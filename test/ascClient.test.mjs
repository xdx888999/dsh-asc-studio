import test from 'node:test'
import assert from 'node:assert/strict'
import { AscClient } from '../lib/asc/client.js'

function client() {
	const client = new AscClient()
	client.tokenCache = { token: 'dummy-token-for-test', signedAt: Date.now() }
	return client
}

for (const failure of ['network', 'server', 'response-body']) {
	test(`does not replay resource creation after ${failure} failure`, async (t) => {
		let calls = 0
		t.mock.method(globalThis, 'fetch', async () => {
			calls += 1
			if (failure === 'network') throw new Error('connection reset')
			if (failure === 'server') return new Response('{}', { status: 503 })
			return { status: 201, ok: true, text: async () => { throw new Error('response interrupted') } }
		})
		await assert.rejects(client().post('/v1/appAssetLibraryPlacements', { data: {} }),
			(error) => error.code === (failure === 'server' ? 'SERVER' : 'NETWORK'))
		assert.equal(calls, 1)
	})
}

test('retries a read after a temporary service error', async (t) => {
	let calls = 0
	t.mock.method(globalThis, 'fetch', async () => {
		calls += 1
		return calls === 1 ? new Response('{}', { status: 503 }) : Response.json({ data: { id: 'app-1' } })
	})
	const result = await client().get('/v1/apps/app-1')
	assert.equal(result.body.data.id, 'app-1')
	assert.equal(calls, 2)
})

test('retries the same field update after its response body is interrupted', async (t) => {
	const requests = []
	t.mock.method(globalThis, 'fetch', async (url, options) => {
		requests.push({ url, method: options.method, body: options.body })
		if (requests.length === 1) return { status: 200, ok: true, text: async () => { throw new Error('response interrupted') } }
		return Response.json({ data: { id: 'locale-1' } })
	})
	const result = await client().patch('/v1/appStoreVersionLocalizations/locale-1', { data: { attributes: { description: 'saved' } } })
	assert.equal(result.body.data.id, 'locale-1')
	assert.equal(requests.length, 2)
	assert.deepEqual(requests[0], requests[1])
})
