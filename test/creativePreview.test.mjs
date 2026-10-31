import test from 'node:test'
import assert from 'node:assert/strict'
import { listCreativePreviewAssets } from '../lib/asc/creativePreview.js'

const LOCALE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const PATH = `/v1/appStoreVersionLocalizations/${LOCALE}/placements`
const header = 'PRODUCT_PAGE_HEADER_ASSET', search = 'APP_STORE_SEARCH_RESULTS_ASSET'
const placement = (id, imageId, type = header, group = 'phone-large') => ({
	type: 'appAssetLibraryPlacements', id,
	attributes: { placementType: type, placementGroup: group, state: 'PARENT_APPROVED' },
	relationships: { image: { data: { type: 'appAssetLibraryImages', id: imageId } }, appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: LOCALE } } }
})
const image = (id) => ({ type: 'appAssetLibraryImages', id, attributes: {
	state: 'APPROVED', imageAsset: { templateUrl: `https://is1-ssl.mzstatic.com/${id}/{w}x{h}bb.{f}`, width: 1440, height: 900 }
} })
const refData = { data: [{ type: 'appAssetLibraryRefData', id: 'ref-data', attributes: {
	placementProfileGroups: [
		{ placementProfileGroupId: 'phone-large', platform: 'IOS', displayClassId: 'IPHONE_DYNAMIC_ISLAND_LARGE_DISPLAY' },
		{ placementProfileGroupId: 'duo', platform: 'IOS', displayClassId: 'IPHONE_DUO' },
		{ placementProfileGroupId: 'tablet', platform: 'IOS', displayClassId: 'IPAD_13_DISPLAY' }
	],
	displayClasses: [
		{ displayClassId: 'IPHONE_DYNAMIC_ISLAND_LARGE_DISPLAY', deviceFamily: 'IPHONE', screenDimensions: ['1320x2868'] },
		{ displayClassId: 'IPHONE_DUO', deviceFamily: 'IPHONE', screenDimensions: ['1998x2732'] },
		{ displayClassId: 'IPAD_13_DISPLAY', deviceFamily: 'IPAD', screenDimensions: ['2064x2752'] }
	]
} }] }

function fixture(handler) {
	const calls = []
	return { calls, client: { get: async (path) => {
		const url = new URL(path, 'https://api.appstoreconnect.apple.com'); calls.push(url)
		if (url.pathname === '/v1/appAssetLibraryRefData') return { body: structuredClone(refData) }
		const body = await handler(url)
		if (body === undefined) throw new Error(`Unexpected request: ${path}`)
		return { body }
	} } }
}

test('joins placement images by resource id and resolves phone, Duo and iPad groups', async () => {
	const f = fixture(() => ({ data: [placement('p-1', 'i-1'), placement('p-2', 'i-2', search, 'duo'), placement('p-3', 'i-3', header, 'tablet')], included: [image('i-3'), image('i-2'), image('i-1')] }))
	const result = await listCreativePreviewAssets(f.client, LOCALE)
	assert.deepEqual(result.map((entry) => [entry.kind, entry.imageId, entry.deviceFamily, entry.displayClassId]), [
		['header', 'i-1', 'IPHONE', 'IPHONE_DYNAMIC_ISLAND_LARGE_DISPLAY'],
		['search', 'i-2', 'IPHONE', 'IPHONE_DUO'], ['header', 'i-3', 'IPAD', 'IPAD_13_DISPLAY']
	])
	assert.equal(result[0].imageAssetUrl, image('i-1').attributes.imageAsset.templateUrl)
	assert.equal(result[0].width, 1440); assert.equal(result[0].height, 900)
	assert.equal(f.calls[0].pathname, PATH)
	assert.equal(f.calls[0].searchParams.get('filter[placementType]'), `${header},${search}`)
	assert.equal(f.calls[0].searchParams.get('include'), 'image')
	assert.equal(f.calls[0].searchParams.get('limit'), '200')
})

test('collects every page before resolving included images', async () => {
	const f = fixture((url) => url.searchParams.has('cursor')
		? { data: [placement('p-2', 'i-2', search)], included: [image('i-1'), image('i-2')], links: { next: null } }
		: { data: [placement('p-1', 'i-1')], links: { next: `https://api.appstoreconnect.apple.com${PATH}?cursor=next` } })
	assert.equal((await listCreativePreviewAssets(f.client, LOCALE)).length, 2)
	assert.equal(f.calls.length, 3)
	assert.equal(f.calls.filter((url) => url.pathname === PATH).length, 2)
})

for (const next of ['https://example.com/steal', `http://api.appstoreconnect.apple.com${PATH}`, 'https://api.appstoreconnect.apple.com/v1/appStoreVersionLocalizations/foreign/placements', `https://user:pass@api.appstoreconnect.apple.com${PATH}`]) {
	test(`rejects pagination outside the authorized resource: ${next}`, async () => {
		const f = fixture(() => ({ data: [], links: { next } }))
		await assert.rejects(listCreativePreviewAssets(f.client, LOCALE), /分页地址不属于当前版本语言/)
		assert.equal(f.calls.length, 1)
	})
}

test('reads an omitted image by id and retains unknown device groups', async () => {
	const f = fixture((url) => url.pathname === PATH
		? { data: [placement('p-1', 'i-1', header, 'future-device')] }
		: { data: image('i-1') })
	const [result] = await listCreativePreviewAssets(f.client, LOCALE)
	assert.equal(result.imageId, 'i-1')
	assert.equal(result.placementGroup, 'future-device')
	assert.equal(result.deviceFamily, '')
	assert.equal(result.displayClassId, '')
	assert.ok(f.calls.some((url) => url.pathname === '/v1/appAssetLibraryImages/i-1'))
})

test('fails on missing image data instead of reporting no remote creative assets', async () => {
	const f = fixture((url) => url.pathname === PATH ? { data: [placement('p-1', 'i-1')] } : { data: null })
	await assert.rejects(listCreativePreviewAssets(f.client, LOCALE), /关联图片缺失/)
})

test('does not replace a failed placement request with an empty list', async () => {
	const f = fixture(() => { throw new Error('ASC denied read') })
	await assert.rejects(listCreativePreviewAssets(f.client, LOCALE), /ASC denied read/)
})

test('skips reference data when the localization has no creative placements', async () => {
	const f = fixture(() => ({ data: [], links: {} }))
	assert.deepEqual(await listCreativePreviewAssets(f.client, LOCALE), [])
	assert.equal(f.calls.length, 1)
})

test('keeps pending image state without inventing a preview URL', async () => {
	const pending = image('i-1'); pending.attributes = { state: 'UPLOAD_COMPLETE' }
	const f = fixture(() => ({ data: [placement('p-1', 'i-1')], included: [pending] }))
	const [result] = await listCreativePreviewAssets(f.client, LOCALE)
	assert.equal(result.imageAssetUrl, '')
	assert.equal(result.width, null)
})
