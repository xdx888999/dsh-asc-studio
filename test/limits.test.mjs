/**
 * 字段上限与可编辑状态测试（对应开发文档第 3 节的表格）。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { LIMITS, charCount, isOverLimit, isVersionEditable, hasOverLimitChange } from '../lib/shared.js'

test('字段上限与文档一致', () => {
	assert.deepEqual(LIMITS, {
		name: 30,
		subtitle: 30,
		keywords: 100,
		promotionalText: 170,
		description: 4000,
		whatsNew: 4000
	})
})

test('charCount 按码点计数：中文、英文、emoji 都算 1 个', () => {
	assert.equal(charCount('你好世界'), 4)
	assert.equal(charCount('hello'), 5)
	assert.equal(charCount('👍🏽'), 2) // emoji + 肤色修饰符 = 2 个码点
	assert.equal(charCount(''), 0)
	assert.equal(charCount(undefined), 0)
})

test('isOverLimit 的临界行为', () => {
	assert.equal(isOverLimit('subtitle', '一'.repeat(30)), false)
	assert.equal(isOverLimit('subtitle', '一'.repeat(31)), true)
	assert.equal(isOverLimit('keywords', 'a'.repeat(100)), false)
	assert.equal(isOverLimit('keywords', 'a'.repeat(101)), true)
	assert.equal(isOverLimit('name', 'x'.repeat(31)), true)
	assert.equal(isOverLimit('unknownField', 'x'.repeat(999)), false)
})

test('可编辑版本状态：文档列出的四种可编辑，其余只读', () => {
	for (const state of ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED']) {
		assert.equal(isVersionEditable(state), true, state)
	}
	for (const state of ['READY_FOR_SALE', 'WAITING_FOR_REVIEW', 'IN_REVIEW', 'PENDING_DEVELOPER_RELEASE', 'REMOVED_FROM_SALE', undefined, null, '']) {
		assert.equal(isVersionEditable(state), false, String(state))
	}
})

test('hasOverLimitChange 发现超限改动', () => {
	const ok = [{ field: 'name', newValue: '短名字' }]
	assert.equal(hasOverLimitChange(ok), false)
	const bad = [{ field: 'name', newValue: '短名字' }, { field: 'subtitle', newValue: '长'.repeat(31) }]
	assert.equal(hasOverLimitChange(bad), true)
})
