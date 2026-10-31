/** 发布前检查：版本一致、安装包白名单、npm 版本单调递增。 */
import { execFileSync } from 'node:child_process'
import { appendFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_NAME = 'dsh-asc-studio'
const REGISTRY = 'https://registry.npmjs.org'
const ROOT_FILES = new Set(['package.json', 'icon.png', 'cordis.patch.yml', 'README.md', 'README.zh-CN.md', 'LICENSE'])

function stableVersion(version) {
	if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('Release version must be a stable x.y.z version')
	const parts = version.split('.').map(Number)
	if (parts.some((value) => !Number.isSafeInteger(value))) throw new Error('Invalid release version')
	return parts
}

export function validateReleaseVersions(pkg, lock, client) {
	if (pkg.name !== PACKAGE_NAME) throw new Error('Unexpected package name')
	stableVersion(pkg.version)
	const clientVersion = client.match(/const PLUGIN_VERSION = '([^']+)'/)?.[1]
	if (lock.name !== pkg.name || lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version || clientVersion !== pkg.version) {
		throw new Error('Package, lockfile, and client versions must match')
	}
}

export function validatePackedFiles(files) {
	const paths = files.map((file) => file.path)
	for (const path of paths) {
		if (ROOT_FILES.has(path) || /^lib\/(?:asc\/)?[A-Za-z][A-Za-z0-9]*\.js$/.test(path) || /^locale\/(?:en|zh)\.json$/.test(path)) continue
		throw new Error(`Unexpected published file: ${path}`)
	}
	for (const required of [...ROOT_FILES, 'lib/index.js', 'lib/client.js', 'locale/en.json', 'locale/zh.json']) {
		if (!paths.includes(required)) throw new Error(`Missing published file: ${required}`)
	}
}

export function shouldPublish(version, metadata) {
	const next = stableVersion(version)
	if (metadata?.name !== PACKAGE_NAME || !metadata.versions || typeof metadata.versions !== 'object') throw new Error('Invalid npm package metadata')
	if (Object.hasOwn(metadata.versions, version)) return false
	const latest = stableVersion(metadata['dist-tags']?.latest)
	const different = next.findIndex((part, i) => part !== latest[i])
	if (different < 0 || next[different] < latest[different]) throw new Error('Release version must be newer than npm latest')
	return true
}

export async function readPublishState(version, request = fetch) {
	const response = await request(`${REGISTRY}/${PACKAGE_NAME}`, { signal: AbortSignal.timeout(30_000) })
	if (!response.ok) throw new Error(`npm version lookup failed: HTTP ${response.status}`)
	return shouldPublish(version, await response.json())
}

async function main() {
	const pkg = JSON.parse(await readFile('package.json', 'utf8'))
	validateReleaseVersions(pkg, JSON.parse(await readFile('package-lock.json', 'utf8')), await readFile('lib/client.js', 'utf8'))
	const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8' }))
	validatePackedFiles(pack.files)
	for (const file of pack.files) {
		if (file.path === 'icon.png') continue
		const content = await readFile(file.path, 'utf8')
		if (/^-----BEGIN (?:EC |RSA )?PRIVATE KEY-----/m.test(content) || /\bnpm_[A-Za-z0-9]{30,}\b/.test(content) || /\/(?:Users\/tx|Volumes\/MarsSSD)\//.test(content)) {
			throw new Error(`Private content detected in ${file.path}`)
		}
	}
	const publish = await readPublishState(pkg.version)
	if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `publish=${publish}\nversion=${pkg.version}\n`)
	console.log(`${PACKAGE_NAME}@${pkg.version}: ${pack.files.length} package files checked; ${publish ? 'ready to publish' : 'already published, skipping'}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main()
