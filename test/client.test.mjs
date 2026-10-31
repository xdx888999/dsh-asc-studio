import test from 'node:test'
import assert from 'node:assert/strict'
import { act } from 'react'
import { A, B, EN, FR, deferred, detail, mountPanel } from '../support/ui.mjs'

test('keeps unsynced drafts until the user explicitly confirms switching apps', async (t) => {
	const ui = await mountPanel(t)
	await ui.selectApp('App A'); await ui.edit('Name', 'Unsynced name')
	await ui.selectApp('App B')
	assert.match(ui.container.querySelector('dialog').textContent, /App B/)
	assert.equal(ui.field('Name').value, 'Unsynced name')
	await ui.click(ui.button('Keep editing'))
	assert.equal(ui.field('Name').value, 'Unsynced name')
	await ui.selectApp('App B'); await ui.click(ui.button('Discard and switch'))
	assert.equal(ui.field('Name').value, `Name ${B}`)
	await ui.selectApp('App A')
	assert.equal(ui.field('Name').value, `Name ${A}`)
	assert.equal(ui.calls.filter(({ method }) => method === 'POST').length, 0)
})

test('warns before leaving with unsynced changes and removes the warning when reverted', async (t) => {
	const ui = await mountPanel(t); await ui.selectApp('App A')
	const blocked = () => {
		const event = new ui.dom.window.Event('beforeunload', { cancelable: true })
		ui.dom.window.dispatchEvent(event); return event.defaultPrevented
	}
	assert.equal(blocked(), false)
	await ui.edit('Name', 'Draft'); assert.equal(blocked(), true)
	await ui.edit('Name', `Name ${A}`); assert.equal(blocked(), false)
})

test('shows a local session error and recovers after refreshing an authenticated session', async (t) => {
	let authenticated = false
	const ui = await mountPanel(t, (request) => request.url.pathname.endsWith('/config') && !authenticated
		? { ok: false, code: 'SESSION', error: 'DSH 会话已失效，请从 DSH 启动入口重新打开页面' } : undefined)
	assert.match(ui.container.querySelector('[role="alert"]').textContent, /DSH session has expired/)
	assert.ok(!ui.container.textContent.includes('Issuer ID'))
	assert.equal(ui.calls.filter((call) => call.url.pathname.endsWith('/apps')).length, 0)
	authenticated = true
	await ui.click(ui.button('Refresh')); await ui.flush()
	assert.equal(ui.container.querySelector('[role="alert"]'), null)
	assert.ok(ui.container.querySelector('.asc-appbtn'))
})

test('shows a secure storage failure instead of an endless loading state', async (t) => {
	const ui = await mountPanel(t, (request) => request.url.pathname.endsWith('/config')
		? { ok: false, code: 'KEYCHAIN', error: '旧凭据迁移失败，请解锁钥匙串后重试' } : undefined)
	assert.match(ui.container.querySelector('[role="alert"]').textContent, /Secure storage/)
	assert.ok(ui.button('Refresh'))
})

test('keeps settings and disconnect available after an interrupted credential save', async (t) => {
	const ui = await mountPanel(t, (request) => request.url.pathname.endsWith('/config')
		? { ok: true, config: { configured: false, hasKey: false, hasStoredCredentials: true, issuerId: 'test-issuer', keyId: 'TESTKEY', recoveryRequired: true } } : undefined)
	assert.match(ui.container.textContent, /Secure credential storage needs recovery/)
	await ui.click(ui.container.querySelector('.asc-footer button'))
	assert.match(ui.container.textContent, /upload the .p8 file again/)
	assert.equal(ui.container.querySelector('#asc-keyid').value, 'TESTKEY')
	assert.equal(ui.button('Save').disabled, true)
	assert.equal(ui.button('Disconnect ASC account').disabled, false)
})

test('ignores late app response after selecting another app', async (t) => {
	const slow = deferred()
	const ui = await mountPanel(t, (request) => request.url.pathname.endsWith('/app') && request.url.searchParams.get('id') === A ? slow.promise : undefined)
	await ui.selectApp('App A'); await ui.selectApp('App B')
	assert.equal(ui.field('Name').value, `Name ${B}`)
	await act(async () => slow.resolve(detail(A)))
	assert.equal(ui.field('Name').value, `Name ${B}`)
	await ui.edit('Name', 'B changed')
	await ui.click(ui.container.querySelector('.asc-footer button'))
	assert.ok(ui.container.querySelector('.asc-modal').textContent.includes(`Name ${B}`))
	assert.ok(!ui.container.querySelector('.asc-modal').textContent.includes(`Name ${A}`))
})

test('preserves selected language on refresh and falls back when removed', async (t) => {
	let available = true
	const ui = await mountPanel(t, (request) => {
		if (!request.url.pathname.endsWith('/app')) return
		const response = detail(A)
		if (!available) response.locales.pop()
		return response
	})
	await ui.selectApp('App A'); await ui.click(ui.button(new Intl.DisplayNames(['en'], { type: 'language' }).of('fr-FR')))
	await ui.click(ui.container.querySelector('[aria-label="Refresh"]'))
	assert.equal(ui.container.querySelector('[role="tab"][aria-pressed="true"]').textContent, new Intl.DisplayNames(['en'], { type: 'language' }).of('fr-FR'))
	available = false
	await ui.click(ui.container.querySelector('[aria-label="Refresh"]'))
	assert.equal(ui.container.querySelector('[role="tab"][aria-pressed="true"]').textContent, new Intl.DisplayNames(['en'], { type: 'language' }).of('en-US'))
})

test('includes app id in preview URL and keeps sync action after image load failure', async (t) => {
	const ui = await mountPanel(t); await ui.selectApp('App A')
	const img = ui.container.querySelector('.asc-pv-asset img')
	assert.equal(new URL(img.src).searchParams.get('appId'), A)
	await act(async () => img.dispatchEvent(new ui.dom.window.Event('error')))
	assert.ok(ui.button('Sync to ASC'))
	assert.ok(ui.container.textContent.includes('Your local asset is kept'))
})

test('clears successful drafts while preserving failures and edits made during sync', async (t) => {
	let serverName = 'Original', serverDescription = 'Description'
	const pending = deferred()
	const ui = await mountPanel(t, (request) => {
		if (request.url.pathname.endsWith('/app')) {
			const response = detail(A, serverName); response.locales[0].description = serverDescription; return response
		}
		if (request.url.pathname.endsWith('/sync')) return pending.promise
	})
	await ui.selectApp('App A')
	await ui.edit('Name', 'Submitted'); await ui.edit('Keywords (comma separated)', 'failed-keywords'); await ui.edit('Description', 'Submitted description')
	await ui.click(ui.container.querySelector('.asc-footer button')); await ui.click(ui.button('Sync now'))
	await ui.edit('Description', 'Newer edit')
	const request = ui.calls.find((item) => item.url.pathname.endsWith('/sync'))
	assert.equal(request.body.appId, A)
	assert.deepEqual(request.body.changes.find((op) => 'name' in op.attributes).baseValues, { name: 'Original' })
	serverName = 'Submitted'; serverDescription = 'Submitted description'
	await act(async () => pending.resolve({ ok: true, succeeded: 2, failed: 1,
		results: request.body.changes.map((op, index) => ({ index, ok: !('keywords' in op.attributes), error: 'Failed' })) }))
	await ui.click(ui.button('Done'))
	serverName = 'Externally edited'
	await ui.click(ui.container.querySelector('[aria-label="Refresh"]'))
	assert.equal(ui.field('Name').value, 'Externally edited')
	assert.equal(ui.field('Keywords (comma separated)').value, 'failed-keywords')
	assert.equal(ui.field('Description').value, 'Newer edit')
})

test('preserves conflicting drafts and shows fresh original text on the next confirmation', async (t) => {
	let remote = 'Original A', serverKeywords = 'initial'
	const ui = await mountPanel(t, (request) => {
		if (request.url.pathname.endsWith('/app')) {
			const response = detail(A); response.locales[0].description = remote; response.locales[0].keywords = serverKeywords; return response
		}
		if (request.url.pathname.endsWith('/sync')) {
			serverKeywords = 'New keywords'
			return { ok: true, succeeded: 1, failed: 1, results: request.body.changes.map((op, index) =>
				'description' in op.attributes ? { index, ok: false, code: 'COPY_CONFLICT', error: 'ASC 原文已变化' } : { index, ok: true }) }
		}
	})
	await ui.selectApp('App A')
	await ui.edit('Description', 'Local C'); await ui.edit('Keywords (comma separated)', 'New keywords')
	await ui.click(ui.container.querySelector('.asc-footer button'))
	remote = 'External B'
	await ui.click(ui.button('Sync now'))
	assert.match(ui.container.querySelector('.asc-modal').textContent, /changed in ASC and was not overwritten/)
	assert.equal(ui.field('Description').value, 'Local C')
	assert.equal(ui.field('Keywords (comma separated)').value, 'New keywords')
	await ui.click(ui.button('Done'))
	await ui.click(ui.container.querySelector('.asc-footer button'))
	const comparison = ui.container.querySelector('.asc-modal')
	assert.match(comparison.textContent, /External B/)
	assert.match(comparison.textContent, /Local C/)
	assert.ok(!comparison.textContent.includes('Original A'))
	assert.equal(comparison.querySelectorAll('.asc-diff').length, 1)
	await ui.click(ui.button('Sync now'))
	const requests = ui.calls.filter((item) => item.url.pathname.endsWith('/sync'))
	assert.equal(requests[0].body.changes.find((op) => 'description' in op.attributes).baseValues.description, 'Original A')
	assert.equal(requests[1].body.changes[0].baseValues.description, 'External B')
})

test('sends the original confirmation snapshot after a background refresh or newer edit', async (t) => {
	let remote = 'Original A'
	const ui = await mountPanel(t, (request) => {
		if (request.url.pathname.endsWith('/app')) { const response = detail(A); response.locales[0].description = remote; return response }
		if (request.url.pathname.endsWith('/sync')) return { ok: true, succeeded: 1, failed: 0, results: [{ index: 0, ok: true }] }
	})
	await ui.selectApp('App A'); await ui.edit('Description', 'Reviewed C')
	await ui.click(ui.container.querySelector('.asc-footer button'))
	remote = 'External B'
	await ui.click(ui.container.querySelector('[aria-label="Refresh"]'))
	await ui.edit('Description', 'Later local edit D')
	assert.match(ui.container.querySelector('.asc-modal').textContent, /Original A/)
	assert.match(ui.container.querySelector('.asc-modal').textContent, /Reviewed C/)
	assert.ok(!ui.container.querySelector('.asc-modal').textContent.includes('External B'))
	await ui.click(ui.button('Sync now'))
	const request = ui.calls.find((item) => item.url.pathname.endsWith('/sync'))
	assert.deepEqual(request.body.changes[0].baseValues, { description: 'Original A' })
	assert.deepEqual(request.body.changes[0].attributes, { description: 'Reviewed C' })
	assert.equal(ui.field('Description').value, 'Later local edit D')
})

test('hides old screenshots while switching language and ignores their late response', async (t) => {
	const pending = deferred()
	const ui = await mountPanel(t, (request) => {
		if (!request.url.pathname.endsWith('/screenshots')) return
		if (request.url.searchParams.get('versionLocId') === EN) return pending.promise
		return { ok: true, sets: [], supported: {} }
	})
	await ui.selectApp('App A'); await ui.click(ui.button(new Intl.DisplayNames(['en'], { type: 'language' }).of('fr-FR')))
	await act(async () => pending.resolve({ ok: true, sets: [{ id: 'set-en', label: 'English set', screenshots: [{ id: 'shot-en', state: 'COMPLETE' }] }], supported: {} }))
	assert.ok(!ui.container.textContent.includes('English set'))
	assert.equal(ui.container.querySelectorAll('[aria-label="Delete screenshot"]').length, 0)
	assert.ok(ui.calls.some((item) => item.url.searchParams.get('versionLocId') === FR))
})

test('sends current localization when withdrawing creative assets', async (t) => {
	const ui = await mountPanel(t, (request) => {
		if (request.url.pathname.endsWith('/preview-asset')) return { ok: true, exists: true, asc: { imageId: 'image', placementId: 'placement', state: 'PREPARE_FOR_SUBMISSION' } }
		if (request.url.pathname.endsWith('/asset-to-asc')) return { ok: true, asc: null }
	})
	await ui.selectApp('App A'); await ui.click(ui.button(new Intl.DisplayNames(['en'], { type: 'language' }).of('fr-FR'))); await ui.click(ui.button('Withdraw from ASC'))
	const action = ui.calls.find((item) => item.url.pathname.endsWith('/asset-to-asc'))
	assert.equal(action.body.appId, A); assert.equal(action.body.versionLocId, FR)
})
