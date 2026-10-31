import test from 'node:test'
import assert from 'node:assert/strict'
import { act } from 'react'
import { A, deferred, mountPanel } from '../support/ui.mjs'

const screenshot = (id) => ({ id, state: 'COMPLETE', url: `https://example.test/${id}/{w}x{h}.{f}` })
test('prefers standard iPhone screenshots even when Duo is returned first', async (t) => {
	const ui = await mountPanel(t, (request) => {
		if (request.url.pathname.endsWith('/preview-asset')) return { ok: true, exists: false, asc: null }
		if (request.url.pathname.endsWith('/creative-assets')) return { ok: true, assets: [] }
		if (request.url.pathname.endsWith('/screenshots')) return { ok: true, sets: [
			{ id: 'duo', displayType: 'APP_IPHONE_DUO', label: 'iPhone Duo', screenshots: [screenshot('duo')] },
			{ id: 'regular', displayType: 'APP_IPHONE_67', label: 'iPhone 6.9', screenshots: [screenshot('regular')] }
		] }
	})
	await ui.selectApp('App A')
	assert.ok(ui.container.querySelector('.asc-pv-shot img').src.includes('/regular/'))
	assert.ok(!ui.container.querySelector('.asc-preview-device').textContent.includes('Duo'))
})

test('previews ASC header and search assets when no local image exists', async (t) => {
	const ui = await mountPanel(t, (request) => {
		if (request.url.pathname.endsWith('/preview-asset')) return { ok: true, exists: false, asc: null }
		if (request.url.pathname.endsWith('/creative-assets')) return { ok: true, assets: [
			{ kind: 'header', deviceFamily: '', displayClassId: 'DEFAULT', placementGroup: 'DEFAULT_PROFILE', imageAssetUrl: 'https://example.test/header/{w}x{h}.{f}' },
			{ kind: 'search', deviceFamily: '', displayClassId: 'DEFAULT', placementGroup: 'DEFAULT_PROFILE', imageAssetUrl: 'https://example.test/search/{w}x{h}.{f}' }
		] }
	})
	await ui.selectApp('App A')
	assert.ok(ui.container.querySelector('.asc-pv-head img')?.src.includes('/header/'))
	await ui.click(ui.button('Search'))
	assert.ok(ui.container.querySelector('.asc-pv-asset-lg img')?.src.includes('/search/'))
	assert.equal(ui.calls.filter((request) => request.method === 'POST').length, 0)
})

test('prefers a standard iPhone placement and preserves its image proportions', async (t) => {
	const ui = await mountPanel(t, (request) => {
		if (request.url.pathname.endsWith('/creative-assets')) return { ok: true, assets: [
			{ kind: 'header', deviceFamily: '', displayClassId: 'DEFAULT', imageAssetUrl: 'https://example.test/default/{w}x{h}.{f}' },
			{ kind: 'header', deviceFamily: 'IPHONE', displayClassId: 'IPHONE_DUO', imageAssetUrl: 'https://example.test/duo/{w}x{h}.{f}' },
			{ kind: 'header', deviceFamily: 'IPAD', displayClassId: 'IPAD_13_DISPLAY', imageAssetUrl: 'https://example.test/ipad/{w}x{h}.{f}' },
			{ kind: 'header', deviceFamily: 'IPHONE', displayClassId: 'IPHONE_DYNAMIC_ISLAND_LARGE_DISPLAY', imageAssetUrl: 'https://example.test/iphone/{w}x{h}.{f}', width: 1500, height: 1000 }
		] }
	})
	await ui.selectApp('App A')
	assert.equal(ui.container.querySelector('.asc-pv-head img').src, 'https://example.test/iphone/1200x800.png')
	assert.equal(ui.container.querySelector('.asc-pv-head').style.aspectRatio, '1.5')
	assert.ok(!ui.button('Withdraw from ASC'))
	await ui.click(ui.button('Local asset'))
	assert.ok(ui.container.querySelector('.asc-pv-head img').src.includes('/preview-asset?'))
	await ui.click(ui.button('ASC asset'))
	assert.ok(ui.container.querySelector('.asc-pv-head img').src.includes('/iphone/'))
	assert.equal(ui.calls.filter((request) => request.method === 'POST').length, 0)
})

test('ignores late remote creative assets after selecting another app', async (t) => {
	const first = deferred()
	const ui = await mountPanel(t, (request) => {
		if (request.url.pathname.endsWith('/preview-asset')) return { ok: true, exists: false, asc: null }
		if (request.url.pathname.endsWith('/creative-assets')) return request.url.searchParams.get('appId') === A ? first.promise : { ok: true, assets: [
			{ kind: 'header', deviceFamily: 'IPHONE', displayClassId: 'IPHONE_DYNAMIC_ISLAND_LARGE_DISPLAY', imageAssetUrl: 'https://example.test/second/{w}x{h}.{f}' }
		] }
	})
	await ui.selectApp('App A')
	await ui.selectApp('App B')
	await act(async () => first.resolve({ ok: true, assets: [
		{ kind: 'header', deviceFamily: 'IPHONE', displayClassId: 'IPHONE_DYNAMIC_ISLAND_LARGE_DISPLAY', imageAssetUrl: 'https://example.test/first/{w}x{h}.{f}' }
	] }))
	assert.ok(ui.container.querySelector('.asc-pv-head img').src.includes('/second/'))
	assert.equal(ui.container.querySelectorAll('img[src*="/first/"]').length, 0)
})
