import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAssetStore } from '../lib/assetStore.js'

test('persists independent localization records without consuming unbound legacy files', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'dsh-asc-store-test-')); t.after(() => rm(root, { recursive: true, force: true }))
	const store = createAssetStore(root)
	const english = { appId: '123456', versionLocId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', kind: 'header' }
	const french = { ...english, versionLocId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }
	await mkdir(join(root, english.appId), { recursive: true })
	const legacyPath = join(root, english.appId, 'header.meta.json')
	await writeFile(legacyPath, JSON.stringify({ imageId: 'legacy' }))
	await store.write(english, { imageId: 'en', placementId: 'en-placement' })
	await store.write(french, { imageId: 'fr', placementId: 'fr-placement' })
	await store.remove(french)
	assert.equal((await store.read(english)).imageId, 'en')
	assert.equal(await store.read(french), null)
	assert.equal(JSON.parse(await readFile(legacyPath)).imageId, 'legacy')
	await assert.rejects(store.write({ ...english, versionLocId: '../outside' }, {}), /非法/)
})
