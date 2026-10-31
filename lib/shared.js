/**
 * dsh-asc-studio 的纯逻辑层：字段上限、可编辑状态、字符计数、改动对比。
 *
 * 零依赖（node / 浏览器通用的纯 ESM），host 半与单元测试直接 import；
 * 浏览器端 `lib/client.js` 无法从这里 import（DSH client 打包环境的
 * `require` 只保证 `react` 可用），所以那里保留了一份逐字相同的副本——
 * 修改任何一处时务必同步另一处，`test/diff.test.mjs` 守护本文件的语义。
 *
 * @module dsh-asc-studio/shared
 */

/** App Store Connect 文案字段的字符上限（按 Unicode 码点数，中英文都算 1 个）。 */
export const LIMITS = Object.freeze({
	name: 30,
	subtitle: 30,
	keywords: 100,
	promotionalText: 170,
	description: 4000,
	whatsNew: 4000
})

/** 字段 → 写回目标与字段元信息。顺序即主面板的展示顺序。 */
export const FIELD_DEFS = Object.freeze([
	{ key: 'name', target: 'appInfoLocalization', limit: LIMITS.name, multiline: false },
	{ key: 'subtitle', target: 'appInfoLocalization', limit: LIMITS.subtitle, multiline: false },
	{ key: 'keywords', target: 'appStoreVersionLocalization', limit: LIMITS.keywords, multiline: false },
	{ key: 'promotionalText', target: 'appStoreVersionLocalization', limit: LIMITS.promotionalText, multiline: false },
	{ key: 'description', target: 'appStoreVersionLocalization', limit: LIMITS.description, multiline: true },
	{ key: 'whatsNew', target: 'appStoreVersionLocalization', limit: LIMITS.whatsNew, multiline: true }
])

/**
 * 允许在 App Store Connect 后台继续编辑版本文案的 `appStoreState`。
 *
 * 这是按开发文档给出的**保守**清单（PREPARE_FOR_SUBMISSION / DEVELOPER_REJECTED /
 * REJECTED / METADATA_REJECTED）；完整可编辑状态列表未在 Apple 文档逐页核对。
 * 保守的代价是：个别实际可编辑的状态会被当作只读展示（推广文本仍可改），
 * 而不会出现“改了却 409”的误导。
 */
export const EDITABLE_VERSION_STATES = Object.freeze(new Set([
	'PREPARE_FOR_SUBMISSION',
	'DEVELOPER_REJECTED',
	'REJECTED',
	'METADATA_REJECTED'
]))

/**
 * 版本状态是否可编辑。
 * @param {string | undefined | null} state - `appStoreState`。
 * @returns {boolean} 可编辑时为 true。
 */
export function isVersionEditable(state) {
	return EDITABLE_VERSION_STATES.has(String(state ?? ''))
}

/**
 * 按 Unicode 码点数数字符（emoji、扩展平面字符算 1 个）。
 * @param {string} value - 任意文本。
 * @returns {number} 码点数。
 */
export function charCount(value) {
	if (value === undefined || value === null) return 0
	let count = 0
	for (const _ of String(value)) count += 1
	return count
}

/**
 * 字段值是否超出上限。
 * @param {string} field - `LIMITS` 中的字段名。
 * @param {string} value - 当前值。
 * @returns {boolean} 超限为 true。
 */
export function isOverLimit(field, value) {
	const limit = LIMITS[field]
	if (limit === undefined) return false
	return charCount(value) > limit
}

/**
 * 从面板草稿算出待同步的改动清单（主机端只做最终校验，对比以这里为准）。
 *
 * @param {object[]} locales - 详情接口返回的 `locales` 数组，每项含
 *   `locale`、`appInfoLocId`、`versionLocId` 与六个字段的服务器值。
 * @param {Record<string, Record<string, string>>} drafts - `{ [locale]: { [field]: value } }`。
 * @returns {{ locale: string, field: string, target: string, id: string,
 *             oldValue: string, newValue: string }[]} 改动列表（按语言、字段排序）。
 */
export function buildChanges(locales, drafts) {
	const changes = []
	for (const entry of Array.isArray(locales) ? locales : []) {
		const draft = drafts?.[entry.locale]
		if (draft === undefined || draft === null) continue
		for (const def of FIELD_DEFS) {
			if (!(def.key in draft)) continue
			const targetId = def.target === 'appInfoLocalization' ? entry.appInfoLocId : entry.versionLocId
			// 没有对应本地化资源 id 的字段不可写（例如该语言还没有版本本地化）。
			if (typeof targetId !== 'string' || targetId === '') continue
			const newValue = String(draft[def.key] ?? '')
			const oldValue = String(entry[def.key] ?? '')
			if (newValue === oldValue) continue
			changes.push({
				locale: entry.locale,
				field: def.key,
				target: def.target,
				id: targetId,
				oldValue,
				newValue
			})
		}
	}
	changes.sort((left, right) => left.locale.localeCompare(right.locale) || left.field.localeCompare(right.field))
	return changes
}

/**
 * 改动里是否存在超限字段（存在则禁止同步）。
 * @param {{ field: string, newValue: string }[]} changes - `buildChanges` 的结果。
 * @returns {boolean} 任一改动超限为 true。
 */
export function hasOverLimitChange(changes) {
	return changes.some((change) => isOverLimit(change.field, change.newValue))
}

/**
 * 提交前检查：对版本文案与截图完整性跑一组确定性规则。
 *
 * 输入全部来自 ASC 已有数据（host 组装），本函数纯计算、零请求。
 * 规则级别：err = 大概率被拒/无法提交；warn = 建议处理；ok = 全部通过。
 *
 * @param {object} input - 检查输入。
 * @param {{ appStoreState: string } | null} input.version - 当前选中版本。
 * @param {object[]} input.locales - 每语言数据：
 *   { locale, versionLocId, name, subtitle, keywords, description, whatsNew,
 *     promotionalText, screenshotSets: [{ displayType, label, count }] }。
 * @returns {{ level: 'ok' | 'warn' | 'err', message: string, messageEn: string }[]} 双语检查结果（按严重度排序）。
 */
export function runPrecheck({ version, locales }) {
	const results = []
	const push = (level, message, messageEn) => results.push({ level, message, messageEn })
	const fieldNamesEn = {
		name: 'Name', subtitle: 'Subtitle', keywords: 'Keywords',
		promotionalText: 'Promotional text', description: 'Description', whatsNew: "What's New"
	}
	const list = Array.isArray(locales) ? locales : []

	const withVersion = list.filter((entry) => typeof entry.versionLocId === 'string' && entry.versionLocId !== '')
	if (version !== null && version !== undefined && withVersion.length === 0) {
		push('err', '草稿版本下没有任何语言本地化，无法提交', 'The draft version has no localizations and cannot be submitted.')
		return results
	}

	for (const entry of withVersion) {
		const label = `${entry.locale}`
		// ── 必填/建议字段 ──
		if (charCount(entry.description) === 0) push('err', `［${label}］描述为空（必填）`, `[${label}] Description is required.`)
		if (charCount(entry.keywords) === 0) push('warn', `［${label}］关键词为空（影响搜索曝光）`, `[${label}] Keywords are empty, which may reduce search visibility.`)
		if (charCount(entry.whatsNew) === 0) push('warn', `［${label}］更新说明为空（建议填写本次更新内容）`, `[${label}] What's New is empty. Describe the changes in this version.`)
		// ── 超限 ──
		for (const def of FIELD_DEFS) {
			const value = entry[def.key]
			if (typeof value === 'string' && isOverLimit(def.key, value)) {
				push('err', `［${label}］${def.key} 超出 ${def.limit} 字上限（当前 ${charCount(value)} 字）`,
					`[${label}] ${fieldNamesEn[def.key]} exceeds the ${def.limit}-character limit (currently ${charCount(value)} characters).`)
			}
		}
		// ── 截图完整性 ──
		const sets = Array.isArray(entry.screenshotSets) ? entry.screenshotSets : []
		const iphoneShots = sets
			.filter((set) => String(set.displayType).startsWith('APP_IPHONE'))
			.reduce((sum, set) => sum + (Number(set.readyCount ?? set.count) || 0), 0)
		if (iphoneShots === 0) {
			push('err', `［${label}］没有 iPhone 截图（必需至少 1 张，iPad 截图不能替代）`,
				`[${label}] At least one completed iPhone screenshot is required; iPad screenshots cannot replace it.`)
		}
		for (const set of sets) {
			const setLabelEn = set.label || set.displayType || 'Screenshot set'
			if (set.readyCount !== undefined && Number(set.readyCount) < Number(set.count)) {
				push('warn', `［${label}］${set.label} 存在未处理完成或失败的截图，请在 ASC 确认`,
					`[${label}] ${setLabelEn} has screenshots that are still processing or failed. Check their status in ASC.`)
			}
			if ((Number(set.count) || 0) > 10) {
				push('err', `［${label}］${set.label} 有 ${set.count} 张截图，超过每集合 10 张上限`,
					`[${label}] ${setLabelEn} has ${set.count} screenshots, exceeding the limit of 10 per set.`)
			}
		}
		const hasIpad13 = sets.some((set) => set.displayType === 'APP_IPAD_PRO_3GEN_129' && (Number(set.readyCount ?? set.count) || 0) > 0)
		if (!hasIpad13) {
			push('warn', `［${label}］没有 iPad 13" 截图（若 App 支持 iPadOS 则必需）`,
				`[${label}] No 13-inch iPad screenshots are available. They are required if the app supports iPadOS.`)
		}
	}

	if (withVersion.length > 0 && results.length === 0) {
		push('ok', '本工具已覆盖的文案与截图检查通过；提交仍以 ASC 校验为准',
			'The listing text and screenshot checks covered by this tool passed. Submission is still subject to ASC validation.')
	}
	const weight = { err: 0, warn: 1, ok: 2 }
	return results.sort((left, right) => weight[left.level] - weight[right.level])
}
