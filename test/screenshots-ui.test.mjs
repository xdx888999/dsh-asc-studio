import test from 'node:test'
import assert from 'node:assert/strict'
import { act } from 'react'
import { deferred, detail, mountPanel } from '../support/ui.mjs'

const shot = (id, state = 'COMPLETE') => ({ id, fileName: `${id}.png`, state, width: 1284, height: 2778, url: `https://example.test/${id}/{w}x{h}.{f}` })
const set = (screenshots, id = 'phone', label = 'iPhone 6.5"') => ({ id, label, displayType: 'APP_IPHONE_65', screenshots })
const payload = (sets) => ({ ok: true, sets, supported: { APP_IPHONE_65: { label: 'iPhone', sizes: [[1284, 2778]] } } })
const card = (ui) => ui.container.querySelector('input[multiple]').closest('.asc-card')
const order = (ui) => [...card(ui).querySelectorAll('.asc-shot-tile')].map((tile) => tile.dataset.shotId)
function clock() {
	const tasks = new Map()
	let sequence = 0
	return {
		configureWindow(window) {
			window.setTimeout = (fn) => { tasks.set(++sequence, fn); return sequence }
			window.clearTimeout = (id) => tasks.delete(id)
		},
		async next() {
			assert.ok(tasks.size, 'Pending uploads should schedule a status refresh')
			const [id, fn] = tasks.entries().next().value
			tasks.delete(id)
			await act(async () => fn())
		},
		get size() { return tasks.size }
	}
}

test('hides empty display groups while retaining processing screenshots', async (t) => {
	const ui = await mountPanel(t, (request) => request.url.pathname.endsWith('/screenshots')
		? payload([set([],'empty','iPhone 6.9"/6.7"'), set([shot('processing', 'UPLOAD_COMPLETE')])]) : undefined)
	await ui.selectApp('App A')
	assert.ok(!card(ui).textContent.includes('iPhone 6.9"/6.7"'))
	assert.match(card(ui).textContent, /Processing/)
})

test('shows immediate per-image deletion feedback and prevents repeated requests', async (t) => {
	const pending = deferred()
	let removed = false
	const ui = await mountPanel(t, async (request) => {
		if (!request.url.pathname.endsWith('/screenshots')) return
		if (request.method === 'POST') { await pending.promise; removed = true; return { ok: true } }
		return payload([set(removed ? [] : [shot('first')])])
	})
	await ui.selectApp('App A')
	const remove = card(ui).querySelector('[aria-label="Delete screenshot"]')
	await ui.click(remove)
	assert.match(card(ui).textContent, /Deleting/)
	assert.ok(remove.disabled)
	assert.equal(card(ui).querySelector('[data-shot-id="first"]').getAttribute('aria-busy'), 'true')
	await ui.click(remove)
	assert.equal(ui.calls.filter((call) => call.method === 'POST').length, 1)
	await act(async () => pending.resolve())
	assert.equal(card(ui).querySelectorAll('img').length, 0)
	assert.ok(!card(ui).textContent.includes('Deleting'))
})

test('refreshes processing images until ASC supplies usable previews without a click', async (t) => {
	const timer = clock()
	let reads = 0
	const ui = await mountPanel(t, (request) => {
		if (!request.url.pathname.endsWith('/screenshots')) return
		reads += 1
		return payload([set(reads === 1 ? [{ ...shot('new', 'UPLOAD_COMPLETE'), url: undefined }] : [shot('new')])])
	}, timer)
	await ui.selectApp('App A')
	assert.match(card(ui).textContent, /Processing/)
	await timer.next()
	assert.equal(reads, 2)
	assert.equal(card(ui).querySelectorAll('img').length, 1)
	assert.ok(!card(ui).textContent.includes('Processing'))
	assert.equal(timer.size, 0)
})

test('moves a screenshot with its expected order and refreshes the device preview', async (t) => {
	let shots = [shot('first'), shot('second')]
	const ui = await mountPanel(t, (request) => {
		if (request.url.pathname.endsWith('/preview-asset')) return { ok: true, exists: false, asc: null }
		if (!request.url.pathname.endsWith('/screenshots')) return
		if (request.method === 'POST') {
			assert.equal(request.body.action, 'reorder')
			assert.deepEqual(request.body.expectedIds, ['first', 'second'])
			assert.deepEqual(request.body.screenshotIds, ['second', 'first'])
			shots = [shots[1], shots[0]]
			return { ok: true }
		}
		return payload([set(shots)])
	})
	await ui.selectApp('App A')
	await ui.click(card(ui).querySelector('[aria-label="Move screenshot later"]'))
	assert.deepEqual(order(ui), ['second','first'])
	assert.ok(ui.container.querySelector('.asc-pv-shot img').src.includes('/second/'))
})

test('keeps screenshots read-only when the version is waiting for review', async (t) => {
	const ui = await mountPanel(t, (request) => {
		if (request.url.pathname.endsWith('/app')) {
			const app = detail(request.url.searchParams.get('id'))
			app.version.editable = false; app.version.appStoreState = 'WAITING_FOR_REVIEW'
			return app
		}
		if (request.url.pathname.endsWith('/screenshots')) return payload([set([shot('first'), shot('second')])])
	})
	await ui.selectApp('App A')
	assert.equal(card(ui).querySelector('[aria-label="Delete screenshot"]'), null)
	assert.equal(card(ui).querySelector('[aria-label="Move screenshot later"]'), null)
	assert.equal(ui.calls.filter((call) => call.method === 'POST').length, 0)
})

async function chooseFiles(ui, names) {
	const input = card(ui).querySelector('input[multiple]')
	Object.defineProperty(input, 'files', { configurable: true, value: names.map((name) => new ui.dom.window.File(['image'], name, { type: 'image/png' })) })
	await act(async () => input.dispatchEvent(new ui.dom.window.Event('change', { bubbles: true })))
}

test('reconciles an uncertain delete response and releases the busy state', async (t) => {
	let deleted = false, reads = 0
	const ui = await mountPanel(t, (request) => {
		if (!request.url.pathname.endsWith('/screenshots')) return
		if (request.method === 'POST') { deleted = true; return { ok: false, code: 'NETWORK', error: 'Delete response lost' } }
		reads += 1
		return payload([set(deleted ? [] : [shot('first')])])
	})
	await ui.selectApp('App A')
	await ui.click(card(ui).querySelector('[aria-label="Delete screenshot"]'))
	assert.equal(reads, 2)
	assert.deepEqual(order(ui), [])
	assert.ok(!card(ui).textContent.includes('Deleting'))
	assert.match(card(ui).textContent, /Delete response lost/)
	assert.equal(ui.button('Upload screenshots').disabled, false)
})

test('keeps refreshing pending images when a new file fails local validation', async (t) => {
	const timer = clock()
	const ui = await mountPanel(t, (request) => request.url.pathname.endsWith('/screenshots')
		? payload([set([shot('pending', 'UPLOAD_COMPLETE')])]) : undefined,
	{ ...timer, createImageBitmap: async () => ({ width: 1, height: 1, close() {} }) })
	await ui.selectApp('App A')
	assert.equal(timer.size, 1)
	await chooseFiles(ui, ['invalid.png'])
	assert.match(card(ui).textContent, /1×1/)
	assert.equal(ui.calls.filter((call) => call.method === 'POST').length, 0)
	assert.equal(timer.size, 1)
})

test('refreshes a partially successful batch through delayed listing and processing without clearing its error', async (t) => {
	const timer = clock()
	let uploaded = 0, reads = 0
	const ui = await mountPanel(t, (request) => {
		if (!request.url.pathname.endsWith('/screenshots')) return
		if (request.method === 'POST') {
			uploaded += 1
			return uploaded < 3 ? { ok: true, screenshotId: `batch-${uploaded}` } : { ok: false, code: 'SERVER', error: 'Third upload failed' }
		}
		reads += 1
		return payload([set(reads < 3 ? [] : [1, 2].map((id) => reads === 3
			? { ...shot(`batch-${id}`, 'UPLOAD_COMPLETE'), url: undefined } : shot(`batch-${id}`)))])
	}, { ...timer, createImageBitmap: async () => ({ width: 1284, height: 2778, close() {} }) })
	await ui.selectApp('App A')
	await chooseFiles(ui, ['one.png', 'two.png', 'three.png'])
	for (let i = 0; i < 100 && reads < 2; i++) await ui.flush()
	assert.equal(uploaded, 3)
	assert.equal(reads, 2)
	assert.equal(timer.size, 1)
	await timer.next()
	assert.match(card(ui).textContent, /Processing/)
	assert.equal(card(ui).querySelectorAll('img').length, 0)
	await timer.next()
	assert.equal(card(ui).querySelectorAll('img').length, 2)
	assert.equal(timer.size, 0)
	assert.match(card(ui).textContent, /Third upload failed/)
})

test('limits processing polls and allows a manual retry', async (t) => {
	const timer = clock()
	let complete = false, reads = 0
	const ui = await mountPanel(t, (request) => {
		if (!request.url.pathname.endsWith('/screenshots')) return
		reads += 1
		return payload([set([shot('pending', complete ? 'COMPLETE' : 'UPLOAD_COMPLETE')])])
	}, timer)
	await ui.selectApp('App A')
	for (let i = 0; i < 30; i++) await timer.next()
	assert.equal(reads, 31)
	assert.equal(timer.size, 0)
	assert.match(card(ui).textContent, /no need to upload them again/)
	complete = true
	await ui.click(card(ui).querySelector('[aria-label="Refresh screenshots"]'))
	assert.equal(reads, 32)
	assert.ok(!card(ui).textContent.includes('no need to upload them again'))
	assert.equal(timer.size, 0)
})

test('cancels the old processing poll when switching apps', async (t) => {
	const timer = clock()
	let reads = 0
	const ui = await mountPanel(t, (request) => {
		if (!request.url.pathname.endsWith('/screenshots')) return
		reads += 1
		return payload([set([shot(reads === 1 ? 'old-app' : 'new-app', reads === 1 ? 'UPLOAD_COMPLETE' : 'COMPLETE')])])
	}, timer)
	await ui.selectApp('App A')
	assert.equal(timer.size, 1)
	await ui.selectApp('App B')
	assert.equal(timer.size, 0)
	assert.deepEqual(order(ui), ['new-app'])
})

test('discards a late polling response during an optimistic reorder and reconciles a conflict', async (t) => {
	const timer = clock(), oldRead = deferred(), mutation = deferred()
	let reads = 0, pollingSignal
	const ui = await mountPanel(t, (request) => {
		if (!request.url.pathname.endsWith('/screenshots')) return
		if (request.method === 'POST') return mutation.promise
		reads += 1
		if (reads === 2) { pollingSignal = request.signal; return oldRead.promise }
		return payload([set([shot('first'), shot('second')]), set([shot('pending', 'UPLOAD_COMPLETE')], 'other')])
	}, timer)
	await ui.selectApp('App A')
	await timer.next()
	await ui.click(card(ui).querySelector('[aria-label="Move screenshot later"]'))
	assert.equal(pollingSignal.aborted, true)
	assert.deepEqual(order(ui).slice(0, 2), ['second', 'first'])
	await act(async () => oldRead.resolve(payload([set([shot('stale')])])))
	assert.deepEqual(order(ui).slice(0, 2), ['second', 'first'])
	await act(async () => mutation.resolve({ ok: false, code: 'SCREENSHOT_CONFLICT', error: 'Order changed' }))
	assert.deepEqual(order(ui).slice(0, 2), ['first', 'second'])
	assert.match(card(ui).textContent, /changed in ASC/)
	assert.equal(card(ui).querySelector('[aria-label="Move screenshot later"]').disabled, false)
})

test('only allows dropping screenshots inside their original group', async (t) => {
	let shots = [shot('first'), shot('second')]
	const ui = await mountPanel(t, (request) => {
		if (!request.url.pathname.endsWith('/screenshots')) return
		if (request.method === 'POST') {
			assert.equal(request.body.setId, 'phone')
			shots = request.body.screenshotIds.map((id) => shot(id))
			return { ok: true }
		}
		return payload([set(shots), set([shot('other-shot')], 'tablet')])
	})
	await ui.selectApp('App A')
	const event = async (id, type) => {
		const dragEvent = new ui.dom.window.Event(type, { bubbles: true, cancelable: true })
		dragEvent.dataTransfer = { setData() {} }
		await act(async () => card(ui).querySelector(`[data-shot-id="${id}"]`).dispatchEvent(dragEvent))
	}
	await event('first', 'dragstart'); await event('other-shot', 'drop')
	assert.equal(ui.calls.filter((call) => call.method === 'POST').length, 0)
	await event('first', 'dragstart'); await event('second', 'dragover'); await event('second', 'drop')
	assert.deepEqual(order(ui), ['second', 'first', 'other-shot'])
})
