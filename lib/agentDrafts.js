/** Agent 只能读取白名单文案并暂存会话草稿；这里不持有凭据或 ASC 写入能力。 */
import { randomUUID } from 'node:crypto'
import { FIELD_DEFS, LIMITS, charCount } from './shared.js'

export const AGENT_DRAFT_LIMITS = Object.freeze({
	ttlMs: 30 * 60 * 1000,
	contexts: 64,
	drafts: 32,
	changes: 200,
	draftBytes: 256 * 1024,
	listingBytes: 1024 * 1024,
	apps: 200,
	locales: 100
})

const MESSAGES = Object.freeze({
	SESSION: '需要有效的当前 Agent 会话。',
	REQUEST: '草稿参数无效；请使用读取结果中的上下文、语言和六个文案字段。',
	SOURCE: '无法读取 App Store 文案；请在面板检查账号连接后重试。',
	CONTEXT: '读取上下文已失效或不属于当前会话，请重新读取文案。',
	CONFLICT: '远端版本、语言资源或原文已变化，请重新读取后生成草稿。',
	READ_ONLY: '该语言字段当前不可编辑，请按读取结果中的 editableFields 生成草稿。',
	LIMIT: '草稿超过字段长度、条目数量或总大小限制。',
	CAPACITY: '暂存容量已满，请在面板处理已有草稿，或等待读取上下文过期后重试。',
	EMPTY: '草稿没有实际文案改动。',
	ABORTED: '操作已取消，未暂存新草稿。'
})

export class AgentDraftError extends Error {
	constructor(code) {
		super(MESSAGES[code] ?? MESSAGES.REQUEST)
		this.name = 'AgentDraftError'
		this.code = Object.hasOwn(MESSAGES, code) ? code : 'REQUEST'
	}
}

function fail(code) { throw new AgentDraftError(code) }
function copy(value) { return structuredClone(value) }
function plainRecord(value) {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
	const prototype = Object.getPrototypeOf(value)
	if (prototype !== null) {
		const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value
		// DSH 的 VM/PTC 对象来自另一个 realm，不能用 Object.prototype 身份做判断。
		if (Object.getPrototypeOf(prototype) !== null || typeof constructor !== 'function'
			|| constructor.name !== 'Object' || constructor.prototype !== prototype
			|| Function.prototype.toString.call(constructor) !== 'function Object() { [native code] }') return false
	}
	return Reflect.ownKeys(value).every((key) => {
		const property = Object.getOwnPropertyDescriptor(value, key)
		return typeof key === 'string' && property.enumerable && Object.hasOwn(property, 'value')
	})
}

export function validateAgentSessionId(sessionId) {
	if (typeof sessionId !== 'string' || !/^[^\s\u0000-\u001f\u007f]{1,256}$/u.test(sessionId)
		|| ['__proto__', 'prototype', 'constructor'].includes(sessionId)) fail('SESSION')
	return sessionId
}

function validAppId(appId) {
	if (typeof appId !== 'string' || !/^\d{1,32}$/.test(appId)) fail('REQUEST')
	return appId
}

function sourceText(value, maxLength = 1024) {
	if (value === undefined || value === null) return ''
	if (typeof value !== 'string' || value.length > maxLength) fail('SOURCE')
	return value
}

function appView(app) {
	if (!plainRecord(app) || typeof app.id !== 'string' || !/^\d{1,32}$/.test(app.id)) fail('SOURCE')
	return {
		id: app.id,
		name: sourceText(app.name),
		bundleId: sourceText(app.bundleId),
		primaryLocale: sourceText(app.primaryLocale, 64)
	}
}

function resourceView(resource, version = false) {
	if (resource === undefined || resource === null) return null
	if (!plainRecord(resource)) fail('SOURCE')
	const id = sourceText(resource.id, 256)
	if (id === '') fail('SOURCE')
	const result = { id, appStoreState: sourceText(resource.appStoreState, 128), editable: resource.editable === true }
	if (version) {
		result.versionString = sourceText(resource.versionString, 128)
		result.promoOnly = resource.promoOnly === true
	}
	return result
}

function targetId(entry, field) {
	return field === 'name' || field === 'subtitle' ? entry.appInfoLocId : entry.versionLocId
}

function listingView(detail, appId) {
	if (!plainRecord(detail) || !Array.isArray(detail.locales) || detail.locales.length > AGENT_DRAFT_LIMITS.locales) fail('SOURCE')
	const app = appView(detail.app)
	if (app.id !== appId) fail('SOURCE')
	const version = resourceView(detail.version, true)
	const appInfo = resourceView(detail.appInfo)
	const seen = new Set()
	const locales = detail.locales.map((entry) => {
		if (!plainRecord(entry)) fail('SOURCE')
		const locale = sourceText(entry.locale, 64)
		if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale) || seen.has(locale)) fail('SOURCE')
		seen.add(locale)
		const result = {
			locale,
			appInfoLocId: sourceText(entry.appInfoLocId, 256),
			versionLocId: sourceText(entry.versionLocId, 256)
		}
		for (const { key } of FIELD_DEFS) result[key] = sourceText(entry[key], 32000)
		result.editableFields = FIELD_DEFS.filter(({ key, target }) => {
			if (!targetId(result, key)) return false
			return target === 'appInfoLocalization'
				? appInfo?.editable === true
				: version !== null && (version.editable || (version.promoOnly && key === 'promotionalText'))
		}).map(({ key }) => key)
		return result
	})
	const result = { app, version, appInfo, locales, limits: { ...LIMITS } }
	if (Buffer.byteLength(JSON.stringify(result), 'utf8') > AGENT_DRAFT_LIMITS.listingBytes) fail('SOURCE')
	return result
}

function validateChanges(input) {
	if (!plainRecord(input) || Object.keys(input).some((key) => !['contextId', 'changes'].includes(key))
		|| typeof input.contextId !== 'string' || input.contextId.length > 128 || input.contextId === ''
		|| !Array.isArray(input.changes) || input.changes.length === 0) fail('REQUEST')
	if (input.changes.length > AGENT_DRAFT_LIMITS.changes) fail('LIMIT')
	const seen = new Set()
	let bytes = 0
	const changes = input.changes.map((change) => {
		if (!plainRecord(change) || Object.keys(change).length !== 3
			|| !Object.hasOwn(change, 'locale') || !Object.hasOwn(change, 'field') || !Object.hasOwn(change, 'value')
			|| typeof change.locale !== 'string' || change.locale.length > 64
			|| typeof change.field !== 'string' || !Object.hasOwn(LIMITS, change.field)
			|| typeof change.value !== 'string') fail('REQUEST')
		if (change.value.length > LIMITS[change.field] * 2 || charCount(change.value) > LIMITS[change.field]) fail('LIMIT')
		const key = `${change.locale}\u0000${change.field}`
		if (seen.has(key)) fail('REQUEST')
		seen.add(key)
		bytes += Buffer.byteLength(JSON.stringify(change), 'utf8')
		if (bytes > AGENT_DRAFT_LIMITS.draftBytes) fail('LIMIT')
		return { locale: change.locale, field: change.field, value: change.value }
	})
	return { contextId: input.contextId, changes }
}

/** 回调接收 sessionId、AbortSignal；readListing 还接收经过验证的 App id。 */
export function createAgentDraftBridge({ listApps: fetchApps, readListing: fetchListing, now = Date.now }) {
	if (typeof fetchApps !== 'function' || typeof fetchListing !== 'function' || typeof now !== 'function') throw new TypeError('Agent draft callbacks are required')
	const contexts = new Map()
	const drafts = new Map()
	let epoch = 0
	const prune = () => {
		const time = now()
		for (const [id, value] of contexts) if (value.expiresAt <= time) contexts.delete(id)
		for (const [id, value] of drafts) if (value.expiresAt <= time) drafts.delete(id)
	}
	const check = (generation, signal) => {
		if (signal?.aborted) fail('ABORTED')
		if (generation !== epoch) fail('CONTEXT')
	}
	const fetchSafely = async (callback, args, generation, signal) => {
		check(generation, signal)
		let result
		try { result = await callback(...args) } catch {
			check(generation, signal)
			fail('SOURCE')
		}
		check(generation, signal)
		return result
	}
	return {
		async listApps(sessionId, signal) {
			validateAgentSessionId(sessionId)
			prune()
			const result = await fetchSafely(fetchApps, [sessionId, signal], epoch, signal)
			if (!Array.isArray(result) || result.length > AGENT_DRAFT_LIMITS.apps) fail('SOURCE')
			return result.map(appView)
		},
		async readListing(sessionId, appId, signal) {
			validateAgentSessionId(sessionId)
			validAppId(appId)
			prune()
			if (contexts.size >= AGENT_DRAFT_LIMITS.contexts) fail('CAPACITY')
			const generation = epoch
			const raw = await fetchSafely(fetchListing, [sessionId, appId, signal], generation, signal)
			const listing = listingView(raw, appId)
			check(generation, signal)
			prune()
			if (contexts.size >= AGENT_DRAFT_LIMITS.contexts) fail('CAPACITY')
			const contextId = randomUUID()
			contexts.set(contextId, { sessionId, listing, expiresAt: now() + AGENT_DRAFT_LIMITS.ttlMs })
			return copy({ contextId, ...listing })
		},
		async stageDraft(sessionId, input, signal) {
			validateAgentSessionId(sessionId)
			const { contextId, changes } = validateChanges(input)
			prune()
			const generation = epoch
			check(generation, signal)
			const context = contexts.get(contextId)
			if (!context || context.sessionId !== sessionId) fail('CONTEXT')
			if (drafts.size >= AGENT_DRAFT_LIMITS.drafts) fail('CAPACITY')
			const listing = context.listing
			const planned = changes.map((change) => {
				const entry = listing.locales.find((item) => item.locale === change.locale)
				if (!entry) fail('REQUEST')
				if (!entry.editableFields.includes(change.field)) fail('READ_ONLY')
				return { ...change, baseValue: entry[change.field], targetId: targetId(entry, change.field) }
			})
			const effective = planned.filter((change) => change.value !== change.baseValue)
			if (effective.length === 0) fail('EMPTY')
			const raw = await fetchSafely(fetchListing, [sessionId, listing.app.id, signal], generation, signal)
			const current = listingView(raw, listing.app.id)
			check(generation, signal)
			prune()
			if (contexts.get(contextId) !== context) fail('CONTEXT')
			if (current.version?.id !== listing.version?.id || current.version?.versionString !== listing.version?.versionString
				|| current.appInfo?.id !== listing.appInfo?.id || current.app.bundleId !== listing.app.bundleId) fail('CONFLICT')
			for (const change of planned) {
				const entry = current.locales.find((item) => item.locale === change.locale)
				if (!entry || targetId(entry, change.field) !== change.targetId || entry[change.field] !== change.baseValue) fail('CONFLICT')
				if (!entry.editableFields.includes(change.field)) fail('READ_ONLY')
			}
			if (drafts.size >= AGENT_DRAFT_LIMITS.drafts) fail('CAPACITY')
			const created = now()
			const proposal = {
				id: randomUUID(),
				app: { id: listing.app.id, name: listing.app.name, bundleId: listing.app.bundleId },
				versionId: listing.version?.id ?? null,
				versionString: listing.version?.versionString ?? null,
				createdAt: new Date(created).toISOString(),
				changes: effective
			}
			drafts.set(proposal.id, { sessionId, proposal, expiresAt: created + AGENT_DRAFT_LIMITS.ttlMs })
			return copy(proposal)
		},
		pending(sessionId) {
			validateAgentSessionId(sessionId)
			prune()
			return copy([...drafts.values()].filter((entry) => entry.sessionId === sessionId).map((entry) => entry.proposal))
		},
		acknowledge(sessionId, id) {
			validateAgentSessionId(sessionId)
			prune()
			if (typeof id !== 'string' || id.length > 128 || id === '') fail('REQUEST')
			if (drafts.get(id)?.sessionId !== sessionId) return false
			return drafts.delete(id)
		},
		clear() {
			// 账号切换/断开和插件卸载后，旧请求即使迟到也不能重新创建上下文或草稿。
			epoch += 1
			contexts.clear()
			drafts.clear()
		}
	}
}
