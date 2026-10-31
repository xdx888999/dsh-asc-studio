import test from 'node:test'
import assert from 'node:assert/strict'
import { act } from 'react'
import { EN, FR, deferred, mountPanel } from '../support/ui.mjs'

const shot = (id, state = 'COMPLETE') => ({ id, fileName: `${id}.png`, state, url: `https://example.test/${id}/{w}x{h}.{f}` })
const screenshotSet = (id, screenshots, displayType = 'APP_IPHONE_67') => ({ id, displayType, label: id, screenshots })
const screenshotsResponse = (sets) => ({ ok: true, sets, supported: {} })
const noAsset = { ok: true, exists: false, asc: null }
const previewSources = (ui) => [...ui.container.querySelectorAll('.asc-pv-shot img')].map((img) => img.src)
const shotReads = (ui) => ui.calls.filter((call) => call.method === 'GET' && call.url.pathname.endsWith('/screenshots'))
const languageName = (locale) => new Intl.DisplayNames(['en'], { type: 'language' }).of(locale)

test('reuses completed iPhone screenshots across product and search previews without another request', async (t) => {
	const ui = await mountPanel(t, (request) => {
		if (request.url.pathname.endsWith('/preview-asset')) return noAsset
		if (request.url.pathname.endsWith('/screenshots')) return screenshotsResponse([
			screenshotSet('iPad', [shot('ipad')], 'APP_IPAD_PRO_3GEN_129'),
			screenshotSet('iPhone', [shot('one'), shot('pending', 'UPLOAD_COMPLETE'), shot('two'), shot('three'), shot('four'), { id: 'missing-url', state: 'COMPLETE' }])
		])
	})
	await ui.selectApp('App A')
	assert.deepEqual(previewSources(ui), ['one', 'two', 'three', 'four'].map((id) => `https://example.test/${id}/600x1300.png`))
	assert.equal(shotReads(ui).length, 1)
	await ui.click(ui.button('Search'))
	assert.deepEqual(previewSources(ui), ['one', 'two', 'three'].map((id) => `https://example.test/${id}/600x1300.png`))
	assert.equal(shotReads(ui).length, 1)
	await ui.click(ui.button('Product page'))
	assert.equal(previewSources(ui).length, 4)
	assert.equal(shotReads(ui).length, 1)
})

test('clears previous language preview immediately and ignores a late screenshot response', async (t) => {
	const french = deferred()
	let englishReads = 0
	const ui = await mountPanel(t, (request) => {
		if (request.url.pathname.endsWith('/preview-asset')) return noAsset
		if (!request.url.pathname.endsWith('/screenshots')) return
		if (request.url.searchParams.get('versionLocId') === FR) return french.promise
		if (request.url.searchParams.get('versionLocId') === EN) {
			englishReads += 1
			return screenshotsResponse([screenshotSet('English', [shot(`english-${englishReads}`)])])
		}
	})
	await ui.selectApp('App A')
	assert.ok(previewSources(ui)[0].includes('/english-1/'))
	await ui.click(ui.button(languageName('fr-FR')))
	assert.deepEqual(previewSources(ui), [])
	assert.ok(ui.container.querySelector('.asc-pv-body').textContent.includes('Loading'))
	await ui.click(ui.button(languageName('en-US')))
	assert.ok(previewSources(ui)[0].includes('/english-2/'))
	await act(async () => french.resolve(screenshotsResponse([screenshotSet('French', [shot('french-late')])])))
	assert.deepEqual(previewSources(ui), ['https://example.test/english-2/600x1300.png'])
	assert.equal(ui.container.querySelectorAll('img[src*="french-late"]').length, 0)
})

test('refreshes screenshot management and device preview together after deletion', async (t) => {
	let screenshots = [shot('first'), shot('second')]
	const ui = await mountPanel(t, (request) => {
		if (request.url.pathname.endsWith('/preview-asset')) return noAsset
		if (!request.url.pathname.endsWith('/screenshots')) return
		if (request.method === 'POST') {
			assert.equal(request.body.action, 'delete')
			screenshots = screenshots.filter((item) => item.id !== request.body.screenshotId)
			return { ok: true }
		}
		return screenshotsResponse([screenshotSet('iPhone', screenshots)])
	})
	await ui.selectApp('App A')
	assert.equal(previewSources(ui).length, 2)
	const remove = ui.container.querySelector('[aria-label="Delete screenshot"]')
	const management = remove.closest('.asc-card')
	assert.equal(management.querySelectorAll('img').length, 2)
	await ui.click(remove)
	assert.deepEqual(previewSources(ui), ['https://example.test/second/600x1300.png'])
	assert.equal(management.querySelectorAll('img').length, 1)
	assert.ok(management.querySelector('img').src.includes('/second/'))
	assert.equal(shotReads(ui).length, 2)
	assert.equal(ui.calls.filter((call) => call.method === 'POST').length, 1)
})

test('refreshes successful screenshots and retains the error when a later file fails', async (t) => {
	let uploaded = 0, reads = 0
	const ui = await mountPanel(t, (request) => {
		if (request.url.pathname.endsWith('/preview-asset')) return noAsset
		if (!request.url.pathname.endsWith('/screenshots')) return
		if (request.method === 'POST') {
			uploaded += 1
			return uploaded === 1 ? { ok: true } : { ok: false, code: 'SERVER', error: 'Second upload failed' }
		}
		reads += 1
		return { ...screenshotsResponse([screenshotSet('iPhone', uploaded ? [shot('saved-first')] : [])]), supported: { APP_IPHONE_67: { label: 'iPhone', sizes: [[1290, 2796]] } } }
	}, { createImageBitmap: async () => ({ width: 1290, height: 2796, close() {} }) })
	await ui.selectApp('App A')
	const input = [...ui.container.querySelectorAll('input[type="file"]')].find((item) => item.multiple)
	Object.defineProperty(input, 'files', { value: ['first.png', 'second.png'].map((name) => new ui.dom.window.File(['image'], name, { type: 'image/png' })) })
	await act(async () => input.dispatchEvent(new ui.dom.window.Event('change', { bubbles: true })))
	for (let i = 0; i < 100 && reads < 2; i++) await ui.flush()
	assert.equal(uploaded, 2)
	assert.equal(reads, 2)
	assert.deepEqual(previewSources(ui), ['https://example.test/saved-first/600x1300.png'])
	assert.match(ui.container.textContent, /Second upload failed/)
})

test('shows unsaved copy in previews without writing to ASC', async (t) => {
	const ui = await mountPanel(t, (request) => request.url.pathname.endsWith('/preview-asset') ? noAsset : undefined)
	await ui.selectApp('App A')
	await ui.edit('Name', 'Draft title')
	await ui.edit('Description', 'A description that has not been synced.')
	assert.equal(ui.container.querySelector('.asc-pv-name').textContent, 'Draft title')
	assert.equal(ui.container.querySelector('details.asc-pv-description p').textContent, 'A description that has not been synced.')
	await ui.click(ui.button('Search'))
	assert.equal(ui.container.querySelector('.asc-pv-name').textContent, 'Draft title')
	assert.equal(ui.calls.filter((call) => call.method === 'POST').length, 0)
})

test('keeps device browsing without simulated status or zoom controls', async (t) => {
	const ui = await mountPanel(t)
	await ui.selectApp('App A')
	assert.ok(ui.container.querySelector('.asc-pv-status') === null, 'The preview should not simulate a device status bar')
	assert.ok(!ui.container.querySelector('.asc-phone-screen').textContent.includes('9:41'))
	await ui.click(ui.button('Device preview'))
	const dialog = ui.container.querySelector('.asc-preview-dialog')
	assert.ok(dialog)
	assert.ok([...dialog.querySelectorAll('button')].some((button) => button.textContent === 'Close preview'))
	assert.ok(![...dialog.querySelectorAll('button')].some((button) => ['Zoom in', 'Fit to window'].includes(button.textContent)))
})
