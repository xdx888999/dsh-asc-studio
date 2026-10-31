/** 只读取本插件的公开版本；不安装代码、不读取账户或持久化检查记录。 */
import { readFileSync } from 'node:fs'

const PACKAGE_NAME = 'dsh-asc-studio'
const VERSION_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`
const CURRENT_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
const CACHE_MS = 6 * 60 * 60 * 1000
const FAILURE_CACHE_MS = 5 * 60 * 1000
const MANUAL_INTERVAL_MS = 30 * 1000
const MAX_RESPONSE_BYTES = 64 * 1024

function versionParts(value) {
	if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) return null
	const parts = value.split('.').map(Number)
	return parts.every(Number.isSafeInteger) ? parts : null
}

async function readVersion(response) {
	if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Invalid registry response')
	if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) throw new Error('Registry response too large')
	const chunks = []
	let size = 0
	for await (const chunk of response.body) {
		size += chunk.length
		if (size > MAX_RESPONSE_BYTES) throw new Error('Registry response too large')
		chunks.push(Buffer.from(chunk))
	}
	const manifest = JSON.parse(Buffer.concat(chunks).toString('utf8'))
	if (manifest.name !== PACKAGE_NAME || !versionParts(manifest.version) || manifest.deprecated ||
		typeof manifest.dsh?.bundle?.patch !== 'string' || !manifest.dsh.bundle.patch) throw new Error('Invalid package metadata')
	return manifest.version
}

export function createUpdateChecker({ currentVersion = CURRENT_VERSION, request = fetch, now = Date.now } = {}) {
	const installed = versionParts(currentVersion)
	if (!installed) throw new Error('Invalid installed version')
	let cached = null, inFlight = null

	return {
		async check({ force = false } = {}) {
			if (inFlight) return inFlight
			const ttl = force ? MANUAL_INTERVAL_MS : cached?.status === 'error' ? FAILURE_CACHE_MS : CACHE_MS
			if (cached && now() >= cached.checkedAt && now() - cached.checkedAt < ttl) return { ...cached }
			inFlight = (async () => {
				try {
					const response = await request(VERSION_URL, {
						method: 'GET', headers: { accept: 'application/json' }, credentials: 'omit',
						redirect: 'error', signal: AbortSignal.timeout(8000)
					})
					const latestVersion = await readVersion(response)
					const latest = versionParts(latestVersion)
					const different = latest.findIndex((part, index) => part !== installed[index])
					cached = { currentVersion, latestVersion, checkedAt: now(),
						status: different !== -1 && latest[different] > installed[different] ? 'available' : 'current' }
				} catch {
					// 不把注册表响应、网络代理诊断或本机路径回传到界面。
					cached = { currentVersion, latestVersion: null, checkedAt: now(), status: 'error' }
				}
				return { ...cached }
			})()
			try { return await inFlight } finally { inFlight = null }
		}
	}
}
