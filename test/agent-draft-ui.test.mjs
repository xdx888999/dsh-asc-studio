import test from 'node:test'
import assert from 'node:assert/strict'
import { act } from 'react'
import { A, B, EN, deferred, detail, mountPanel } from '../support/ui.mjs'

const SESSION = 'conversation-a'
function proposal(overrides = {}) {
	return { id: 'draft-1', app: { id: A, name: 'App A', bundleId: 'app.a' }, versionId: `version-${A}`, versionString: '1.0', createdAt: Date.now(),
		changes: [{ locale: 'en-US', field: 'keywords', value: 'agent,copy', baseValue: 'initial', targetId: EN }], ...overrides }
}
const agentRequests = (ui, method = 'GET') => ui.calls.filter((request) => request.url.pathname.endsWith('/agent-drafts') && request.method === method)
const synced = (ui) => ui.calls.filter((request) => request.url.pathname.endsWith('/sync'))
const keywords = (ui) => ui.field('Keywords (comma separated)')
const refresh = async (ui) => { await ui.click(ui.button('Refresh drafts')); await ui.flush() }
function response(drafts) { return { ok: true, available: true, drafts } }

test('fills an Agent draft in its conversation and never syncs automatically', async (t) => {
	const ui = await mountPanel(t, (request) => request.url.pathname.endsWith('/agent-drafts')
		? request.method === 'GET' ? response([proposal()]) : { ok: true } : undefined, { sessionId: SESSION })
	assert.equal(keywords(ui).value, 'agent,copy')
	assert.ok(ui.container.querySelector('.asc-appbtn').textContent.includes('App A'))
	assert.match(ui.container.querySelector('.asc-agent').textContent, /Filled 1 suggestion/)
	assert.equal(agentRequests(ui)[0].url.searchParams.get('sessionId'), SESSION)
	assert.deepEqual(agentRequests(ui, 'POST').map((request) => request.body), [{ sessionId: SESSION, id: 'draft-1', action: 'acknowledge' }])
	assert.equal(synced(ui).length, 0)
})

test('keeps manual copy and displays the conflicting suggestion until ignored', async (t) => {
	let incoming = []
	const ui = await mountPanel(t, (request) => request.url.pathname.endsWith('/agent-drafts')
		? request.method === 'GET' ? response(incoming) : { ok: true } : undefined, { sessionId: SESSION })
	await ui.selectApp('App A'); await ui.edit('Keywords (comma separated)', 'My manual copy')
	incoming = [proposal()]; await refresh(ui)
	assert.equal(keywords(ui).value, 'My manual copy')
	assert.match(ui.container.querySelector('.asc-agent').textContent, /A manual draft already exists/)
	assert.match(ui.container.querySelector('.asc-agent-copy').textContent, /agent,copy/)
	assert.equal(agentRequests(ui, 'POST').length, 0)
	await ui.click(ui.button('Keep current copy and ignore suggestions'))
	assert.equal(keywords(ui).value, 'My manual copy')
	assert.equal(agentRequests(ui, 'POST').length, 1)
	await refresh(ui)
	assert.equal(keywords(ui).value, 'My manual copy')
	assert.equal(agentRequests(ui, 'POST').length, 1)
})

test('rechecks remote copy and rejects a stale baseline without losing other manual drafts', async (t) => {
	let incoming = [], remoteKeywords = 'initial'
	const ui = await mountPanel(t, (request) => {
		if (request.url.pathname.endsWith('/agent-drafts')) return request.method === 'GET' ? response(incoming) : { ok: true }
		if (request.url.pathname.endsWith('/app')) { const next = detail(A); next.locales[0].keywords = remoteKeywords; return next }
	}, { sessionId: SESSION })
	await ui.selectApp('App A'); await ui.edit('Name', 'My app name')
	remoteKeywords = 'Changed in ASC'; incoming = [proposal()]; await refresh(ui)
	assert.equal(keywords(ui).value, 'Changed in ASC')
	assert.equal(ui.field('Name').value, 'My app name')
	assert.match(ui.container.querySelector('.asc-agent').textContent, /ASC copy has changed/)
	assert.equal(agentRequests(ui, 'POST').length, 0)
})

test('preserves another app’s unsynced copy when opening Agent suggestions', async (t) => {
	let incoming = []
	const ui = await mountPanel(t, (request) => request.url.pathname.endsWith('/agent-drafts')
		? request.method === 'GET' ? response(incoming) : { ok: true } : undefined, { sessionId: SESSION })
	await ui.selectApp('App B'); await ui.edit('Name', 'B manual name')
	incoming = [proposal()]; await refresh(ui)
	assert.ok(ui.container.querySelector('.asc-appbtn').textContent.includes('App B'))
	await ui.click(ui.button('View Agent drafts'))
	assert.ok(ui.container.querySelector('.asc-appbtn').textContent.includes('App B'))
	assert.equal(ui.field('Name').value, 'B manual name')
	assert.match(ui.container.querySelector('.asc-agent').textContent, /Handle the current app’s unsynced drafts/)
	assert.match(ui.container.querySelector('.asc-agent-copy').textContent, /agent,copy/)
	assert.equal(agentRequests(ui, 'POST').length, 0)
})

test('switches apps explicitly when no unsynced draft would be discarded', async (t) => {
	let incoming = []
	const ui = await mountPanel(t, (request) => request.url.pathname.endsWith('/agent-drafts')
		? request.method === 'GET' ? response(incoming) : { ok: true } : undefined, { sessionId: SESSION })
	await ui.selectApp('App B'); incoming = [proposal()]; await refresh(ui)
	assert.ok(ui.container.querySelector('.asc-appbtn').textContent.includes('App B'))
	await ui.click(ui.button('View Agent drafts')); await ui.flush()
	assert.ok(ui.container.querySelector('.asc-appbtn').textContent.includes('App A'))
	assert.equal(keywords(ui).value, 'agent,copy')
})

test('ignores late responses after switching sessions and isolates receipt IDs', async (t) => {
	const slow = deferred()
	const ui = await mountPanel(t, (request) => {
		if (!request.url.pathname.endsWith('/agent-drafts')) return
		if (request.method === 'POST') return { ok: true }
		return request.url.searchParams.get('sessionId') === SESSION ? slow.promise : response([proposal({ changes: [{ locale: 'en-US', field: 'keywords', value: 'session-b', baseValue: 'initial', targetId: EN }] })])
	}, { sessionId: SESSION })
	await ui.rerenderSession('conversation-b'); await ui.flush()
	assert.equal(keywords(ui).value, 'session-b')
	assert.equal(agentRequests(ui)[0].signal.aborted, true)
	await act(async () => slow.resolve(response([proposal()])))
	assert.equal(keywords(ui).value, 'session-b')
	assert.deepEqual(agentRequests(ui, 'POST').map((request) => request.body.sessionId), ['conversation-b'])
})

for (const invalid of ['readonly', 'version', 'localization']) {
	test(`does not fill a draft after its ${invalid} changes`, async (t) => {
		const ui = await mountPanel(t, (request) => {
			if (request.url.pathname.endsWith('/agent-drafts')) return request.method === 'GET' ? response([proposal()]) : { ok: true }
			if (request.url.pathname.endsWith('/app')) {
				const next = detail(A)
				if (invalid === 'readonly') next.version.editable = false
				if (invalid === 'version') next.version.id = 'new-version'
				if (invalid === 'localization') next.locales[0].versionLocId = 'new-localization'
				return next
			}
		}, { sessionId: SESSION })
		assert.equal(keywords(ui).value, 'initial')
		assert.match(ui.container.querySelector('.asc-agent').textContent, invalid === 'readonly' ? /currently read-only/ : /version, or localization has changed/)
		assert.equal(agentRequests(ui, 'POST').length, 0)
	})
}

test('retries failed receipts without filling the same suggestion over later manual edits', async (t) => {
	let receiptWorks = false
	const ui = await mountPanel(t, (request) => request.url.pathname.endsWith('/agent-drafts')
		? request.method === 'GET' ? response([proposal()]) : receiptWorks ? { ok: true } : { ok: false, error: 'Receipt unavailable' } : undefined,
	{ sessionId: SESSION })
	assert.equal(keywords(ui).value, 'agent,copy')
	assert.match(ui.container.querySelector('.asc-agent').textContent, /receipt could not be saved/)
	await ui.edit('Keywords (comma separated)', 'My later edit')
	receiptWorks = true; await refresh(ui)
	assert.equal(keywords(ui).value, 'My later edit')
	assert.equal(agentRequests(ui, 'POST').length, 2)
	assert.ok(!ui.container.querySelector('.asc-agent').textContent.includes('receipt could not be saved'))
})

test('queues suggestions while the sync confirmation is open and preserves the snapshot', async (t) => {
	let incoming = []
	const ui = await mountPanel(t, (request) => request.url.pathname.endsWith('/agent-drafts')
		? request.method === 'GET' ? response(incoming) : { ok: true } : undefined, { sessionId: SESSION })
	await ui.selectApp('App A'); await ui.edit('Name', 'Reviewed name')
	await ui.click(ui.container.querySelector('.asc-footer button'))
	const snapshot = ui.container.querySelector('.asc-modal').textContent
	incoming = [proposal()]; await refresh(ui)
	assert.equal(keywords(ui).value, 'initial')
	assert.equal(ui.container.querySelector('.asc-modal').textContent, snapshot)
	assert.equal(agentRequests(ui, 'POST').length, 0)
	await ui.click(ui.button('Cancel')); await ui.flush()
	assert.equal(keywords(ui).value, 'agent,copy')
	assert.equal(ui.field('Name').value, 'Reviewed name')
	assert.equal(synced(ui).length, 0)
})

test('does not request drafts without a session or while the sidebar is hidden', async (t) => {
	const ui = await mountPanel(t)
	assert.match(ui.container.querySelector('.asc-agent').textContent, /Open this panel in a project conversation/)
	assert.equal(agentRequests(ui).length, 0)
	await ui.rerenderSession(SESSION, false); await ui.flush()
	assert.equal(agentRequests(ui).length, 0)
	await ui.rerenderSession(SESSION, true); await ui.flush()
	assert.equal(agentRequests(ui).length, 1)
	await ui.click(ui.container.querySelector('[aria-label="Settings"]'))
	assert.equal(agentRequests(ui)[0].signal.aborted, true)
})

test('aborts pending validation before a background tab can fill or acknowledge', async (t) => {
	let reads = 0
	const slow = deferred()
	const ui = await mountPanel(t, (request) => {
		if (request.url.pathname.endsWith('/agent-drafts')) return request.method === 'GET' ? response([proposal()]) : { ok: true }
		if (request.url.pathname.endsWith('/app') && ++reads > 1) return slow.promise
	}, { sessionId: SESSION })
	await ui.rerenderSession(SESSION, false)
	await act(async () => slow.resolve(detail(A)))
	assert.equal(keywords(ui).value, 'initial')
	assert.equal(agentRequests(ui, 'POST').length, 0)
})

test('fills safe fields while showing only conflicting fields for review', async (t) => {
	let incoming = []
	const ui = await mountPanel(t, (request) => request.url.pathname.endsWith('/agent-drafts')
		? request.method === 'GET' ? response(incoming) : { ok: true } : undefined, { sessionId: SESSION })
	await ui.selectApp('App A'); await ui.edit('Name', 'My name')
	incoming = [proposal({ changes: [...proposal().changes,
		{ locale: 'en-US', field: 'name', value: 'Suggested name', baseValue: `Name ${A}`, targetId: `info-${A}-en-US` }] })]
	await refresh(ui)
	assert.equal(keywords(ui).value, 'agent,copy')
	assert.equal(ui.field('Name').value, 'My name')
	assert.equal(ui.container.querySelectorAll('.asc-agent-copy').length, 1)
	assert.match(ui.container.querySelector('.asc-agent').textContent, /English.*Name/)
	await ui.edit('Keywords (comma separated)', 'Later edit'); await refresh(ui)
	assert.equal(keywords(ui).value, 'Later edit')
	assert.equal(agentRequests(ui, 'POST').length, 0)
})

test('treats an identical local suggestion as handled without replacing other manual fields', async (t) => {
	let incoming = []
	const ui = await mountPanel(t, (request) => request.url.pathname.endsWith('/agent-drafts')
		? request.method === 'GET' ? response(incoming) : { ok: true } : undefined, { sessionId: SESSION })
	await ui.selectApp('App A'); await ui.edit('Keywords (comma separated)', 'agent,copy'); await ui.edit('Name', 'Keep name')
	incoming = [proposal()]; await refresh(ui)
	assert.equal(keywords(ui).value, 'agent,copy')
	assert.equal(ui.field('Name').value, 'Keep name')
	assert.equal(agentRequests(ui, 'POST').length, 1)
	assert.equal(ui.container.querySelectorAll('.asc-agent-copy').length, 0)
})

test('honors edits made while the latest remote baseline is being fetched', async (t) => {
	let incoming = [], slow = null
	const ui = await mountPanel(t, (request) => {
		if (request.url.pathname.endsWith('/agent-drafts')) return request.method === 'GET' ? response(incoming) : { ok: true }
		if (request.url.pathname.endsWith('/app') && slow) return slow.promise
	}, { sessionId: SESSION })
	await ui.selectApp('App A')
	slow = deferred(); incoming = [proposal()]; await refresh(ui)
	await ui.edit('Keywords (comma separated)', 'Changed while loading')
	await act(async () => slow.resolve(detail(A)))
	assert.equal(keywords(ui).value, 'Changed while loading')
	assert.match(ui.container.querySelector('.asc-agent').textContent, /A manual draft already exists/)
})

test('isolates handled IDs when another session receives the same draft ID', async (t) => {
	const ui = await mountPanel(t, (request) => request.url.pathname.endsWith('/agent-drafts')
		? request.method === 'GET' ? response([proposal()]) : { ok: true } : undefined, { sessionId: SESSION })
	assert.equal(keywords(ui).value, 'agent,copy')
	await ui.rerenderSession('conversation-b'); await ui.flush()
	assert.equal(keywords(ui).value, 'agent,copy')
	assert.deepEqual(agentRequests(ui, 'POST').map((request) => request.body.sessionId), [SESSION, 'conversation-b'])
})

test('holds new drafts throughout a running sync and its result dialog', async (t) => {
	let incoming = [], serverName = `Name ${A}`
	const sync = deferred()
	const ui = await mountPanel(t, (request) => {
		if (request.url.pathname.endsWith('/agent-drafts')) return request.method === 'GET' ? response(incoming) : { ok: true }
		if (request.url.pathname.endsWith('/app')) return detail(A, serverName)
		if (request.url.pathname.endsWith('/sync')) return sync.promise
	}, { sessionId: SESSION })
	await ui.selectApp('App A'); await ui.edit('Name', 'Synced name')
	await ui.click(ui.container.querySelector('.asc-footer button')); await ui.click(ui.button('Sync now'))
	incoming = [proposal()]; await refresh(ui)
	assert.equal(keywords(ui).value, 'initial')
	assert.equal(agentRequests(ui, 'POST').length, 0)
	assert.deepEqual(synced(ui)[0].body.changes.map((change) => change.attributes), [{ name: 'Synced name' }])
	serverName = 'Synced name'
	await act(async () => sync.resolve({ ok: true, succeeded: 1, failed: 0, results: [{ index: 0, ok: true }] }))
	assert.equal(keywords(ui).value, 'initial')
	await ui.click(ui.button('Done')); await ui.flush()
	assert.equal(keywords(ui).value, 'agent,copy')
	assert.equal(synced(ui).length, 1)
})

test('resumes foreground polling after document visibility changes', async (t) => {
	const ui = await mountPanel(t, undefined, { sessionId: SESSION })
	Object.defineProperty(ui.dom.window.document, 'visibilityState', { configurable: true, value: 'hidden' })
	await act(async () => ui.dom.window.document.dispatchEvent(new ui.dom.window.Event('visibilitychange')))
	assert.equal(agentRequests(ui)[0].signal.aborted, true)
	assert.equal(ui.button('Refresh drafts').disabled, true)
	Object.defineProperty(ui.dom.window.document, 'visibilityState', { configurable: true, value: 'visible' })
	await act(async () => ui.dom.window.document.dispatchEvent(new ui.dom.window.Event('visibilitychange')))
	assert.equal(agentRequests(ui).length, 2)
	assert.equal(ui.button('Refresh drafts').disabled, false)
})

test('shows localized guidance and unsupported-host state without accepting drafts', async (t) => {
	const ui = await mountPanel(t, (request) => request.url.pathname.endsWith('/agent-drafts') ? { ok: true, available: false, drafts: [proposal()] } : undefined,
	{ sessionId: SESSION, language: 'zh-CN' })
	assert.match(ui.container.querySelector('.asc-agent').textContent, /在当前 DSH 会话中，让 Agent 生成并填写文案/)
	assert.match(ui.container.querySelector('.asc-agent').textContent, /当前宿主暂不支持 Agent 草稿/)
	assert.equal(agentRequests(ui, 'POST').length, 0)
	assert.equal(ui.field('关键词（逗号分隔）'), undefined)
})

test('retries a temporary baseline failure on manual refresh without requiring a new proposal', async (t) => {
	let appReads = 0, failing = true
	const ui = await mountPanel(t, (request) => {
		if (request.url.pathname.endsWith('/agent-drafts')) return request.method === 'GET' ? response([proposal()]) : { ok: true }
		if (request.url.pathname.endsWith('/app')) {
			appReads += 1
			return appReads > 1 && failing ? { ok: false, error: 'Temporary ASC network error' } : detail(A)
		}
	}, { sessionId: SESSION })
	assert.equal(keywords(ui).value, 'initial')
	assert.match(ui.container.querySelector('.asc-agent').textContent, /Use Refresh drafts to try again/)
	assert.equal(agentRequests(ui, 'POST').length, 0)
	assert.equal(appReads, 2)
	failing = false
	await refresh(ui)
	assert.equal(keywords(ui).value, 'agent,copy')
	assert.equal(appReads, 3)
	assert.equal(agentRequests(ui, 'POST').length, 1)
	assert.equal(ui.container.querySelectorAll('.asc-agent-copy').length, 0)
	await ui.edit('Keywords (comma separated)', 'Later manual edit'); await refresh(ui)
	assert.equal(keywords(ui).value, 'Later manual edit')
	assert.equal(appReads, 3)
	assert.equal(agentRequests(ui, 'POST').length, 1)
})

test('manual refresh does not reset an actual conflict even after the user clears their draft', async (t) => {
	let incoming = [], appReads = 0
	const ui = await mountPanel(t, (request) => {
		if (request.url.pathname.endsWith('/agent-drafts')) return request.method === 'GET' ? response(incoming) : { ok: true }
		if (request.url.pathname.endsWith('/app')) { appReads += 1; return detail(A) }
	}, { sessionId: SESSION })
	await ui.selectApp('App A'); await ui.edit('Keywords (comma separated)', 'Manual conflict')
	incoming = [proposal()]; await refresh(ui)
	assert.match(ui.container.querySelector('.asc-agent').textContent, /A manual draft already exists/)
	assert.equal(appReads, 2)
	await ui.edit('Keywords (comma separated)', 'initial'); await refresh(ui)
	assert.equal(keywords(ui).value, 'initial')
	assert.equal(appReads, 2)
	assert.match(ui.container.querySelector('.asc-agent').textContent, /A manual draft already exists/)
	assert.equal(agentRequests(ui, 'POST').length, 0)
})
