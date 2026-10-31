import test from 'node:test'
import assert from 'node:assert/strict'
import { listApps } from '../lib/asc/metadata.js'
import { guessDisplayType } from '../lib/asc/screenshots.js'

test('returns app list without waiting for icon lookups', async () => {
	const original = globalThis.fetch
	let externalRequests = 0
	globalThis.fetch = async () => { externalRequests += 1; throw new Error('No icon network request expected') }
	try {
		const apps = await listApps({ get: async () => ({ body: { data: [{ id: '123456', attributes: { name: 'App' } }] } }) })
		assert.equal(apps.length, 1); assert.equal(externalRequests, 0)
	} finally { globalThis.fetch = original }
})

test('detects supported iPad screenshot dimensions in both orientations', () => {
	for (const [width, height] of [[2048, 2732], [2732, 2048], [2064, 2752], [2752, 2064]]) assert.equal(guessDisplayType(width, height), 'APP_IPAD_PRO_3GEN_129')
	for (const [width, height] of [[1640, 2360], [2360, 1640]]) assert.equal(guessDisplayType(width, height), 'APP_IPAD_PRO_3GEN_11')
})
