import test from 'node:test'
import assert from 'node:assert/strict'
import { createUpdateChecker } from '../lib/updates.js'

const manifest = (version = '0.1.3') => ({ name: 'dsh-asc-studio', version, dsh: { bundle: { patch: './cordis.patch.yml' } } })
const response = (value = manifest()) => Response.json(value)

test('only requests the fixed public package endpoint without credentials', async () => {
	const calls = []
	const checker = createUpdateChecker({ currentVersion: '0.1.2', now: () => 1000, request: async (...args) => { calls.push(args); return response() } })
	assert.deepEqual(await checker.check(), { currentVersion: '0.1.2', latestVersion: '0.1.3', status: 'available', checkedAt: 1000 })
	assert.equal(calls[0][0], 'https://registry.npmjs.org/dsh-asc-studio/latest')
	assert.deepEqual(calls[0][1].headers, { accept: 'application/json' })
	assert.equal(calls[0][1].credentials, 'omit')
	assert.equal(calls[0][1].redirect, 'error')
	assert.equal(calls[0][1].body, undefined)
	assert.ok(calls[0][1].signal instanceof AbortSignal)
})

test('compares numeric stable versions without offering a downgrade', async () => {
	for (const [currentVersion, latestVersion, status] of [
		['0.1.9', '0.1.10', 'available'], ['0.1.10', '0.1.9', 'current'],
		['0.1.2', '0.1.2', 'current'], ['0.9.9', '1.0.0', 'available'], ['1.0.0', '0.9.9', 'current']
	]) {
		const checker = createUpdateChecker({ currentVersion, request: async () => response(manifest(latestVersion)) })
		assert.equal((await checker.check()).status, status)
	}
})

test('caches successful checks for six hours and rate limits manual checks', async () => {
	let time = 1000, requests = 0
	const checker = createUpdateChecker({ currentVersion: '0.1.2', now: () => time, request: async () => { requests++; return response() } })
	const first = await checker.check()
	first.status = 'error'
	assert.equal((await checker.check()).status, 'available')
	await checker.check({ force: true }); assert.equal(requests, 1)
	time += 30_000
	await checker.check({ force: true }); assert.equal(requests, 2)
	time += 6 * 60 * 60 * 1000 - 1
	await checker.check(); assert.equal(requests, 2)
	time++
	await checker.check(); assert.equal(requests, 3)
})

test('coalesces concurrent checks into one request', async () => {
	let release, requests = 0
	const pending = new Promise((resolve) => { release = resolve })
	const checker = createUpdateChecker({ currentVersion: '0.1.2', request: async () => { requests++; await pending; return response() } })
	const a = checker.check(), b = checker.check({ force: true })
	release()
	assert.deepEqual(await a, await b)
	assert.equal(requests, 1)
})

test('retries failed checks and never returns raw network errors', async () => {
	let time = 1000, requests = 0
	const checker = createUpdateChecker({ currentVersion: '0.1.2', now: () => time, request: async () => {
		requests++
		if (requests === 1) throw new Error('Private proxy diagnostic')
		return response()
	} })
	assert.deepEqual(await checker.check(), { currentVersion: '0.1.2', latestVersion: null, checkedAt: time, status: 'error' })
	time += 5 * 60 * 1000 - 1
	assert.equal((await checker.check()).status, 'error'); assert.equal(requests, 1)
	time++
	assert.equal((await checker.check()).status, 'available'); assert.equal(requests, 2)
})

test('rejects unexpected packages, prereleases, invalid metadata and HTTP failures', async () => {
	for (const makeResponse of [
		() => response({ ...manifest(), name: 'other-plugin' }),
		() => response(manifest('0.2.0-beta.1')), () => response(manifest('01.2.3')),
		() => response(manifest('99999999999999999999999.1.1')),
		() => response({ ...manifest(), deprecated: 'Do not use' }),
		() => response({ name: 'dsh-asc-studio', version: '1.0.0' }),
		() => new Response('Bad gateway', { status: 502 }),
		() => new Response('<html>Proxy error</html>'),
		() => new Response('{', { headers: { 'content-type': 'application/json' } }),
		() => new Response('', { status: 302 })
	]) {
		const checker = createUpdateChecker({ currentVersion: '0.1.2', request: async () => makeResponse() })
		assert.equal((await checker.check()).status, 'error')
	}
})

test('limits both declared and streamed response sizes', async () => {
	for (const makeResponse of [
		() => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '1000000' } }),
		() => new Response(' '.repeat(65537), { headers: { 'content-type': 'application/json' } })
	]) {
		const checker = createUpdateChecker({ currentVersion: '0.1.2', request: async () => makeResponse() })
		assert.equal((await checker.check()).status, 'error')
	}
})
