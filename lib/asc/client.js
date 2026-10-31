/**
 * App Store Connect API 的 fetch 封装：JWT 认证、限流/服务器错误重试、错误归类。
 *
 * 私钥只用于本地签名，从不随请求发出；日志与错误信息中都不包含 token。
 *
 * @module dsh-asc-studio/asc/client
 */

import { makeToken } from './jwt.js'
import { request as httpsRequest } from 'node:https'

/** 请求超时（毫秒）。 */
const REQUEST_TIMEOUT_MS = 30_000
/** token 缓存时长；到期后下一次请求自动重签（Apple 上限 20 分钟）。 */
const TOKEN_REFRESH_MS = 15 * 60 * 1000
/** 429 的最大尝试次数（含首次）。 */
const RATE_LIMIT_ATTEMPTS = 3
/** 限流没有 Retry-After 时的退避序列（毫秒）。 */
const RATE_LIMIT_BACKOFF_MS = [1000, 2000, 4000]
/** 5xx / 网络错误的最大尝试次数（含首次）。 */
const SERVER_RETRY_ATTEMPTS = 3
const SERVER_BACKOFF_MS = [500, 1000]

/** Base URL：App Store Connect API。 */
export const ASC_BASE_URL = 'https://api.appstoreconnect.apple.com'

/** 媒体直传主机白名单（Apple 家族域名，防 SSRF：uploadOperations.url 必须命中其一）。 */
const UPLOAD_HOST_SUFFIXES = ['.apple.com', '.mzstatic.com']

/**
 * 校验 uploadOperations 里的直传地址：必须 https 且主机在 Apple 域名白名单内。
 * @param {string} rawUrl - Apple 返回的预签名地址。
 * @returns {URL} 解析后的 URL。
 */
export function assertSafeUploadUrl(rawUrl) {
	let parsed
	try {
		parsed = new URL(String(rawUrl ?? ''))
	} catch {
		throw new AscError('SERVER', '素材直传地址不是合法 URL')
	}
	if (parsed.protocol !== 'https:') {
		throw new AscError('SERVER', '素材直传地址必须为 https')
	}
	const host = parsed.hostname.toLowerCase()
	if (!UPLOAD_HOST_SUFFIXES.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix))) {
		throw new AscError('SERVER', `素材直传地址不在 Apple 域名白名单内（${host}）`)
	}
	return parsed
}

/**
 * 经白名单校验后，用 node:https 直传一段字节到 Apple 的预签名地址。
 * @param {object} op - uploadOperations 条目（url/method/offset/length/requestHeaders）。
 * @param {Buffer} chunk - 本段字节。
 * @returns {Promise<{ status: number }>} 上传结果。
 */
export function uploadViaPresignedUrl(op, chunk) {
	return new Promise((resolve, reject) => {
		let target
		try {
			target = assertSafeUploadUrl(op?.url)
		} catch (error) {
			reject(error)
			return
		}
		const headers = {}
		for (const header of (Array.isArray(op?.requestHeaders) ? op.requestHeaders : [])) {
			if (typeof header?.name === 'string') headers[header.name] = String(header.value ?? '')
		}
		const request = httpsRequest({
			protocol: target.protocol,
			hostname: target.hostname,
			port: target.port !== '' ? target.port : 443,
			path: `${target.pathname}${target.search}`,
			method: String(op?.method ?? 'PUT'),
			headers,
			timeout: 120_000
		}, (response) => {
			const chunks = []
			response.on('data', (chunkData) => chunks.push(chunkData))
			response.on('end', () => {
				const status = response.statusCode ?? 0
				if (status >= 200 && status < 300) {
					resolve({ status })
					return
				}
				reject(new AscError('SERVER', `素材字节直传失败（HTTP ${status}）`, {
					detail: Buffer.concat(chunks).toString('utf8').slice(0, 500)
				}))
			})
			response.on('error', (error) => reject(new AscError('SERVER', `素材直传响应错误（${describeError(error)}）`)))
		})
		request.on('timeout', () => request.destroy(new AscError('SERVER', '素材直传超时')))
		request.on('error', (error) => reject(error instanceof AscError ? error : new AscError('SERVER', `素材直传网络错误（${describeError(error)}）`)))
		request.end(chunk)
	})
}

/**
 * 归类后的 ASC 错误。
 *
 * `code` 是面向前端的稳定错误类：CONFIG / AUTH / FORBIDDEN / NOT_FOUND /
 * CONFLICT / COPY_CONFLICT / VALIDATION / RATE_LIMIT / SERVER / NETWORK / REQUEST。
 */
export class AscError extends Error {
	/**
	 * @param {string} code - 错误类。
	 * @param {string} message - 面向用户的中文说明。
	 * @param {{ status?: number, detail?: string, retryAfterMs?: number }?} extra - 附加信息。
	 */
	constructor(code, message, extra = {}) {
		super(message)
		this.name = 'AscError'
		this.code = code
		this.status = extra.status
		this.detail = extra.detail
		this.retryAfterMs = extra.retryAfterMs
	}
}

/** @param {unknown} error - 任意抛出值。 @returns {string} 短消息。 */
export function describeError(error) {
	if (error instanceof Error) return error.message
	return String(error)
}

/** @param {number} ms - 等待毫秒。 @returns {Promise<void>} 定时结束。 */
function sleep(ms) {
	return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/**
 * 解析 JSON:API 错误体，拼接 `errors[].detail`。
 * @param {unknown} body - 响应体（已 JSON.parse 或 null）。
 * @returns {string | undefined} 拼接后的详情。
 */
function extractDetail(body) {
	const errors = body?.errors
	if (!Array.isArray(errors)) return undefined
	const parts = errors
		.map((entry) => {
			const field = entry?.source?.pointer ? String(entry.source.pointer).replace(/^\/data\//, '') : ''
			const text = entry?.detail ?? entry?.title ?? entry?.code
			if (text === undefined || text === null || text === '') return ''
			return field === '' ? String(text) : `${field}: ${text}`
		})
		.filter((part) => part !== '')
	return parts.length > 0 ? parts.join('；') : undefined
}

/**
 * 一个持有 token 缓存的 ASC API 客户端。
 */
export class AscClient {
	/**
	 * @param {object} options - 连接参数。
	 * @param {string} options.p8 - .p8 私钥 PEM 内容。
	 * @param {string} options.keyId - Key ID。
	 * @param {string} options.issuerId - Issuer ID。
	 * @param {{ info?: Function, warn?: Function }} [options.logger] - 可选日志。
	 */
	constructor({ p8, keyId, issuerId, logger } = {}) {
		this.p8 = String(p8 ?? '')
		this.keyId = String(keyId ?? '')
		this.issuerId = String(issuerId ?? '')
		this.logger = logger
		/** @type {{ token: string, signedAt: number } | undefined} */
		this.tokenCache = undefined
	}

	/** @returns {string} 当前缓存的有效 token，需要时重签。 */
	#token() {
		const cached = this.tokenCache
		if (cached !== undefined && Date.now() - cached.signedAt < TOKEN_REFRESH_MS) return cached.token
		const { token } = makeToken({ p8: this.p8, keyId: this.keyId, issuerId: this.issuerId })
		this.tokenCache = { token, signedAt: Date.now() }
		return token
	}

	/** 丢弃缓存的 token（401 后强制重签一次）。 */
	invalidateToken() {
		this.tokenCache = undefined
	}

	/**
	 * 发起一次 API 调用，处理 401 重签、429 限流退避、5xx/网络重试。
	 *
	 * @param {string} method - HTTP 方法。
	 * @param {string} path - 以 `/v1` 开头的路径（可带查询串）。
	 * @param {object} [body] - JSON 请求体。
	 * @param {{ attempts?: number, retriedAuth?: boolean, beforeAttempt?: Function }} [state] - 重试状态；beforeAttempt 每次发送前复核，返回已有响应可跳过写入。
	 * @returns {Promise<{ status: number, body: object | undefined, headers: Headers }>}
	 *   原始响应（body 已尽力 JSON.parse）。
	 */
	async request(method, path, body, state = {}) {
		if (typeof fetch !== 'function') {
			throw new AscError('SERVER', '当前 Node 环境没有 fetch，无法调用 App Store Connect API')
		}
		// 复核必须在重试循环内、网络异常捕获外；冲突不能被包装成网络错误后再次写入。
		const completed = await state.beforeAttempt?.()
		if (completed) return completed
		const attempts = state.attempts ?? 0
		const url = new URL(path, ASC_BASE_URL).href
		let response, text
		try {
			response = await fetch(url, {
				method,
				headers: {
					authorization: `Bearer ${this.#token()}`,
					...(body === undefined ? {} : { 'content-type': 'application/json' })
				},
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
			})
			text = await response.text()
		} catch (error) {
			// POST 可能已在远端完成，响应中断时不能盲目重新创建资源。
			if (method !== 'POST' && attempts + 1 < SERVER_RETRY_ATTEMPTS) {
				await sleep(SERVER_BACKOFF_MS[Math.min(attempts, SERVER_BACKOFF_MS.length - 1)])
				return this.request(method, path, body, { ...state, attempts: attempts + 1 })
			}
			throw new AscError('NETWORK', `网络错误：无法连接 App Store Connect（${describeError(error)}）`)
		}

		let parsed
		try { parsed = text === '' ? undefined : JSON.parse(text) } catch { parsed = undefined }

		if (response.status === 401) {
			// 密钥无效 / token 过期：先重签一次再报错。
			if (state.retriedAuth !== true) {
				this.invalidateToken()
				return this.request(method, path, body, { ...state, retriedAuth: true })
			}
			throw new AscError('AUTH', '密钥无效或已过期：请检查 Issuer ID、Key ID 与 .p8 文件，并确认系统时间正确', {
				status: 401,
				detail: extractDetail(parsed)
			})
		}
		if (response.status === 403) {
			throw new AscError('FORBIDDEN', '密钥角色权限不足：请确认该 API 密钥至少是 App Manager（或 Admin）', {
				status: 403,
				detail: extractDetail(parsed)
			})
		}
		if (response.status === 404) {
			throw new AscError('NOT_FOUND', '资源不存在，请刷新列表后重试', { status: 404, detail: extractDetail(parsed) })
		}
		if (response.status === 409) {
			throw new AscError('CONFLICT', '该版本当前状态不允许此修改（可能是版本不可编辑或字段不合法）', {
				status: 409,
				detail: extractDetail(parsed)
			})
		}
		if (response.status === 400 || response.status === 422) {
			const detail = extractDetail(parsed)
			throw new AscError('VALIDATION', detail === undefined ? '请求被拒绝：请检查字段内容与长度' : `字段错误：${detail}`, {
				status: response.status,
				detail
			})
		}
		if (response.status === 429) {
			if (attempts + 1 < RATE_LIMIT_ATTEMPTS) {
				const header = Number(response.headers?.get?.('retry-after'))
				const waitMs = Number.isFinite(header) && header > 0
					? header * 1000
					: RATE_LIMIT_BACKOFF_MS[Math.min(attempts, RATE_LIMIT_BACKOFF_MS.length - 1)]
				await sleep(waitMs)
				return this.request(method, path, body, { ...state, attempts: attempts + 1 })
			}
			throw new AscError('RATE_LIMIT', '请求过于频繁（限流）：请稍后重试', { status: 429, detail: extractDetail(parsed) })
		}
		if (response.status >= 500) {
			if (method !== 'POST' && attempts + 1 < SERVER_RETRY_ATTEMPTS) {
				await sleep(SERVER_BACKOFF_MS[Math.min(attempts, SERVER_BACKOFF_MS.length - 1)])
				return this.request(method, path, body, { ...state, attempts: attempts + 1 })
			}
			throw new AscError('SERVER', `App Store Connect 服务暂时不可用（HTTP ${response.status}）`, {
				status: response.status,
				detail: extractDetail(parsed)
			})
		}
		if (!response.ok) {
			throw new AscError('SERVER', `App Store Connect 返回了未预期的状态（HTTP ${response.status}）`, {
				status: response.status,
				detail: extractDetail(parsed)
			})
		}
		return { status: response.status, body: parsed, headers: response.headers }
	}

	/** GET。 @param {string} path - 路径。 */
	get(path) { return this.request('GET', path) }

	/** POST。 @param {string} path - 路径。 @param {object} body - 请求体。 */
	post(path, body) { return this.request('POST', path, body) }

	/** PATCH。 @param {string} path - 路径。 @param {object} body - 请求体。 */
	patch(path, body, options) { return this.request('PATCH', path, body, options) }
}
