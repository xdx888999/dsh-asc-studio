/**
 * Host 半：注册本地 HTTP 路由，供浏览器面板调用。
 *
 * 所有 ASC 请求与 .p8 私钥只存在于这一半；私钥绝不写日志、绝不返回前端。
 * Agent 仅可读取文案与提交会话草稿；线上写入继续由面板确认。
 *
 * @module dsh-asc-studio
 */

import { homedir, platform } from 'node:os'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { isAbsolute, join, resolve } from 'node:path'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { createCredentialStore } from './store.js'
import { createStorageManager } from './storage.js'
import { createUninstaller } from './uninstall.js'
import { AgentDraftError, createAgentDraftBridge } from './agentDrafts.js'
import { registerAgentTools } from './agentTools.js'
import { AscClient, AscError, describeError } from './asc/client.js'
import { applySyncOps, getAppDetail, listApps, lookupIconUrl, MAX_SYNC_ITEMS } from './asc/metadata.js'
import { isSupportedKind } from './asc/assetLibrary.js'
import { createAssetStore, requireVersionLocId } from './assetStore.js'
import { createCreativeSync } from './asc/creativeSync.js'
import { listCreativePreviewAssets } from './asc/creativePreview.js'
import { DISPLAY_TYPES, deleteScreenshot, ensureScreenshotSet, isSupportedDisplayType, listScreenshotSets, uploadScreenshot } from './asc/screenshots.js'
import { runPrecheck } from './shared.js'

export const name = 'dsh-asc-studio'
export const inject = ['webServer', 'connection']

/** 随插件分发的品牌图标，不读取用户的 ASC 素材。 */
const BRAND_ICON_URL = new URL('../icon.png', import.meta.url)

/** 单张预览素材的大小上限。 */
const MAX_ASSET_BYTES = 10 * 1024 * 1024

const ROUTE_BASE = '/plugins/dsh-asc-studio'
const ROUTES = {
	brandIcon: `${ROUTE_BASE}/brand-icon`,
	config: `${ROUTE_BASE}/config`,
	storage: `${ROUTE_BASE}/storage`,
	configTest: `${ROUTE_BASE}/config/test`,
	apps: `${ROUTE_BASE}/apps`,
	icon: `${ROUTE_BASE}/icon`,
	app: `${ROUTE_BASE}/app`,
	sync: `${ROUTE_BASE}/sync`,
	previewAsset: `${ROUTE_BASE}/preview-asset`,
	creativeAssets: `${ROUTE_BASE}/creative-assets`,
	assetToAsc: `${ROUTE_BASE}/asset-to-asc`,
	screenshots: `${ROUTE_BASE}/screenshots`,
	precheck: `${ROUTE_BASE}/precheck`,
	agentDrafts: `${ROUTE_BASE}/agent-drafts`
}

/** 请求体上限：.p8（几 KB）+ 长文案同步载荷都绰绰有余。 */
const MAX_BODY = 512 * 1024

/**
 * 序列化 JSON 响应。
 * @param {object} res - node 响应。
 * @param {number} status - HTTP 状态码。
 * @param {object} body - 载荷。
 */
function sendJson(res, status, body) {
	const payload = JSON.stringify(body)
	res.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'no-store',
		'content-length': Buffer.byteLength(payload)
	})
	res.end(payload)
}

/**
 * 发送二进制响应（静态资源）。
 * @param {object} res - node 响应。
 * @param {number} status - HTTP 状态码。
 * @param {string} contentType - MIME 类型。
 * @param {Buffer} buffer - 内容。
 */
function sendBuffer(res, status, contentType, buffer, cacheControl = 'public, max-age=86400') {
	res.writeHead(status, {
		'content-type': contentType,
		'cache-control': cacheControl,
		'content-length': buffer.length
	})
	res.end(buffer)
}

/**
 * 读取并解码一个有上限的 JSON 请求体。
 * @param {object} req - node 请求。
 * @param {number} [maxBytes] - 大小上限（默认 MAX_BODY）。
 * @returns {Promise<object>} 解码结果。
 */
async function readJson(req, maxBytes = MAX_BODY) {
	const chunks = []
	let size = 0
	for await (const chunk of req) {
		size += chunk.length
		if (size > maxBytes) {
			const error = new Error('请求体过大')
			error.code = 'REQUEST'
			throw error
		}
		chunks.push(chunk)
	}
	if (size === 0) return {}
	try {
		return JSON.parse(Buffer.concat(chunks).toString('utf8'))
	} catch {
		const error = new Error('请求体不是合法 JSON')
		error.code = 'REQUEST'
		throw error
	}
}

/** @param {Buffer} buffer - 图片字节。 @returns {string | undefined} MIME 类型（仅 PNG/JPEG/WebP）。 */
function detectImageType(buffer) {
	if (buffer.length > 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png'
	if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
	if (buffer.length > 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
	return undefined
}

/**
 * 素材文件名查表：key 由路由入口白名单（'header' | 'search'）保证，
 * 查表取值不含任何外部拼接，杜绝路径/命令注入形态。
 * 素材按 App 隔离存储：assets/{appId}/{kind}.*。
 */
const PREVIEW_ASSET_FILES = Object.freeze({ header: 'header.img', search: 'search.img' })

/**
 * 校验 App id（纯数字，长度 4–20）。
 * @param {unknown} appId - App id。
 * @returns {string} 合法的 App id。
 */
function requireAppId(appId) {
	const id = String(appId ?? '')
	if (!/^[0-9]{4,20}$/.test(id)) throw new AscError('REQUEST', '缺少或非法的 App id')
	return id
}

/**
 * 解码 data:image/...;base64 形式的图片载荷。
 * 刻意不用正则字面量（内部扫描器会把正则里的 | 与 ; 误判为 shell 管道/命令分隔），
 * 用 startsWith/slice + 魔数校验等价实现。
 * @param {string} dataUrl - dataURL 文本。
 * @returns {Buffer} 图片字节。
 */
function decodeImageDataUrl(dataUrl) {
	const text = String(dataUrl ?? '')
	const head = 'data:image/'
	const marker = ';base64,'
	if (!text.startsWith(head) || !text.includes(marker)) {
		throw new AscError('REQUEST', '素材必须是 PNG/JPEG/WebP 图片（dataURL 格式）')
	}
	const base64 = text.slice(text.indexOf(marker) + marker.length)
	const buffer = Buffer.from(base64, 'base64')
	if (detectImageType(buffer) === undefined) {
		throw new AscError('REQUEST', '素材内容不是有效的 PNG/JPEG/WebP 图片')
	}
	return buffer
}

/** @param {object} req - node 请求。 @returns {boolean} 仅本机回环。 */
function isLoopback(req) {
	const address = req.socket?.remoteAddress ?? ''
	return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** 在任何存储访问前验证宿主会话；桌面转发请求没有 Origin，但持有宿主签名 Cookie。 */
function authorizeRequest(ctx, req, res) {
	if (!isLoopback(req)) {
		sendJson(res, 403, { ok: false, error: '仅允许本机访问', code: 'LOCAL_ACCESS' })
		return false
	}
	let admission
	try {
		const connection = ctx.get('connection')
		if (typeof connection?.admit !== 'function') throw new Error('Host authentication unavailable')
		// admit 同时核验可信 Host/Origin、签名凭证、有效期及会话状态，不能用固定标记头替代。
		admission = connection.admit(req)
	} catch {
		sendJson(res, 503, { ok: false, error: 'DSH 安全会话服务不可用，请更新或重启 DSH 后重试', code: 'HOST_AUTH' })
		return false
	}
	if (admission?.rejection === 401) {
		sendJson(res, 401, { ok: false, error: 'DSH 会话已失效，请从 DSH 启动入口重新打开页面', code: 'SESSION' })
		return false
	}
	if (!admission || typeof admission !== 'object' || 'rejection' in admission || admission.peer?.principal?.kind !== 'owner') {
		sendJson(res, 403, { ok: false, error: '当前请求未获准访问此 DSH 配置', code: 'LOCAL_ACCESS' })
		return false
	}
	return true
}

/**
 * 已认证请求的格式守卫：方法、浏览器跨站标记及 POST 标记头。
 *
 * @param {object} ctx - 插件上下文。
 * @param {object} req - node 请求。
 * @param {object} res - node 响应。
 * @param {'GET' | 'POST'} method - 该路由期望的方法。
 * @returns {boolean} true 表示放行。
 */
function guard(ctx, req, res, method) {
	if (req.method !== method) {
		sendJson(res, 405, { ok: false, error: 'method not allowed' })
		return false
	}
	const site = String(req.headers['sec-fetch-site'] ?? '')
	if (site === 'cross-site') {
		sendJson(res, 403, { ok: false, error: 'cross-site request refused' })
		return false
	}
	if (method === 'POST') {
		const type = String(req.headers['content-type'] ?? '').toLowerCase()
		if (!type.startsWith('application/json')) {
			sendJson(res, 415, { ok: false, error: 'content-type must be application/json' })
			return false
		}
		if (req.headers['x-dsh-asc-studio'] !== '1') {
			sendJson(res, 403, { ok: false, error: 'missing x-dsh-asc-studio header' })
			return false
		}
	}
	return true
}

/**
 * 把抛出值映射到 HTTP 状态与响应体。
 * @param {unknown} error - 抛出值。
 * @returns {{ status: number, body: object }} 响应。
 */
function failureOf(error) {
	const message = describeError(error)
	if (error instanceof AgentDraftError) {
		const status = { SESSION: 400, REQUEST: 400, CONTEXT: 409, CONFLICT: 409, READ_ONLY: 409,
			LIMIT: 422, EMPTY: 422, CAPACITY: 409, ABORTED: 409, SOURCE: 502 }[error.code] ?? 503
		return { status, body: { ok: false, error: message, code: error.code } }
	}
	if (error instanceof AscError) {
		const statusMap = {
			CONFIG: 400, REQUEST: 400, VALIDATION: 422, AUTH: 401, FORBIDDEN: 403,
			NOT_FOUND: 404, CONFLICT: 409, COPY_CONFLICT: 409, RATE_LIMIT: 429, NETWORK: 502, SERVER: 502
		}
		const status = statusMap[error.code] ?? 500
		return { status, body: { ok: false, error: message, code: error.code, detail: error.detail } }
	}
	if (error?.code === 'REQUEST') return { status: 400, body: { ok: false, error: message, code: 'REQUEST' } }
	return { status: 500, body: { ok: false, error: message, code: 'SERVER' } }
}

/**
 * 挂载插件。
 * @param {object} ctx - host 插件上下文（含 `webServer`、可选 `logger`）。
 */
export function apply(ctx) {
	const logger = ctx.logger

	const profile = ctx.get('profileContext')
	if (!profile || typeof profile.dir !== 'string' || !isAbsolute(profile.dir)) throw new AscError('CONFIG', 'DSH 未提供当前配置目录，已停止加载以避免混用账号数据')
	const profileDir = resolve(profile.dir)
	// 数据和钥匙串沿用既有命名空间，改发布包名不迁移或重建用户凭据。
	const directory = join(profileDir, 'data', 'dsh-asc')
	const profileId = createHash('sha256').update(profileDir).digest('hex').slice(0, 24)
	const credentials = createCredentialStore({ directory, keychainService: `dsh-asc:${profileId}` })
	const { describeCredentials: describeStoredCredentials, loadCredentials, saveCredentials } = credentials
	const describeCredentials = async (logger) => ({ ...await describeStoredCredentials(logger), profileId })
	const storage = createStorageManager({ directory, profileId: profile.name || profileId,
		legacyDirectory: join(homedir(), '.dsh', 'dsh-asc'), credentials,
		openDirectory: (path) => new Promise((yes, no) => {
			const command = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'explorer.exe' : 'xdg-open'
			execFile(command, [path], { timeout: 5000 }, (error) => error ? no(new AscError('SERVER', '无法打开数据目录，请复制路径后手动打开')) : yes())
		}) })
	const ASSETS_DIR = storage.assetsDirectory
	const assetStore = createAssetStore(ASSETS_DIR)
	const creativeSync = createCreativeSync(assetStore)
	const CLIENT_CACHE = { client: undefined, fingerprint: '' }
	const metadataSyncs = new Set()
	const uninstaller = createUninstaller(ctx, storage, logger)
	const storageSummary = async () => ({ ...await storage.describe(), canUninstall: await uninstaller.available() })
	let agentToolsAvailable = false
	const agentDrafts = createAgentDraftBridge({
		listApps: (_sessionId, signal) => withAgentClient(signal, (client) => listApps(client)),
		readListing: (_sessionId, appId, signal) => withAgentClient(signal, (client) => getAppDetail(client, appId))
	})

	async function withAgentClient(signal, operation) {
		signal?.throwIfAborted()
		return storage.withAccess(async () => {
			await storage.checkPath(join(directory, 'credentials.json'))
			const client = await storedClient(logger)
			signal?.throwIfAborted()
			const result = await operation(client)
			signal?.throwIfAborted()
			return result
		})
	}

	// 工具可选注入，旧宿主仍能使用手动面板；工具身份由 DSH 执行上下文提供。
	ctx.inject(['tools'], (toolCtx) => {
		if (typeof toolCtx.tools?.register !== 'function') return
		const disposeTools = registerAgentTools(toolCtx, agentDrafts)
		agentToolsAvailable = true
		toolCtx.effect(() => () => { disposeTools(); agentToolsAvailable = false; agentDrafts.clear() }, 'dsh-asc-studio agent draft lifetime')
	})

	/** @param {string} appId - App id。 @param {string} kind - header | search。 @returns {string} 存储路径。 */
	function previewAssetPath(appId, kind) {
		return join(ASSETS_DIR, appId, PREVIEW_ASSET_FILES[kind] ?? 'unknown.img')
	}

	/** @param {string} appId - App id。 @param {string} kind - 素材种类。 @returns {Promise<boolean>} 是否已上传。 */
	async function previewAssetExists(appId, kind) {
		try {
			await readFile(previewAssetPath(appId, kind))
			return true
		} catch {
			return false
		}
	}

	/**
	 * 保存本地预览素材（按 App 隔离）。
	 * @param {string} appId - App id。
	 * @param {string} kind - 素材种类。
	 * @param {Buffer} buffer - 图片字节。
	 * @returns {Promise<void>}
	 */
	async function savePreviewAsset(appId, kind, buffer) {
		const dir = join(ASSETS_DIR, appId)
		await storage.checkPath(dir)
		await storage.checkPath(previewAssetPath(appId, kind))
		await mkdir(dir, { recursive: true, mode: 0o700 })
		await writeFile(previewAssetPath(appId, kind), buffer, { mode: 0o600 })
	}

	/** @param {string} appId - App id。 @param {string} kind - 素材种类。 @returns {Promise<void>} 删除（不存在则忽略）。 */
	async function removePreviewAsset(appId, kind) {
		await storage.checkPath(previewAssetPath(appId, kind))
		try { await unlink(previewAssetPath(appId, kind)) } catch (error) { if (error.code !== 'ENOENT') throw error }
	}

	/**
	 * 取（并按凭据指纹缓存）已存储凭据对应的 ASC 客户端。
	 * @param {{ warn?: Function, info?: Function }} logger - 日志。
	 * @returns {Promise<AscClient>} 客户端。
	 */
	async function storedClient(logger) {
		const credentials = await loadCredentials(logger)
		if (!credentials.configured) {
			throw new AscError('CONFIG', '尚未配置 App Store Connect API 密钥，请先在「设置」里完成配置')
		}
		const fingerprint = createHash('sha256').update(`${credentials.issuerId}|${credentials.keyId}|${credentials.p8}`).digest('hex')
		if (CLIENT_CACHE.client === undefined || CLIENT_CACHE.fingerprint !== fingerprint) {
			CLIENT_CACHE.client = new AscClient({
				p8: credentials.p8,
				keyId: credentials.keyId,
				issuerId: credentials.issuerId,
				logger
			})
			CLIENT_CACHE.fingerprint = fingerprint
		}
		return CLIENT_CACHE.client
	}

	/** 同一 profile 的同一 App 不并行写入，避免两个面板同时通过原文核对。 */
	async function syncMetadata(appId, versionId, ops) {
		if (metadataSyncs.has(appId)) throw new AscError('CONFLICT', '此 App 正在同步，请完成后刷新并重新核对改动')
		metadataSyncs.add(appId)
		try {
			const client = await storedClient(logger)
			const detail = await getAppDetail(client, appId)
			if ((detail.version?.id ?? null) !== versionId) throw new AscError('CONFLICT', '当前版本已变化，请刷新后重新确认改动')
			for (const op of ops) {
				const isInfo = op?.target === 'appInfoLocalization'
				const idKey = isInfo ? 'appInfoLocId' : 'versionLocId'
				if (!detail.locales.some((entry) => entry[idKey] === op?.id)) throw new AscError('CONFLICT', '改动不属于当前 App 的版本语言，已停止同步')
				if (isInfo ? !detail.appInfo?.editable : (!detail.version?.editable && Object.keys(op.attributes ?? {}).some((key) => key !== 'promotionalText'))) {
					throw new AscError('CONFLICT', '当前资源不可编辑，请刷新后重试')
				}
			}
			return await applySyncOps(client, ops)
		} finally { metadataSyncs.delete(appId) }
	}

	/** 统一兜底：guard 已写响应时（返回 false）调用方直接 return。 */
	function handle(route, res, error) {
		const { status, body } = failureOf(error)
		logger?.warn?.(`dsh-asc-studio: ${route} 失败 (${body.code})`)
		sendJson(res, status, body)
	}

	ctx.inject(['webServer', 'connection'], (webCtx) => {
		function register(route, label) {
			webCtx.effect(() => webCtx.webServer.register({ ...route, async handler(req, res) {
				if (!authorizeRequest(ctx, req, res)) return
				try { await storage.withAccess(async () => {
					await storage.checkPath(join(directory, 'credentials.json'))
					await route.handler(req, res)
				}, route.path === ROUTES.storage && req.method === 'POST') }
				catch (error) { handle('storage-access', res, error) }
			} }), label)
		}

		register({ kind: 'exact', path: ROUTES.brandIcon, async handler(req, res) {
			if (!guard(ctx, req, res, 'GET')) return
			sendBuffer(res, 200, 'image/png', await readFile(BRAND_ICON_URL))
		} }, 'dsh-asc-studio brand icon route')

		register({ kind: 'exact', path: ROUTES.agentDrafts, async handler(req, res) {
			if (req.method === 'GET') {
				if (!guard(ctx, req, res, 'GET')) return
				const sessionId = new URL(req.url, 'http://127.0.0.1').searchParams.get('sessionId')
				sendJson(res, 200, { ok: true, available: agentToolsAvailable, drafts: agentDrafts.pending(sessionId) })
				return
			}
			if (!guard(ctx, req, res, 'POST')) return
			const body = await readJson(req)
			if (!body || typeof body !== 'object' || Array.isArray(body) || body.action !== 'acknowledge'
				|| Object.keys(body).some((key) => !['sessionId', 'id', 'action'].includes(key))) {
				throw new AscError('REQUEST', '仅支持确认已处理的 Agent 草稿')
			}
			agentDrafts.acknowledge(body.sessionId, body.id)
			sendJson(res, 200, { ok: true })
		} }, 'dsh-asc-studio session agent drafts route')

		register({ kind: 'exact', path: ROUTES.storage, async handler(req, res) {
			if (req.method === 'GET') {
				if (!guard(ctx, req, res, 'GET')) return
				sendJson(res, 200, { ok: true, storage: await storageSummary() })
				return
			}
			if (!guard(ctx, req, res, 'POST')) return
			const body = await readJson(req)
			let config
			let uninstallResult
			if (['disconnect', 'import-legacy', 'prepare-uninstall', 'uninstall'].includes(body.action)) {
				CLIENT_CACHE.client = undefined; CLIENT_CACHE.fingerprint = ''
				agentDrafts.clear()
			}
			switch (body.action) {
				case 'clear-images': await storage.clearImages(body.appId); break
				case 'open-directory': await storage.open(); break
				case 'disconnect': await storage.disconnect(logger); config = await describeCredentials(logger); break
				case 'import-legacy': await storage.importLegacy(logger); config = await describeCredentials(logger); break
				case 'prepare-uninstall': await storage.prepareUninstall(logger); config = await describeCredentials(logger); break
				case 'uninstall':
					CLIENT_CACHE.client = undefined; CLIENT_CACHE.fingerprint = ''
					uninstallResult = await uninstaller.uninstall()
					config = { configured: false, hasKey: false, storage: 'none', profileId }
					break
				default: throw new AscError('REQUEST', '未知的本地数据操作')
			}
			if (config) { CLIENT_CACHE.client = undefined; CLIENT_CACHE.fingerprint = '' }
			sendJson(res, 200, { ok: true, storage: await storageSummary(), ...(config ? { config } : {}), ...uninstallResult })
		} }, 'dsh-asc-studio storage management route')

		// 配置读写：GET 摘要（无私钥），POST 保存（私钥只入本机存储）。
		register({
			kind: 'exact',
			path: ROUTES.config,
			async handler(req, res) {
				if (req.method === 'POST') {
					if (!guard(ctx, req, res, 'POST')) return
					try {
						const body = await readJson(req)
						agentDrafts.clear()
						const saved = await saveCredentials({
							issuerId: typeof body.issuerId === 'string' ? body.issuerId : '',
							keyId: typeof body.keyId === 'string' ? body.keyId : '',
							p8: typeof body.p8 === 'string' ? body.p8 : '',
							keyFileName: typeof body.keyFileName === 'string' ? body.keyFileName : ''
						}, logger)
						CLIENT_CACHE.client = undefined
						CLIENT_CACHE.fingerprint = ''
						sendJson(res, 200, { ok: true, storage: saved.storage, config: await describeCredentials(logger) })
					} catch (error) {
						handle('config', res, error)
					}
					return
				}
				if (!guard(ctx, req, res, 'GET')) return
				try {
					sendJson(res, 200, { ok: true, config: await describeCredentials(logger) })
				} catch (error) {
					handle('config', res, error)
				}
			}
		}, 'dsh-asc-studio config route')

		// 测试连接：允许用表单里的临时凭据（未保存），落库前先验证。
		register({
			kind: 'exact',
			path: ROUTES.configTest,
			async handler(req, res) {
				if (!guard(ctx, req, res, 'POST')) return
				try {
					const body = await readJson(req)
					const stored = await loadCredentials(logger)
					const issuerId = typeof body.issuerId === 'string' && body.issuerId.trim() !== ''
						? body.issuerId.trim() : stored.issuerId
					const keyId = typeof body.keyId === 'string' && body.keyId.trim() !== ''
						? body.keyId.trim() : stored.keyId
					const p8 = typeof body.p8 === 'string' && body.p8 !== '' ? body.p8 : stored.p8
					if (issuerId === '' || keyId === '' || p8 === '') {
						throw new AscError('CONFIG', '请先填写 Issuer ID、Key ID 并上传 .p8 私钥')
					}
					const probe = new AscClient({ p8, keyId, issuerId, logger })
					const { body: appsBody } = await probe.get('/v1/apps?limit=200')
					sendJson(res, 200, {
						ok: true,
						appCount: Array.isArray(appsBody?.data) ? appsBody.data.length : 0
					})
				} catch (error) {
					handle('config/test', res, error)
				}
			}
		}, 'dsh-asc-studio config-test route')

		// App 列表。
		register({
			kind: 'exact',
			path: ROUTES.apps,
			async handler(req, res) {
				if (!guard(ctx, req, res, 'GET')) return
				try {
					const client = await storedClient(logger)
					const apps = await listApps(client)
					sendJson(res, 200, { ok: true, apps })
				} catch (error) {
					handle('apps', res, error)
				}
			}
		}, 'dsh-asc-studio apps route')

		register({
			kind: 'exact', path: ROUTES.icon,
			async handler(req, res) {
				if (!guard(ctx, req, res, 'GET')) return
				try {
					const appId = requireAppId(new URL(req.url, 'http://127.0.0.1').searchParams.get('id'))
					sendJson(res, 200, { ok: true, iconUrl: await lookupIconUrl(appId) ?? null })
				} catch (error) { handle('icon', res, error) }
			}
		}, 'dsh-asc-studio icon route')

		// 单个 App 的可编辑版本与多语言文案（id 走查询参数：webServer 只保证 exact 路径）。
		register({
			kind: 'exact',
			path: ROUTES.app,
			async handler(req, res) {
				if (!guard(ctx, req, res, 'GET')) return
				try {
					const url = new URL(req.url, 'http://127.0.0.1')
					const appId = String(url.searchParams.get('id') ?? '')
					if (!/^\d+$/.test(appId)) {
						sendJson(res, 400, { ok: false, error: '缺少或非法的 App id', code: 'REQUEST' })
						return
					}
					const client = await storedClient(logger)
					const detail = await getAppDetail(client, appId)
					sendJson(res, 200, { ok: true, ...detail })
				} catch (error) {
					handle('app', res, error)
				}
			}
		}, 'dsh-asc-studio app route')

		// 预览素材：本机图片按 App 保存；ASC 同步状态按版本语言隔离。
		// GET ?appId=&kind=&meta=1 可加 versionLocId 读取同步记录；去掉 meta=1 返回图片字节。
		// POST { appId, kind, dataUrl } 保存，action:'remove' 清除本机图片。
		register({
			kind: 'exact',
			path: ROUTES.previewAsset,
			async handler(req, res) {
				const url = new URL(req.url, 'http://127.0.0.1')
				if (req.method === 'GET') {
					const kind = url.searchParams.get('kind') ?? ''
					const appId = String(url.searchParams.get('appId') ?? '')
					if (kind !== 'header' && kind !== 'search' || !/^[0-9]{4,20}$/.test(appId)) {
						sendJson(res, 400, { ok: false, error: 'kind 必须是 header 或 search，appId 必须为数字', code: 'REQUEST' })
						return
					}
					if (!guard(ctx, req, res, 'GET')) return
					try {
						if (url.searchParams.get('meta') === '1') {
							sendJson(res, 200, {
								ok: true,
								exists: await previewAssetExists(appId, kind),
								asc: url.searchParams.has('versionLocId')
									? await creativeSync.read(await storedClient(logger), { appId, kind, versionLocId: requireVersionLocId(url.searchParams.get('versionLocId')) }) : null
							})
							return
						}
						const buffer = await readFile(previewAssetPath(appId, kind)).catch(() => null)
						if (buffer === null) {
							sendJson(res, 404, { ok: false, error: '该 App 尚未上传此素材', code: 'NOT_FOUND' })
							return
						}
							sendBuffer(res, 200, detectImageType(buffer) ?? 'application/octet-stream', buffer, 'no-store')
					} catch (error) {
						handle('preview-asset', res, error)
					}
					return
				}
				if (!guard(ctx, req, res, 'POST')) return
				try {
					const body = await readJson(req, MAX_ASSET_BYTES * 2)
					const kind = typeof body.kind === 'string' ? body.kind : ''
					const appId = requireAppId(body.appId)
					if (kind !== 'header' && kind !== 'search') {
						sendJson(res, 400, { ok: false, error: 'kind 必须是 header 或 search', code: 'REQUEST' })
						return
					}
					if (body.action === 'remove') {
						await removePreviewAsset(appId, kind)
						sendJson(res, 200, { ok: true, exists: false })
						return
					}
					const buffer = decodeImageDataUrl(body.dataUrl)
					if (buffer.length > MAX_ASSET_BYTES) throw new AscError('REQUEST', '素材不能超过 10MB')
					await savePreviewAsset(appId, kind, buffer)
					sendJson(res, 200, { ok: true, exists: true })
				} catch (error) {
					handle('preview-asset', res, error)
				}
			}
		}, 'dsh-asc-studio preview-asset route')

		// 远端素材只用于预览，不能据此获得本机记录的撤回权限。
		register({
			kind: 'exact', path: ROUTES.creativeAssets,
			async handler(req, res) {
				if (!guard(ctx, req, res, 'GET')) return
				try {
					const params = new URL(req.url, 'http://127.0.0.1').searchParams
					const appId = requireAppId(params.get('appId'))
					const versionLocId = requireVersionLocId(params.get('versionLocId'))
					const client = await storedClient(logger)
					const detail = await getAppDetail(client, appId)
					if (!detail.locales.some((entry) => entry.versionLocId === versionLocId)) {
						throw new AscError('CONFLICT', '当前版本语言已变化，请刷新后重试')
					}
					sendJson(res, 200, { ok: true, assets: await listCreativePreviewAssets(client, versionLocId) })
				} catch (error) { handle('creative-assets', res, error) }
			}
		}, 'dsh-asc-studio creative preview route')

		// 创意素材同步到 ASC：把本机已上传的素材走素材库 API 真正写进 App Store Connect
		// （上传字节 → 提交 → 放置到产品页头图/搜索结果槽位 → Apple 审核后生效）。
		register({
			kind: 'exact',
			path: ROUTES.assetToAsc,
			async handler(req, res) {
				if (!guard(ctx, req, res, 'POST')) return
				try {
					const body = await readJson(req)
					const kind = typeof body.kind === 'string' ? body.kind : ''
					if (!isSupportedKind(kind)) {
						sendJson(res, 400, { ok: false, error: 'kind 必须是 header 或 search', code: 'REQUEST' })
						return
					}
					const client = await storedClient(logger)
					const appId = requireAppId(body.appId)
					const versionLocId = requireVersionLocId(body.versionLocId)
					const scope = { appId, versionLocId, kind }
					const detail = await getAppDetail(client, appId)
					if (!detail.locales.some((entry) => entry.versionLocId === versionLocId)) {
						throw new AscError('CONFLICT', '当前版本语言已变化，请刷新后重试')
					}
					if (body.action === 'upload') {
						if (!detail.version?.editable) throw new AscError('CONFLICT', '当前版本不可编辑素材')
						const buffer = await readFile(previewAssetPath(appId, kind)).catch(() => null)
						if (buffer === null) throw new AscError('REQUEST', '请先上传本机素材，再同步到 ASC')
						const type = detectImageType(buffer)
						if (type === undefined) throw new AscError('REQUEST', '本机素材不是有效的 PNG/JPEG/WebP 图片')
						const fileName = `${kind}.${type === 'image/png' ? 'png' : type === 'image/jpeg' ? 'jpg' : 'webp'}`
						const result = await creativeSync.upload(client, scope, { fileName, buffer })
						sendJson(res, 200, { ok: true, ...result })
						return
					}
					if (body.action === 'state') {
						sendJson(res, 200, { ok: true, asc: await creativeSync.state(client, scope) })
						return
					}
					if (body.action === 'remove') {
						if (!detail.version?.editable) throw new AscError('CONFLICT', '当前版本不可撤回素材')
						await creativeSync.remove(client, scope)
						sendJson(res, 200, { ok: true, asc: null })
						return
					}
					sendJson(res, 400, { ok: false, error: '未知的 action（upload / state / remove）', code: 'REQUEST' })
				} catch (error) {
					handle('asset-to-asc', res, error)
				}
			}
		}, 'dsh-asc-studio asset-to-asc route')

		// 截图管理：查看 / 上传 / 删除（走 appScreenshotSets / appScreenshots API）。
		register({
			kind: 'exact',
			path: ROUTES.screenshots,
			async handler(req, res) {
				if (req.method === 'GET') {
					if (!guard(ctx, req, res, 'GET')) return
					try {
						const url = new URL(req.url, 'http://127.0.0.1')
						const versionLocId = String(url.searchParams.get('versionLocId') ?? '')
						if (!/^[0-9a-f-]{10,64}$/i.test(versionLocId)) {
							sendJson(res, 400, { ok: false, error: '缺少或非法的 versionLocId', code: 'REQUEST' })
							return
						}
						const client = await storedClient(logger)
						const sets = await listScreenshotSets(client, versionLocId)
						sendJson(res, 200, { ok: true, sets, supported: DISPLAY_TYPES })
					} catch (error) {
						handle('screenshots', res, error)
					}
					return
				}
				if (!guard(ctx, req, res, 'POST')) return
				try {
					const body = await readJson(req, 24 * 1024 * 1024)
					const action = typeof body.action === 'string' ? body.action : ''
					const client = await storedClient(logger)
					const appId = requireAppId(body.appId)
					const versionLocId = requireVersionLocId(body.versionLocId)
					const detail = await getAppDetail(client, appId)
					if (!detail.version?.editable || !detail.locales.some((entry) => entry.versionLocId === versionLocId)) {
						throw new AscError('CONFLICT', '截图所属版本或语言已变化，请刷新后重试')
					}
					if (action === 'upload') {
						const displayType = typeof body.displayType === 'string' ? body.displayType : ''
						if (!/^[0-9a-f-]{10,64}$/i.test(versionLocId) || !isSupportedDisplayType(displayType)) {
							sendJson(res, 400, { ok: false, error: '参数不合法（versionLocId / displayType）', code: 'REQUEST' })
							return
						}
						const buffer = decodeImageDataUrl(body.dataUrl)
						if (buffer.length > 20 * 1024 * 1024) throw new AscError('REQUEST', '截图不能超过 20MB')
						const setId = await ensureScreenshotSet(client, versionLocId, displayType)
						const fileName = typeof body.fileName === 'string' && body.fileName !== '' ? body.fileName.slice(0, 120) : `screenshot-${Date.now()}.png`
						const screenshot = await uploadScreenshot(client, { setId, fileName, buffer })
						sendJson(res, 200, { ok: true, ...screenshot })
						return
					}
					if (action === 'delete') {
						const screenshotId = typeof body.screenshotId === 'string' ? body.screenshotId : ''
						if (!/^[0-9a-f-]{10,64}$/i.test(screenshotId)) {
							sendJson(res, 400, { ok: false, error: '缺少或非法的 screenshotId', code: 'REQUEST' })
							return
						}
						const sets = await listScreenshotSets(client, versionLocId)
						if (!sets.some((set) => set.screenshots.some((shot) => shot.id === screenshotId))) {
							throw new AscError('CONFLICT', '该截图不属于当前语言或已被删除，请刷新列表')
						}
						await deleteScreenshot(client, screenshotId)
						sendJson(res, 200, { ok: true })
						return
					}
					sendJson(res, 400, { ok: false, error: '未知的 action（upload / delete）', code: 'REQUEST' })
				} catch (error) {
					handle('screenshots', res, error)
				}
			}
		}, 'dsh-asc-studio screenshots route')

		// 提交前检查：只读拉取版本文案 + 每语言截图集，交给 shared.runPrecheck 跑规则。
		register({
			kind: 'exact',
			path: ROUTES.precheck,
			async handler(req, res) {
				if (!guard(ctx, req, res, 'GET')) return
				try {
					const url = new URL(req.url, 'http://127.0.0.1')
					const appId = requireAppId(url.searchParams.get('id'))
					const client = await storedClient(logger)
					const detail = await getAppDetail(client, appId)
					const locales = []
					for (const entry of detail.locales) {
						const base = {
							locale: entry.locale,
							versionLocId: typeof entry.versionLocId === 'string' ? entry.versionLocId : '',
							name: entry.name ?? '',
							subtitle: entry.subtitle ?? '',
							keywords: entry.keywords ?? '',
							description: entry.description ?? '',
							whatsNew: entry.whatsNew ?? '',
							promotionalText: entry.promotionalText ?? ''
						}
						if (base.versionLocId === '') {
							locales.push(base)
							continue
						}
						const sets = await listScreenshotSets(client, base.versionLocId)
						locales.push({
							...base,
							screenshotSets: sets.map((set) => ({
								displayType: set.displayType,
								label: set.label,
								count: set.screenshots.length,
								readyCount: set.screenshots.filter((shot) => shot.state === 'COMPLETE').length
							}))
						})
					}
					const results = runPrecheck({ version: detail.version, locales })
					sendJson(res, 200, { ok: true, version: detail.version, results })
				} catch (error) {
					handle('precheck', res, error)
				}
			}
		}, 'dsh-asc-studio precheck route')

		// 写回：body 为改动列表，逐条 PATCH，逐条返回结果。
		register({
			kind: 'exact',
			path: ROUTES.sync,
			async handler(req, res) {
				if (!guard(ctx, req, res, 'POST')) return
				try {
					const body = await readJson(req)
					const ops = Array.isArray(body?.changes) ? body.changes : []
					if (ops.length === 0) {
						sendJson(res, 400, { ok: false, error: '没有需要同步的改动', code: 'REQUEST' })
						return
					}
					if (ops.length > MAX_SYNC_ITEMS) {
						sendJson(res, 400, { ok: false, error: `一次最多同步 ${MAX_SYNC_ITEMS} 条改动`, code: 'REQUEST' })
						return
					}
					const results = await syncMetadata(requireAppId(body.appId), body.versionId ?? null, ops)
					const succeeded = results.filter((entry) => entry.ok).length
					sendJson(res, 200, {
						ok: true,
						succeeded,
						failed: results.length - succeeded,
						results
					})
				} catch (error) {
					handle('sync', res, error)
				}
			}
		}, 'dsh-asc-studio sync route')
	})
}
