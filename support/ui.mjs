import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'

export const A = '123456', B = '234567'
export const EN = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', FR = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
export function detail(appId, name = `Name ${appId}`) {
	return { ok: true, app: { id: appId }, version: { id: `version-${appId}`, editable: true, appStoreState: 'PREPARE_FOR_SUBMISSION' }, appInfo: { editable: true },
		locales: ['en-US', 'fr-FR'].map((locale, index) => ({ locale, appInfoLocId: `info-${appId}-${locale}`, versionLocId: index === 0 ? EN : FR,
			name, subtitle: 'Subtitle', keywords: 'initial', description: 'Description', whatsNew: 'Changes', promotionalText: '' })) }
}
export function deferred() {
	let resolve, reject
	const promise = new Promise((yes, no) => { resolve = yes; reject = no })
	return { promise, resolve, reject }
}
export async function mountPanel(t, handler = () => undefined, options = {}) {
	const dom = new JSDOM('<html><head></head><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:3080', pretendToBeVisual: true })
	options.configureWindow?.(dom.window)
	if (options.storedLanguage !== undefined) dom.window.localStorage.setItem('dsh-asc.ui-language', options.storedLanguage)
	for (const [key, value] of Object.entries(options.storageEntries ?? {})) dom.window.localStorage.setItem(key, value)
	if (options.storageUnavailable) Object.defineProperty(dom.window, 'localStorage', { get() { throw new Error('Storage unavailable') } })
	if (options.readNativeLocale) dom.window.__DSH_LOCALE__ = { read: options.readNativeLocale }
	const navigator = { language: options.language ?? 'en-US', languages: options.languages }
	globalThis.window = dom.window; globalThis.document = dom.window.document
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
	const calls = []
	const fetch = async (url, fetchOptions = {}) => {
		const request = { url: new URL(url, dom.window.location.href), method: fetchOptions.method ?? 'GET', body: fetchOptions.body ? JSON.parse(fetchOptions.body) : null, signal: fetchOptions.signal }
		calls.push(request)
		let payload = await handler(request)
		if (payload === undefined) {
			switch (request.url.pathname.split('/').pop()) {
				case 'updates': payload = { ok: true, update: { currentVersion: '0.1.2', latestVersion: '0.1.2', status: 'current', checkedAt: 1793433600000 } }; break
				case 'config': payload = { ok: true, config: { configured: true, ...(options.profileId ? { profileId: options.profileId } : {}) } }; break
				case 'apps': payload = { ok: true, apps: [{ id: A, name: 'App A', bundleId: 'app.a' }, { id: B, name: 'App B', bundleId: 'app.b' }] }; break
				case 'icon': payload = { ok: true, iconUrl: null }; break
				case 'app': payload = detail(request.url.searchParams.get('id')); break
				case 'preview-asset': payload = { ok: true, exists: true, asc: null }; break
				case 'agent-drafts': payload = { ok: true, available: true, drafts: [] }; break
				case 'creative-assets': payload = { ok: true, assets: [] }; break
				case 'screenshots': payload = { ok: true, sets: [], supported: {} }; break
				case 'storage': payload = { ok: true, storage: { directory: '/tmp/dsh-test/storage', profileId: 'asc-test', totalBytes: 0, imageBytes: 0, imageCount: 0, recordBytes: 0, recordCount: 0, apps: [], legacy: { available: false }, automaticUninstallCleanup: false } }; break
				default: throw new Error(`Unexpected request: ${url}`)
			}
		}
		return { ok: payload.ok !== false, status: payload.ok === false ? 500 : 200, json: async () => payload }
	}
	let exports, Panel, Entry
	dom.window.__ModuleLoader__ = { load: (definition) => { exports = definition.factory((name) => { if (name !== 'react') throw new Error(name); return React }) } }
	vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), {
		window: dom.window, document: dom.window.document, navigator,
		fetch, AbortController, console, URL, FileReader: dom.window.FileReader, Image: dom.window.Image,
		createImageBitmap: options.createImageBitmap
	})
	exports.apply({
		effect: (fn) => fn(),
		inject: (names, fn) => fn({ get: () => ({ register: () => () => {} }) }),
		slots: { inject: (name, fn) => fn(), register: (options, component) => {
			if (options.key === 'dsh-asc-studio') Panel = component
			if (options.id === 'dsh-asc-studio-entry') Entry = component
			return () => {}
		} }
	})
	const { createRoot } = await import('react-dom/client')
	const container = dom.window.document.getElementById('root')
	const root = createRoot(container)
	t.after(async () => { await act(async () => root.unmount()); dom.window.close() })
	const renderPanel = async (sessionId, visible = true) => { await act(async () => root.render(React.createElement(React.Fragment, null, options.includeEntry ? React.createElement(Entry) : null, React.createElement(Panel, { sessionId, useTabInfo: () => ({ tab: { visible } }) })))) }
	await renderPanel(options.sessionId, options.visible ?? true)
	const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) }) }
	const click = async (element) => {
		assertElement(element)
		await act(async () => element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
	}
	const button = (text) => [...container.querySelectorAll('button')].find((item) => item.textContent.trim() === text)
	const selectApp = async (name) => { await click(container.querySelector('.asc-appbtn')); await click([...container.querySelectorAll('[role="option"]')].find((item) => item.textContent.includes(name))) }
	const field = (name) => [...container.querySelectorAll('.asc-field')].find((item) => item.querySelector('.asc-field-label')?.textContent === name)?.querySelector('input,textarea')
	const edit = async (name, value) => {
		const input = field(name); assertElement(input)
		await act(async () => {
			Object.getOwnPropertyDescriptor(input.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype, 'value').set.call(input, value)
			input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
		})
	}
	await flush()
	return { dom, container, calls, click, button, selectApp, field, edit, flush, navigator, rerenderSession: renderPanel }
}
function assertElement(element) { if (!element) throw new Error('Expected UI element not found') }
