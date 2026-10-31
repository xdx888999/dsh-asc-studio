import test from 'node:test'
import assert from 'node:assert/strict'
import { act } from 'react'
import { mountPanel } from '../support/ui.mjs'

const preferenceKey = 'dsh-asc.ui-language'
const languageName = (locale, lang) => new Intl.DisplayNames([lang], { type: 'language' }).of(locale)
const visibleRoot = (ui) => ui.container.querySelector('.asc-root:not([hidden])')

async function chooseLanguage(ui, value) {
	const select = ui.container.querySelector('#asc-ui-language')
	assert.ok(select, 'Interface language should be available in settings')
	await act(async () => {
		select.value = value
		select.dispatchEvent(new ui.dom.window.Event('change', { bubbles: true }))
	})
}

for (const [name, options, expectedLanguage, expectedPreference] of [
	['prefers the first browser language', { language: 'en-US', languages: ['zh-Hant-TW', 'en-US'] }, 'zh-Hans', 'auto'],
	['uses English for other browser languages', { language: 'fr-FR' }, 'en', 'auto'],
	['restores an explicit preference over browser language', { language: 'zh-CN', storedLanguage: 'en' }, 'en', 'en'],
	['ignores an invalid stored preference', { language: 'zh-HK', storedLanguage: 'invalid' }, 'zh-Hans', 'auto']
]) {
	test(name, async (t) => {
		const ui = await mountPanel(t, undefined, options)
		assert.equal(visibleRoot(ui).lang, expectedLanguage)
		await ui.click(ui.container.querySelector(`[aria-label="${expectedLanguage === 'en' ? 'Settings' : '设置'}"]`))
		assert.equal(ui.container.querySelector('#asc-ui-language').value, expectedPreference)
	})
}

test('switches interface language immediately while preserving the app, listing language, and drafts', async (t) => {
	const ui = await mountPanel(t, undefined, { includeEntry: true })
	await ui.selectApp('App A')
	await ui.click(ui.button(languageName('fr-FR', 'en')))
	await ui.edit('Name', 'French title draft')
	await ui.edit('Description', 'Unsaved French description')
	const readsBefore = ui.calls.filter((call) => !call.url.pathname.endsWith('/storage')).length
	await ui.click(ui.container.querySelector('[aria-label="Settings"]'))
	await chooseLanguage(ui, 'zh')
	assert.equal(visibleRoot(ui).lang, 'zh-Hans')
	assert.equal(ui.dom.window.localStorage.getItem(preferenceKey), 'zh')
	assert.ok(ui.container.querySelector('[aria-label="打开 App Store 文案面板"]'))
	assert.ok(!ui.container.querySelector('[aria-label="Open the App Store copy panel"]'))
	await ui.click(ui.container.querySelector('[aria-label="返回"]'))
	assert.ok(ui.container.querySelector('.asc-appbtn').textContent.includes('App A'))
	assert.equal(ui.container.querySelector('[role="tab"][aria-pressed="true"]').textContent, languageName('fr-FR', 'zh-Hans'))
	assert.equal(ui.field('名称').value, 'French title draft')
	assert.equal(ui.field('描述').value, 'Unsaved French description')
	assert.equal(ui.calls.filter((call) => !call.url.pathname.endsWith('/storage')).length, readsBefore)
	assert.equal(ui.calls.filter((call) => call.method === 'POST').length, 0)
})

test('updates the panel and independent entry on storage and system-language events', async (t) => {
	const ui = await mountPanel(t, undefined, { includeEntry: true, language: 'en-US', languages: ['en-US'] })
	await act(async () => {
		ui.dom.window.localStorage.setItem(preferenceKey, 'zh')
		ui.dom.window.dispatchEvent(new ui.dom.window.StorageEvent('storage', { key: preferenceKey, newValue: 'zh' }))
	})
	assert.equal(visibleRoot(ui).lang, 'zh-Hans')
	assert.ok(ui.container.querySelector('[aria-label="打开 App Store 文案面板"]'))
	await act(async () => {
		ui.dom.window.localStorage.setItem(preferenceKey, 'auto')
		ui.dom.window.dispatchEvent(new ui.dom.window.StorageEvent('storage', { key: preferenceKey, newValue: 'auto' }))
	})
	assert.equal(visibleRoot(ui).lang, 'en')
	await act(async () => {
		ui.navigator.languages = ['zh-Hant']
		ui.dom.window.dispatchEvent(new ui.dom.window.Event('languagechange'))
	})
	assert.equal(visibleRoot(ui).lang, 'zh-Hans')
	assert.ok(ui.container.querySelector('[aria-label="打开 App Store 文案面板"]'))
	await act(async () => {
		ui.dom.window.localStorage.setItem(preferenceKey, 'en')
		ui.dom.window.dispatchEvent(new ui.dom.window.StorageEvent('storage', { key: preferenceKey, newValue: 'en' }))
		ui.dom.window.dispatchEvent(new ui.dom.window.Event('languagechange'))
	})
	assert.equal(visibleRoot(ui).lang, 'en')
	assert.ok(ui.container.querySelector('[aria-label="Open the App Store copy panel"]'))
})

test('still changes language and explains the limitation when browser storage is unavailable', async (t) => {
	const ui = await mountPanel(t, undefined, { storageUnavailable: true })
	await ui.click(ui.container.querySelector('[aria-label="Settings"]'))
	await chooseLanguage(ui, 'zh')
	assert.equal(visibleRoot(ui).lang, 'zh-Hans')
	assert.equal(ui.container.querySelector('#asc-ui-language').value, 'zh')
	assert.ok(visibleRoot(ui).querySelector('[role="status"]').textContent.includes('浏览器未允许保存设置'))
	assert.equal(ui.calls.filter((call) => call.method === 'POST').length, 0)
})

test('relocalizes existing precheck results without another request', async (t) => {
	const ui = await mountPanel(t, (request) => request.url.pathname.endsWith('/precheck')
		? { ok: true, results: [{ level: 'warn', message: '请补充关键词', messageEn: 'Add keywords' }] }
		: undefined)
	await ui.selectApp('App A')
	await ui.click(ui.button('Run checks'))
	assert.equal(ui.container.querySelector('.asc-check-row').textContent, 'Add keywords')
	await ui.click(ui.container.querySelector('[aria-label="Settings"]'))
	await chooseLanguage(ui, 'zh')
	await ui.click(ui.container.querySelector('[aria-label="返回"]'))
	assert.equal(ui.container.querySelector('.asc-check-row').textContent, '请补充关键词')
	assert.equal(ui.calls.filter((call) => call.url.pathname.endsWith('/precheck')).length, 1)
	assert.equal(ui.calls.filter((call) => call.method === 'POST').length, 0)
})

test('offers interface language selection before ASC credentials are configured', async (t) => {
	const ui = await mountPanel(t, (request) => request.url.pathname.endsWith('/config')
		? { ok: true, config: { configured: false } }
		: undefined)
	await ui.click(ui.button('Open settings'))
	await chooseLanguage(ui, 'zh')
	assert.equal(visibleRoot(ui).lang, 'zh-Hans')
	assert.equal(ui.dom.window.localStorage.getItem(preferenceKey), 'zh')
	assert.equal(ui.calls.filter((call) => call.method === 'POST').length, 0)
})

test('shows English recovery guidance while retaining the server diagnostic', async (t) => {
	const ui = await mountPanel(t, (request) => request.url.pathname.endsWith('/apps')
		? { ok: false, code: 'AUTH', error: '密钥无效或已过期', detail: 'The JWT has expired.' }
		: undefined)
	assert.ok(ui.container.textContent.includes('Authentication failed. Check your Issuer ID, Key ID, private key and system clock.'))
	assert.ok(ui.container.textContent.includes('The JWT has expired.'))
})

test('relocalizes an existing request error without retrying the request', async (t) => {
	const ui = await mountPanel(t, (request) => request.url.pathname.endsWith('/apps')
		? { ok: false, code: 'AUTH', error: '密钥无效或已过期' }
		: undefined, { language: 'zh-CN' })
	assert.ok(!ui.container.textContent.includes('Authentication failed.'))
	const requestsBefore = ui.calls.filter((call) => !call.url.pathname.endsWith('/storage')).length
	await ui.click(ui.container.querySelector('[aria-label="设置"]'))
	await chooseLanguage(ui, 'en')
	await ui.click(ui.container.querySelector('[aria-label="Back"]'))
	assert.ok(visibleRoot(ui).textContent.includes('Authentication failed.'))
	assert.ok(visibleRoot(ui).textContent.includes('密钥无效或已过期'))
	assert.equal(ui.calls.filter((call) => !call.url.pathname.endsWith('/storage')).length, requestsBefore)
})
