import test from 'node:test'
import assert from 'node:assert/strict'
import { readPublishState, shouldPublish, validatePackedFiles, validateReleaseVersions } from '../support/release.mjs'

const metadata = { name: 'dsh-asc-studio', versions: { '0.1.0': {} }, 'dist-tags': { latest: '0.1.0' } }

test('publishes a new stable version and skips an already published version', () => {
	assert.equal(shouldPublish('0.1.1', metadata), true)
	assert.equal(shouldPublish('0.1.0', metadata), false)
	assert.equal(shouldPublish('0.2.0', metadata), true)
})

test('rejects release downgrades and invalid version metadata', () => {
	assert.throws(() => shouldPublish('0.0.9', metadata), /newer/)
	for (const version of ['0.1.1-beta.1', '01.1.1', '0.1.1\npublish=true']) assert.throws(() => shouldPublish(version, metadata), /stable/)
	assert.throws(() => shouldPublish('0.1.1', {}), /metadata/)
})

test('does not treat registry errors as an unpublished version', async () => {
	for (const status of [404, 429, 503]) {
		await assert.rejects(readPublishState('0.1.1', async () => ({ ok: false, status })), new RegExp(`HTTP ${status}`))
	}
	await assert.rejects(readPublishState('0.1.1', async () => { throw new Error('offline') }), /offline/)
})

test('requires package lock and UI versions to match', () => {
	const pkg = { name: 'dsh-asc-studio', version: '0.1.1' }
	const lock = { ...pkg, packages: { '': pkg } }
	assert.doesNotThrow(() => validateReleaseVersions(pkg, lock, "const PLUGIN_VERSION = '0.1.1'"))
	assert.throws(() => validateReleaseVersions(pkg, lock, "const PLUGIN_VERSION = '0.1.0'"), /match/)
	assert.throws(() => validateReleaseVersions(pkg, { ...lock, version: '0.1.0' }, "const PLUGIN_VERSION = '0.1.1'"), /match/)
})

test('excludes private files and original design assets from the npm package', () => {
	const files = ['package.json', 'icon.png', 'cordis.patch.yml', 'README.md', 'README.zh-CN.md', 'LICENSE', 'lib/index.js', 'lib/client.js', 'locale/en.json', 'locale/zh.json'].map((path) => ({ path }))
	assert.doesNotThrow(() => validatePackedFiles(files))
	for (const path of ['assets/phone-frame.png', 'assets/asc-studio-icon-master.png', 'credentials.json', '.npmrc', 'lib/private.p8', 'lib/../credentials.js']) {
		assert.throws(() => validatePackedFiles([...files, { path }]), /Unexpected/)
	}
	assert.throws(() => validatePackedFiles(files.filter((file) => file.path !== 'icon.png')), /Missing/)
})
