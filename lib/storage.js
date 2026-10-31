/** 插件本地数据管理。清理仅限当前配置的目录，不调用 ASC。 */
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { copyFile, lstat, mkdir, readdir, rm, unlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { AscError } from './asc/client.js'

const APP_ID = /^[0-9]{4,20}$/
const LOCALIZATION_ID = /^[0-9a-f-]{10,64}$/i
const IMAGE_NAMES = new Set(['header.img', 'search.img'])
const RECORD_NAMES = new Set(['header.meta.json', 'search.meta.json'])

async function info(path) {
	try { return await lstat(path) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
}

/** 不跟随数据目录内的符号链接，避免统计、导入或删除触及目录之外。 */
async function safePath(root, path) {
	if ((await info(dirname(root)))?.isSymbolicLink()) throw new AscError('CONFIG', '插件数据目录的父目录含符号链接，请先检查目录')
	const subpath = relative(root, path)
	if (subpath.startsWith(`..${sep}`) || subpath === '..' || isAbsolute(subpath)) throw new AscError('REQUEST', '文件不属于当前插件的数据目录')
	let current = root
	for (const part of ['', ...subpath.split(sep).filter(Boolean)]) {
		if (part) current = join(current, part)
		const item = await info(current)
		if (item?.isSymbolicLink()) throw new AscError('CONFIG', '插件数据目录含符号链接，请先检查目录')
	}
}

async function filesUnder(root) {
	await safePath(root, root)
	if (!await info(root)) return []
	const files = []
	async function visit(directory) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name)
			if (entry.isSymbolicLink()) throw new AscError('CONFIG', '插件数据目录含符号链接，请先检查目录')
			if (entry.isDirectory()) await visit(path)
			else if (entry.isFile()) files.push({ path, parts: relative(root, path).split(sep), bytes: (await lstat(path)).size })
		}
	}
	await visit(root)
	return files
}

function classify(file) {
	const p = file.parts
	if (p[0] !== 'assets' || !APP_ID.test(p[1] ?? '')) return 'other'
	if (p.length === 3 && IMAGE_NAMES.has(p[2])) return 'image'
	if ((p.length === 3 && RECORD_NAMES.has(p[2])) ||
		(p.length === 5 && p[2] === 'localizations' && LOCALIZATION_ID.test(p[3]) && RECORD_NAMES.has(p[4]))) return 'record'
	return 'other'
}

async function inventory(directory) {
	const files = await filesUnder(directory)
	const apps = new Map()
	const result = { totalBytes: 0, imageBytes: 0, imageCount: 0, recordBytes: 0, recordCount: 0 }
	for (const file of files) {
		result.totalBytes += file.bytes
		const type = classify(file)
		if (type === 'other') continue
		result[`${type}Bytes`] += file.bytes
		result[`${type}Count`] += 1
		if (type === 'image') {
			const app = apps.get(file.parts[1]) ?? { appId: file.parts[1], imageCount: 0, imageBytes: 0 }
			app.imageCount += 1; app.imageBytes += file.bytes
			apps.set(app.appId, app)
		}
	}
	return { ...result, apps: [...apps.values()].sort((a, b) => a.appId.localeCompare(b.appId)) }
}

export function createStorageManager({ directory, profileId, legacyDirectory, credentials, openDirectory, automaticUninstallCleanup = false }) {
	if (!isAbsolute(directory) || basename(directory) !== 'dsh-asc') throw new Error('An absolute dsh-asc data directory is required')
	directory = resolve(directory)
	const assetsDirectory = join(directory, 'assets')
	let active = 0, exclusive = false
	const manager = {
		directory, assetsDirectory, profileId,
		async withAccess(operation, needsExclusive = false) {
			if (exclusive || (needsExclusive && active > 0)) throw new AscError('CONFLICT', '插件仍在处理请求，请完成后再清理或更改本地数据')
			active += 1
			if (needsExclusive) exclusive = true
			try { return await operation() } finally { active -= 1; if (needsExclusive) exclusive = false }
		},
		async describe() {
			const current = await inventory(directory)
			let legacy = null, legacyUnavailable = false
			if (legacyDirectory && resolve(legacyDirectory) !== directory) {
				try { legacy = await inventory(legacyDirectory) } catch { legacyUnavailable = true }
			}
			return { directory, profileId, ...current, automaticUninstallCleanup,
				legacy: { available: Boolean(legacy?.totalBytes), unavailable: legacyUnavailable, directory: legacyDirectory ?? '', imageCount: legacy?.imageCount ?? 0, imageBytes: legacy?.imageBytes ?? 0 } }
		},
		async ensure() {
			await safePath(directory, directory)
			await mkdir(directory, { recursive: true, mode: 0o700 })
		},
		async checkPath(path) { await safePath(directory, path) },
		async clearImages(appId) {
			if (appId !== undefined && !APP_ID.test(String(appId))) throw new AscError('REQUEST', 'App ID 不合法')
			const files = await filesUnder(directory)
			for (const file of files) {
				if (classify(file) !== 'image' || (appId !== undefined && file.parts[1] !== String(appId))) continue
				await safePath(directory, file.path)
				await unlink(file.path)
			}
		},
		async disconnect(logger) {
			await safePath(directory, directory)
			await credentials.clearCredentials(logger)
		},
		async open() {
			await manager.ensure()
			if (!openDirectory) throw new AscError('REQUEST', '当前宿主不支持打开文件夹，请复制显示的目录路径')
			await openDirectory(directory)
		},
		async importLegacy(logger) {
			if (!legacyDirectory || resolve(legacyDirectory) === directory) throw new AscError('REQUEST', '没有可导入的旧版目录')
			const existing = await filesUnder(directory)
			if (existing.length) throw new AscError('CONFLICT', '当前配置已有本地数据，不能覆盖导入')
			const sources = await filesUnder(legacyDirectory)
			if (!sources.length) throw new AscError('NOT_FOUND', '没有可导入的旧版数据')
			await manager.ensure()
			// 凭据最后导入；失败时回滚本次复制的素材，保留原始目录和凭据清理记录。
			const copied = []
			try {
				for (const file of sources.filter((item) => classify(item) !== 'other')) {
					const destination = join(directory, ...file.parts)
					await safePath(directory, destination)
					await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
					await copyFile(file.path, destination, constants.COPYFILE_EXCL)
					copied.push(destination)
				}
				if (sources.some((file) => file.parts.length === 1 && file.parts[0] === 'credentials.json')) {
					await credentials.importLegacyCredentials(legacyDirectory, 'dsh-asc', logger)
				}
			} catch (error) {
				await Promise.all(copied.map((path) => unlink(path)))
				throw error
			}
		},
		async prepareUninstall(logger) {
			// 先删除钥匙串项目；失败时保留文件里的待清理账号，供用户重试。
			await filesUnder(directory)
			await credentials.clearCredentials(logger)
			await safePath(directory, directory)
			await rm(directory, { recursive: true, force: true })
		}
	}
	return manager
}
