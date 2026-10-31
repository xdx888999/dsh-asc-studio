/** 使用系统钥匙串；秘密仅通过子进程管道传递。 */
import { execFile } from 'node:child_process'

const SECURITY_PATH = '/usr/bin/security'
const KEYCHAIN_TIMEOUT_MS = 5_000
const MAX_COMMAND_BYTES = 4_000
const ACCOUNT_PATTERN = /^p8:[a-z0-9_-]{1,200}$/i

function keychainError(code = 'KEYCHAIN') {
	return Object.assign(new Error('macOS 钥匙串操作失败，请确认钥匙串可用后重试'), { code })
}

function validateIdentity(service, account) {
	if (typeof service !== 'string' || service.trim() === '' || /[\0\r\n]/.test(service)
		|| typeof account !== 'string' || !ACCOUNT_PATTERN.test(account)) throw keychainError()
}

function quote(value) {
	return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function runSecurity(argv, input) {
	return new Promise((resolve, reject) => {
		let child
		const failInput = () => {
			reject(keychainError())
			try { child?.kill() } catch { /* 终止失败不覆盖已脱敏的错误。 */ }
		}
		try {
			child = execFile(SECURITY_PATH, argv, { timeout: KEYCHAIN_TIMEOUT_MS, maxBuffer: 32 * 1024, encoding: 'utf8' }, (error, stdout) => {
				if (error) {
					// 子进程错误可能含命令、输出或秘密，始终重建公开错误。
					reject(keychainError(error.code === 44 && input === undefined ? 'KEYCHAIN_NOT_FOUND' : 'KEYCHAIN'))
					return
				}
				resolve(String(stdout ?? ''))
			})
			if (input !== undefined) {
				child.stdin.on('error', failInput)
				child.stdin.end(input, (error) => { if (error) failInput() })
			}
		} catch { failInput() }
	})
}

export async function readKeychain(service, account) {
	validateIdentity(service, account)
	const value = (await runSecurity(['find-generic-password', '-s', service, '-a', account, '-w'])).trim()
	if (value === '') throw keychainError()
	return value
}

export async function writeKeychain(service, account, value) {
	validateIdentity(service, account)
	if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw keychainError()
	const command = `add-generic-password -U -s ${quote(service)} -a ${quote(account)} -w ${value}\n`
	// security 的交互输入按约 4 KiB 分行；越界会拆成新命令并覆盖退出码。
	if (Buffer.byteLength(command, 'utf8') > MAX_COMMAND_BYTES) throw keychainError()
	await runSecurity(['-i', '-q', '-p', ''], command)
}

export async function deleteKeychain(service, account) {
	validateIdentity(service, account)
	await runSecurity(['delete-generic-password', '-s', service, '-a', account])
}
