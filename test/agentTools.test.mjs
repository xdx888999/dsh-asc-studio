import test from 'node:test'
import assert from 'node:assert/strict'
import { registerAgentTools } from '../lib/agentTools.js'
import { createAgentDraftBridge, AgentDraftError } from '../lib/agentDrafts.js'

function fixture() {
	const registered = new Map()
	const calls = []
	const source = {
		app: { id: '12345', name: 'Example', bundleId: 'com.example', primaryLocale: 'en-US', privateKey: 'SECRET' },
		version: { id: 'v1', versionString: '1.0', appStoreState: 'PREPARE_FOR_SUBMISSION', editable: true, promoOnly: false },
		appInfo: null,
		locales: [{ locale: 'en-US', versionLocId: 'en-v1', whatsNew: 'Old', marketingUrl: 'https://secret.example' }]
	}
	const bridge = createAgentDraftBridge({
		listApps: async (...args) => { calls.push(['listApps', ...args]); return [source.app] },
		readListing: async (...args) => { calls.push(['readListing', ...args]); return source }
	})
	const ctx = { tools: { register: (tool) => { registered.set(tool.name, tool); return () => registered.delete(tool.name) } } }
	const dispose = registerAgentTools(ctx, bridge)
	const signal = new AbortController().signal
	const exec = { agent: { session: { id: 'session-a' } }, signal }
	return { bridge, registered, dispose, calls, exec }
}

test('registers exactly the three read and local draft capabilities with disposable lifecycle', () => {
	const { registered, dispose } = fixture()
	assert.deepEqual([...registered.keys()], ['asc_list_apps', 'asc_read_listing', 'asc_stage_draft'])
	for (const tool of registered.values()) {
		assert.equal(tool.parameters.type, 'object')
		assert.equal(tool.parameters.additionalProperties, false)
		assert.ok(tool.output.schema)
		assert.match(tool.description, /当前会话项目/)
		assert.match(tool.description, /Git/)
		assert.match(tool.description, /不要猜测/)
		assert.match(tool.description, /不要读取或索取 \.p8/)
		assert.match(tool.description, /人工确认同步/)
	}
	dispose()
	dispose()
	assert.equal(registered.size, 0)
})

test('requires a real current agent session and rejects identity injection', async () => {
	const { registered, exec, calls } = fixture()
	const tool = registered.get('asc_list_apps')
	for (const invalidExec of [undefined, {}, { sessionId: 'session-a' }, { agent: {} }, { agent: { session: { id: '' } } }, { agent: { session: { id: '__proto__' } } }]) {
		await assert.rejects(tool.execute({}, invalidExec), (error) => error instanceof AgentDraftError && error.code === 'SESSION')
	}
	await assert.rejects(tool.execute({ sessionId: 'session-b' }, exec), (error) => error.code === 'REQUEST')
	assert.equal(calls.length, 0)
})

test('returns safe white-listed reads and a clearly unpublished stage receipt', async () => {
	const { registered, exec, calls, bridge } = fixture()
	const apps = await registered.get('asc_list_apps').execute({}, exec)
	const listing = await registered.get('asc_read_listing').execute({ appId: apps[0].id }, exec)
	const receipt = await registered.get('asc_stage_draft').execute({ contextId: listing.contextId, changes: [{ locale: 'en-US', field: 'whatsNew', value: 'New' }] }, exec)
	assert.equal(receipt.staged, true)
	assert.equal(receipt.count, 1)
	assert.equal(receipt.app.id, '12345')
	assert.match(receipt.message, /尚未写入或发布/)
	assert.match(receipt.message, /同一会话/)
	assert.match(receipt.message, /人工确认/)
	assert.equal(bridge.pending('session-a')[0].id, receipt.id)
	assert.ok(calls.every((call) => call[1] === 'session-a' && call.at(-1) === exec.signal))
	assert.deepEqual(calls.map((call) => call[0]), ['listApps', 'readListing', 'readListing'])
	const rendered = registered.get('asc_stage_draft').output.render({}, receipt)
	assert.deepEqual(JSON.parse(rendered[0].text), receipt)
	assert.doesNotMatch(JSON.stringify({ apps, listing, receipt, rendered }), /SECRET|privateKey|secret\.example|Bearer/)
})

test('cannot stage another session context or supply fabricated base values', async () => {
	const { registered, exec } = fixture()
	const listing = await registered.get('asc_read_listing').execute({ appId: '12345' }, exec)
	const args = { contextId: listing.contextId, changes: [{ locale: 'en-US', field: 'whatsNew', value: 'New' }] }
	await assert.rejects(registered.get('asc_stage_draft').execute(args, { ...exec, agent: { session: { id: 'session-b' } } }), (error) => error.code === 'CONTEXT')
	args.changes[0].baseValue = 'fake'
	await assert.rejects(registered.get('asc_stage_draft').execute(args, exec), (error) => error.code === 'REQUEST')
})

test('sanitizes thrown messages even when a bridge implementation fails unexpectedly', async () => {
	let definition
	const ctx = { tools: { register: (tool) => { if (tool.name === 'asc_list_apps') definition = tool; return () => {} } } }
	registerAgentTools(ctx, { listApps: async () => { throw new Error('PRIVATE KEY secret-account secret-jwt') } })
	await assert.rejects(definition.execute({}, { agent: { session: { id: 'session-a' } } }), (error) => {
		assert.equal(error.code, 'SOURCE')
		assert.doesNotMatch(String(error), /PRIVATE KEY|secret/)
		return true
	})
})

test('rolls back partially registered tools if registration fails', () => {
	const names = new Set()
	const ctx = { tools: { register: (tool) => {
		if (tool.name === 'asc_stage_draft') throw new Error('Registration unavailable')
		names.add(tool.name)
		return () => names.delete(tool.name)
	} } }
	assert.throws(() => registerAgentTools(ctx, {}), /Registration unavailable/)
	assert.equal(names.size, 0)
})
