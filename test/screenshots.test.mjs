import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { AscError } from '../lib/asc/client.js'
import { uploadScreenshot } from '../lib/asc/screenshots.js'
import * as screenshots from '../lib/asc/screenshots.js'

function orderFixture(ids = ['first', 'second']) {
	const writes = []
	let current = ids
	const client = {
		get: async () => ({ body: { data: current.map((id) => ({ type: 'appScreenshots', id })) } }),
		patch: async (path, body, options) => {
			const completed = await options.beforeAttempt()
			if (completed) return completed
			writes.push({ path, body })
			current = body.data.map((entry) => entry.id)
			return { status: 204 }
		}
	}
	return { client, writes, options: { setId: 'set-one', expectedIds: ['first', 'second'], screenshotIds: ['second', 'first'] } }
}

test('reorders the complete screenshot relationship in the requested order', async () => {
	const f = orderFixture()
	await screenshots.reorderScreenshots(f.client, f.options)
	assert.equal(f.writes[0].path, '/v1/appScreenshotSets/set-one/relationships/appScreenshots')
	assert.deepEqual(f.writes[0].body.data, ['second','first'].map((id) => ({ type: 'appScreenshots', id })))
})

test('rejects missing, duplicate and foreign screenshot IDs before a reorder', async () => {
	for (const ids of [['first'], ['first','first'], ['first','foreign'], ['first','../second']]) {
		const f = orderFixture()
		await assert.rejects(() => screenshots.reorderScreenshots(f.client, { ...f.options, screenshotIds: ids }), { code: 'REQUEST' })
		assert.equal(f.writes.length, 0)
	}
})

test('does not overwrite a screenshot order changed in ASC since loading', async () => {
	const f = orderFixture(['first','third'])
	await assert.rejects(() => screenshots.reorderScreenshots(f.client, f.options), { code: 'SCREENSHOT_CONFLICT' })
	assert.equal(f.writes.length, 0)
})

test('recognizes an accepted reorder before retrying a lost response', async () => {
	const f = orderFixture()
	await screenshots.reorderScreenshots(f.client, f.options)
	await screenshots.reorderScreenshots(f.client, f.options)
	assert.equal(f.writes.length, 1)
})

test('rejects incomplete or malformed screenshot relationships before reordering', async () => {
	for (const body of [{ data: [null] }, { data: [] }, { data: [{ type: 'apps', id: 'first' }] },
		{ data: [{ type: 'appScreenshots', id: 'first' }], links: { next: '/next-page' } }]) {
		const f = orderFixture()
		f.client.get = async () => ({ body })
		await assert.rejects(() => screenshots.reorderScreenshots(f.client, f.options), { code: 'SCREENSHOT_CONFLICT' })
		assert.equal(f.writes.length, 0)
	}
})

function fixture() {
	const calls = []
	const options = { setId: 'set-1', fileName: 'test.png', buffer: Buffer.from('sixbyt') }
	const reserved = { id: 'new-shot', type: 'appScreenshots', attributes: { uploadOperations: [
		{ offset: 0, length: 3 }, { offset: 3, length: 3 }
	] } }
	const f = { calls, options, reserved, state: 'AWAITING_UPLOAD', createError: null, patchError: null, readError: null, deleteError: null }
	f.client = {
		async request(method, path, body) {
			calls.push({ method, path, body })
			if (method === 'POST') { if (f.createError) throw f.createError; return { body: { data: reserved } } }
			assert.equal(method, 'DELETE'); assert.equal(path, '/v1/appScreenshots/new-shot')
			if (f.deleteError) throw f.deleteError
			return { body: {} }
		},
		async patch(path, body) {
			calls.push({ method: 'PATCH', path, body })
			if (f.patchError) throw f.patchError
			return { body: { data: { attributes: { assetDeliveryState: { state: 'UPLOAD_COMPLETE' } } } } }
		},
		async get(path) {
			calls.push({ method: 'GET', path })
			if (f.readError) throw f.readError
			return { body: { data: { id: 'new-shot', type: 'appScreenshots', attributes: { assetDeliveryState: { state: f.state } } } } }
		}
	}
	return f
}

test('uploads all screenshot chunks before committing the original checksum', async () => {
	const f = fixture(), chunks = []
	const result = await uploadScreenshot(f.client, f.options, async (_op, bytes) => chunks.push(bytes))
	assert.equal(result.state, 'UPLOAD_COMPLETE')
	assert.deepEqual(Buffer.concat(chunks), f.options.buffer)
	assert.equal(f.calls.at(-1).body.data.attributes.sourceFileChecksum, createHash('md5').update(f.options.buffer).digest('hex'))
})

test('cleans only the new reservation after a partial screenshot transfer fails', async () => {
	const f = fixture(); let transfers = 0
	await assert.rejects(uploadScreenshot(f.client, f.options, async () => { if (++transfers === 2) throw new Error('transfer interrupted') }), /transfer interrupted/)
	assert.deepEqual(f.calls.map(({ method }) => method), ['POST', 'DELETE'])
})

test('cleans a reservation with missing upload operations', async () => {
	const f = fixture(); f.reserved.attributes.uploadOperations = []
	await assert.rejects(uploadScreenshot(f.client, f.options), /uploadOperations/)
	assert.equal(f.calls.at(-1).method, 'DELETE')
})

test('preserves an accepted screenshot when the commit response was lost', async () => {
	const f = fixture(); f.patchError = new AscError('NETWORK', 'response lost'); f.state = 'COMPLETE'
	const result = await uploadScreenshot(f.client, f.options, async () => {})
	assert.equal(result.state, 'COMPLETE')
	assert.deepEqual(f.calls.map(({ method }) => method), ['POST', 'PATCH', 'GET'])
})

test('cleans a rejected screenshot after verifying it was not accepted', async () => {
	const f = fixture(); f.patchError = new AscError('VALIDATION', 'invalid screenshot')
	await assert.rejects(uploadScreenshot(f.client, f.options, async () => {}), /invalid screenshot/)
	assert.deepEqual(f.calls.map(({ method }) => method), ['POST', 'PATCH', 'GET', 'DELETE'])
})

test('keeps an uncertain screenshot and asks for reconciliation when its state cannot be read', async () => {
	const f = fixture(); f.patchError = new AscError('NETWORK', 'lost'); f.readError = new Error('offline')
	await assert.rejects(uploadScreenshot(f.client, f.options, async () => {}), { code: 'SCREENSHOT_RECOVERY' })
	assert.ok(!f.calls.some(({ method }) => method === 'DELETE'))
})

test('reports incomplete cleanup without claiming the failed upload was removed', async () => {
	const f = fixture(); f.deleteError = new Error('offline')
	await assert.rejects(uploadScreenshot(f.client, f.options, async () => { throw new Error('failed') }), { code: 'SCREENSHOT_RECOVERY' })
})

test('does not guess a resource to delete or replay creation after an ambiguous response', async () => {
	const f = fixture(); f.createError = new AscError('NETWORK', 'response lost')
	await assert.rejects(uploadScreenshot(f.client, f.options), { code: 'SCREENSHOT_RECOVERY' })
	assert.equal(f.calls.length, 1)
})
