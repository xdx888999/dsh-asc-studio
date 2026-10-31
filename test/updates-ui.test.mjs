import test from 'node:test'
import assert from 'node:assert/strict'
import { act } from 'react'
import { deferred, mountPanel } from '../support/ui.mjs'

const available = { ok: true, update: { currentVersion: '0.1.2', latestVersion: '0.1.3', status: 'available', checkedAt: 1793433600000 } }
const updateHandler = (request) => request.url.pathname.endsWith('/updates') ? available : undefined

test('checks on opening and reopening without installing or changing drafts', async (t) => {
	const ui = await mountPanel(t, updateHandler, { visible: false })
	const checks = () => ui.calls.filter((call) => call.url.pathname.endsWith('/updates'))
	assert.equal(checks().length, 0)
	await ui.rerenderSession(undefined, true)
	assert.equal(checks().length, 1)
	assert.match(ui.container.querySelector('.asc-update-notice').textContent, /Version 0.1.3 is available/)
	await ui.selectApp('App A'); await ui.edit('Name', 'Unsynced draft')
	await ui.click(ui.button('How to update'))
	const guide = ui.container.querySelector('.asc-update-guide')
	assert.match(guide.textContent, /Handle unsynced edits/)
	assert.match(guide.textContent, /dsh-asc-studio@latest/)
	assert.match(guide.textContent, /Do not use “Clean up and uninstall plugin”/)
	await ui.click(ui.button('Got it'))
	assert.equal(ui.field('Name').value, 'Unsynced draft')
	await ui.rerenderSession(undefined, false); await ui.rerenderSession(undefined, true)
	assert.equal(checks().length, 2)
	assert.equal(ui.field('Name').value, 'Unsynced draft')
	assert.equal(ui.calls.filter((call) => call.method !== 'GET').length, 0)
})

test('keeps the editor quiet when up to date and supports a manual check in settings', async (t) => {
	const ui = await mountPanel(t)
	assert.equal(ui.container.querySelector('.asc-update-notice'), null)
	await ui.click(ui.container.querySelector('[aria-label="Settings"]'))
	assert.match(ui.container.querySelector('.asc-update-card').textContent, /You’re up to date/)
	await ui.click(ui.button('Check for updates'))
	assert.ok(ui.calls.some((call) => call.url.pathname.endsWith('/updates') && call.url.searchParams.get('refresh') === '1'))
})

test('fails quietly and allows retrying without interrupting the editor', async (t) => {
	let failed = true
	const ui = await mountPanel(t, (request) => request.url.pathname.endsWith('/updates')
		? failed ? { ok: true, update: { currentVersion: '0.1.2', status: 'error' } } : available : undefined)
	assert.equal(ui.container.querySelector('.asc-update-notice'), null)
	await ui.selectApp('App A'); await ui.edit('Description', 'Keep this draft')
	await ui.click(ui.container.querySelector('[aria-label="Settings"]'))
	assert.match(ui.container.querySelector('.asc-update-card').textContent, /Could not check for updates/)
	failed = false
	await ui.click(ui.button('Check for updates'))
	assert.match(ui.container.querySelector('.asc-update-card').textContent, /Version 0.1.3 is available/)
	await ui.click(ui.container.querySelector('[aria-label="Back"]'))
	assert.equal(ui.field('Description').value, 'Keep this draft')
})

test('ignores a late result from a hidden panel', async (t) => {
	const slow = deferred()
	let count = 0
	const ui = await mountPanel(t, (request) => request.url.pathname.endsWith('/updates') && ++count === 1 ? slow.promise : undefined)
	await ui.rerenderSession(undefined, false); await ui.rerenderSession(undefined, true)
	await act(async () => slow.resolve(available))
	assert.equal(ui.container.querySelector('.asc-update-notice'), null)
	assert.equal(count, 2)
})

test('disables repeated manual checks while a request is pending', async (t) => {
	const slow = deferred()
	const ui = await mountPanel(t, (request) => request.url.searchParams.get('refresh') === '1' ? slow.promise : undefined)
	await ui.click(ui.container.querySelector('[aria-label="Settings"]'))
	await ui.click(ui.button('Check for updates'))
	assert.equal(ui.button('Check for updates').disabled, true)
	await ui.click(ui.button('Check for updates'))
	assert.equal(ui.calls.filter((call) => call.url.searchParams.get('refresh') === '1').length, 1)
	await act(async () => slow.resolve(available))
	assert.equal(ui.button('Check for updates').disabled, false)
})

test('shows Chinese updates before an ASC account is connected', async (t) => {
	const ui = await mountPanel(t, (request) => request.url.pathname.endsWith('/config')
		? { ok: true, config: { configured: false } } : updateHandler(request), { language: 'zh-CN' })
	assert.match(ui.container.querySelector('.asc-update-notice').textContent, /发现新版本 v0.1.3/)
	await ui.click(ui.button('更新指引'))
	assert.match(ui.container.querySelector('.asc-update-guide').textContent, /先处理未同步的文案/)
	await ui.click(ui.button('知道了'))
	assert.equal(ui.container.querySelector('dialog'), null)
})
