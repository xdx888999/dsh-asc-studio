import test from 'node:test'
import assert from 'node:assert/strict'
import { act } from 'react'
import { A, B, deferred, mountPanel } from '../support/ui.mjs'

function storage(overrides = {}) {
	return {
		directory: '/profiles/asc-test/data/dsh-asc', profileId: 'asc-test', totalBytes: 4096,
		imageBytes: 3072, imageCount: 3, recordBytes: 1024, recordCount: 2,
		apps: [{ appId: A, imageBytes: 2048, imageCount: 2 }, { appId: B, imageBytes: 1024, imageCount: 1 }],
		legacy: { available: false }, automaticUninstallCleanup: false, ...overrides
	}
}
const writes = (ui) => ui.calls.filter((request) => request.method === 'POST')
const storageCard = (ui) => ui.container.querySelector('.asc-storage')
const confirmation = (ui) => ui.container.querySelector('.asc-storage-confirm')
async function settings(ui) { await ui.click(ui.container.querySelector('[aria-label="Settings"]')) }
async function confirm(ui) {
	const button = [...confirmation(ui).querySelectorAll('button')].find((item) => item.textContent === 'Confirm action')
	await ui.click(button)
}

test('shows profile-scoped usage and explains cleanup limits without mutating data', async (t) => {
	const ui = await mountPanel(t, (request) => request.url.pathname.endsWith('/storage') ? { ok: true, storage: storage() } : undefined)
	await settings(ui)
	const card = storageCard(ui)
	assert.ok(card.textContent.includes('/profiles/asc-test/data/dsh-asc'))
	assert.ok(card.textContent.includes('Current profile: asc-test'))
	assert.ok(card.textContent.includes('4.0 KB'))
	assert.ok(card.textContent.includes('3 images'))
	assert.ok(card.textContent.includes('2 records'))
	assert.ok(card.textContent.includes('does not provide automatic uninstall cleanup'))
	assert.ok(card.textContent.includes('do not delete assets from App Store Connect'))
	assert.equal(card.querySelectorAll('.asc-storage-app').length, 0)
	assert.equal(ui.container.querySelector('[aria-label="Manage by app"]').getAttribute('aria-expanded'), 'false')
	const appListReads = ui.calls.filter((request) => request.url.pathname.endsWith('/apps')).length
	await ui.click(ui.container.querySelector('[aria-label="Manage by app"]'))
	assert.equal(ui.container.querySelector('[aria-label="Manage by app"]').getAttribute('aria-expanded'), 'true')
	const rows = [...card.querySelectorAll('.asc-storage-app')]
	assert.equal(rows.length, 2)
	assert.ok(rows[0].textContent.includes('App A'))
	assert.ok(rows[0].textContent.includes(A))
	assert.ok(rows[0].textContent.includes('2 images'))
	assert.ok(rows[1].textContent.includes('App B'))
	assert.equal(ui.calls.filter((request) => request.url.pathname.endsWith('/apps')).length, appListReads)
	await ui.click(ui.container.querySelector('[aria-label="Manage by app"]'))
	assert.equal(card.querySelectorAll('.asc-storage-app').length, 0)
	assert.ok(!ui.button('Import into this profile'))
	assert.equal(writes(ui).length, 0)
})

test('requires confirmation before clearing one app and preserves the selected app and draft', async (t) => {
	let localImage = true
	const pending = deferred()
	const ui = await mountPanel(t, (request) => {
		if (request.url.pathname.endsWith('/storage')) return request.method === 'GET' ? { ok: true, storage: storage() } : pending.promise
		if (request.url.pathname.endsWith('/preview-asset')) return { ok: true, exists: localImage, asc: null }
	})
	await ui.selectApp('App A')
	await ui.click(ui.button(new Intl.DisplayNames(['en'], { type: 'language' }).of('fr-FR')))
	await ui.edit('Name', 'Keep this draft')
	const appReads = ui.calls.filter((request) => request.url.pathname.endsWith('/app')).length
	await settings(ui)
	await ui.click(ui.container.querySelector('[aria-label="Manage by app"]'))
	await ui.click(ui.container.querySelector(`[aria-label="Clear preview images: App A (${A})"]`))
	assert.equal(writes(ui).length, 0)
	assert.ok(confirmation(ui).textContent.includes(`App A (${A})`))
	assert.ok(confirmation(ui).textContent.includes('2 images, 2.0 KB'))
	assert.ok(confirmation(ui).textContent.includes('Sync records and account credentials will be kept'))
	await ui.click([...confirmation(ui).querySelectorAll('button')].find((item) => item.textContent === 'Cancel'))
	assert.ok(!confirmation(ui))
	assert.equal(writes(ui).length, 0)
	await ui.click(ui.container.querySelector(`[aria-label="Clear preview images: App A (${A})"]`))
	await confirm(ui)
	assert.deepEqual(writes(ui).map((request) => request.body), [{ action: 'clear-images', appId: A }])
	assert.ok(ui.container.querySelector('[aria-label="Back"]').disabled)
	assert.ok(ui.container.querySelector('#asc-ui-language').matches(':disabled'))
	assert.ok([...confirmation(ui).querySelectorAll('button')].every((button) => button.disabled))
	localImage = false
	await act(async () => pending.resolve({ ok: true, storage: storage({ imageBytes: 1024, imageCount: 1, totalBytes: 2048, apps: [{ appId: B, imageBytes: 1024, imageCount: 1 }] }) }))
	assert.ok(!confirmation(ui))
	assert.ok(!ui.container.querySelector('[aria-label="Manage by app"]'))
	assert.equal(storageCard(ui).querySelectorAll('.asc-storage-app').length, 0)
	await ui.click(ui.container.querySelector('[aria-label="Back"]'))
	assert.ok(ui.container.querySelector('.asc-appbtn').textContent.includes('App A'))
	assert.equal(ui.container.querySelector('[role="tab"][aria-pressed="true"]').textContent, new Intl.DisplayNames(['en'], { type: 'language' }).of('fr-FR'))
	assert.equal(ui.field('Name').value, 'Keep this draft')
	assert.ok(!ui.container.querySelector('.asc-pv-asset img'))
	assert.equal(ui.calls.filter((request) => request.url.pathname.endsWith('/app')).length, appReads)
})

test('shows one cleanup button when only one app has preview images', async (t) => {
	const ui = await mountPanel(t, (request) => request.url.pathname.endsWith('/storage') ? { ok: true, storage: storage({
		imageCount: 2, imageBytes: 2048,
		apps: [{ appId: A, imageCount: 2, imageBytes: 2048 }, { appId: B, imageCount: 0, imageBytes: 0 }]
	}) } : undefined)
	await settings(ui)
	assert.ok(ui.button('Clear preview images'))
	assert.ok(!ui.container.querySelector('[aria-label="Manage by app"]'))
	assert.equal(storageCard(ui).querySelectorAll('.asc-storage-app').length, 0)
	await ui.click(ui.button('Clear preview images'))
	assert.ok(confirmation(ui).textContent.includes('all of this profile’s'))
	assert.ok(confirmation(ui).textContent.includes('2 images, 2.0 KB'))
	assert.equal(writes(ui).length, 0)
})

test('clears the named storage row rather than the selected app and identifies unavailable names by ID', async (t) => {
	const unknownId = '345678'
	const ui = await mountPanel(t, (request) => request.url.pathname.endsWith('/storage') ? { ok: true, storage: storage({
		apps: [{ appId: A, imageCount: 2, imageBytes: 2048 }, { appId: unknownId, imageCount: 1, imageBytes: 1024 }]
	}) } : undefined)
	await ui.selectApp('App B')
	await settings(ui)
	await ui.click(ui.container.querySelector('[aria-label="Manage by app"]'))
	const unknownRow = [...storageCard(ui).querySelectorAll('.asc-storage-app')].find((row) => row.textContent.includes(unknownId))
	assert.ok(unknownRow.textContent.includes(`App ${unknownId}`))
	await ui.click(unknownRow.querySelector('button'))
	assert.ok(confirmation(ui).textContent.includes(`App ${unknownId}`))
	assert.ok(!confirmation(ui).textContent.includes('App B'))
	await confirm(ui)
	assert.deepEqual(writes(ui).map((request) => request.body), [{ action: 'clear-images', appId: unknownId }])
	await ui.click(ui.container.querySelector('[aria-label="Back"]'))
	assert.ok(ui.container.querySelector('.asc-appbtn').textContent.includes('App B'))
})

test('clears all images only after reviewing the full profile scope', async (t) => {
	const ui = await mountPanel(t, (request) => request.url.pathname.endsWith('/storage')
		? { ok: true, storage: request.method === 'GET' ? storage() : storage({ imageBytes: 0, imageCount: 0, totalBytes: 1024, apps: [] }) }
		: undefined)
	await settings(ui)
	await ui.click(ui.button('Clear preview images'))
	assert.equal(writes(ui).length, 0)
	assert.ok(confirmation(ui).textContent.includes('all of this profile’s'))
	assert.ok(confirmation(ui).textContent.includes('3 images, 3.0 KB'))
	await confirm(ui)
	assert.deepEqual(writes(ui).map((request) => request.body), [{ action: 'clear-images' }])
	assert.ok(storageCard(ui).textContent.includes('2 records'))
	assert.ok(ui.button('Clear preview images').disabled)
	assert.ok(!ui.button('Disconnect ASC account').disabled)
})

for (const action of ['disconnect', 'prepare-uninstall']) {
	test(`reviews ${action} before removing credentials and updates the account UI`, async (t) => {
		const ui = await mountPanel(t, (request) => {
			if (request.url.pathname.endsWith('/config')) return { ok: true, config: { configured: true, hasKey: true, issuerId: 'issuer-before', keyId: 'key-before' } }
			if (request.url.pathname.endsWith('/storage')) return request.method === 'GET'
				? { ok: true, storage: storage() }
				: { ok: true, storage: action === 'disconnect' ? storage() : storage({ imageCount: 0, imageBytes: 0, recordCount: 0, recordBytes: 0, totalBytes: 0, apps: [] }), config: { configured: false, hasKey: false, issuerId: '', keyId: '' } }
		})
		await settings(ui)
		await ui.click(ui.button(action === 'disconnect' ? 'Disconnect ASC account' : 'Clean up for uninstall'))
		assert.equal(writes(ui).length, 0)
		assert.ok(confirmation(ui).textContent.includes('Keychain'))
		assert.ok(confirmation(ui).textContent.includes('do not delete assets from App Store Connect'))
		if (action === 'prepare-uninstall') {
			assert.ok(confirmation(ui).textContent.includes('failure-recovery history'))
			assert.ok(confirmation(ui).textContent.includes('cannot be undone'))
		} else assert.ok(confirmation(ui).textContent.includes('Preview images and sync records will be kept'))
		await confirm(ui)
		assert.deepEqual(writes(ui).map((request) => request.body), [{ action }])
		assert.equal(ui.container.querySelector('#asc-issuer').value, '')
		assert.equal(ui.container.querySelector('#asc-keyid').value, '')
		assert.ok(ui.button('Disconnect ASC account').disabled)
		await ui.click(ui.container.querySelector('[aria-label="Back"]'))
		assert.ok(ui.button('Open settings'))
	})
}

test('imports legacy data only into an empty profile and preserves the source notice', async (t) => {
	const legacy = { available: true, directory: '/legacy/shared', imageCount: 2, imageBytes: 2048 }
	const empty = storage({ imageCount: 0, imageBytes: 0, recordCount: 0, recordBytes: 0, totalBytes: 0, apps: [], legacy })
	const ui = await mountPanel(t, (request) => {
		if (request.url.pathname.endsWith('/config')) return { ok: true, config: { configured: false } }
		if (request.url.pathname.endsWith('/storage')) return request.method === 'GET'
			? { ok: true, storage: empty }
			: { ok: true, storage: storage({ legacy }), config: { configured: true, hasKey: true, issuerId: 'imported-issuer', keyId: 'imported-key' } }
	})
	await ui.click(ui.button('Open settings'))
	assert.ok(storageCard(ui).textContent.includes('keep the source files'))
	assert.ok(!ui.button('Import into this profile').disabled)
	await ui.click(ui.button('Import into this profile'))
	assert.deepEqual(writes(ui).map((request) => request.body), [{ action: 'import-legacy' }])
	assert.equal(ui.container.querySelector('#asc-keyid').value, 'imported-key')
	assert.ok(ui.button('Import into this profile').disabled)
	assert.ok(storageCard(ui).textContent.includes('Import requires an empty profile'))
})

test('reports a storage conflict and restores controls for a safe retry', async (t) => {
	const ui = await mountPanel(t, (request) => request.url.pathname.endsWith('/storage')
		? request.method === 'GET' ? { ok: true, storage: storage() } : { ok: false, code: 'CONFLICT', error: 'Another storage operation is running' }
		: undefined)
	await settings(ui)
	await ui.click(ui.button('Clear preview images'))
	await confirm(ui)
	assert.ok(!confirmation(ui))
	assert.ok(storageCard(ui).querySelector('[role="alert"]').textContent.includes('Another storage operation is running'))
	assert.ok(!ui.button('Clear preview images').disabled)
	assert.ok(!ui.container.querySelector('[aria-label="Back"]').disabled)
	await ui.click([...storageCard(ui).querySelectorAll('button')].find((button) => button.textContent === 'Refresh'))
	assert.equal(ui.calls.filter((request) => request.url.pathname.endsWith('/storage') && request.method === 'GET').length, 2)
	assert.equal(writes(ui).length, 1)
})

test('opens the profile directory without treating it as a cleanup action', async (t) => {
	const ui = await mountPanel(t, (request) => request.url.pathname.endsWith('/storage') ? { ok: true, storage: storage() } : undefined)
	await settings(ui)
	await ui.click(ui.button('Open directory'))
	assert.ok(!confirmation(ui))
	assert.deepEqual(writes(ui).map((request) => request.body), [{ action: 'open-directory' }])
})

test('localizes storage usage and the review dialog in Chinese', async (t) => {
	const ui = await mountPanel(t, (request) => request.url.pathname.endsWith('/storage') ? { ok: true, storage: storage() } : undefined, { language: 'zh-CN' })
	await ui.click(ui.container.querySelector('[aria-label="设置"]'))
	assert.ok(storageCard(ui).textContent.includes('本机存储'))
	assert.ok(storageCard(ui).textContent.includes('3 张图片'))
	assert.ok(storageCard(ui).textContent.includes('卸载前先清理'))
	assert.ok(ui.button('清理预览图片'))
	await ui.click(ui.container.querySelector('[aria-label="按 App 管理"]'))
	await ui.click(storageCard(ui).querySelector('.asc-storage-app button'))
	assert.ok(confirmation(ui).textContent.includes(`App A (${A})`))
	assert.ok(confirmation(ui).textContent.includes('2 张'))
	await ui.click(ui.button('取消'))
	await ui.click(ui.button('清理并准备卸载'))
	assert.ok(confirmation(ui).textContent.includes('将失去当前环境的素材同步与失败恢复记录'))
	assert.ok(confirmation(ui).textContent.includes('不会删除 ASC 后台素材'))
	assert.equal(writes(ui).length, 0)
})

test('offers uninstall only when supported and confirms data cleanup before the request', async (t) => {
	const ui = await mountPanel(t, (request) => request.url.pathname.endsWith('/storage')
		? request.method === 'GET'
			? { ok: true, storage: storage({ canUninstall: true }) }
			: { ok: true, uninstalled: true, storage: storage({ totalBytes: 0, imageBytes: 0, imageCount: 0, recordBytes: 0, recordCount: 0, apps: [], canUninstall: true }), config: { configured: false } }
		: undefined)
	await settings(ui)
	assert.ok(!ui.button('Clean up for uninstall'))
	assert.ok(storageCard(ui).textContent.includes('does not provide automatic uninstall cleanup'))
	await ui.click(ui.button('Clean up and uninstall plugin'))
	assert.equal(writes(ui).length, 0)
	assert.ok(confirmation(ui).textContent.includes('then uninstall this plugin from DSH'))
	assert.ok(confirmation(ui).textContent.includes('failure-recovery history'))
	assert.ok(confirmation(ui).textContent.includes('do not delete assets from App Store Connect'))
	assert.ok(confirmation(ui).textContent.includes('plugin panel will close'))
	await confirm(ui)
	assert.deepEqual(writes(ui).map((request) => request.body), [{ action: 'uninstall' }])
})

test('refreshes local account state and explains manual completion after uninstall failure', async (t) => {
	let cleared = false
	const empty = storage({ totalBytes: 0, imageBytes: 0, imageCount: 0, recordBytes: 0, recordCount: 0, apps: [], canUninstall: true })
	const ui = await mountPanel(t, (request) => {
		if (request.url.pathname.endsWith('/config')) return { ok: true, config: { configured: !cleared, hasKey: !cleared } }
		if (request.url.pathname.endsWith('/storage')) {
			if (request.method === 'GET') return { ok: true, storage: cleared ? empty : storage({ canUninstall: true }) }
			cleared = true
			return { ok: false, code: 'SERVER', error: 'Host uninstall failed' }
		}
	})
	await settings(ui)
	await ui.click(ui.button('Clean up and uninstall plugin'))
	await confirm(ui)
	assert.ok(!confirmation(ui))
	assert.ok(storageCard(ui).querySelector('[role="alert"]').textContent.includes('Host uninstall failed'))
	assert.ok(storageCard(ui).textContent.includes('Finish uninstalling it in DSH’s plugin manager'))
	assert.ok(storageCard(ui).textContent.includes('No local preview images'))
	assert.ok(ui.button('Disconnect ASC account').disabled)
	assert.equal(writes(ui).length, 1)
	assert.equal(ui.calls.filter((request) => request.url.pathname.endsWith('/storage') && request.method === 'GET').length, 2)
	assert.equal(ui.calls.filter((request) => request.url.pathname.endsWith('/config')).length, 2)
})

const profileA = '111111111111111111111111', profileB = '222222222222222222222222'
const languageKey = 'dsh-asc.ui-language'
const scopedLanguageKey = (profileId) => `${languageKey}:${profileId}`
async function chooseLanguage(ui, value) {
	await act(async () => {
		const select = ui.container.querySelector('#asc-ui-language')
		select.value = value
		select.dispatchEvent(new ui.dom.window.Event('change', { bubbles: true }))
	})
}

test('isolates language preferences by profile even before connecting an account', async (t) => {
	const ui = await mountPanel(t, (request) => request.url.pathname.endsWith('/config')
		? { ok: true, config: { configured: false, profileId: profileA } } : undefined,
	{ storedLanguage: 'zh', storageEntries: { [scopedLanguageKey(profileA)]: 'en', [scopedLanguageKey(profileB)]: 'en' }, includeEntry: true })
	assert.equal(ui.container.querySelector('.asc-root:not([hidden])').lang, 'en')
	assert.ok(ui.container.querySelector('[aria-label="Open the App Store copy panel"]'))
	await ui.click(ui.button('Open settings'))
	assert.equal(ui.container.querySelector('#asc-ui-language').value, 'en')
	await chooseLanguage(ui, 'zh')
	assert.equal(ui.dom.window.localStorage.getItem(scopedLanguageKey(profileA)), 'zh')
	assert.equal(ui.dom.window.localStorage.getItem(scopedLanguageKey(profileB)), 'en')
	assert.equal(ui.dom.window.localStorage.getItem(languageKey), 'zh')
	await act(async () => ui.dom.window.dispatchEvent(new ui.dom.window.StorageEvent('storage', { key: scopedLanguageKey(profileB), newValue: 'en' })))
	assert.equal(ui.container.querySelector('#asc-ui-language').value, 'zh')
	await act(async () => {
		ui.dom.window.localStorage.removeItem(scopedLanguageKey(profileA))
		ui.dom.window.dispatchEvent(new ui.dom.window.StorageEvent('storage', { key: scopedLanguageKey(profileA), newValue: null }))
	})
	assert.equal(ui.container.querySelector('#asc-ui-language').value, 'auto')
	assert.equal(ui.container.querySelector('.asc-root:not([hidden])').lang, 'en')
	assert.ok(ui.container.querySelector('[aria-label="Open the App Store copy panel"]'))
	assert.equal(writes(ui).length, 0)
})

for (const action of ['prepare-uninstall', 'uninstall', 'disconnect']) {
	test(`cleans only the current profile language preference for ${action}`, async (t) => {
		const ui = await mountPanel(t, (request) => {
			if (request.url.pathname.endsWith('/storage')) return {
				ok: true, storage: storage({ canUninstall: action === 'uninstall' }),
				...(request.method === 'POST' ? { config: { configured: false, profileId: profileA } } : {})
			}
		}, { language: 'zh-CN', profileId: profileA, storedLanguage: 'zh', storageEntries: { [scopedLanguageKey(profileA)]: 'en', [scopedLanguageKey(profileB)]: 'zh' } })
		await settings(ui)
		await ui.click(ui.button({ 'prepare-uninstall': 'Clean up for uninstall', uninstall: 'Clean up and uninstall plugin', disconnect: 'Disconnect ASC account' }[action]))
		assert.equal(ui.dom.window.localStorage.getItem(scopedLanguageKey(profileA)), 'en')
		await confirm(ui)
		assert.equal(ui.dom.window.localStorage.getItem(scopedLanguageKey(profileA)), action === 'disconnect' ? 'en' : null)
		assert.equal(ui.dom.window.localStorage.getItem(scopedLanguageKey(profileB)), 'zh')
		assert.equal(ui.dom.window.localStorage.getItem(languageKey), 'zh')
		assert.equal(ui.container.querySelector('#asc-ui-language').value, action === 'disconnect' ? 'en' : 'auto')
		assert.equal(ui.container.querySelector('.asc-root:not([hidden])').lang, action === 'disconnect' ? 'en' : 'zh-Hans')
	})
}

test('separates local preview image URLs across profile scopes and module reloads', async (t) => {
	const sources = []
	for (const profileId of [profileA, profileA, profileB]) {
		await t.test(`loads preview in profile ${profileId} instance ${sources.length + 1}`, async (instance) => {
			const ui = await mountPanel(instance, undefined, { profileId })
			await ui.selectApp('App A')
			const first = new URL(ui.container.querySelector('.asc-pv-asset img').src)
			assert.equal(first.searchParams.get('profile'), profileId)
			assert.ok(first.searchParams.get('cacheBuster'))
			await ui.edit('Name', 'Changed preview title')
			assert.equal(ui.container.querySelector('.asc-pv-asset img').src, first.href)
			await ui.click(ui.button('Search'))
			const search = new URL(ui.container.querySelector('.asc-pv-asset img').src)
			assert.equal(search.searchParams.get('cacheBuster'), first.searchParams.get('cacheBuster'))
			assert.equal(search.searchParams.get('profile'), profileId)
			sources.push(first)
		})
	}
	assert.equal(new Set(sources.map((source) => source.searchParams.get('cacheBuster'))).size, 3)
	assert.notEqual(sources[0].href, sources[1].href)
	assert.notEqual(sources[1].href, sources[2].href)
})
