import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as fs from 'node:fs/promises'
import * as asc from '../lib/asc/client.js'
import { loadModule } from '../support/modules.mjs'

const appId = '123456', loc = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', shot = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
async function fixture(profileDir = '/fake-profile/route-tests', options = {}) {
	const writes = [], reads = [], credentialScopes = [], credentialReads = [], credentialWrites = [], pathChecks = []
	const versionCopy = { locale: 'en-US', description: 'Test', keywords: 'test', whatsNew: 'test' }
	const infoCopy = { locale: 'en-US', name: 'Test' }
	const client = {
		get: async (path) => {
			reads.push(path)
			if (path.includes('/appStoreVersions?')) return { body: { data: [{ id: 'version-1', attributes: { versionString: '1.0', appStoreState: 'PREPARE_FOR_SUBMISSION' } }] } }
			if (path.includes('/appInfos?')) return { body: { data: [{ id: 'info-1', attributes: { appStoreState: 'PREPARE_FOR_SUBMISSION' } }] } }
			if (path.includes('/appInfoLocalizations?')) return { body: { data: [{ id: 'info-local', attributes: { ...infoCopy } }] } }
			if (path.includes('/appStoreVersionLocalizations?')) return { body: { data: [{ id: loc, attributes: { ...versionCopy } }] } }
			if (path === `/v1/appStoreVersionLocalizations/${loc}`) return { body: { data: { id: loc, type: 'appStoreVersionLocalizations', attributes: { ...versionCopy } } } }
			if (path === '/v1/appInfoLocalizations/info-local') return { body: { data: { id: 'info-local', type: 'appInfoLocalizations', attributes: { ...infoCopy } } } }
			if (path.endsWith('/appScreenshotSets')) return { body: { data: [{ id: 'set-1', attributes: { screenshotDisplayType: 'APP_IPHONE_67' } }] } }
			if (path.endsWith('/appScreenshots')) return { body: { data: [{ id: shot, attributes: { assetDeliveryState: { state: 'FAILED' } } }] } }
			if (path.includes('/placements?')) return { body: { data: [] } }
			if (path === `/v1/apps/${appId}`) return { body: { data: { attributes: { name: 'Test', primaryLocale: 'en-US' } } } }
			throw new Error(`Unexpected mocked request: ${path}`)
		},
		patch: async (path, body, optionsForPatch) => {
			const completed = await optionsForPatch?.beforeAttempt?.()
			if (completed) return completed
			await options.beforePatch?.()
			writes.push({ method: 'PATCH', path, body })
			Object.assign(path.includes('/appInfoLocalizations/') ? infoCopy : versionCopy, body.data.attributes)
			return {}
		},
		request: async (method, path, body) => { writes.push({ method, path, body }); return {} }
	}
	const entry = await loadModule(resolve('lib/index.js'), {
		'node:os': { homedir: () => '/fake-home', platform: () => 'darwin' },
		'node:fs/promises': { ...fs, lstat: (...args) => { pathChecks.push(args[0]); return fs.lstat(...args) } },
		[pathToFileURL(resolve('lib/asc/client.js')).href]: { ...asc, AscClient: class { constructor() { return client } } },
		[pathToFileURL(resolve('lib/store.js')).href]: {
			createCredentialStore: (scope) => { credentialScopes.push(scope); return {
				loadCredentials: async () => { credentialReads.push('load'); return { configured: true, issuerId: 'dummy', keyId: 'dummy', p8: 'fake' } },
				describeCredentials: async () => { credentialReads.push('describe'); return { configured: true } },
				saveCredentials: async (input) => { credentialWrites.push(input); return { storage: 'keychain' } }
			} }
		}
	})
	const routes = new Map(), agentTools = new Map()
	const tools = { register: (definition) => { agentTools.set(definition.name, definition); return () => agentTools.delete(definition.name) } }
	const webServer = { register: (route) => { routes.set(route.path, route.handler); return () => {} }, getOrigin: () => 'http://127.0.0.1:3080' }
	// 宿主认证契约替身；真实签名 Cookie 由运行中 DSH 的集成验证覆盖。
	const connection = Object.hasOwn(options, 'connection') ? options.connection : { admit: (req) => {
		if (req.headers.host !== '127.0.0.1:3080' || req.headers.origin && req.headers.origin !== 'http://127.0.0.1:3080') return { rejection: 403 }
		return req.headers.cookie === 'test-owner-session' ? { peer: { principal: { kind: 'owner' } } } : { rejection: 401 }
	} }
	const services = { profileContext: { name: 'route-tests', dir: profileDir }, webServer, connection, tools }
	entry.apply({ get: (key) => services[key], inject: (names, callback) => callback({ ...services, effect: (fn) => fn() }) })
	const request = async (route, body, { method = 'POST', headers = {}, address = '127.0.0.1' } = {}) => {
		const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
		Object.assign(req, { method, url: `/plugins/dsh-asc-studio/${route}`, socket: { remoteAddress: address },
			headers: { origin: 'http://127.0.0.1:3080', host: '127.0.0.1:3080', cookie: 'test-owner-session', 'content-type': 'application/json', 'x-dsh-asc-studio': '1', ...headers } })
		let status, payload, responseHeaders
		await routes.get(req.url.split('?')[0])(req, {
			writeHead: (value, nextHeaders) => { status = value; responseHeaders = nextHeaders },
			end: (value) => { payload = responseHeaders?.['content-type'] === 'image/png' ? value : JSON.parse(value) }
		})
		return { status, payload, headers: responseHeaders }
	}
	const callTool = (name, args, sessionId = 'session-a') => agentTools.get(name).execute(args, { agent: { session: { id: sessionId } }, signal: new AbortController().signal })
	return { request, callTool, agentTools, writes, reads, credentialScopes, credentialReads, credentialWrites, pathChecks, routes, versionCopy, infoCopy }
}

test('serves only the bundled brand image without loading ASC credentials', async () => {
	const f = await fixture()
	const response = await f.request('brand-icon', undefined, { method: 'GET', headers: { origin: undefined } })
	assert.equal(response.status, 200)
	assert.equal(response.headers['content-type'], 'image/png')
	assert.deepEqual(response.payload, await fs.readFile(new URL('../icon.png', import.meta.url)))
	assert.equal((await f.request('brand-icon', {})).status, 405)
	assert.equal((await f.request('brand-icon', undefined, { method: 'GET', headers: { 'sec-fetch-site': 'cross-site' } })).status, 403)
	assert.deepEqual([f.credentialReads.length, f.credentialWrites.length, f.reads.length, f.writes.length], [0, 0, 0, 0])
})

test('connects agent tools to authenticated session drafts without granting ASC writes', async () => {
	const f = await fixture()
	assert.deepEqual([...f.agentTools.keys()].sort(), ['asc_list_apps', 'asc_read_listing', 'asc_stage_draft'])
	const context = await f.callTool('asc_read_listing', { appId })
	const staged = await f.callTool('asc_stage_draft', { contextId: context.contextId, changes: [{ locale: 'en-US', field: 'description', value: 'Agent draft' }] })
	assert.ok(staged.id)
	assert.equal(f.writes.length, 0)
	const own = await f.request('agent-drafts?sessionId=session-a', undefined, { method: 'GET' })
	assert.equal(own.status, 200); assert.equal(own.payload.available, true)
	assert.equal(own.payload.drafts[0].changes[0].value, 'Agent draft')
	const other = await f.request('agent-drafts?sessionId=session-b', undefined, { method: 'GET' })
	assert.equal(other.payload.drafts.length, 0)
	await f.request('agent-drafts', { sessionId: 'session-b', id: staged.id, action: 'acknowledge' })
	assert.equal((await f.request('agent-drafts?sessionId=session-a', undefined, { method: 'GET' })).payload.drafts.length, 1)
	await f.request('agent-drafts', { sessionId: 'session-a', id: staged.id, action: 'acknowledge' })
	assert.equal((await f.request('agent-drafts?sessionId=session-a', undefined, { method: 'GET' })).payload.drafts.length, 0)
	assert.equal(f.writes.length, 0)
})

test('invalidates staged drafts and read contexts when credentials are saved', async () => {
	const f = await fixture()
	const context = await f.callTool('asc_read_listing', { appId })
	await f.callTool('asc_stage_draft', { contextId: context.contextId, changes: [{ locale: 'en-US', field: 'description', value: 'Old account draft' }] })
	assert.equal((await f.request('config', { issuerId: 'new', keyId: 'new', p8: 'synthetic' })).status, 200)
	assert.equal((await f.request('agent-drafts?sessionId=session-a', undefined, { method: 'GET' })).payload.drafts.length, 0)
	await assert.rejects(f.callTool('asc_stage_draft', { contextId: context.contextId, changes: [{ locale: 'en-US', field: 'description', value: 'stale' }] }))
	assert.equal(f.writes.length, 0)
})

test('draft HTTP endpoint cannot create drafts or execute a model supplied operation', async () => {
	const f = await fixture()
	for (const body of [{ sessionId: 'session-a', action: 'stage', changes: [] }, { sessionId: 'session-a', id: 'x', action: 'acknowledge', sync: true }]) {
		assert.equal((await f.request('agent-drafts', body)).status, 400)
	}
	assert.equal(f.credentialReads.length, 0); assert.equal(f.writes.length, 0)
})

test('rejects anonymous reads and writes on every route before accessing storage or credentials', async () => {
	const f = await fixture()
	for (const path of f.routes.keys()) {
		for (const method of ['GET', 'POST']) {
			for (const origin of [undefined, 'http://127.0.0.1:3080']) {
				const response = await f.request(path.replace('/plugins/dsh-asc-studio/', ''), {}, { method, headers: { cookie: undefined, origin } })
				assert.equal(response.status, 401, `${method} ${path}`)
				assert.equal(response.payload.code, 'SESSION')
			}
		}
	}
	assert.deepEqual([f.pathChecks.length, f.credentialReads.length, f.credentialWrites.length, f.reads.length, f.writes.length], [0, 0, 0, 0, 0])
})

test('rejects forged sessions and foreign authorities before any data access', async () => {
	const f = await fixture()
	for (const headers of [
		{ cookie: 'forged-owner-session' }, { cookie: 'expired-owner-session' },
		{ host: 'attacker.invalid:3080', origin: undefined },
		{ origin: 'https://attacker.invalid' }
	]) {
		assert.ok([401, 403].includes((await f.request('config', undefined, { method: 'GET', headers })).status))
	}
	assert.equal(f.pathChecks.length, 0); assert.equal(f.credentialReads.length, 0)
})

test('fails closed for missing broken unknown or non-owner host authentication', async () => {
	for (const [connection, expected] of [
		[undefined, 503], [{}, 503], [{ admit: () => { throw new Error('private diagnostic') } }, 503],
		...[null, undefined, true, 'owner', {}, { peer: { principal: { kind: 'guest' } } }, { rejection: 403, peer: { principal: { kind: 'owner' } } }].map((result) => [{ admit: () => result }, 403])
	]) {
		const f = await fixture(undefined, { connection })
		const response = await f.request('config', undefined, { method: 'GET' })
		assert.equal(response.status, expected)
		assert.ok(!JSON.stringify(response).includes('private diagnostic'))
		assert.equal(f.pathChecks.length, 0); assert.equal(f.credentialReads.length, 0)
	}
})

test('accepts authenticated browser and desktop requests without requiring desktop Origin', async () => {
	const f = await fixture()
	for (const origin of ['http://127.0.0.1:3080', undefined]) {
		assert.equal((await f.request('config', undefined, { method: 'GET', headers: { origin } })).status, 200)
		assert.equal((await f.request('config', { issuerId: 'test', keyId: 'test', p8: 'synthetic-input' }, { headers: { origin } })).status, 200)
	}
	assert.equal(f.credentialWrites.length, 2)
})

test('refuses sync for another localization before any writes', async () => {
	const f = await fixture()
	const response = await f.request('sync', { appId, versionId: 'version-1', changes: [{ target: 'appStoreVersionLocalization', id: 'foreign-locale', attributes: { description: 'wrong app' } }] })
	assert.equal(response.status, 409); assert.equal(f.writes.length, 0)
})

test('checks version identity before applying a valid localization change', async () => {
	const f = await fixture()
	const body = { appId, versionId: 'old-version', changes: [{ target: 'appStoreVersionLocalization', id: loc, attributes: { keywords: 'updated' }, baseValues: { keywords: 'test' } }] }
	assert.equal((await f.request('sync', body)).status, 409)
	assert.equal(f.writes.length, 0)
	body.versionId = 'version-1'
	const response = await f.request('sync', body)
	assert.equal(response.status, 200); assert.equal(response.payload.succeeded, 1)
	assert.equal(f.writes[0].path, `/v1/appStoreVersionLocalizations/${loc}`)
})

test('keeps externally changed copy while syncing another unchanged field', async () => {
	const f = await fixture()
	const initial = await f.request(`app?id=${appId}`, undefined, { method: 'GET' })
	f.versionCopy.description = 'Changed directly in ASC'
	const response = await f.request('sync', { appId, versionId: 'version-1', changes: [
		{ target: 'appStoreVersionLocalization', id: loc, attributes: { description: 'My draft' }, baseValues: { description: initial.payload.locales[0].description } },
		{ target: 'appStoreVersionLocalization', id: loc, attributes: { keywords: 'updated' }, baseValues: { keywords: 'test' } }
	] })
	assert.equal(response.status, 200)
	assert.equal(response.payload.failed, 1); assert.equal(response.payload.succeeded, 1)
	assert.equal(response.payload.results[0].code, 'COPY_CONFLICT')
	assert.equal(f.versionCopy.description, 'Changed directly in ASC')
	assert.equal(f.versionCopy.keywords, 'updated')
	assert.equal(f.writes.length, 1)
	assert.deepEqual(Object.keys(f.writes[0].body.data.attributes), ['keywords'])
})

test('protects all six fields including originally empty text', async () => {
	for (const field of ['name', 'subtitle', 'keywords', 'description', 'whatsNew', 'promotionalText']) {
		const f = await fixture()
		const isInfo = ['name', 'subtitle'].includes(field)
		const copy = isInfo ? f.infoCopy : f.versionCopy
		const original = copy[field] ?? ''
		copy[field] = 'Edited elsewhere'
		const response = await f.request('sync', { appId, versionId: 'version-1', changes: [{
			target: isInfo ? 'appInfoLocalization' : 'appStoreVersionLocalization', id: isInfo ? 'info-local' : loc,
			attributes: { [field]: 'Local draft' }, baseValues: { [field]: original }
		}] })
		assert.equal(response.payload.results[0].code, 'COPY_CONFLICT', field)
		assert.equal(f.writes.length, 0, field)
	}
})

test('refuses missing or malformed original values without any write', async () => {
	for (const baseValues of [undefined, null, [], {}, { description: null }, { description: 1 }]) {
		const f = await fixture()
		const response = await f.request('sync', { appId, versionId: 'version-1', changes: [{ target: 'appStoreVersionLocalization', id: loc, attributes: { description: 'Local draft' }, baseValues }] })
		assert.equal(response.payload.results[0].code, 'REQUEST')
		assert.equal(f.writes.length, 0)
	}
})

test('blocks concurrent same-app sync and releases the lock afterwards', async () => {
	let release, started
	const pause = new Promise((resolve) => { release = resolve })
	const pending = new Promise((resolve) => { started = resolve })
	const f = await fixture(undefined, { beforePatch: () => { started(); return pause } })
	const body = { appId, versionId: 'version-1', changes: [{ target: 'appStoreVersionLocalization', id: loc, attributes: { keywords: 'updated' }, baseValues: { keywords: 'test' } }] }
	const first = f.request('sync', body)
	await pending
	try {
		assert.equal((await f.request('sync', body)).status, 409)
		assert.equal(f.writes.length, 0)
	} finally { release() }
	assert.equal((await first).payload.succeeded, 1)
	assert.equal((await f.request('sync', body)).payload.succeeded, 1)
	assert.equal(f.writes.length, 1)
})

test('refuses a screenshot from another language before deletion', async () => {
	const f = await fixture()
	const response = await f.request('screenshots', { action: 'delete', appId, versionLocId: loc, screenshotId: 'cccccccc-cccc-cccc-cccc-cccccccccccc' })
	assert.equal(response.status, 409); assert.equal(f.writes.length, 0)
	assert.equal((await f.request('screenshots', { action: 'delete', appId, versionLocId: loc, screenshotId: shot })).status, 200)
	assert.equal(f.writes[0].path, `/v1/appScreenshots/${shot}`)
})

test('requires localization scope on creative mutations', async () => {
	const f = await fixture()
	assert.equal((await f.request('asset-to-asc', { action: 'remove', appId, kind: 'header' })).status, 400)
	assert.equal((await f.request('asset-to-asc', { action: 'remove', appId, kind: 'header', versionLocId: 'cccccccc-cccc-cccc-cccc-cccccccccccc' })).status, 409)
	assert.equal(f.writes.length, 0)
})

test('does not count failed screenshot reservations as usable screenshots', async () => {
	const f = await fixture()
	const response = await f.request(`precheck?id=${appId}`, undefined, { method: 'GET' })
	assert.equal(response.status, 200)
	assert.ok(response.payload.results.some((item) => item.level === 'err' && item.message.includes('iPhone')))
})

test('preserves loopback and origin guards on write routes', async () => {
	const f = await fixture()
	assert.equal((await f.request('sync', {}, { headers: { 'x-dsh-asc-studio': '' } })).status, 403)
	assert.equal((await f.request('sync', {}, { headers: { origin: 'https://foreign.example' } })).status, 403)
	assert.equal((await f.request('sync', {}, { address: '192.0.2.1' })).status, 403)
	assert.equal(f.writes.length, 0)
})

test('checks app localization ownership before reading remote creative assets', async () => {
	const f = await fixture()
	const wrong = await f.request(`creative-assets?appId=${appId}&versionLocId=${shot}`, undefined, { method: 'GET' })
	assert.equal(wrong.status, 409)
	assert.ok(!f.reads.some((path) => path.includes('/placements?')))
	const correct = await f.request(`creative-assets?appId=${appId}&versionLocId=${loc}`, undefined, { method: 'GET' })
	assert.equal(correct.status, 200)
	assert.deepEqual(correct.payload.assets, [])
	assert.equal(f.writes.length, 0)
})

test('uses independent profile directories, keychain services and preference scopes', async () => {
	const first = await fixture('/fake-profile/test'), second = await fixture('/fake-profile/desktop')
	assert.equal(first.credentialScopes[0].directory, '/fake-profile/test/data/dsh-asc')
	assert.equal(second.credentialScopes[0].directory, '/fake-profile/desktop/data/dsh-asc')
	assert.notEqual(first.credentialScopes[0].keychainService, second.credentialScopes[0].keychainService)
	const a = await first.request('config', undefined, { method: 'GET' })
	const b = await second.request('config', undefined, { method: 'GET' })
	assert.notEqual(a.payload.config.profileId, b.payload.config.profileId)
})

test('storage routes reject cross-origin cleanup and never call ASC', async () => {
	const f = await fixture()
	assert.equal((await f.request('storage', { action: 'clear-images' }, { headers: { origin: 'https://foreign.example' } })).status, 403)
	assert.equal((await f.request('storage', { action: 'clear-images' }, { headers: { 'x-dsh-asc-studio': '' } })).status, 403)
	assert.equal((await f.request('storage', { action: 'clear-images', appId: '../../elsewhere' })).status, 400)
	const summary = await f.request('storage', undefined, { method: 'GET' })
	assert.equal(summary.status, 200)
	assert.equal(summary.payload.storage.directory, '/fake-profile/route-tests/data/dsh-asc')
	assert.equal(summary.payload.storage.canUninstall, false)
	assert.deepEqual(f.writes, []); assert.deepEqual(f.reads, [])
})
