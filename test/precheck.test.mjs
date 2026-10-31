/**
 * 提交前检查规则测试：只验证纯规则逻辑（不发请求）。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { LIMITS, runPrecheck } from '../lib/shared.js'

/** @param {object} overrides - 覆盖字段。 @returns {object} 一个健康的语言条目。 */
function healthyLocale(overrides = {}) {
	return {
		locale: 'zh-Hans',
		versionLocId: 'vl-1',
		name: '测试应用',
		subtitle: '副标题',
		keywords: '关键词',
		description: '描述内容',
		whatsNew: '更新说明',
		promotionalText: '推广文本',
		screenshotSets: [
			{ displayType: 'APP_IPHONE_67', label: 'iPhone 6.9"', count: 3 },
			{ displayType: 'APP_IPAD_PRO_3GEN_129', label: 'iPad Pro 13"', count: 2 }
		],
		...overrides
	}
}

test('全部健康 → 单条 ok', () => {
	const results = runPrecheck({ version: { appStoreState: 'PREPARE_FOR_SUBMISSION' }, locales: [healthyLocale()] })
	assert.equal(results.length, 1)
	assert.equal(results[0].level, 'ok')
})

test('描述为空 → err；关键词/更新说明为空 → warn', () => {
	const results = runPrecheck({ version: { appStoreState: 'PREPARE_FOR_SUBMISSION' }, locales: [healthyLocale({ description: '', keywords: '', whatsNew: '' })] })
	const levels = Object.fromEntries(results.map((r) => [r.message, r.level]))
	assert.equal(levels['［zh-Hans］描述为空（必填）'], 'err')
	assert.equal(levels['［zh-Hans］关键词为空（影响搜索曝光）'], 'warn')
	assert.equal(levels['［zh-Hans］更新说明为空（建议填写本次更新内容）'], 'warn')
})

test('字段超限 → err', () => {
	const results = runPrecheck({ version: null, locales: [healthyLocale({ subtitle: '长'.repeat(31) })] })
	assert.ok(results.some((r) => r.level === 'err' && r.message.includes('subtitle 超出 30 字')))
})

test('没有 iPhone 截图（仅 iPad）→ err', () => {
	const results = runPrecheck({ version: null, locales: [healthyLocale({
		screenshotSets: [{ displayType: 'APP_IPAD_PRO_3GEN_129', label: 'iPad Pro 13"', count: 4 }]
	})] })
	const iphoneErr = results.find((r) => r.message.includes('没有 iPhone 截图'))
	assert.equal(iphoneErr?.level, 'err')
})

test('单集合超过 10 张 → err', () => {
	const results = runPrecheck({ version: null, locales: [healthyLocale({ screenshotSets: [{ displayType: 'APP_IPHONE_67', label: 'iPhone 6.9"', count: 11 }] })] })
	assert.ok(results.some((r) => r.level === 'err' && r.message.includes('超过每集合 10 张上限')))
})

test('缺 iPad 13" 截图 → warn（不影响通过级）', () => {
	const results = runPrecheck({ version: null, locales: [healthyLocale({ screenshotSets: [{ displayType: 'APP_IPHONE_67', label: 'iPhone 6.9"', count: 3 }] })] })
	const ipadWarn = results.find((r) => r.message.includes('没有 iPad 13" 截图'))
	assert.equal(ipadWarn?.level, 'warn')
})

test('草稿版本下没有任何语言本地化 → err', () => {
	const results = runPrecheck({ version: { appStoreState: 'PREPARE_FOR_SUBMISSION' }, locales: [] })
	assert.equal(results[0].level, 'err')
	assert.ok(results[0].message.includes('没有任何语言本地化'))
})

test('无 versionLocId 的语言被跳过', () => {
	const results = runPrecheck({ version: null, locales: [healthyLocale({ versionLocId: '', description: '' })] })
	assert.deepEqual(results, [])
})

test('结果按严重度排序（err 在前）', () => {
	const results = runPrecheck({ version: null, locales: [healthyLocale({ description: '', whatsNew: '' })] })
	const firstErr = results.findIndex((r) => r.level === 'err')
	const lastErr = results.map((r) => r.level).lastIndexOf('err')
	const firstWarn = results.findIndex((r) => r.level === 'warn')
	assert.ok(firstErr !== -1 && firstWarn !== -1)
	assert.ok(lastErr < firstWarn)
})

test('does not accept an eleven inch iPad set as thirteen inch coverage', () => {
	const input = healthyLocale({ screenshotSets: [
		{ displayType: 'APP_IPHONE_67', count: 1 },
		{ displayType: 'APP_IPAD_PRO_3GEN_11', count: 1 }
	] })
	assert.ok(runPrecheck({ version: {}, locales: [input] }).some((item) => item.message.includes('没有 iPad 13')))
	input.screenshotSets.push({ displayType: 'APP_IPAD_PRO_3GEN_129', count: 1 })
	assert.equal(runPrecheck({ version: {}, locales: [input] })[0].level, 'ok')
})

test('does not count pending screenshots as ready coverage', () => {
	const input = healthyLocale({ screenshotSets: [
		{ displayType: 'APP_IPHONE_67', label: 'iPhone', count: 2, readyCount: 0 },
		{ displayType: 'APP_IPAD_PRO_3GEN_129', label: 'iPad 13', count: 1, readyCount: 0 }
	] })
	const results = runPrecheck({ version: {}, locales: [input] })
	assert.ok(results.some((item) => item.level === 'err' && item.message.includes('iPhone')))
	assert.ok(results.some((item) => item.message.includes('没有 iPad 13')))
	assert.ok(!results.some((item) => item.level === 'ok'))
})

test('returns English and Chinese messages for successful and missing-localization checks', () => {
	const healthy = runPrecheck({ version: {}, locales: [healthyLocale()] })[0]
	assert.equal(healthy.level, 'ok')
	assert.match(healthy.message, /本工具已覆盖/)
	assert.match(healthy.messageEn, /checks covered by this tool passed/)
	assert.match(healthy.messageEn, /subject to ASC validation/)
	const missing = runPrecheck({ version: {}, locales: [] })[0]
	assert.equal(missing.level, 'err')
	assert.match(missing.message, /没有任何语言本地化/)
	assert.equal(missing.messageEn, 'The draft version has no localizations and cannot be submitted.')
})

test('provides English explanations for every required-field and screenshot warning', () => {
	const results = runPrecheck({ version: {}, locales: [healthyLocale({
		locale: 'en-US', description: '', keywords: '', whatsNew: '',
		screenshotSets: [{ displayType: 'APP_IPHONE_67', label: 'iPhone 6.9"', count: 11, readyCount: 0 }]
	})] })
	const messages = results.map((item) => item.messageEn)
	assert.equal(results.length, 7)
	for (const expected of [
		'[en-US] Description is required.',
		'[en-US] Keywords are empty, which may reduce search visibility.',
		"[en-US] What's New is empty. Describe the changes in this version.",
		'[en-US] At least one completed iPhone screenshot is required; iPad screenshots cannot replace it.',
		'[en-US] iPhone 6.9" has screenshots that are still processing or failed. Check their status in ASC.',
		'[en-US] iPhone 6.9" has 11 screenshots, exceeding the limit of 10 per set.',
		'[en-US] No 13-inch iPad screenshots are available. They are required if the app supports iPadOS.'
	]) assert.ok(messages.includes(expected), `Missing English message: ${expected}`)
	assert.ok(results.every((item) => typeof item.message === 'string' && !/[\u4e00-\u9fff]/u.test(item.messageEn)))
})

test('uses readable English field names and correct limits in over-limit messages', () => {
	const names = { name: 'Name', subtitle: 'Subtitle', keywords: 'Keywords', promotionalText: 'Promotional text', description: 'Description', whatsNew: "What's New" }
	for (const [field, label] of Object.entries(names)) {
		const limit = LIMITS[field]
		const [result] = runPrecheck({ version: {}, locales: [healthyLocale({ locale: 'en-US', [field]: 'x'.repeat(limit + 1) })] })
		assert.equal(result.level, 'err')
		assert.equal(result.messageEn, `[en-US] ${label} exceeds the ${limit}-character limit (currently ${limit + 1} characters).`)
		assert.ok(result.message.includes(`${field} 超出 ${limit} 字上限`))
	}
})
