import test from 'node:test'
import assert from 'node:assert/strict'
import { createCreativeSync } from '../lib/asc/creativeSync.js'
import { AscError } from '../lib/asc/client.js'

function fixture() {
	const records = new Map(), legacy = new Map(), placements = new Map(), images = new Set(), calls = []
	const scope = { appId: '123456', versionLocId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', kind: 'header' }
	const key = (scope) => `${scope.appId}:${scope.versionLocId}:${scope.kind}`
	const copy = (value) => value ? structuredClone(value) : null
	const store = {
		read: async (scope) => copy(records.get(key(scope))),
		write: async (scope, value) => records.set(key(scope), copy(value)),
		remove: async (scope) => records.delete(key(scope)),
		readLegacy: async (scope) => copy(legacy.get(scope.appId)),
		removeLegacy: async (scope) => legacy.delete(scope.appId)
	}
	const fail = { upload: false, processing: false, placement: 0, placementResponse: false, deletePlacement: false, deleteImage: false }
	let counter = 0
	const library = {
		PLACEMENT_TYPES: { header: 'PRODUCT_PAGE_HEADER_ASSET', search: 'APP_STORE_SEARCH_RESULTS_ASSET' },
		uploadCreativeAsset: async (client, { onReserved }) => {
			const imageId = `image-${++counter}`
			images.add(imageId); calls.push(['upload', imageId]); await onReserved(imageId)
			if (fail.upload) throw new Error('upload failed')
			return { imageId }
		},
		waitForImageReady: async () => { if (fail.processing) throw new Error('processing failed') },
		getImageState: async () => ({ state: 'PREPARE_FOR_SUBMISSION' }),
		placeCreativeAsset: async (client, { versionLocId, kind, imageId }) => {
			calls.push(['place', imageId, versionLocId])
			if (fail.placement > 0) { fail.placement -= 1; throw new Error('placement failed') }
			const placementId = `placement-${++counter}`
			placements.set(placementId, { attributes: { placementType: library.PLACEMENT_TYPES[kind] }, relationships: {
				appStoreVersionLocalization: { data: { id: versionLocId } }, image: { data: { id: imageId } }
			} })
			if (fail.placementResponse) { fail.placementResponse = false; throw new Error('response lost after creation') }
			return { placementId, state: 'PARENT_PREPARE_FOR_SUBMISSION' }
		},
		deletePlacement: async (client, id) => {
			calls.push(['delete-placement', id])
			if (fail.deletePlacement) throw new Error('delete placement failed')
			placements.delete(id)
		}
	}
	const client = {
		get: async (path) => {
			if (path.startsWith('/v1/appAssetLibraryImages/')) {
				const imageId = path.split('/')[3]
				return { body: { data: [...placements.entries()].filter(([, item]) => item.relationships.image.data.id === imageId).map(([id, item]) => ({ id, ...copy(item) })) } }
			}
			const id = path.split('/').pop().split('?')[0]
			if (!placements.has(id)) throw new AscError('NOT_FOUND', 'missing', { status: 404 })
			return { body: { data: copy(placements.get(id)) } }
		},
		request: async (method, path) => {
			assert.equal(method, 'DELETE')
			const id = path.split('/').pop(); calls.push(['delete-image', id])
			if (fail.deleteImage) throw new Error('delete image failed')
			images.delete(id)
		}
	}
	const service = createCreativeSync(store, library)
	const upload = (target = scope) => service.upload(client, target, { fileName: 'test.png', buffer: Buffer.from([1]) })
	return { records, legacy, placements, images, calls, scope, store, client, library, fail, service, upload, key }
}

test('keeps English and French placements independent', async () => {
	const f = fixture()
	const english = await f.upload()
	const frenchScope = { ...f.scope, versionLocId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }
	const french = await f.upload(frenchScope)
	assert.equal(f.placements.size, 2)
	await f.service.remove(f.client, frenchScope)
	assert.ok(f.placements.has(english.placementId))
	assert.ok(!f.placements.has(french.placementId))
	assert.ok(f.images.has(english.imageId))
})

for (const stage of ['upload', 'processing']) {
	test(`keeps old placement when ${stage} fails`, async () => {
		const f = fixture(); const old = await f.upload(); f.fail[stage] = true
		await assert.rejects(f.upload())
		assert.ok(f.placements.has(old.placementId))
		const meta = await f.store.read(f.scope)
		assert.equal(meta.imageId, old.imageId)
		assert.ok(meta.pendingImageId)
	})
}

test('restores old image when replacement placement fails', async () => {
	const f = fixture(); const old = await f.upload(); f.fail.placement = 1
	await assert.rejects(f.upload(), /placement failed/)
	const meta = await f.store.read(f.scope)
	assert.equal(meta.imageId, old.imageId)
	assert.ok(f.placements.has(meta.placementId))
	assert.equal(meta.restoreRequired, false)
})

test('persists recovery record when both placement and rollback fail', async () => {
	const f = fixture(); const old = await f.upload(); f.fail.placement = 2
	await assert.rejects(f.upload(), /旧素材尚未恢复/)
	const meta = await f.store.read(f.scope)
	assert.equal(meta.imageId, old.imageId)
	assert.equal(meta.restoreRequired, true)
	await f.upload()
	assert.equal(f.placements.size, 1)
	assert.equal((await f.store.read(f.scope)).restoreRequired, false)
})

test('keeps record and stops before image deletion when placement deletion fails', async () => {
	const f = fixture(); const old = await f.upload(); f.fail.deletePlacement = true
	await assert.rejects(f.service.remove(f.client, f.scope))
	assert.equal((await f.store.read(f.scope)).placementId, old.placementId)
	assert.ok(f.images.has(old.imageId))
	f.fail.deletePlacement = false
	await f.service.remove(f.client, f.scope)
	assert.equal(await f.store.read(f.scope), null)
})

test('retries partial withdrawal without losing remaining image id', async () => {
	const f = fixture(); const old = await f.upload(); f.fail.deleteImage = true
	await assert.rejects(f.service.remove(f.client, f.scope))
	const meta = await f.store.read(f.scope)
	assert.equal(meta.placementId, '')
	assert.equal(meta.imageId, old.imageId)
	f.fail.deleteImage = false
	await f.service.remove(f.client, f.scope)
	assert.equal(f.images.size, 0)
	assert.equal(await f.store.read(f.scope), null)
})

test('migrates legacy metadata only after checking its remote language', async () => {
	const f = fixture(); const english = await f.upload()
	f.legacy.set(f.scope.appId, english); f.records.clear()
	const french = { ...f.scope, versionLocId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }
	await f.service.remove(f.client, french)
	assert.ok(f.placements.has(english.placementId))
	assert.ok(f.legacy.has(f.scope.appId))
	assert.equal((await f.service.read(f.client, f.scope)).placementId, english.placementId)
	assert.equal(f.legacy.size, 0)
})

test('refuses deletion when remote placement binding no longer matches', async () => {
	const f = fixture(); const old = await f.upload()
	f.placements.get(old.placementId).relationships.appStoreVersionLocalization.data.id = 'foreign-locale'
	await assert.rejects(f.service.remove(f.client, f.scope), /不属于当前语言/)
	assert.ok(f.images.has(old.imageId))
	assert.ok(f.placements.has(old.placementId))
})

test('rejects concurrent mutation of the same scope', async () => {
	const f = fixture(); let release
	f.library.waitForImageReady = () => new Promise((resolve) => { release = resolve })
	const first = f.upload()
	while (!release) await new Promise((resolve) => setTimeout(resolve, 0))
	await assert.rejects(f.upload(), /正在操作/)
	release(); await first
})

test('recovers placement after a successful POST loses its response', async () => {
	const f = fixture(); await f.upload(); f.fail.placementResponse = true
	const result = await f.upload()
	assert.equal(f.placements.size, 1)
	assert.ok(f.placements.has(result.placementId))
	assert.equal(result.pendingImageId, '')
	assert.equal(f.images.size, 1)
})

test('recovers old placement when rollback succeeds but loses its response', async () => {
	const f = fixture(); const old = await f.upload()
	f.fail.placement = 1; f.fail.placementResponse = true
	await assert.rejects(f.upload(), /placement failed/)
	const restored = await f.store.read(f.scope)
	assert.equal(restored.imageId, old.imageId)
	assert.equal(restored.restoreRequired, false)
	assert.ok(f.placements.has(restored.placementId))
	await f.upload()
	assert.equal(f.placements.size, 1)
	assert.equal(f.calls.filter(([operation, image]) => operation === 'place' && image === old.imageId).length, 2)
})

for (const action of ['upload', 'remove']) {
	test(`recovers saved rollback placement before retrying ${action} after local save failure`, async () => {
		const f = fixture(); const old = await f.upload(); f.fail.placement = 1
		const write = f.store.write
		f.store.write = async (scope, value) => {
			if (value.imageId === old.imageId && value.placementId && value.placementId !== old.placementId && !value.restoreRequired) {
				throw new Error('local save failed')
			}
			return write(scope, value)
		}
		await assert.rejects(f.upload(), /旧素材尚未恢复/)
		assert.equal((await f.store.read(f.scope)).restoreRequired, true)
		assert.equal((await f.store.read(f.scope)).placementId, '')
		assert.equal(f.placements.size, 1)
		f.store.write = write
		if (action === 'upload') await f.upload()
		else await f.service.remove(f.client, f.scope)
		assert.equal(f.placements.size, action === 'upload' ? 1 : 0)
		assert.equal(f.images.size, action === 'upload' ? 1 : 0)
		assert.equal(f.calls.filter(([operation, image]) => operation === 'place' && image === old.imageId).length, 2)
	})
}

test('preserves placement record if lookup returns an incomplete response', async () => {
	const f = fixture(); const old = await f.upload()
	f.client.get = async () => ({ body: undefined })
	await assert.rejects(f.service.remove(f.client, f.scope), /无法确认素材/)
	assert.ok(f.placements.has(old.placementId))
	assert.ok(f.images.has(old.imageId))
	assert.equal((await f.store.read(f.scope)).placementId, old.placementId)
})
