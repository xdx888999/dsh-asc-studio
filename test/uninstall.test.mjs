import test from 'node:test'
import assert from 'node:assert/strict'
import { createUninstaller } from '../lib/uninstall.js'

function fixture() {
	const calls = []
	let installed = true
	const bundle = { name: 'dsh-asc-studio', installed: true, removable: true, rows: [{ moduleName: 'dsh-asc-studio', entryId: 'include/dsh-asc-studio' }], overrides: [] }
	const manager = { listBundles: async () => installed ? [bundle] : [], removeBundle: async (name) => {
		calls.push(['remove', name]); installed = false; return { application: 'applied', packageResult: { exitCode: 0 } }
	} }
	const ctx = { get: (key) => key === 'pluginManager' ? manager : key === 'hmr' ? {} : undefined,
		fiber: { entry: { id: 'include/dsh-asc-studio', options: { name: 'dsh-asc-studio' } } } }
	const storage = { prepareUninstall: async () => calls.push(['clean']) }
	return { calls, bundle, manager, ctx, storage, uninstaller: createUninstaller(ctx, storage) }
}

test('cleans only after resolving its own bundle and before invoking host uninstall', async () => {
	const f = fixture()
	assert.equal(await f.uninstaller.available(), true)
	assert.deepEqual(f.calls, [])
	assert.deepEqual(await f.uninstaller.uninstall(), { uninstalled: true, restartRequired: false })
	assert.deepEqual(f.calls, [['clean'], ['remove', 'dsh-asc-studio']])
})

test('does not clean or uninstall a bundle containing other plugins', async () => {
	const f = fixture(); f.bundle.rows.push({ moduleName: 'another-plugin', entryId: 'include/other' })
	assert.equal(await f.uninstaller.available(), false)
	await assert.rejects(f.uninstaller.uninstall(), /不支持直接卸载/)
	assert.deepEqual(f.calls, [])
})

test('does not clean or uninstall the separately owned old package name', async () => {
	const f = fixture()
	f.ctx.fiber.entry.options.name = 'dsh-asc'
	f.bundle.rows[0].moduleName = 'dsh-asc'
	assert.equal(await f.uninstaller.available(), false)
	await assert.rejects(f.uninstaller.uninstall(), /不支持直接卸载/)
	assert.deepEqual(f.calls, [])
})

test('does not clean when the running host has no hot reload support', async () => {
	const f = fixture(); f.ctx.get = (key) => key === 'pluginManager' ? f.manager : undefined
	assert.equal(await f.uninstaller.available(), false)
	await assert.rejects(f.uninstaller.uninstall(), /不支持直接卸载/)
	assert.deepEqual(f.calls, [])
})

test('reports partial success when host uninstall resolves with a failure result', async () => {
	const f = fixture(); f.manager.removeBundle = async () => ({ application: 'failed', error: { code: 'bundle-in-use' } })
	await assert.rejects(f.uninstaller.uninstall(), /本机数据已清理.*卸载未完成/)
	assert.deepEqual(f.calls, [['clean']])
})

test('does not invoke host uninstall if local credential cleanup failed', async () => {
	const f = fixture(); f.storage.prepareUninstall = async () => { throw new Error('Keychain locked') }
	await assert.rejects(f.uninstaller.uninstall(), /Keychain locked/)
	assert.deepEqual(f.calls, [])
})
