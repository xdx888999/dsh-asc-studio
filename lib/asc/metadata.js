/**
 * ASC 文案读写业务层：列 App、取可编辑版本与本地化、逐条写回。
 *
 * @module dsh-asc-studio/asc/metadata
 */

import { LIMITS, FIELD_DEFS, isVersionEditable, charCount } from '../shared.js'
import { AscClient, AscError, describeError } from './client.js'

/** 列 App 一次最多取多少条。 */
const APPS_LIMIT = 200
/** iTunes Lookup 超时（毫秒），仅用于给已上架 App 拿图标。 */
const ICON_LOOKUP_TIMEOUT_MS = 5_000
/** 一次同步允许的最大条数。 */
export const MAX_SYNC_ITEMS = 200

/** @type {Map<string, string | undefined>} appId → 图标 URL（拿不到就记 undefined，避免反复探测）。 */
const iconCache = new Map()

/**
 * 尽力而为地取 App 图标（iTunes Lookup，只对已上架 App 有效；失败静默）。
 * @param {string} appId - ASC 的 App appleId。
 * @returns {Promise<string | undefined>} 图标 URL 或 undefined。
 */
export async function lookupIconUrl(appId) {
	const cached = iconCache.get(appId)
	if (cached !== undefined) return cached
	if (iconCache.has(appId)) return undefined
	try {
		const response = await fetch(`https://itunes.apple.com/lookup?id=${encodeURIComponent(appId)}&limit=1`, {
			signal: AbortSignal.timeout(ICON_LOOKUP_TIMEOUT_MS)
		})
		const body = await response.json()
		const result = Array.isArray(body?.results) ? body.results[0] : undefined
		const url = typeof result?.artworkUrl512 === 'string'
			? result.artworkUrl512
			: typeof result?.artworkUrl100 === 'string' ? result.artworkUrl100 : undefined
		iconCache.set(appId, url)
		return url
	} catch {
		iconCache.set(appId, undefined)
		return undefined
	}
}

/**
 * 版本字符串语义比较（`1.10.2` > `1.9.9`；不可解析的按原样比较兜底）。
 * @param {string} left - 左值。
 * @param {string} right - 右值。
 * @returns {number} 比较结果。
 */
export function compareVersionStrings(left, right) {
	const asParts = (value) => String(value ?? '').split(/[.]/).map((part) => /^\d+$/.test(part) ? Number(part) : part)
	const a = asParts(left)
	const b = asParts(right)
	for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
		const pa = a[index]
		const pb = b[index]
		if (pa === undefined) return -1
		if (pb === undefined) return 1
		if (typeof pa === 'number' && typeof pb === 'number') {
			if (pa !== pb) return pa - pb
			continue
		}
		const textCompare = String(pa).localeCompare(String(pb))
		if (textCompare !== 0) return textCompare
	}
	return 0
}

/**
 * 列出账号下的 App。
 * @param {AscClient} client - API 客户端。
 * @returns {Promise<{ id: string, name: string, bundleId: string, primaryLocale: string, sku: string, iconUrl?: string }[]>}
 */
export async function listApps(client) {
	const { body } = await client.get(`/v1/apps?limit=${APPS_LIMIT}&sort=name`)
	const apps = (Array.isArray(body?.data) ? body.data : []).map((entry) => ({
		id: String(entry?.id ?? ''),
		name: String(entry?.attributes?.name ?? ''),
		bundleId: String(entry?.attributes?.bundleId ?? ''),
		primaryLocale: String(entry?.attributes?.primaryLocale ?? ''),
		sku: String(entry?.attributes?.sku ?? '')
	})).filter((app) => app.id !== '')
	// 列表先返回，未缓存的图标由前端限并发加载，避免每个 App 等待一次网络超时。
	for (const app of apps) {
		const iconUrl = iconCache.get(app.id)
		if (iconUrl !== undefined) app.iconUrl = iconUrl
	}
	return apps
}

/**
 * 从一组 AppInfo 里挑选用于展示/编辑的那条：优先可编辑状态，其次非 READY_FOR_SALE，
 * 都不行就取第一条。
 * @param {object[]} appInfos - `GET /v1/apps/{id}/appInfos` 的 data。
 * @returns {object | undefined} 选中的 appInfo。
 */
export function pickAppInfo(appInfos) {
	const list = Array.isArray(appInfos) ? appInfos.filter((entry) => entry?.id !== undefined) : []
	if (list.length === 0) return undefined
	const stateOf = (entry) => String(entry?.attributes?.appStoreState ?? '')
	return list.find((entry) => isVersionEditable(stateOf(entry)))
		?? list.find((entry) => stateOf(entry) !== 'READY_FOR_SALE')
		?? list[0]
}

/**
 * 取一个 App 的完整文案详情（版本 + 两种本地化按语言合并）。
 *
 * 版本选择：优先“可编辑状态里版本号最高的”；没有可编辑版本时取版本号最高的
 * 一条并标记只读——推广文本（promotionalText）在已上架版本上仍可改。
 *
 * @param {AscClient} client - API 客户端。
 * @param {string} appId - App id。
 * @returns {Promise<object>} 面板详情（结构见 README）。
 */
export async function getAppDetail(client, appId) {
	if (!/^\d+$/.test(String(appId ?? ''))) {
		throw new AscError('REQUEST', 'App id 不合法')
	}

	const versionsRes = await client.get(`/v1/apps/${appId}/appStoreVersions?filter[platform]=IOS&limit=50`)
	const versions = Array.isArray(versionsRes.body?.data) ? versionsRes.body.data : []
	const sortedVersions = versions.slice().sort((a, b) =>
		compareVersionStrings(b?.attributes?.versionString, a?.attributes?.versionString))
	const selectedVersion = sortedVersions.find((entry) => isVersionEditable(entry?.attributes?.appStoreState)) ?? sortedVersions[0] ?? null
	const versionEditable = selectedVersion !== null && isVersionEditable(selectedVersion?.attributes?.appStoreState)

	const appInfosRes = await client.get(`/v1/apps/${appId}/appInfos?limit=10`)
	const appInfo = pickAppInfo(appInfosRes.body?.data)

	/** @type {Map<string, object>} locale → 合并条目。 */
	const localeMap = new Map()
	const entryFor = (locale) => {
		let entry = localeMap.get(locale)
		if (entry === undefined) {
			entry = { locale }
			localeMap.set(locale, entry)
		}
		return entry
	}

	if (appInfo !== undefined) {
		const res = await client.get(`/v1/appInfos/${appInfo.id}/appInfoLocalizations?limit=50`)
		for (const loc of Array.isArray(res.body?.data) ? res.body.data : []) {
			const entry = entryFor(String(loc?.attributes?.locale ?? ''))
			entry.appInfoLocId = String(loc?.id ?? '')
			entry.name = String(loc?.attributes?.name ?? '')
			entry.subtitle = String(loc?.attributes?.subtitle ?? '')
		}
	}

	if (selectedVersion !== null) {
		const res = await client.get(`/v1/appStoreVersions/${selectedVersion.id}/appStoreVersionLocalizations?limit=50`)
		for (const loc of Array.isArray(res.body?.data) ? res.body.data : []) {
			const entry = entryFor(String(loc?.attributes?.locale ?? ''))
			entry.versionLocId = String(loc?.id ?? '')
			entry.description = String(loc?.attributes?.description ?? '')
			entry.keywords = String(loc?.attributes?.keywords ?? '')
			entry.whatsNew = String(loc?.attributes?.whatsNew ?? '')
			entry.promotionalText = String(loc?.attributes?.promotionalText ?? '')
			entry.marketingUrl = String(loc?.attributes?.marketingUrl ?? '')
			entry.supportUrl = String(loc?.attributes?.supportUrl ?? '')
		}
	}

	const primary = await client.get(`/v1/apps/${appId}`)
	const appAttributes = primary.body?.data?.attributes ?? {}

	const locales = [...localeMap.values()]
	locales.sort((a, b) => {
		if (a.locale === appAttributes.primaryLocale) return -1
		if (b.locale === appAttributes.primaryLocale) return 1
		return a.locale.localeCompare(b.locale)
	})

	return {
		app: {
			id: appId,
			name: String(appAttributes.name ?? ''),
			bundleId: String(appAttributes.bundleId ?? ''),
			primaryLocale: String(appAttributes.primaryLocale ?? ''),
			sku: String(appAttributes.sku ?? '')
		},
		version: selectedVersion === null ? null : {
			id: String(selectedVersion.id ?? ''),
			versionString: String(selectedVersion.attributes?.versionString ?? ''),
			appStoreState: String(selectedVersion.attributes?.appStoreState ?? ''),
			editable: versionEditable,
			// 只读版本上仅推广文本可改（Apple 允许随时更新 promotionalText）。
			promoOnly: !versionEditable
		},
		appInfo: appInfo === undefined ? null : {
			id: String(appInfo.id ?? ''),
			appStoreState: String(appInfo.attributes?.appStoreState ?? ''),
			editable: isVersionEditable(appInfo.attributes?.appStoreState)
		},
		locales
	}
}

/**
 * 服务端校验单条同步改动，返回可直接 PATCH 的 attributes（已裁剪为白名单字段）。
 * @param {object} op - `{ target, id, attributes, baseValues }`；baseValues 是用户确认的原文。
 * @returns {{ target: string, id: string, attributes: object, baseValues: object }} 校验后的操作。
 */
export function validateSyncOp(op) {
	const target = String(op?.target ?? '')
	const id = String(op?.id ?? '')
	const attributes = op?.attributes
	if (id === '' || attributes === null || typeof attributes !== 'object' || Array.isArray(attributes)) {
		throw new AscError('REQUEST', '同步条目格式不正确')
	}
	if (!op.baseValues || typeof op.baseValues !== 'object' || Array.isArray(op.baseValues)) {
		throw new AscError('REQUEST', '同步缺少已确认的原文，请刷新插件页面后重新核对改动')
	}
	const defs = FIELD_DEFS.filter((def) => def.target === target)
	if (defs.length === 0) {
		throw new AscError('REQUEST', `未知的写回目标：${target}`)
	}
	const cleaned = {}, baseValues = {}
	for (const def of defs) {
		if (!Object.hasOwn(attributes, def.key)) continue
		if (!Object.hasOwn(op.baseValues, def.key) || typeof op.baseValues[def.key] !== 'string') {
			throw new AscError('REQUEST', `字段 ${def.key} 缺少已确认的原文，请刷新插件页面后重新核对改动`)
		}
		const value = attributes[def.key]
		if (value !== null && typeof value !== 'string') {
			throw new AscError('REQUEST', `字段 ${def.key} 必须是文本`)
		}
		const text = value === null ? '' : value
		if (charCount(text) > def.limit) {
			throw new AscError('VALIDATION', `字段 ${def.key} 超出 ${def.limit} 字上限（当前 ${charCount(text)} 字）`)
		}
		cleaned[def.key] = text
		baseValues[def.key] = op.baseValues[def.key]
	}
	if (Object.keys(cleaned).length === 0) {
		throw new AscError('REQUEST', '同步条目没有可写回的字段')
	}
	return { target, id, attributes: cleaned, baseValues }
}

/** 每次实际 PATCH（包括重试）前读取该资源；已是目标值时无需再次写入。 */
async function checkSyncBaseline(client, path, op) {
	const response = await client.get(path)
	const data = response.body?.data
	if (data?.id !== op.id || data.type !== `${op.target}s` || !data.attributes || typeof data.attributes !== 'object' || Array.isArray(data.attributes)) {
		throw new AscError('SERVER', '无法核对 ASC 最新原文，已停止该项同步，请刷新后重试')
	}
	let alreadyApplied = true
	for (const [field, value] of Object.entries(op.attributes)) {
		const current = data.attributes[field] ?? ''
		if (typeof current !== 'string') throw new AscError('SERVER', 'ASC 字段格式异常，已停止该项同步')
		if (current === value) continue
		alreadyApplied = false
		if (current !== op.baseValues[field]) {
			throw new AscError('COPY_CONFLICT', 'ASC 中的该字段已被修改，本次未覆盖。本地草稿已保留，请重新打开改动对比，核对最新原文后再确认同步。')
		}
	}
	return alreadyApplied ? response : undefined
}

/**
 * 逐条核对原文后写回。冲突或失败不影响其他条目；结果按序返回。
 * @param {AscClient} client - API 客户端。
 * @param {object[]} ops - `[{ target, id, attributes, baseValues }]`。
 * @returns {Promise<{ index: number, ok: boolean, id?: string, error?: string, code?: string }[]>}
 */
export async function applySyncOps(client, ops) {
	const results = []
	const list = Array.isArray(ops) ? ops.slice(0, MAX_SYNC_ITEMS) : []
	for (let index = 0; index < list.length; index += 1) {
		const op = list[index]
		try {
			const validated = validateSyncOp(op)
			const path = `/v1/${validated.target}s/${encodeURIComponent(validated.id)}`
			// 注意：JSON:API 的 type 必须用复数形式（appStoreVersionLocalizations /
			// appInfoLocalizations），Apple 对单数 type 会直接 409。
			await client.patch(path, {
				data: { type: `${validated.target}s`, id: validated.id, attributes: validated.attributes }
			}, { beforeAttempt: () => checkSyncBaseline(client, path, validated) })
			results.push({ index, ok: true, id: validated.id })
		} catch (error) {
			// Apple 的 errors[].detail 常常才是真正的原因（如版本状态、字段约束），必须透传给面板。
			const base = describeError(error)
			const detail = error?.detail
			results.push({
				index,
				ok: false,
				id: typeof op?.id === 'string' ? op.id : undefined,
				error: detail && detail !== base ? `${base}｜Apple: ${detail}` : base,
				code: error instanceof AscError ? error.code : 'SERVER'
			})
		}
	}
	return results
}

export { LIMITS, isVersionEditable }
