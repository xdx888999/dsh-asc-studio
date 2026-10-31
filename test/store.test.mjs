import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { generateKeyPairSync } from 'node:crypto'
import { loadModule } from '../support/modules.mjs'

const generateP8 = (namedCurve = 'prime256v1') => generateKeyPairSync('ec', { namedCurve }).privateKey.export({ format: 'pem', type: 'pkcs8' })
const SECRET = generateP8()
const OTHER_SECRET = generateP8()
const encoded = (value) => Buffer.from(value).toString('base64')

async function fixture(t, { platform = 'darwin', overrides = {} } = {}) {
	const directory = await fs.mkdtemp(join(tmpdir(), 'dsh-asc-store-test-'))
	t.after(() => fs.rm(directory, { recursive: true, force: true }))
	const keychain = new Map(), calls = [], writes = [], failAdds = new Set(), failDeletes = new Set(), failReads = new Set(), corruptWrites = new Set()
	let beforeWrite
	const module = await loadModule(resolve('lib/store.js'), {
		'node:os': { platform: () => platform },
		'node:fs/promises': { ...fs, ...overrides, writeFile: async (path, content, options) => {
			writes.push({ path, content })
			return (overrides.writeFile ?? fs.writeFile)(path, content, options)
		} },
		[pathToFileURL(resolve('lib/keychain.js')).href]: {
			writeKeychain: async (service, account, value) => {
				calls.push({ command: 'add-generic-password', service, account })
				await beforeWrite?.()
				if (failAdds.has(account)) throw Object.assign(new Error('钥匙串不可用'), { code: 'KEYCHAIN' })
				keychain.set(`${service}|${account}`, corruptWrites.has(account) ? encoded(OTHER_SECRET) : value)
			},
			readKeychain: async (service, account) => {
				calls.push({ command: 'find-generic-password', service, account })
				if (failReads.has(account)) throw Object.assign(new Error('钥匙串不可用'), { code: 'KEYCHAIN' })
				if (!keychain.has(`${service}|${account}`)) throw Object.assign(new Error('钥匙串项不存在'), { code: 'KEYCHAIN_NOT_FOUND' })
				return keychain.get(`${service}|${account}`)
			},
			deleteKeychain: async (service, account) => {
				calls.push({ command: 'delete-generic-password', service, account })
				if (failDeletes.has(account)) throw Object.assign(new Error('钥匙串不可用'), { code: 'KEYCHAIN' })
				if (!keychain.delete(`${service}|${account}`)) throw Object.assign(new Error('钥匙串项不存在'), { code: 'KEYCHAIN_NOT_FOUND' })
			}
		}
	})
	const profileDirectory = (name) => join(directory, name)
	const statePath = (name) => join(profileDirectory(name), 'credentials.json')
	const create = (name) => module.createCredentialStore({ directory: profileDirectory(name), keychainService: `dsh-asc.profile.${name}` })
	const read = async (name) => JSON.parse(await fs.readFile(statePath(name), 'utf8'))
	const write = async (name, payload) => {
		await fs.mkdir(profileDirectory(name), { recursive: true })
		await fs.writeFile(statePath(name), JSON.stringify(payload))
	}
	return { module, create, read, write, profileDirectory, statePath, keychain, calls, writes, failAdds, failDeletes, failReads, corruptWrites,
		setBeforeWrite: (callback) => { beforeWrite = callback } }
}

function credentials(keyId = 'KEYA', p8 = SECRET) {
	return { issuerId: 'fake-issuer', keyId, p8, keyFileName: `${keyId}.p8` }
}

test('requires an explicit profile directory and separate keychain service', async (t) => {
	const f = await fixture(t)
	assert.throws(() => f.module.createCredentialStore(), { code: 'CONFIG' })
	assert.throws(() => f.module.createCredentialStore({ directory: 'relative', keychainService: 'profile' }), { code: 'CONFIG' })
	assert.throws(() => f.module.createCredentialStore({ directory: f.profileDirectory('a') }), { code: 'CONFIG' })
	assert.throws(() => f.module.createCredentialStore({ directory: f.profileDirectory('a'), keychainService: 'dsh-asc' }), { code: 'CONFIG' })
	assert.equal(f.calls.length, 0)
})

test('isolates profiles using the same key ID and omits secrets from descriptions', async (t) => {
	const f = await fixture(t), a = f.create('a'), b = f.create('b')
	await a.saveCredentials(credentials())
	await b.saveCredentials(credentials('KEYA', OTHER_SECRET))
	assert.equal((await a.loadCredentials()).p8, SECRET)
	assert.equal((await b.loadCredentials()).p8, OTHER_SECRET)
	const raw = await f.read('a')
	assert.equal(raw.storage, 'keychain')
	assert.equal(raw.p8B64, undefined)
	assert.deepEqual(raw.keychainAccounts, ['p8:KEYA'])
	const description = await a.describeCredentials()
	assert.equal(description.configured, true)
	assert.equal(description.hasKey, true)
	assert.equal(description.p8, undefined)
	assert.equal(description.p8B64, undefined)
	await a.saveCredentials({ issuerId: 'updated-issuer', keyId: 'KEYA' })
	assert.equal((await a.loadCredentials()).p8, SECRET)
	assert.equal((await a.loadCredentials()).issuerId, 'updated-issuer')
})

test('fails closed without writing file secrets when keychain is unavailable', async (t) => {
	const f = await fixture(t), store = f.create('a'), logs = []
	f.failAdds.add('p8:KEYA')
	await assert.rejects(store.saveCredentials(credentials(), { warn: (line) => logs.push(line) }), { code: 'KEYCHAIN' })
	assert.ok(!logs.join('').includes(SECRET))
	assert.ok(!logs.join('').includes(encoded(SECRET)))
	assert.ok(!logs.join('').includes('Command failed'))
	assert.equal((await fs.stat(f.profileDirectory('a'))).mode & 0o777, 0o700)
	assert.equal((await fs.stat(f.statePath('a'))).mode & 0o777, 0o600)
	assert.equal((await f.read('a')).p8B64, undefined)
	assert.equal((await store.loadCredentials()).configured, false)
	assert.ok(f.writes.every(({ content }) => !content.includes(encoded(SECRET)) && !content.includes('PRIVATE KEY')))
	await store.clearCredentials()
	await assert.rejects(fs.access(f.statePath('a')), { code: 'ENOENT' })
})

test('clears all rotated profile keys while preserving other profiles and legacy keys', async (t) => {
	const f = await fixture(t), a = f.create('a'), b = f.create('b')
	f.keychain.set('dsh-asc|p8:KEYA', encoded(OTHER_SECRET))
	await a.saveCredentials(credentials())
	await a.saveCredentials(credentials('KEYB', OTHER_SECRET))
	await b.saveCredentials(credentials())
	assert.deepEqual((await f.read('a')).keychainAccounts, ['p8:KEYA', 'p8:KEYB'])
	await a.clearCredentials()
	assert.equal(f.keychain.has('dsh-asc.profile.a|p8:KEYA'), false)
	assert.equal(f.keychain.has('dsh-asc.profile.a|p8:KEYB'), false)
	assert.equal(f.keychain.get('dsh-asc|p8:KEYA'), encoded(OTHER_SECRET))
	assert.equal((await b.loadCredentials()).p8, SECRET)
	await assert.rejects(fs.access(f.statePath('a')), { code: 'ENOENT' })
	assert.equal((await a.loadCredentials()).configured, false)
	const deletes = f.calls.filter((call) => call.command === 'delete-generic-password')
	assert.ok(deletes.every((call) => call.service === 'dsh-asc.profile.a'))
})

test('retains unfinished keychain cleanup records and resumes after failure', async (t) => {
	const f = await fixture(t), store = f.create('a'), logs = []
	await store.saveCredentials(credentials())
	await store.saveCredentials(credentials('KEYB', OTHER_SECRET))
	f.failDeletes.add('p8:KEYB')
	await assert.rejects(store.clearCredentials({ warn: (line) => logs.push(line) }), { code: 'KEYCHAIN' })
	assert.deepEqual((await f.read('a')).keychainAccounts, ['p8:KEYB'])
	assert.equal(f.keychain.has('dsh-asc.profile.a|p8:KEYA'), false)
	assert.equal(f.keychain.has('dsh-asc.profile.a|p8:KEYB'), true)
	assert.ok(!logs.join('').includes('Command failed'))
	f.failDeletes.clear()
	await store.clearCredentials()
	await assert.rejects(fs.access(f.statePath('a')), { code: 'ENOENT' })
	assert.equal(f.keychain.size, 0)
})

test('treats missing keychain items and missing credential files as already cleared', async (t) => {
	const f = await fixture(t), store = f.create('a')
	await store.saveCredentials(credentials())
	f.keychain.clear()
	await store.clearCredentials()
	const callCount = f.calls.length
	await store.clearCredentials()
	assert.equal(f.calls.length, callCount)
})

test('journals new key accounts before saving them when final metadata write fails', async (t) => {
	let renames = 0
	const f = await fixture(t, { overrides: { rename: async (...args) => {
		renames += 1
		if (renames === 2) throw Object.assign(new Error('simulated disk failure'), { code: 'EIO' })
		return fs.rename(...args)
	} } }), store = f.create('a')
	await assert.rejects(store.saveCredentials(credentials()), { code: 'EIO' })
	assert.equal(f.keychain.has('dsh-asc.profile.a|p8:KEYA'), true)
	assert.deepEqual((await f.read('a')).keychainAccounts, ['p8:KEYA'])
	assert.deepEqual(await fs.readdir(f.profileDirectory('a')), ['credentials.json'])
	await store.clearCredentials()
	assert.equal(f.keychain.size, 0)
	await assert.rejects(fs.access(f.statePath('a')), { code: 'ENOENT' })
})

test('does not write a keychain item when its tracking record cannot be persisted', async (t) => {
	const f = await fixture(t, { overrides: { rename: async () => { throw Object.assign(new Error('simulated disk failure'), { code: 'EIO' }) } } })
	await assert.rejects(f.create('a').saveCredentials(credentials()), { code: 'EIO' })
	assert.equal(f.calls.length, 0)
	assert.deepEqual(await fs.readdir(f.profileDirectory('a')), [])
})

test('imports legacy file credentials by copying without changing the source', async (t) => {
	const f = await fixture(t), store = f.create('a')
	const legacy = { issuerId: 'legacy-issuer', keyId: 'LEGACY', keyFileName: 'legacy.p8', storage: 'file', p8B64: encoded(SECRET) }
	await f.write('legacy', legacy)
	const original = await fs.readFile(f.statePath('legacy'), 'utf8')
	await store.importLegacyCredentials(f.profileDirectory('legacy'))
	assert.equal((await store.loadCredentials()).issuerId, 'legacy-issuer')
	assert.equal((await store.loadCredentials()).p8, SECRET)
	assert.equal(await fs.readFile(f.statePath('legacy'), 'utf8'), original)
	assert.deepEqual((await f.read('a')).keychainAccounts, ['p8:LEGACY'])
	await store.clearCredentials()
	assert.equal(await fs.readFile(f.statePath('legacy'), 'utf8'), original)
})

test('imports legacy keychain credentials into a separate service and preserves the source after clearing', async (t) => {
	const f = await fixture(t), store = f.create('a')
	await f.write('legacy', { issuerId: 'legacy-issuer', keyId: 'LEGACY', storage: 'keychain' })
	f.keychain.set('dsh-asc|p8:LEGACY', encoded(SECRET))
	await store.importLegacyCredentials(f.profileDirectory('legacy'))
	assert.equal(f.keychain.get('dsh-asc.profile.a|p8:LEGACY'), encoded(SECRET))
	await store.clearCredentials()
	assert.equal(f.keychain.get('dsh-asc|p8:LEGACY'), encoded(SECRET))
	assert.equal((await f.read('legacy')).storage, 'keychain')
})

test('refuses to import over existing credentials or incomplete cleanup records', async (t) => {
	const f = await fixture(t)
	await f.write('legacy', { issuerId: 'legacy-issuer', keyId: 'LEGACY', storage: 'file', p8B64: encoded(SECRET) })
	await f.create('a').saveCredentials(credentials())
	await f.write('b', { keychainAccounts: ['p8:OLD'] })
	const callCount = f.calls.length
	await assert.rejects(f.create('a').importLegacyCredentials(f.profileDirectory('legacy')), { code: 'CONFIG' })
	await assert.rejects(f.create('b').importLegacyCredentials(f.profileDirectory('legacy')), { code: 'CONFIG' })
	assert.equal(f.calls.length, callCount)
	assert.deepEqual((await f.read('b')).keychainAccounts, ['p8:OLD'])
})

test('preserves malformed state instead of losing cleanup records during save or clear', async (t) => {
	const f = await fixture(t), store = f.create('a')
	await fs.mkdir(f.profileDirectory('a'))
	await fs.writeFile(f.statePath('a'), '{invalid state')
	await assert.rejects(store.saveCredentials(credentials()), { code: 'CONFIG' })
	await assert.rejects(store.clearCredentials(), { code: 'CONFIG' })
	assert.equal(await fs.readFile(f.statePath('a'), 'utf8'), '{invalid state')
	assert.equal(f.calls.length, 0)
})

test('rejects new credentials and legacy file use on unsupported platforms but allows explicit file cleanup', async (t) => {
	const f = await fixture(t, { platform: 'linux' }), store = f.create('a')
	await assert.rejects(store.saveCredentials(credentials()), { code: 'KEYCHAIN' })
	assert.equal(f.writes.length, 0)
	await f.write('a', { issuerId: 'issuer', keyId: 'KEYA', storage: 'file', p8B64: encoded(SECRET) })
	await assert.rejects(store.loadCredentials(), { code: 'KEYCHAIN' })
	assert.equal((await f.read('a')).p8B64, encoded(SECRET))
	await store.clearCredentials()
	assert.equal(f.calls.length, 0)
	await assert.rejects(fs.access(f.statePath('a')), { code: 'ENOENT' })
})

test('preserves keychain cleanup records when opened on another platform', async (t) => {
	const f = await fixture(t, { platform: 'linux' }), store = f.create('a')
	await f.write('a', { issuerId: 'issuer', keyId: 'KEYA', storage: 'keychain', keychainAccounts: ['p8:KEYA'] })
	await assert.rejects(store.clearCredentials(), { code: 'KEYCHAIN' })
	assert.deepEqual((await f.read('a')).keychainAccounts, ['p8:KEYA'])
	assert.equal(f.calls.length, 0)
})

test('retains an empty cleanup journal when credential file removal fails', async (t) => {
	let rejectRemoval = true
	const f = await fixture(t, { overrides: { unlink: async (path) => {
		if (rejectRemoval && path.endsWith('/credentials.json')) throw Object.assign(new Error('simulated removal failure'), { code: 'EACCES' })
		return fs.unlink(path)
	} } }), store = f.create('a')
	await store.saveCredentials(credentials())
	await assert.rejects(store.clearCredentials(), { code: 'EACCES' })
	assert.deepEqual((await f.read('a')).keychainAccounts, [])
	assert.equal(f.keychain.size, 0)
	const callCount = f.calls.length
	rejectRemoval = false
	await store.clearCredentials()
	assert.equal(f.calls.length, callCount)
	await assert.rejects(fs.access(f.statePath('a')), { code: 'ENOENT' })
})

test('never discovers or removes unregistered keychain accounts', async (t) => {
	const f = await fixture(t), store = f.create('a')
	f.keychain.set('dsh-asc.profile.a|p8:UNREGISTERED', encoded(OTHER_SECRET))
	await store.clearCredentials()
	assert.equal(f.calls.length, 0)
	await store.saveCredentials(credentials())
	await store.clearCredentials()
	assert.equal(f.keychain.get('dsh-asc.profile.a|p8:UNREGISTERED'), encoded(OTHER_SECRET))
})

test('validates P-256 keys before writing metadata and canonicalizes PEM whitespace', async (t) => {
	const f = await fixture(t), store = f.create('a')
	for (const p8 of ['-----BEGIN PRIVATE KEY-----\nINVALID\n-----END PRIVATE KEY-----', generateP8('secp384r1'), `${SECRET}${' '.repeat(8192)}`]) {
		await assert.rejects(store.saveCredentials(credentials('KEYA', p8)), { code: 'CONFIG' })
	}
	assert.equal(f.writes.length, 0)
	assert.equal(f.calls.length, 0)
	await store.saveCredentials(credentials('KEYA', SECRET.replace(/\n/g, '\r\n')))
	assert.equal((await store.loadCredentials()).p8, SECRET)
})

test('migrates legacy profile file secrets once and never copies secrets into metadata writes', async (t) => {
	const f = await fixture(t), store = f.create('a')
	await f.write('a', { issuerId: 'issuer', keyId: 'KEYA', storage: 'file', p8B64: encoded(SECRET), p8: SECRET, unexpectedSecret: encoded(OTHER_SECRET) })
	const [loaded, description] = await Promise.all([store.loadCredentials(), store.describeCredentials()])
	assert.equal(loaded.p8, SECRET)
	assert.equal(loaded.storage, 'keychain')
	assert.equal(description.configured, true)
	assert.equal(description.p8, undefined)
	assert.equal(f.calls.filter(({ command }) => command === 'add-generic-password').length, 1)
	assert.deepEqual((await f.read('a')).keychainAccounts, ['p8:KEYA'])
	assert.equal((await f.read('a')).p8B64, undefined)
	assert.equal((await f.read('a')).p8, undefined)
	assert.equal((await f.read('a')).unexpectedSecret, undefined)
	assert.ok(f.writes.every(({ content }) => !content.includes(encoded(SECRET)) && !content.includes(encoded(OTHER_SECRET)) && !content.includes('PRIVATE KEY')))
})

test('preserves the original legacy file and returns no credentials when migration write fails', async (t) => {
	const f = await fixture(t), store = f.create('a')
	await f.write('a', { issuerId: 'issuer', keyId: 'KEYA', storage: 'file', p8B64: encoded(SECRET) })
	const original = await fs.readFile(f.statePath('a'), 'utf8')
	f.failAdds.add('p8:KEYA')
	await assert.rejects(store.loadCredentials(), { code: 'KEYCHAIN' })
	assert.equal((await store.describeCredentials()).recoveryRequired, true)
	await assert.rejects(store.saveCredentials({ issuerId: 'issuer', keyId: 'KEYA' }), { code: 'KEYCHAIN' })
	assert.equal(await fs.readFile(f.statePath('a'), 'utf8'), original)
	assert.equal(f.writes.length, 0)
	assert.equal(f.keychain.size, 0)
	f.failAdds.clear()
	assert.equal((await store.loadCredentials()).p8, SECRET)
})

test('does not remove legacy file secrets until the keychain value has been verified', async (t) => {
	const f = await fixture(t), store = f.create('a')
	await f.write('a', { issuerId: 'issuer', keyId: 'KEYA', storage: 'file', p8B64: encoded(SECRET) })
	const original = await fs.readFile(f.statePath('a'), 'utf8')
	f.corruptWrites.add('p8:KEYA')
	await assert.rejects(store.loadCredentials(), { code: 'KEYCHAIN' })
	assert.equal(await fs.readFile(f.statePath('a'), 'utf8'), original)
	assert.equal(f.writes.length, 0)
	f.corruptWrites.clear()
	f.failReads.add('p8:KEYA')
	await assert.rejects(store.loadCredentials(), { code: 'KEYCHAIN' })
	assert.equal(await fs.readFile(f.statePath('a'), 'utf8'), original)
	assert.equal(f.writes.length, 0)
	f.failReads.clear()
	assert.equal((await store.loadCredentials()).p8, SECRET)
})

test('retains the original legacy file if metadata commit fails and can clean up the migrated key', async (t) => {
	let failRename = true
	const f = await fixture(t, { overrides: { rename: async (...args) => {
		if (failRename) throw Object.assign(new Error('simulated disk failure'), { code: 'EIO' })
		return fs.rename(...args)
	} } }), store = f.create('a')
	await f.write('a', { issuerId: 'issuer', keyId: 'KEYA', storage: 'file', p8B64: encoded(SECRET) })
	const original = await fs.readFile(f.statePath('a'), 'utf8')
	await assert.rejects(store.loadCredentials(), { code: 'EIO' })
	assert.equal(await fs.readFile(f.statePath('a'), 'utf8'), original)
	assert.equal(f.keychain.get('dsh-asc.profile.a|p8:KEYA'), encoded(SECRET))
	assert.deepEqual(await fs.readdir(f.profileDirectory('a')), ['credentials.json'])
	assert.ok(f.writes.every(({ content }) => !content.includes(encoded(SECRET)) && !content.includes('PRIVATE KEY')))
	failRename = false
	await store.clearCredentials()
	assert.equal(f.keychain.size, 0)
	await assert.rejects(fs.access(f.statePath('a')), { code: 'ENOENT' })
})

test('serializes migration with disconnect so a delayed migration cannot recreate disconnected credentials', async (t) => {
	const f = await fixture(t), store = f.create('a')
	await f.write('a', { issuerId: 'issuer', keyId: 'KEYA', storage: 'file', p8B64: encoded(SECRET) })
	let release, markStarted
	const started = new Promise((resolve) => { markStarted = resolve })
	f.setBeforeWrite(() => new Promise((resolve) => { release = resolve; markStarted() }))
	const loading = store.loadCredentials()
	await started
	const clearing = store.clearCredentials()
	assert.equal(f.writes.length, 0)
	release()
	assert.equal((await loading).p8, SECRET)
	await clearing
	assert.equal(f.keychain.size, 0)
	assert.equal((await store.loadCredentials()).configured, false)
	await assert.rejects(fs.access(f.statePath('a')), { code: 'ENOENT' })
})

test('retains sanitized cleanup records after disconnecting a legacy profile fails', async (t) => {
	const f = await fixture(t), store = f.create('a')
	await f.write('a', { issuerId: 'issuer', keyId: 'KEYA', storage: 'file', p8B64: encoded(SECRET), p8: SECRET })
	f.keychain.set('dsh-asc.profile.a|p8:KEYA', encoded(SECRET))
	f.failDeletes.add('p8:KEYA')
	await assert.rejects(store.clearCredentials(), { code: 'KEYCHAIN' })
	assert.deepEqual((await f.read('a')).keychainAccounts, ['p8:KEYA'])
	assert.equal((await f.read('a')).p8B64, undefined)
	assert.equal((await f.read('a')).p8, undefined)
	assert.equal((await f.read('a')).storage, 'clearing')
	assert.equal((await f.create('a').loadCredentials()).configured, false)
	assert.equal((await f.create('a').loadCredentials()).p8, '')
	assert.equal((await f.create('a').describeCredentials()).recoveryRequired, true)
	assert.ok(f.writes.every(({ content }) => !content.includes(encoded(SECRET)) && !content.includes('PRIVATE KEY')))
	f.failDeletes.clear()
	await store.clearCredentials()
	assert.equal(f.keychain.size, 0)
})

test('verifies new writes before reporting saved credentials and preserves cleanup tracking on mismatch', async (t) => {
	const f = await fixture(t), store = f.create('a')
	f.corruptWrites.add('p8:KEYA')
	await assert.rejects(store.saveCredentials(credentials()), { code: 'KEYCHAIN' })
	assert.deepEqual((await f.read('a')).keychainAccounts, ['p8:KEYA'])
	assert.equal((await f.read('a')).keyId, undefined)
	assert.equal((await store.loadCredentials()).configured, false)
	await store.clearCredentials()
	assert.equal(f.keychain.size, 0)
})

test('keeps legacy import sources unchanged if secure storage fails', async (t) => {
	const f = await fixture(t), store = f.create('a')
	await f.write('legacy', { issuerId: 'issuer', keyId: 'KEYA', storage: 'file', p8B64: encoded(SECRET) })
	const original = await fs.readFile(f.statePath('legacy'), 'utf8')
	f.failAdds.add('p8:KEYA')
	await assert.rejects(store.importLegacyCredentials(f.profileDirectory('legacy')), { code: 'KEYCHAIN' })
	assert.equal(await fs.readFile(f.statePath('legacy'), 'utf8'), original)
	assert.equal((await f.read('a')).p8B64, undefined)
	await store.clearCredentials()
	assert.equal(await fs.readFile(f.statePath('legacy'), 'utf8'), original)
})

test('does not authenticate with old metadata after same-ID replacement verification fails', async (t) => {
	const f = await fixture(t), store = f.create('a')
	await store.saveCredentials(credentials())
	f.failReads.add('p8:KEYA')
	await assert.rejects(store.saveCredentials({ ...credentials('KEYA', OTHER_SECRET), issuerId: 'new-issuer' }), { code: 'KEYCHAIN' })
	assert.equal(f.keychain.get('dsh-asc.profile.a|p8:KEYA'), encoded(OTHER_SECRET))
	assert.equal((await f.read('a')).storage, 'pending')
	f.failReads.clear()
	assert.equal((await store.loadCredentials()).p8, '')
	assert.equal((await store.describeCredentials()).configured, false)
	assert.equal((await store.describeCredentials()).recoveryRequired, true)
	await assert.rejects(store.saveCredentials({ issuerId: 'new-issuer', keyId: 'KEYA' }), { code: 'KEYCHAIN' })
	await store.saveCredentials({ ...credentials('KEYA', OTHER_SECRET), issuerId: 'new-issuer' })
	assert.equal((await store.loadCredentials()).p8, OTHER_SECRET)
	assert.equal((await store.loadCredentials()).issuerId, 'new-issuer')
})

test('keeps a same-ID replacement unavailable when its final metadata commit fails', async (t) => {
	let renames = 0
	const f = await fixture(t, { overrides: { rename: async (...args) => {
		renames += 1
		if (renames === 4) throw Object.assign(new Error('simulated disk failure'), { code: 'EIO' })
		return fs.rename(...args)
	} } }), store = f.create('a')
	await store.saveCredentials(credentials())
	await assert.rejects(store.saveCredentials({ ...credentials('KEYA', OTHER_SECRET), issuerId: 'new-issuer' }), { code: 'EIO' })
	assert.equal(f.keychain.get('dsh-asc.profile.a|p8:KEYA'), encoded(OTHER_SECRET))
	assert.equal((await f.read('a')).storage, 'pending')
	assert.equal((await store.loadCredentials()).configured, false)
	assert.equal((await store.describeCredentials()).hasStoredCredentials, true)
	await store.clearCredentials()
	assert.equal(f.keychain.size, 0)
})

test('keeps the previous credentials usable if writing a different key ID fails', async (t) => {
	const f = await fixture(t), store = f.create('a')
	await store.saveCredentials(credentials())
	f.failAdds.add('p8:KEYB')
	await assert.rejects(store.saveCredentials({ ...credentials('KEYB', OTHER_SECRET), issuerId: 'new-issuer' }), { code: 'KEYCHAIN' })
	assert.deepEqual((await f.read('a')).keychainAccounts, ['p8:KEYA', 'p8:KEYB'])
	assert.equal((await f.read('a')).storage, 'keychain')
	assert.equal((await store.loadCredentials()).p8, SECRET)
	assert.equal((await store.loadCredentials()).issuerId, 'fake-issuer')
	assert.equal((await store.describeCredentials()).configured, true)
	assert.equal((await store.describeCredentials()).recoveryRequired, false)
})

test('returns only safe recovery metadata when legacy migration fails and still permits disconnect', async (t) => {
	const f = await fixture(t), store = f.create('a')
	await f.write('a', { issuerId: 'issuer', keyId: 'KEYA', keyFileName: 'original.p8', storage: 'file', p8B64: encoded(SECRET), p8: SECRET })
	f.failAdds.add('p8:KEYA')
	await assert.rejects(store.loadCredentials(), { code: 'KEYCHAIN' })
	const description = await store.describeCredentials()
	assert.deepEqual(JSON.parse(JSON.stringify(description)), { configured: false, hasKey: false, hasStoredCredentials: true,
		storage: 'none', recoveryRequired: true, recoveryCode: 'KEYCHAIN', issuerId: 'issuer', keyId: 'KEYA', keyFileName: 'original.p8' })
	assert.equal(JSON.stringify(description).includes(encoded(SECRET)), false)
	assert.equal(JSON.stringify(description).includes('PRIVATE KEY'), false)
	assert.equal(f.writes.length, 0)
	assert.equal((await f.read('a')).p8B64, encoded(SECRET))
	await store.clearCredentials()
	await assert.rejects(fs.access(f.statePath('a')), { code: 'ENOENT' })
	assert.equal((await store.describeCredentials()).recoveryRequired, false)
})

test('type-checks recovery metadata and uses stable codes without exposing migration errors', async (t) => {
	const f = await fixture(t), store = f.create('a')
	await f.write('a', { issuerId: { secret: SECRET }, keyId: ['KEYA'], keyFileName: { secret: SECRET }, p8B64: encoded('invalid private key') })
	const description = await store.describeCredentials()
	assert.equal(description.issuerId, '')
	assert.equal(description.keyId, '')
	assert.equal(description.keyFileName, '')
	assert.equal(description.recoveryRequired, true)
	assert.equal(description.recoveryCode, 'CONFIG')
	assert.equal(description.configured, false)
	assert.equal(description.hasKey, false)
	assert.equal(description.error, undefined)
	assert.equal(description.p8, undefined)
	assert.equal(description.p8B64, undefined)
	await assert.rejects(store.loadCredentials(), { code: 'CONFIG' })
	await fs.writeFile(f.statePath('a'), '{invalid state')
	await assert.rejects(store.describeCredentials(), { code: 'CONFIG' })
})

test('replaces unusable legacy secrets with a new key without requiring the old account to migrate', async (t) => {
	for (const oldSecret of [encoded('invalid legacy key'), encoded(SECRET)]) {
		const f = await fixture(t), store = f.create('a')
		await f.write('a', { issuerId: 'old-issuer', keyId: 'KEYA', keyFileName: { secret: SECRET }, storage: 'file',
			p8B64: oldSecret, p8: SECRET, unknownSecret: { value: encoded(SECRET) }, keychainAccounts: ['p8:TRACKED'] })
		const original = await fs.readFile(f.statePath('a'), 'utf8')
		f.failAdds.add('p8:KEYA')
		f.setBeforeWrite(async () => {
			assert.equal(await fs.readFile(f.statePath('a'), 'utf8'), original)
			const journal = JSON.parse(await fs.readFile(join(f.profileDirectory('a'), 'keychain-cleanup.json'), 'utf8'))
			assert.deepEqual(journal, { keychainAccounts: ['p8:TRACKED', 'p8:KEYA', 'p8:KEYB'] })
		})
		await store.saveCredentials({ ...credentials('KEYB', OTHER_SECRET), issuerId: 'new-issuer' })
		assert.equal(f.calls.filter(({ command, account }) => command === 'add-generic-password' && account === 'p8:KEYA').length, 0)
		assert.equal((await store.loadCredentials()).p8, OTHER_SECRET)
		assert.equal((await store.loadCredentials()).issuerId, 'new-issuer')
		assert.deepEqual((await f.read('a')).keychainAccounts, ['p8:TRACKED', 'p8:KEYA', 'p8:KEYB'])
		assert.equal((await f.read('a')).p8B64, undefined)
		assert.equal((await f.read('a')).unknownSecret, undefined)
		assert.ok(f.writes.every(({ content }) => !content.includes(encoded(SECRET)) && !content.includes(encoded(OTHER_SECRET)) && !content.includes('PRIVATE KEY')))
		await assert.rejects(fs.access(join(f.profileDirectory('a'), 'keychain-cleanup.json')), { code: 'ENOENT' })
	}
})

test('preserves the sole legacy file while tracking a failed replacement for later cleanup', async (t) => {
	const f = await fixture(t), store = f.create('a')
	await f.write('a', { issuerId: 'issuer', keyId: 'KEYA', storage: 'file', p8B64: encoded(SECRET), unknownSecret: SECRET })
	const original = await fs.readFile(f.statePath('a'), 'utf8')
	f.failReads.add('p8:KEYB')
	await assert.rejects(store.saveCredentials(credentials('KEYB', OTHER_SECRET)), { code: 'KEYCHAIN' })
	assert.equal(await fs.readFile(f.statePath('a'), 'utf8'), original)
	assert.equal(f.keychain.get('dsh-asc.profile.a|p8:KEYB'), encoded(OTHER_SECRET))
	assert.deepEqual(JSON.parse(await fs.readFile(join(f.profileDirectory('a'), 'keychain-cleanup.json'), 'utf8')), { keychainAccounts: ['p8:KEYA', 'p8:KEYB'] })
	assert.ok(f.writes.every(({ content }) => !content.includes(encoded(SECRET)) && !content.includes(encoded(OTHER_SECRET)) && !content.includes('PRIVATE KEY')))
	await f.create('a').clearCredentials()
	assert.equal(f.keychain.size, 0)
	assert.deepEqual(await fs.readdir(f.profileDirectory('a')), [])
})

test('does not start replacing a file secret if its separate cleanup journal cannot be committed', async (t) => {
	const f = await fixture(t, { overrides: { rename: async (source, destination) => {
		if (destination.endsWith('/keychain-cleanup.json')) throw Object.assign(new Error('simulated journal failure'), { code: 'EIO' })
		return fs.rename(source, destination)
	} } }), store = f.create('a')
	await f.write('a', { issuerId: 'issuer', keyId: 'KEYA', storage: 'file', p8B64: encoded(SECRET) })
	const original = await fs.readFile(f.statePath('a'), 'utf8')
	await assert.rejects(store.saveCredentials(credentials('KEYB', OTHER_SECRET)), { code: 'EIO' })
	assert.equal(await fs.readFile(f.statePath('a'), 'utf8'), original)
	assert.equal(f.calls.length, 0)
	assert.deepEqual(await fs.readdir(f.profileDirectory('a')), ['credentials.json'])
	assert.ok(f.writes.every(({ content }) => !content.includes(encoded(SECRET)) && !content.includes('PRIVATE KEY')))
})

test('merges interrupted replacement accounts when the original file is subsequently migrated', async (t) => {
	let failMetadata = true
	const f = await fixture(t, { overrides: { rename: async (source, destination) => {
		if (failMetadata && destination.endsWith('/credentials.json')) throw Object.assign(new Error('simulated metadata failure'), { code: 'EIO' })
		return fs.rename(source, destination)
	} } }), store = f.create('a')
	await f.write('a', { issuerId: 'old-issuer', keyId: 'KEYA', storage: 'file', p8B64: encoded(SECRET) })
	const original = await fs.readFile(f.statePath('a'), 'utf8')
	await assert.rejects(store.saveCredentials(credentials('KEYB', OTHER_SECRET)), { code: 'EIO' })
	assert.equal(await fs.readFile(f.statePath('a'), 'utf8'), original)
	assert.equal(f.keychain.get('dsh-asc.profile.a|p8:KEYB'), encoded(OTHER_SECRET))
	failMetadata = false
	const reopened = f.create('a')
	assert.equal((await reopened.loadCredentials()).p8, SECRET)
	assert.deepEqual((await f.read('a')).keychainAccounts, ['p8:KEYA', 'p8:KEYB'])
	await assert.rejects(fs.access(join(f.profileDirectory('a'), 'keychain-cleanup.json')), { code: 'ENOENT' })
	await reopened.clearCredentials()
	assert.equal(f.keychain.size, 0)
})

test('uses committed replacement metadata safely if removing its redundant journal fails', async (t) => {
	let failRemoval = true
	const f = await fixture(t, { overrides: { unlink: async (path) => {
		if (failRemoval && path.endsWith('/keychain-cleanup.json')) throw Object.assign(new Error('simulated removal failure'), { code: 'EACCES' })
		return fs.unlink(path)
	} } }), store = f.create('a')
	await f.write('a', { issuerId: 'issuer', keyId: 'KEYA', storage: 'file', p8B64: encoded(SECRET) })
	await assert.rejects(store.saveCredentials(credentials('KEYB', OTHER_SECRET)), { code: 'EACCES' })
	const reopened = f.create('a')
	assert.equal((await reopened.loadCredentials()).p8, OTHER_SECRET)
	assert.equal((await f.read('a')).p8B64, undefined)
	assert.deepEqual((await f.read('a')).keychainAccounts, ['p8:KEYA', 'p8:KEYB'])
	failRemoval = false
	await reopened.clearCredentials()
	assert.equal(f.keychain.size, 0)
	assert.deepEqual(await fs.readdir(f.profileDirectory('a')), [])
})

test('exposes standalone cleanup journals as recovery state and blocks legacy import until cleared', async (t) => {
	const f = await fixture(t), store = f.create('a')
	await fs.mkdir(f.profileDirectory('a'))
	await fs.writeFile(join(f.profileDirectory('a'), 'keychain-cleanup.json'), JSON.stringify({ keychainAccounts: ['p8:KEYB'] }))
	f.keychain.set('dsh-asc.profile.a|p8:KEYB', encoded(OTHER_SECRET))
	await f.write('legacy', { issuerId: 'issuer', keyId: 'KEYA', storage: 'file', p8B64: encoded(SECRET) })
	assert.equal((await store.loadCredentials()).configured, false)
	assert.equal((await store.loadCredentials()).p8, '')
	assert.equal((await store.describeCredentials()).recoveryRequired, true)
	assert.equal((await store.describeCredentials()).hasStoredCredentials, true)
	await assert.rejects(store.importLegacyCredentials(f.profileDirectory('legacy')), { code: 'CONFIG' })
	await store.clearCredentials()
	assert.equal(f.keychain.size, 0)
	assert.deepEqual(await fs.readdir(f.profileDirectory('a')), [])
	assert.equal((await store.describeCredentials()).hasStoredCredentials, false)
})

test('keeps ordinary keychain credentials disabled after disconnect fails and after reopening the store', async (t) => {
	const f = await fixture(t), store = f.create('a')
	await store.saveCredentials(credentials())
	f.failDeletes.add('p8:KEYA')
	await assert.rejects(store.clearCredentials(), { code: 'KEYCHAIN' })
	assert.equal((await f.read('a')).storage, 'clearing')
	assert.equal(f.keychain.get('dsh-asc.profile.a|p8:KEYA'), encoded(SECRET))
	const callsBefore = f.calls.length, reopened = f.create('a')
	assert.equal((await reopened.loadCredentials()).configured, false)
	assert.equal((await reopened.loadCredentials()).p8, '')
	assert.equal((await reopened.describeCredentials()).recoveryRequired, true)
	assert.equal(f.calls.length, callsBefore)
	await assert.rejects(reopened.saveCredentials({ issuerId: 'issuer', keyId: 'KEYA' }), { code: 'KEYCHAIN' })
	f.failDeletes.clear()
	await reopened.clearCredentials()
	assert.equal(f.keychain.size, 0)
})

test('rejects corrupt or symlinked cleanup journals before using or changing credentials', async (t) => {
	const f = await fixture(t), store = f.create('a')
	await fs.mkdir(f.profileDirectory('a'))
	const journalPath = join(f.profileDirectory('a'), 'keychain-cleanup.json')
	await fs.writeFile(journalPath, JSON.stringify({ keychainAccounts: ['p8:INVALID\naccount'] }))
	await assert.rejects(store.loadCredentials(), { code: 'CONFIG' })
	await assert.rejects(store.saveCredentials(credentials()), { code: 'CONFIG' })
	await assert.rejects(store.clearCredentials(), { code: 'CONFIG' })
	await fs.unlink(journalPath)
	await f.write('other', { keychainAccounts: ['p8:OTHER'] })
	await fs.symlink(f.statePath('other'), journalPath)
	await assert.rejects(store.describeCredentials(), { code: 'CONFIG' })
	assert.equal(f.calls.length, 0)
	assert.equal(f.writes.length, 0)
})
