import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { AscClient } from '../lib/asc/client.js'
import { applySyncOps } from '../lib/asc/metadata.js'

const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'pem', type: 'pkcs8' })
const path = '/v1/appStoreVersionLocalizations/locale-1'
const operation = { target: 'appStoreVersionLocalization', id: 'locale-1', attributes: { description: 'Local C' }, baseValues: { description: 'Original A' } }
const client = () => new AscClient({ p8: key, keyId: 'SYNTHETIC', issuerId: 'synthetic-issuer' })
const resource = (attributes) => ({ data: { type: 'appStoreVersionLocalizations', id: 'locale-1', attributes } })

test('writes only the requested field after checking its current original', async (t) => {
	const requests = []
	t.mock.method(globalThis, 'fetch', async (url, options) => {
		requests.push({ url, method: options.method, body: options.body })
		return Response.json(resource({ description: 'Original A', keywords: 'Someone changed only keywords' }))
	})
	const results = await applySyncOps(client(), [operation])
	assert.equal(results[0].ok, true)
	assert.deepEqual(requests.map((item) => item.method), ['GET', 'PATCH'])
	assert.equal(new URL(requests[0].url).pathname, path)
	assert.deepEqual(JSON.parse(requests[1].body).data.attributes, { description: 'Local C' })
})

test('stops a stale write and accepts a fresh explicitly reviewed original', async (t) => {
	const requests = []
	t.mock.method(globalThis, 'fetch', async (_url, options) => {
		requests.push(options.method)
		return Response.json(resource({ description: 'External B' }))
	})
	const stale = await applySyncOps(client(), [operation])
	assert.equal(stale[0].code, 'COPY_CONFLICT')
	assert.deepEqual(requests, ['GET'])
	const reviewed = await applySyncOps(client(), [{ ...operation, baseValues: { description: 'External B' } }])
	assert.equal(reviewed[0].ok, true)
	assert.deepEqual(requests, ['GET', 'GET', 'PATCH'])
})

for (const failure of ['network', 'server', 'response-body', 'auth', 'rate-limit']) {
	test(`rechecks original text before a ${failure} retry and preserves an intervening edit`, async (t) => {
		let remote = 'Original A'
		const requests = []
		t.mock.method(globalThis, 'fetch', async (_url, options) => {
			requests.push(options.method)
			if (options.method === 'GET') return Response.json(resource({ description: remote }))
			// 第一次写入响应失败后，模拟其他编辑者修改了同一字段。
			remote = 'External B'
			if (failure === 'network') throw new Error('synthetic connection reset')
			if (failure === 'response-body') return { status: 200, ok: true, text: async () => { throw new Error('synthetic interrupted body') } }
			return new Response('{}', { status: failure === 'auth' ? 401 : failure === 'rate-limit' ? 429 : 503, headers: { 'retry-after': '0.001' } })
		})
		const results = await applySyncOps(client(), [operation])
		assert.equal(results[0].code, 'COPY_CONFLICT')
		assert.equal(remote, 'External B')
		assert.deepEqual(requests, ['GET', 'PATCH', 'GET'])
	})
}

test('recognizes a completed write after a lost response without replaying PATCH', async (t) => {
	let remote = 'Original A'
	const requests = []
	t.mock.method(globalThis, 'fetch', async (_url, options) => {
		requests.push(options.method)
		if (options.method === 'GET') return Response.json(resource({ description: remote }))
		remote = 'Local C'
		throw new Error('synthetic lost success response')
	})
	assert.equal((await applySyncOps(client(), [operation]))[0].ok, true)
	assert.deepEqual(requests, ['GET', 'PATCH', 'GET'])
})

test('does not write when the current field already equals the desired text', async (t) => {
	const requests = []
	t.mock.method(globalThis, 'fetch', async (_url, options) => {
		requests.push(options.method)
		return Response.json(resource({ description: 'Local C' }))
	})
	assert.equal((await applySyncOps(client(), [operation]))[0].ok, true)
	assert.deepEqual(requests, ['GET'])
})

test('does not write if current resource identity or text cannot be verified', async (t) => {
	let body
	const requests = []
	t.mock.method(globalThis, 'fetch', async (_url, options) => { requests.push(options.method); return Response.json(body) })
	for (const bad of [
		{ data: { type: 'appInfoLocalizations', id: 'locale-1', attributes: { description: 'Original A' } } },
		{ data: { type: 'appStoreVersionLocalizations', id: 'foreign', attributes: { description: 'Original A' } } },
		{ data: { type: 'appStoreVersionLocalizations', id: 'locale-1' } },
		resource({ description: 123 })
	]) {
		body = bad
		assert.equal((await applySyncOps(client(), [operation]))[0].code, 'SERVER')
	}
	assert.ok(requests.every((method) => method === 'GET'))
})

test('does not patch any field of a multi-field operation if one baseline conflicts', async (t) => {
	const requests = []
	t.mock.method(globalThis, 'fetch', async (_url, options) => {
		requests.push(options.method)
		return Response.json(resource({ description: 'External B', keywords: 'Original keywords' }))
	})
	const results = await applySyncOps(client(), [{ ...operation,
		attributes: { description: 'Local C', keywords: 'New keywords' },
		baseValues: { description: 'Original A', keywords: 'Original keywords' }
	}])
	assert.equal(results[0].code, 'COPY_CONFLICT')
	assert.deepEqual(requests, ['GET'])
})
