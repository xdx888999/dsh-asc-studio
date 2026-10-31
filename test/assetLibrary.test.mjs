import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import { loadModule } from '../support/modules.mjs'
import { waitForImageReady } from '../lib/asc/assetLibrary.js'

test('uploads reserved image chunks through validated transport and commits', async () => {
	const sent = [], patches = [], reserved = []
	const library = await loadModule(resolve('lib/asc/assetLibrary.js'), {
		'node:https': { request: (options, callback) => {
			const request = new EventEmitter()
			request.end = (chunk) => {
				sent.push({ options, chunk: [...chunk] })
				const response = new EventEmitter(); response.statusCode = 200; callback(response); response.emit('end')
			}
			return request
		} }
	})
	const client = {
		get: async () => ({ body: { data: { id: 'library-1' } } }),
		post: async () => ({ body: { data: { id: 'image-1', attributes: { uploadOperations: [
			{ url: 'https://store-030.blobstore.apple.com/image', offset: 1, length: 2, method: 'PUT', requestHeaders: [{ name: 'content-type', value: 'image/png' }] }
		] } } } }),
		patch: async (path, body) => { patches.push({ path, body }); return {} }
	}
	const result = await library.uploadCreativeAsset(client, { appId: '123456', buffer: Buffer.from([0, 1, 2, 3]), fileName: 'test.png', onReserved: (id) => reserved.push(id) })
	assert.equal(result.imageId, 'image-1')
	assert.deepEqual(reserved, ['image-1'])
	assert.deepEqual(sent[0].chunk, [1, 2])
	assert.equal(sent[0].options.hostname, 'store-030.blobstore.apple.com')
	assert.equal(patches[0].body.data.attributes.uploaded, true)
})

test('waits until image processing completes and reports failed processing', async () => {
	const states = ['UPLOAD_COMPLETE', 'PREPARE_FOR_SUBMISSION']
	const client = { get: async () => ({ body: { data: { attributes: { state: states.shift() } } } }) }
	assert.equal((await waitForImageReady(client, 'image-1', { delay: async () => {} })).state, 'PREPARE_FOR_SUBMISSION')
	await assert.rejects(waitForImageReady({ get: async () => ({ body: { data: { attributes: { state: 'FAILED' } } } }) }, 'image-1'), /素材处理失败/)
})
