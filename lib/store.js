/**
 * 每个宿主 profile 独立保存凭据：目录及钥匙串 service 必须由宿主显式提供。
 * 私钥存入 macOS 钥匙串，不可用时明确失败；旧文件私钥验证迁移后移除。
 * 私钥仅在本机及请求内存中流转，摘要与日志均不包含其内容。
 * @module dsh-asc-studio/store
 */

import { platform } from 'node:os'
import { chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { createPrivateKey, randomUUID } from 'node:crypto'
import { deleteKeychain, readKeychain, writeKeychain } from './keychain.js'

const LEGACY_KEYCHAIN_SERVICE = 'dsh-asc'
const ACCOUNT_PATTERN = /^p8:[a-z0-9_-]{1,200}$/i
const MAX_P8_BYTES = 8 * 1024
const CLEANUP_JOURNAL_FILE = 'keychain-cleanup.json'

function storageError(message, code = 'CONFIG') {
	return Object.assign(new Error(message), { code })
}

function directoryPath(directory) {
	if (typeof directory !== 'string' || !isAbsolute(directory)) {
		throw storageError('凭据目录必须由宿主提供绝对路径')
	}
	return resolve(directory)
}

function serviceName(service) {
	if (typeof service !== 'string' || service.trim() === '' || /[\0\r\n]/.test(service)) {
		throw storageError('必须提供本 profile 独立的钥匙串 service')
	}
	return service
}

function keychainAccount(keyId) {
	const account = `p8:${keyId}`
	if (!ACCOUNT_PATTERN.test(account)) throw storageError('Key ID 格式不正确')
	return account
}

function requireSecureBackend() {
	if (platform() !== 'darwin') throw storageError('当前系统没有受支持的安全凭据存储，无法保存或使用私钥', 'KEYCHAIN')
}

function normalizeP8(value) {
	try {
		if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_P8_BYTES || !value.includes('-----BEGIN PRIVATE KEY-----')) throw new Error('invalid')
		const key = createPrivateKey({ key: value, format: 'pem' })
		if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('invalid')
		return key.export({ format: 'pem', type: 'pkcs8' }).toString()
	} catch { throw storageError('.p8 必须是有效的 EC P-256 PEM 私钥') }
}

async function readStateFile(directory, fileName = 'credentials.json') {
	let content
	try {
		const path = join(directory, fileName)
		if (!(await lstat(path)).isFile()) throw storageError('凭据文件不能是符号链接或目录')
		content = await readFile(path, 'utf8')
	} catch (error) {
		if (error.code === 'ENOENT') return null
		throw storageError('无法读取本 profile 的凭据文件')
	}
	try {
		const raw = JSON.parse(content)
		if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid')
		return raw
	} catch {
		throw storageError('本 profile 的凭据文件已损坏，请先恢复文件后再操作')
	}
}

async function removeFile(path) {
	try { await unlink(path) } catch (error) {
		if (error.code !== 'ENOENT') throw error
	}
}

function metadata(raw) {
	// 白名单避免旧私钥或未知字段被复制到清理记录和临时文件。
	const payload = Object.fromEntries(['issuerId', 'keyId', 'keyFileName', 'storage', 'savedAt']
		.filter((key) => typeof raw[key] === 'string').map((key) => [key, raw[key]]))
	if (raw.keychainAccounts !== undefined) payload.keychainAccounts = trackedAccounts(raw)
	return payload
}

async function writeStateFile(directory, payload, fileName = 'credentials.json') {
	await mkdir(directory, { recursive: true, mode: 0o700 })
	await chmod(directory, 0o700)
	const stateFile = join(directory, fileName)
	const temp = `${stateFile}.${randomUUID()}.tmp`
	try {
		await writeFile(temp, JSON.stringify(metadata(payload), null, 2), { encoding: 'utf8', mode: 0o600 })
		await chmod(temp, 0o600)
		await rename(temp, stateFile)
	} finally {
		await removeFile(temp)
	}
}

function decodeP8(b64) {
	try {
		if (typeof b64 !== 'string' || b64.length > Math.ceil(MAX_P8_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return ''
		return normalizeP8(Buffer.from(b64, 'base64').toString('utf8'))
	} catch { return '' }
}

function hasFileSecret(raw) {
	return typeof raw.p8B64 === 'string' && raw.p8B64 !== ''
}

async function credentialsFromState(raw, service, logger, allowLegacyFile = false) {
	const issuerId = typeof raw.issuerId === 'string' ? raw.issuerId : ''
	const keyId = typeof raw.keyId === 'string' ? raw.keyId : ''
	const keyFileName = typeof raw.keyFileName === 'string' ? raw.keyFileName : ''
	let p8 = '', storage = 'none'
	if (raw.storage === 'pending' || raw.storage === 'clearing') return { configured: false, issuerId, keyId, keyFileName, storage, p8, recoveryRequired: true }
	if (allowLegacyFile && hasFileSecret(raw)) {
		p8 = decodeP8(raw.p8B64)
		if (p8 !== '') storage = 'file'
	} else if (keyId !== '' && platform() === 'darwin') {
		try {
			p8 = decodeP8(await readKeychain(service, keychainAccount(keyId)))
			if (p8 !== '') storage = 'keychain'
		} catch {
			logger?.warn?.('dsh-asc-studio: 本 profile 的钥匙串读取失败')
		}
	}
	return { configured: issuerId !== '' && keyId !== '' && p8 !== '', issuerId, keyId, keyFileName, storage, p8 }
}

function trackedAccounts(raw) {
	const accounts = raw.keychainAccounts === undefined
		? (raw.storage === 'keychain' && raw.keyId ? [keychainAccount(raw.keyId)] : [])
		: raw.keychainAccounts
	if (!Array.isArray(accounts) || accounts.some((value) => typeof value !== 'string' || !ACCOUNT_PATTERN.test(value))) {
		throw storageError('本 profile 的钥匙串清理记录已损坏')
	}
	return [...new Set(accounts)]
}

async function writeVerifiedKey(service, account, p8) {
	const value = Buffer.from(p8).toString('base64')
	await writeKeychain(service, account, value)
	if (await readKeychain(service, account) !== value) throw storageError('钥匙串写入验证失败，请重试', 'KEYCHAIN')
}

/**
 * @param {{ directory: string, keychainService: string }} options - 宿主 profile 的独立存储位置。
 * @returns {{loadCredentials: Function, saveCredentials: Function, describeCredentials: Function,
 * clearCredentials: Function, importLegacyCredentials: Function}} 本 profile 的凭据操作。
 */
export function createCredentialStore({ directory, keychainService } = {}) {
	const stateDirectory = directoryPath(directory)
	const service = serviceName(keychainService)
	if (service === LEGACY_KEYCHAIN_SERVICE) throw storageError('本 profile 不能使用旧版共享钥匙串 service')
	let mutation = Promise.resolve()
	const exclusive = (operation) => {
		const result = mutation.then(operation)
		mutation = result.catch(() => {})
		return result
	}

	async function readCleanupJournal() {
		const journal = await readStateFile(stateDirectory, CLEANUP_JOURNAL_FILE)
		if (journal !== null && !Array.isArray(journal.keychainAccounts)) throw storageError('本 profile 的钥匙串清理记录已损坏')
		if (journal !== null) trackedAccounts(journal)
		return journal
	}

	function profileAccounts(raw, journal) {
		const accounts = [...trackedAccounts(raw), ...trackedAccounts(journal ?? {})]
		// 旧文件的 keyId 也是迁移可能已经创建的账户；损坏的旧 ID 不阻止提供新密钥恢复。
		if (hasFileSecret(raw) && platform() === 'darwin' && typeof raw.keyId === 'string' && ACCOUNT_PATTERN.test(`p8:${raw.keyId}`)) {
			accounts.push(keychainAccount(raw.keyId))
		}
		return [...new Set(accounts)]
	}

	async function migrateFileSecret(raw, journal) {
		if (!hasFileSecret(raw) || raw.storage === 'clearing') return raw
		requireSecureBackend()
		const p8 = decodeP8(raw.p8B64)
		if (p8 === '') throw storageError('旧版文件私钥无效，已保留原文件，请重新提供有效的 .p8')
		const account = keychainAccount(raw.keyId)
		const accounts = profileAccounts(raw, journal)
		if (!accounts.includes(account)) accounts.push(account)
		// 旧文件本身记录目标 keyId；验证前不重写它，以免丢失唯一私钥或新增明文副本。
		await writeVerifiedKey(service, account, p8)
		const migrated = { ...metadata(raw), storage: 'keychain', keychainAccounts: accounts }
		await writeStateFile(stateDirectory, migrated)
		if (journal !== null) await removeFile(join(stateDirectory, CLEANUP_JOURNAL_FILE))
		return migrated
	}

	async function load(logger) {
		const raw = await readStateFile(stateDirectory)
		const journal = await readCleanupJournal()
		return credentialsFromState(await migrateFileSecret(raw ?? (journal ? { storage: 'pending' } : {}), journal), service, logger)
	}

	function loadCredentials(logger = {}) {
		return exclusive(() => load(logger))
	}

	async function save(input = {}, logger = {}) {
		requireSecureBackend()
		const issuerId = String(input.issuerId ?? '').trim()
		const keyId = String(input.keyId ?? '').trim()
		const suppliedP8 = String(input.p8 ?? '')
		const account = keychainAccount(keyId)
		const suppliedKey = suppliedP8 === '' ? '' : normalizeP8(suppliedP8)
		if (issuerId === '') throw storageError('Issuer ID、Key ID 与 .p8 缺一不可')
		const original = await readStateFile(stateDirectory) ?? {}
		const journal = await readCleanupJournal()
		// 用户重新提供合法私钥时不依赖旧私钥迁移成功；失败前原文件仍是唯一旧副本。
		const raw = suppliedKey ? original : await migrateFileSecret(original, journal)
		if ((raw.storage === 'pending' || raw.storage === 'clearing') && suppliedKey === '') throw storageError('安全凭据存储尚未恢复，请重新上传 .p8 后保存，或断开账号后重试', 'KEYCHAIN')
		const p8 = suppliedKey || (await credentialsFromState(raw, service, logger)).p8
		if (p8 === '') throw storageError('Issuer ID、Key ID 与 .p8 缺一不可')
		const accounts = profileAccounts(raw, journal)
		if (!accounts.includes(account)) accounts.push(account)
		// 先登记再写钥匙串：即使后续文件写入失败，清理仍能找到本 profile 创建的项。
		// 同一账号覆写无法跨存储原子提交；新账号失败则仍可使用旧账号。
		const journalStorage = raw.keyId === keyId ? 'pending' : raw.storage
		if (hasFileSecret(raw)) {
			await writeStateFile(stateDirectory, { keychainAccounts: accounts }, CLEANUP_JOURNAL_FILE)
		} else {
			await writeStateFile(stateDirectory, { ...metadata(raw), storage: journalStorage, keychainAccounts: accounts })
		}
		await writeVerifiedKey(service, account, p8)
		const payload = {
			issuerId, keyId, keyFileName: String(input.keyFileName || raw.keyFileName || '').slice(0, 200),
			storage: 'keychain', savedAt: new Date().toISOString(), keychainAccounts: accounts
		}
		await writeStateFile(stateDirectory, payload)
		await removeFile(join(stateDirectory, CLEANUP_JOURNAL_FILE))
		logger?.info?.('dsh-asc-studio: 私钥已写入本 profile 的 macOS 钥匙串')
		return { storage: 'keychain' }
	}

	function saveCredentials(input, logger = {}) {
		return exclusive(() => save(input, logger))
	}

	function describeCredentials(logger = {}) {
		return exclusive(async () => {
			const raw = await readStateFile(stateDirectory)
			const journal = await readCleanupJournal()
			let state
			try { state = await migrateFileSecret(raw ?? (journal ? { storage: 'pending' } : {}), journal) } catch (error) {
				if (!hasFileSecret(raw ?? {})) throw error
				// 摘要保留恢复入口；认证读取仍失败，原文件中的私钥不会返回给客户端。
				return { configured: false, hasKey: false, hasStoredCredentials: true, storage: 'none', recoveryRequired: true,
					recoveryCode: ['KEYCHAIN', 'KEYCHAIN_NOT_FOUND'].includes(error.code) ? 'KEYCHAIN' : 'CONFIG',
					issuerId: typeof raw.issuerId === 'string' ? raw.issuerId : '',
					keyId: typeof raw.keyId === 'string' ? raw.keyId : '',
					keyFileName: typeof raw.keyFileName === 'string' ? raw.keyFileName : '' }
			}
			const { configured, issuerId, keyId, keyFileName, storage, p8, recoveryRequired } = await credentialsFromState(state, service, logger)
			return { configured, issuerId, keyId, keyFileName, storage, hasKey: p8 !== '', recoveryRequired: recoveryRequired === true,
				hasStoredCredentials: raw !== null || journal !== null }
		})
	}

	function clearCredentials(logger = {}) {
		return exclusive(async () => {
			const original = await readStateFile(stateDirectory)
			const journal = await readCleanupJournal()
			if (original === null && journal === null) return
			const raw = original ?? {}
			let remaining = profileAccounts(raw, journal)
			if (remaining.length > 0 && platform() !== 'darwin') {
				throw storageError('需要在 macOS 上完成本 profile 的钥匙串清理', 'KEYCHAIN')
			}
			// 先停用配置，再删除钥匙串；任何中断都不会重新启用尚未删除的旧密钥。
			await writeStateFile(stateDirectory, { ...metadata(raw), storage: 'clearing', keychainAccounts: remaining })
			await removeFile(join(stateDirectory, CLEANUP_JOURNAL_FILE))
			for (const account of [...remaining]) {
				try {
					await deleteKeychain(service, account)
				} catch (error) {
					if (error.code !== 'KEYCHAIN_NOT_FOUND') {
						logger?.warn?.('dsh-asc-studio: 本 profile 的钥匙串清理未完成，已保留清理记录')
						throw storageError('钥匙串清理未完成，已保留清理记录，请重试', 'KEYCHAIN')
					}
				}
				remaining = remaining.filter((value) => value !== account)
				await writeStateFile(stateDirectory, { ...metadata(raw), storage: 'clearing', keychainAccounts: remaining })
			}
			await removeFile(join(stateDirectory, 'credentials.json'))
		})
	}

	function importLegacyCredentials(legacyDirectory, legacyKeychainService = LEGACY_KEYCHAIN_SERVICE, logger = {}) {
		return exclusive(async () => {
			const sourceDirectory = directoryPath(legacyDirectory)
			const sourceService = serviceName(legacyKeychainService)
			if (sourceDirectory === stateDirectory || sourceService === service) throw storageError('旧版来源必须与当前 profile 独立')
			if (await readStateFile(stateDirectory) !== null || await readCleanupJournal() !== null) throw storageError('当前 profile 已有凭据或清理记录，不能覆盖导入')
			const raw = await readStateFile(sourceDirectory)
			if (raw === null) throw storageError('未找到旧版凭据')
			const credentials = await credentialsFromState(raw, sourceService, logger, true)
			if (!credentials.configured) throw storageError('旧版凭据不完整或私钥无法读取')
			return save(credentials, logger)
		})
	}

	return { loadCredentials, saveCredentials, describeCredentials, clearCredentials, importLegacyCredentials }
}
