/**
 * 改动对比测试：buildChanges 只挑出真正变化的、可写的字段。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { buildChanges } from '../lib/shared.js'

/** @returns {object[]} 两种语言的详情（name/subtitle 走 appInfo，其余走 version）。 */
function sampleLocales() {
	return [
		{
			locale: 'zh-Hans',
			appInfoLocId: 'info-zh',
			versionLocId: 'ver-zh',
			name: '测试应用',
			subtitle: '副标题',
			keywords: 'a,b',
			description: '旧描述',
			whatsNew: '修复问题',
			promotionalText: ''
		},
		{
			locale: 'en-US',
			appInfoLocId: 'info-en',
			versionLocId: '',
			name: 'Test App',
			subtitle: 'Sub',
			keywords: 'x',
			description: 'old',
			whatsNew: 'fixes',
			promotionalText: ''
		}
	]
}

test('只挑出变化的字段，并携带正确的 target 与资源 id', () => {
	const drafts = {
		'zh-Hans': { keywords: 'a,b,c', description: '新描述', name: '测试应用' },
		'en-US': { subtitle: 'New sub' }
	}
	const changes = buildChanges(sampleLocales(), drafts)
	assert.deepEqual(changes.map((entry) => [entry.locale, entry.field]), [
		['en-US', 'subtitle'],
		['zh-Hans', 'description'],
		['zh-Hans', 'keywords']
	])
	const byKey = new Map(changes.map((entry) => [`${entry.locale}:${entry.field}`, entry]))
	assert.equal(byKey.get('zh-Hans:keywords').target, 'appStoreVersionLocalization')
	assert.equal(byKey.get('zh-Hans:keywords').id, 'ver-zh')
	assert.equal(byKey.get('zh-Hans:keywords').oldValue, 'a,b')
	assert.equal(byKey.get('zh-Hans:description').oldValue, '旧描述')
})

test('en-US 没有版本本地化（versionLocId 为空）时，版本字段不可产生改动', () => {
	const drafts = { 'en-US': { whatsNew: 'brand new', name: 'Test App 2' } }
	const changes = buildChanges(sampleLocales(), drafts)
	assert.equal(changes.some((entry) => entry.locale === 'en-US' && entry.field === 'whatsNew'), false)
	assert.deepEqual(changes.map((entry) => entry.field), ['name'])
	assert.equal(changes[0].id, 'info-en')
	assert.equal(changes[0].target, 'appInfoLocalization')
})

test('草稿与服务器值相同 → 无改动', () => {
	const drafts = { 'zh-Hans': { name: '测试应用', subtitle: '副标题', keywords: 'a,b', description: '旧描述', whatsNew: '修复问题', promotionalText: '' } }
	assert.deepEqual(buildChanges(sampleLocales(), drafts), [])
})

test('改动按语言再按字段排序，输出稳定', () => {
	const drafts = {
		'zh-Hans': { whatsNew: 'w', keywords: 'k', description: 'd' },
		'en-US': { name: 'n' }
	}
	const changes = buildChanges(sampleLocales(), drafts)
	assert.deepEqual(changes.map((entry) => `${entry.locale}:${entry.field}`), [
		'en-US:name',
		'zh-Hans:description',
		'zh-Hans:keywords',
		'zh-Hans:whatsNew'
	])
})
