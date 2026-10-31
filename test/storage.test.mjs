import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createStorageManager } from '../lib/storage.js'

async function fixture(t) {
	const root = await mkdtemp(join(tmpdir(), 'dsh-asc-storage-'))
	t.after(() => rm(root, { recursive: true, force: true }))
	const directory = join(root, 'profile-a', 'data', 'dsh-asc')
	const other = join(root, 'profile-b', 'data', 'dsh-asc')
	const legacyDirectory = join(root, 'legacy', 'dsh-asc')
	const calls = []
	const credentials = {
		clearCredentials: async () => { calls.push('clear-credentials') },
		importLegacyCredentials: async (source) => { calls.push(['import-credentials', source]) }
	}
	const storage = createStorageManager({ directory, profileId: 'profile-a', legacyDirectory, credentials })
	const put = async (path, text = 'image') => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, text) }
	return { root, directory, other, legacyDirectory, credentials, calls, storage, put }
}

test('reports owned storage and removes only the selected app images', async (t) => {
	const f = await fixture(t)
	const image = join(f.directory, 'assets', '123456', 'header.img')
	const record = join(f.directory, 'assets', '123456', 'localizations', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'header.meta.json')
	const otherImage = join(f.directory, 'assets', '234567', 'search.img')
	const config = join(f.directory, 'credentials.json')
	await f.put(image); await f.put(otherImage); await f.put(record, '{}'); await f.put(config, '{}')
	const inventory = await f.storage.describe()
	assert.equal(inventory.imageCount, 2); assert.equal(inventory.imageBytes, 10)
	assert.equal(inventory.recordCount, 1); assert.equal(inventory.totalBytes, 14)
	assert.equal(inventory.automaticUninstallCleanup, false)
	await f.storage.clearImages('123456')
	await assert.rejects(stat(image), { code: 'ENOENT' })
	assert.equal(await readFile(otherImage, 'utf8'), 'image')
	assert.equal(await readFile(record, 'utf8'), '{}')
	assert.equal(await readFile(config, 'utf8'), '{}')
	await f.storage.clearImages()
	assert.equal((await f.storage.describe()).imageCount, 0)
	assert.equal((await f.storage.describe()).recordCount, 1)
	assert.equal(f.calls.length, 0)
})

test('uninstall preparation cannot remove other profiles or shared legacy data', async (t) => {
	const f = await fixture(t)
	await f.put(join(f.directory, 'assets', '123456', 'header.img'))
	await f.put(join(f.other, 'assets', '123456', 'header.img'), 'other profile')
	await f.put(join(f.legacyDirectory, 'assets', '123456', 'header.img'), 'legacy')
	await f.storage.prepareUninstall()
	await assert.rejects(stat(f.directory), { code: 'ENOENT' })
	assert.equal(await readFile(join(f.other, 'assets', '123456', 'header.img'), 'utf8'), 'other profile')
	assert.equal(await readFile(join(f.legacyDirectory, 'assets', '123456', 'header.img'), 'utf8'), 'legacy')
	assert.deepEqual(f.calls, ['clear-credentials'])
})

test('keeps files when keychain cleanup fails so uninstall preparation can retry', async (t) => {
	const f = await fixture(t)
	const record = join(f.directory, 'credentials.json')
	await f.put(record, '{"keychainAccounts":["pending"]}')
	f.credentials.clearCredentials = async () => { throw new Error('Keychain locked') }
	await assert.rejects(f.storage.prepareUninstall(), /Keychain locked/)
	assert.match(await readFile(record, 'utf8'), /pending/)
})

test('rejects paths and symlinks outside the owned directory', async (t) => {
	const f = await fixture(t)
	await f.put(join(f.other, 'assets', '123456', 'header.img'), 'keep')
	await mkdir(join(f.directory, 'assets'), { recursive: true })
	await symlink(join(f.other, 'assets', '123456'), join(f.directory, 'assets', '123456'))
	await assert.rejects(f.storage.clearImages(), /符号链接/)
	await assert.rejects(f.storage.prepareUninstall(), /符号链接/)
	await assert.rejects(f.storage.clearImages('../profile-b'), /App ID/)
	assert.equal(await readFile(join(f.other, 'assets', '123456', 'header.img'), 'utf8'), 'keep')
})

test('does not clear data while another plugin request is in progress', async (t) => {
	const f = await fixture(t)
	let finish
	const pending = f.storage.withAccess(() => new Promise((resolve) => { finish = resolve }))
	await assert.rejects(f.storage.withAccess(() => f.storage.prepareUninstall(), true), /仍在处理请求/)
	finish(); await pending
	await f.storage.withAccess(() => f.storage.prepareUninstall(), true)
	assert.deepEqual(f.calls, ['clear-credentials'])
})

test('imports known legacy assets without overwriting or deleting the source', async (t) => {
	const f = await fixture(t)
	const relativeImage = join('assets', '123456', 'header.img')
	await f.put(join(f.legacyDirectory, relativeImage), 'legacy image')
	await f.put(join(f.legacyDirectory, 'credentials.json'), '{}')
	await f.put(join(f.legacyDirectory, 'unrelated.txt'), 'keep')
	await f.storage.importLegacy()
	assert.equal(await readFile(join(f.directory, relativeImage), 'utf8'), 'legacy image')
	assert.equal(await readFile(join(f.legacyDirectory, relativeImage), 'utf8'), 'legacy image')
	await assert.rejects(stat(join(f.directory, 'unrelated.txt')), { code: 'ENOENT' })
	assert.deepEqual(f.calls, [['import-credentials', f.legacyDirectory]])
	await assert.rejects(f.storage.importLegacy(), /已有本地数据/)
})

test('rolls back copied images when legacy credentials fail before being stored', async (t) => {
	const f = await fixture(t)
	await f.put(join(f.legacyDirectory, 'assets', '123456', 'header.img'))
	await f.put(join(f.legacyDirectory, 'credentials.json'), '{}')
	f.credentials.importLegacyCredentials = async () => { throw new Error('Legacy keychain locked') }
	await assert.rejects(f.storage.importLegacy(), /Legacy keychain locked/)
	assert.equal((await f.storage.describe()).imageCount, 0)
	assert.equal(await readFile(join(f.legacyDirectory, 'assets', '123456', 'header.img'), 'utf8'), 'image')
	f.credentials.importLegacyCredentials = async () => {}
	await f.storage.importLegacy()
	assert.equal((await f.storage.describe()).imageCount, 1)
})

test('an unreadable legacy candidate cannot hide successful current-profile cleanup', async (t) => {
	const f = await fixture(t)
	await f.put(join(f.directory, 'assets', '123456', 'header.img'))
	await mkdir(join(f.legacyDirectory, '..'), { recursive: true })
	await symlink(f.other, f.legacyDirectory)
	assert.equal((await f.storage.describe()).legacy.unavailable, true)
	await f.storage.prepareUninstall()
	const summary = await f.storage.describe()
	assert.equal(summary.totalBytes, 0)
	assert.equal(summary.legacy.unavailable, true)
})
