import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { createAgentDraftBridge, AgentDraftError, AGENT_DRAFT_LIMITS } from '../lib/agentDrafts.js'

function listing(appId = '12345') {
	return {
		app: { id: appId, name: 'Example', bundleId: `com.example.app${appId}`, primaryLocale: 'en-US', sku: 'secret-sku', privateKeyPem: 'PRIVATE KEY' },
		version: { id: `version-${appId}`, versionString: '1.2.0', appStoreState: 'PREPARE_FOR_SUBMISSION', editable: true, promoOnly: false },
		appInfo: { id: `info-${appId}`, appStoreState: 'PREPARE_FOR_SUBMISSION', editable: true },
		locales: [{ locale: 'en-US', appInfoLocId: `info-en-${appId}`, versionLocId: `version-en-${appId}`, name: 'Example', subtitle: 'Original subtitle', keywords: 'original', promotionalText: 'Original promo', description: 'Original description', whatsNew: 'Original release notes', marketingUrl: 'https://secret.example', supportUrl: 'https://secret.example/support', privateKey: 'PRIVATE KEY' }],
		credentials: { privateKeyPem: 'PRIVATE KEY' }
	}
}

function setup(options = {}) {
	let time = 1_800_000_000_000
	const sources = new Map([['12345', listing()], ['67890', listing('67890')]])
	const calls = []
	const bridge = createAgentDraftBridge({
		listApps: async (sessionId, signal) => { calls.push({ method: 'list', sessionId, signal }); return [...sources.values()].map((item) => item.app) },
		readListing: async (sessionId, appId, signal) => { calls.push({ method: 'read', sessionId, appId, signal }); return sources.get(appId) },
		now: () => time,
		...options
	})
	return { bridge, sources, calls, advance: (ms) => { time += ms } }
}

const change = (value = 'New release notes') => ({ locale: 'en-US', field: 'whatsNew', value })
const expectCode = (code) => (error) => error instanceof AgentDraftError && error.code === code
const deferred = () => {
	let resolve
	const promise = new Promise((done) => { resolve = done })
	return { promise, resolve }
}

test('lists and reads only approved app metadata and text', async () => {
	const { bridge, calls } = setup()
	const controller = new AbortController()
	const apps = await bridge.listApps('session-a', controller.signal)
	assert.deepEqual(Object.keys(apps[0]), ['id', 'name', 'bundleId', 'primaryLocale'])
	const result = await bridge.readListing('session-a', '12345', controller.signal)
	assert.match(result.contextId, /^[\da-f-]{36}$/)
	assert.equal(result.limits.whatsNew, 4000)
	assert.deepEqual(result.locales[0].editableFields, ['name', 'subtitle', 'keywords', 'promotionalText', 'description', 'whatsNew'])
	assert.doesNotMatch(JSON.stringify({ apps, result }), /PRIVATE KEY|privateKey|credentials|secret\.example|sku/)
	assert.equal(calls[0].sessionId, 'session-a')
	assert.equal(calls[1].signal, controller.signal)
})

test('accepts plain JSON records from a separate DSH VM realm', async () => {
	const source = vm.runInNewContext(`(${JSON.stringify(listing())})`)
	const { bridge } = setup({ readListing: async () => source })
	const { contextId } = await bridge.readListing('session-a', '12345')
	const input = vm.runInNewContext(`(${JSON.stringify({ contextId, changes: [change()] })})`)
	assert.equal((await bridge.stageDraft('session-a', input)).changes[0].value, 'New release notes')
})

test('stages local proposals with server-owned bases and isolated copies', async () => {
	const { bridge, sources, calls } = setup()
	const read = await bridge.readListing('session-a', '12345')
	read.app.id = '67890'
	read.locales[0].whatsNew = 'Tampered returned copy'
	read.locales[0].versionLocId = 'wrong-target'
	const input = { contextId: read.contextId, changes: [change()] }
	const proposal = await bridge.stageDraft('session-a', input)
	assert.equal(proposal.app.id, '12345')
	assert.equal(proposal.versionId, 'version-12345')
	assert.equal(proposal.createdAt, '2027-01-15T08:00:00.000Z')
	assert.deepEqual(proposal.changes, [{ ...change(), baseValue: 'Original release notes', targetId: 'version-en-12345' }])
	assert.equal(calls.filter((item) => item.method === 'read').length, 2)
	assert.equal(sources.get('12345').locales[0].whatsNew, 'Original release notes')
	input.changes[0].value = 'Input mutated'
	proposal.changes[0].value = 'Output mutated'
	const pending = bridge.pending('session-a')
	assert.equal(pending[0].changes[0].value, 'New release notes')
	pending[0].app.name = 'Pending mutated'
	assert.equal(bridge.pending('session-a')[0].app.name, 'Example')
})

test('isolates contexts, queues and acknowledgements by session and app', async () => {
	const { bridge } = setup()
	const a = await bridge.readListing('session-a', '12345')
	const b = await bridge.readListing('session-a', '67890')
	await assert.rejects(bridge.stageDraft('session-b', { contextId: a.contextId, changes: [change()] }), expectCode('CONTEXT'))
	const first = await bridge.stageDraft('session-a', { contextId: a.contextId, changes: [change()] })
	const second = await bridge.stageDraft('session-a', { contextId: b.contextId, changes: [change()] })
	assert.deepEqual(bridge.pending('session-b'), [])
	assert.equal(bridge.acknowledge('session-b', first.id), false)
	assert.equal(bridge.acknowledge('session-a', 'unrelated-id'), false)
	assert.deepEqual(bridge.pending('session-a').map((draft) => draft.app.id), ['12345', '67890'])
	assert.equal(bridge.acknowledge('session-a', first.id), true)
	assert.equal(bridge.acknowledge('session-a', first.id), false)
	assert.deepEqual(bridge.pending('session-a').map((draft) => draft.id), [second.id])
})

test('rejects invalid session and app identifiers before reading', async () => {
	const { bridge, calls } = setup()
	for (const sessionId of ['', ' ', null, 42, '__proto__', 'constructor', 'prototype', 'x'.repeat(257), 'session\nsecret']) {
		await assert.rejects(bridge.readListing(sessionId, '12345'), expectCode('SESSION'))
		assert.throws(() => bridge.pending(sessionId), expectCode('SESSION'))
	}
	for (const appId of ['', ' 12345', '12345/credentials', 12345, null, '1e5', '1'.repeat(33)]) {
		await assert.rejects(bridge.readListing('session-a', appId), expectCode('REQUEST'))
	}
	assert.equal(calls.length, 0)
})

test('rejects unknown, duplicated and forged changes without fetching', async () => {
	const { bridge, calls } = setup()
	const { contextId } = await bridge.readListing('session-a', '12345')
	const invalidInputs = [
		{ contextId, appId: '67890', changes: [change()] },
		{ contextId, versionId: 'other', changes: [change()] },
		{ contextId, changes: [{ ...change(), baseValue: 'fake' }] },
		{ contextId, changes: [{ ...change(), targetId: 'fake' }] },
		{ contextId, changes: [change(), change()] },
		{ contextId, changes: [{ ...change(), field: '__proto__' }] },
		{ contextId, changes: [{ ...change(), field: 'supportUrl' }] },
		{ contextId, changes: [{ ...change(), locale: 'zh-Hans' }] },
		{ contextId, changes: [{ ...change(), value: null }] },
		{ contextId, changes: [{ ...change(), value: { text: 'fake' } }] },
		{ contextId, changes: [] }
	]
	for (const input of invalidInputs) await assert.rejects(bridge.stageDraft('session-a', input), expectCode('REQUEST'))
	assert.equal(calls.length, 1)
	assert.deepEqual(bridge.pending('session-a'), [])
})

test('enforces Unicode field limits and ignores unchanged items', async () => {
	const { bridge } = setup()
	const { contextId } = await bridge.readListing('session-a', '12345')
	await assert.rejects(bridge.stageDraft('session-a', { contextId, changes: [{ ...change(), field: 'name', value: '😀'.repeat(31) }] }), expectCode('LIMIT'))
	await assert.rejects(bridge.stageDraft('session-a', { contextId, changes: Array(201).fill(change()) }), expectCode('LIMIT'))
	await assert.rejects(bridge.stageDraft('session-a', { contextId, changes: [change('Original release notes')] }), expectCode('EMPTY'))
	const proposal = await bridge.stageDraft('session-a', { contextId, changes: [change('Original release notes'), { ...change(), field: 'name', value: '😀'.repeat(30) }] })
	assert.equal(proposal.changes.length, 1)
	assert.equal(proposal.changes[0].field, 'name')
})

test('enforces total draft bytes across valid locales and fields', async () => {
	const { bridge, sources } = setup()
	const source = sources.get('12345')
	source.locales = Array.from({ length: 30 }, (_value, index) => ({ ...source.locales[0], locale: `en-${String(index).padStart(2, '0')}`, versionLocId: `version-${index}` }))
	const { contextId } = await bridge.readListing('session-a', '12345')
	const changes = source.locales.map((entry) => ({ locale: entry.locale, field: 'description', value: '文'.repeat(4000) }))
	await assert.rejects(bridge.stageDraft('session-a', { contextId, changes }), expectCode('LIMIT'))
})

test('exposes only editable fields for read-only resources and missing localization ids', async () => {
	const { bridge, sources } = setup()
	const source = sources.get('12345')
	source.version.editable = false
	source.version.promoOnly = true
	source.appInfo.editable = false
	const { contextId, locales } = await bridge.readListing('session-a', '12345')
	assert.deepEqual(locales[0].editableFields, ['promotionalText'])
	await assert.rejects(bridge.stageDraft('session-a', { contextId, changes: [change()] }), expectCode('READ_ONLY'))
	await assert.rejects(bridge.stageDraft('session-a', { contextId, changes: [{ ...change(), field: 'name' }] }), expectCode('READ_ONLY'))
	const promo = await bridge.stageDraft('session-a', { contextId, changes: [{ ...change(), field: 'promotionalText' }] })
	assert.equal(promo.changes[0].field, 'promotionalText')
	source.locales[0].versionLocId = ''
	assert.deepEqual((await bridge.readListing('session-a', '12345')).locales[0].editableFields, [])
})

test('rejects remote field, version, localization and editability changes', async (t) => {
	const cases = [
		['base value', (source) => { source.locales[0].whatsNew = 'Someone edited remotely' }, 'CONFLICT'],
		['version id', (source) => { source.version.id = 'new-version' }, 'CONFLICT'],
		['version string', (source) => { source.version.versionString = '2.0' }, 'CONFLICT'],
		['localization id', (source) => { source.locales[0].versionLocId = 'new-locale' }, 'CONFLICT'],
		['deleted locale', (source) => { source.locales = [] }, 'CONFLICT'],
		['read-only version', (source) => { source.version.editable = false }, 'READ_ONLY']
	]
	for (const [name, mutate, code] of cases) await t.test(name, async () => {
		const { bridge, sources } = setup()
		const { contextId } = await bridge.readListing('session-a', '12345')
		mutate(sources.get('12345'))
		await assert.rejects(bridge.stageDraft('session-a', { contextId, changes: [change()] }), expectCode(code))
		assert.deepEqual(bridge.pending('session-a'), [])
	})
})

test('expires contexts and pending proposals without extending TTL on access', async () => {
	const { bridge, advance } = setup()
	const { contextId } = await bridge.readListing('session-a', '12345')
	await bridge.stageDraft('session-a', { contextId, changes: [change()] })
	advance(AGENT_DRAFT_LIMITS.ttlMs - 1)
	assert.equal(bridge.pending('session-a').length, 1)
	advance(1)
	assert.equal(bridge.pending('session-a').length, 0)
	await assert.rejects(bridge.stageDraft('session-a', { contextId, changes: [change()] }), expectCode('CONTEXT'))
	assert.ok((await bridge.readListing('session-a', '12345')).contextId)
})

test('fails explicitly at context and draft capacities without evicting pending work', async () => {
	const { bridge, advance } = setup()
	const first = await bridge.readListing('session-a', '12345')
	for (let index = 1; index < AGENT_DRAFT_LIMITS.contexts; index += 1) await bridge.readListing('session-a', '12345')
	await assert.rejects(bridge.readListing('session-b', '12345'), expectCode('CAPACITY'))
	for (let index = 0; index < AGENT_DRAFT_LIMITS.drafts; index += 1) await bridge.stageDraft('session-a', { contextId: first.contextId, changes: [change(`Draft ${index}`)] })
	await assert.rejects(bridge.stageDraft('session-a', { contextId: first.contextId, changes: [change()] }), expectCode('CAPACITY'))
	assert.equal(bridge.pending('session-a').length, AGENT_DRAFT_LIMITS.drafts)
	assert.equal(bridge.pending('session-a')[0].changes[0].value, 'Draft 0')
	advance(AGENT_DRAFT_LIMITS.ttlMs)
	assert.ok((await bridge.readListing('session-b', '12345')).contextId)
})

test('clear invalidates pending reads and pending stages even when callbacks ignore cancellation', async (t) => {
	for (const action of ['read', 'stage']) await t.test(action, async () => {
		const wait = deferred()
		let hold = false
		const { bridge } = setup({ readListing: async () => hold ? wait.promise : listing() })
		const { contextId } = await bridge.readListing('session-a', '12345')
		await bridge.stageDraft('session-a', { contextId, changes: [change()] })
		hold = true
		const pending = action === 'read'
			? bridge.readListing('session-a', '12345')
			: bridge.stageDraft('session-a', { contextId, changes: [change()] })
		bridge.clear()
		wait.resolve(listing())
		await assert.rejects(pending, expectCode('CONTEXT'))
		assert.deepEqual(bridge.pending('session-a'), [])
		await assert.rejects(bridge.stageDraft('session-a', { contextId, changes: [change()] }), expectCode('CONTEXT'))
	})
})

test('aborted operations never create proposals or reusable read contexts', async () => {
	const wait = deferred()
	let hold = false
	const { bridge } = setup({ readListing: async () => hold ? wait.promise : listing() })
	const { contextId } = await bridge.readListing('session-a', '12345')
	const controller = new AbortController()
	controller.abort(new Error('secret cancellation reason'))
	await assert.rejects(bridge.stageDraft('session-a', { contextId, changes: [change()] }, controller.signal), expectCode('ABORTED'))
	await assert.rejects(bridge.readListing('session-a', '12345', controller.signal), expectCode('ABORTED'))
	const inFlight = new AbortController()
	hold = true
	const promise = bridge.stageDraft('session-a', { contextId, changes: [change()] }, inFlight.signal)
	inFlight.abort()
	wait.resolve(listing())
	await assert.rejects(promise, expectCode('ABORTED'))
	assert.deepEqual(bridge.pending('session-a'), [])
})

test('rechecks expiration after asynchronous validation', async () => {
	const wait = deferred()
	let hold = false
	const { bridge, advance } = setup({ readListing: async () => hold ? wait.promise : listing() })
	const { contextId } = await bridge.readListing('session-a', '12345')
	hold = true
	const pending = bridge.stageDraft('session-a', { contextId, changes: [change()] })
	advance(AGENT_DRAFT_LIMITS.ttlMs)
	wait.resolve(listing())
	await assert.rejects(pending, expectCode('CONTEXT'))
	assert.deepEqual(bridge.pending('session-a'), [])
})

test('concurrent reads and stages cannot exceed retained item capacities', async () => {
	const { bridge } = setup()
	const reads = await Promise.allSettled(Array.from({ length: AGENT_DRAFT_LIMITS.contexts + 1 }, () => bridge.readListing('session-a', '12345')))
	assert.equal(reads.filter((item) => item.status === 'fulfilled').length, AGENT_DRAFT_LIMITS.contexts)
	assert.equal(reads.find((item) => item.status === 'rejected').reason.code, 'CAPACITY')
	const contextId = reads.find((item) => item.status === 'fulfilled').value.contextId
	const stages = await Promise.allSettled(Array.from({ length: AGENT_DRAFT_LIMITS.drafts + 1 }, (_item, index) => bridge.stageDraft('session-a', { contextId, changes: [change(`Draft ${index}`)] })))
	assert.equal(stages.filter((item) => item.status === 'fulfilled').length, AGENT_DRAFT_LIMITS.drafts)
	assert.equal(stages.find((item) => item.status === 'rejected').reason.code, 'CAPACITY')
	assert.equal(bridge.pending('session-a').length, AGENT_DRAFT_LIMITS.drafts)
})

test('sanitizes upstream failures instead of disclosing diagnostics or credentials', async () => {
	const { bridge } = setup({
		listApps: async () => { throw new Error('Authorization: Bearer secret-jwt PRIVATE KEY') },
		readListing: async () => { throw new Error('https://private.network secret-issuer') }
	})
	for (const promise of [bridge.listApps('session-a'), bridge.readListing('session-a', '12345')]) {
		await assert.rejects(promise, (error) => {
			assert.equal(error.code, 'SOURCE')
			assert.doesNotMatch(String(error), /secret|PRIVATE KEY|Bearer|private\.network/)
			return true
		})
	}
})
