/** 创意素材的同步记录按 App / 版本本地化 / 类型隔离；原子写入保留失败恢复信息。 */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { AscError } from './asc/client.js'

export function requireVersionLocId(value) {
	if (typeof value !== 'string' || !/^[0-9a-f-]{10,64}$/i.test(value)) {
		throw new AscError('REQUEST', '缺少或非法的版本语言标识')
	}
	return value
}

export function createAssetStore(directory) {
	function pathFor({ appId, versionLocId, kind }, legacy = false) {
		if (!/^[0-9]{4,20}$/.test(String(appId)) || !['header', 'search'].includes(kind)) {
			throw new AscError('REQUEST', '素材所属 App 或类型不合法')
		}
		return legacy
			? join(directory, appId, `${kind}.meta.json`)
			: join(directory, appId, 'localizations', requireVersionLocId(versionLocId), `${kind}.meta.json`)
	}
	async function read(path) {
		try {
			const value = JSON.parse(await readFile(path, 'utf8'))
			if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid record')
			return value
		} catch (error) {
			if (error.code === 'ENOENT') return null
			throw new AscError('CONFIG', '素材同步记录无法读取，请保留记录并检查本机文件')
		}
	}
	async function remove(path) {
		try { await unlink(path) } catch (error) { if (error.code !== 'ENOENT') throw error }
	}
	return {
		read: async (scope) => {
			const record = await read(pathFor(scope))
			if (record && record.versionLocId !== scope.versionLocId) throw new AscError('CONFLICT', '素材记录与当前版本语言不一致')
			return record
		},
		write: async (scope, record) => {
			const path = pathFor(scope)
			const dir = join(directory, scope.appId, 'localizations', scope.versionLocId)
			await mkdir(dir, { recursive: true, mode: 0o700 })
			const temp = `${path}.${randomUUID()}.tmp`
			try {
				await writeFile(temp, JSON.stringify({ ...record, versionLocId: scope.versionLocId, syncedAt: new Date().toISOString() }, null, 2), { mode: 0o600 })
				await rename(temp, path)
			} finally { await remove(temp) }
		},
		remove: (scope) => remove(pathFor(scope)),
		readLegacy: (scope) => read(pathFor(scope, true)),
		removeLegacy: (scope) => remove(pathFor(scope, true))
	}
}
