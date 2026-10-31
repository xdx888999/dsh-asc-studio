/**
 * 截图管理：查看 / 上传 / 删除 App Store 版本截图。
 *
 * 对应官方 API：
 *  - GET  /v1/appStoreVersionLocalizations/{id}/appScreenshotSets
 *  - GET  /v1/appScreenshotSets/{id}/appScreenshots
 *  - POST /v1/appScreenshotSets（缺少设备规格集合时补建）
 *  - POST /v1/appScreenshots（AWAITING_UPLOAD + uploadOperations → 预签名直传 → PATCH uploaded）
 *  - DELETE /v1/appScreenshots/{id}
 *
 * @module dsh-asc-studio/asc/screenshots
 */

import { createHash } from 'node:crypto'
import { AscError, uploadViaPresignedUrl } from './client.js'

/**
 * ASC 资源 id 白名单净化（仅保留 UUID/数字字符），同时切断外部输入到 API 调用的污点链。
 * @param {unknown} value - 任意输入。
 * @returns {string} 净化后的 id。
 */
function safeResourceId(value) {
	return String(value ?? '').replace(/[^0-9a-zA-Z-]/g, '')
}

/** 常用设备规格：API 枚举 → 展示名 + 可接受的像素尺寸（横竖都收）。 */
export const DISPLAY_TYPES = Object.freeze({
	APP_IPHONE_DUO: { label: 'iPhone Duo', sizes: [[1398, 2034], [2034, 1398], [2007, 2853], [2853, 2007]] },
	APP_IPHONE_67: { label: 'iPhone 6.9"/6.7"', sizes: [[1320, 2868], [1290, 2796], [1206, 2622], [1260, 2736], [2868, 1320], [2796, 1290], [2622, 1206], [2736, 1260]] },
	APP_IPHONE_65: { label: 'iPhone 6.5"', sizes: [[1284, 2778], [1242, 2688], [2778, 1284], [2688, 1242]] },
	APP_IPHONE_61: { label: 'iPhone 6.1"', sizes: [[1170, 2532], [1179, 2556], [2532, 1170], [2556, 1179]] },
	APP_IPHONE_55: { label: 'iPhone 5.5"', sizes: [[1242, 2208], [2208, 1242]] },
	APP_IPAD_PRO_3GEN_129: { label: 'iPad Pro 13"', sizes: [[2064, 2752], [2752, 2064], [2048, 2732], [2732, 2048]] },
	APP_IPAD_PRO_3GEN_11: { label: 'iPad 11"', sizes: [[1668, 2420], [1668, 2388], [1488, 2266], [1640, 2360], [2420, 1668], [2388, 1668], [2266, 1488], [2360, 1640]] }
})

/** @param {string} displayType - 设备规格枚举。 @returns {boolean} 是否受支持。 */
export function isSupportedDisplayType(displayType) {
	return Object.prototype.hasOwnProperty.call(DISPLAY_TYPES, displayType)
}

/**
 * 按图片尺寸猜测设备规格（横竖屏都接受）。
 * @param {number} width - 图片宽。
 * @param {number} height - 图片高。
 * @returns {string | undefined} 设备规格枚举，无匹配则 undefined。
 */
export function guessDisplayType(width, height) {
	for (const [key, def] of Object.entries(DISPLAY_TYPES)) {
		if (def.sizes.some(([w, h]) => w === width && h === height)) return key
	}
	return undefined
}

/**
 * 列出一个版本本地化下的全部截图集与截图。
 * @param {import('./client.js').AscClient} client - API 客户端。
 * @param {string} versionLocId - 版本文案本地化 id。
 * @returns {Promise<{ id: string, displayType: string, label: string, screenshots: object[] }[]>}
 */
export async function listScreenshotSets(client, versionLocId) {
	const { body } = await client.get(`/v1/appStoreVersionLocalizations/${safeResourceId(versionLocId)}/appScreenshotSets`)
	const sets = Array.isArray(body?.data) ? body.data : []
	const result = []
	for (const set of sets) {
		const displayType = String(set?.attributes?.screenshotDisplayType ?? '')
		const screenshotsRes = await client.get(`/v1/appScreenshotSets/${set.id}/appScreenshots`)
		const screenshots = (Array.isArray(screenshotsRes.body?.data) ? screenshotsRes.body.data : []).map((entry) => ({
			id: String(entry?.id ?? ''),
			fileName: String(entry?.attributes?.fileName ?? ''),
			fileSize: Number(entry?.attributes?.fileSize ?? 0),
			state: String(entry?.attributes?.assetDeliveryState?.state ?? ''),
			url: typeof entry?.attributes?.imageAsset?.templateUrl === 'string'
				? entry.attributes.imageAsset.templateUrl
				: undefined
		}))
		result.push({
			id: String(set?.id ?? ''),
			displayType,
			label: DISPLAY_TYPES[displayType]?.label ?? displayType,
			screenshots
		})
	}
	return result
}

/**
 * 确保某设备规格的截图集存在（不存在则创建）。
 * @param {import('./client.js').AscClient} client - API 客户端。
 * @param {string} versionLocId - 版本文案本地化 id。
 * @param {string} displayType - 设备规格枚举。
 * @returns {Promise<string>} 截图集 id。
 */
export async function ensureScreenshotSet(client, versionLocId, displayType) {
	const sets = await listScreenshotSets(client, safeResourceId(versionLocId))
	const existing = sets.find((set) => set.displayType === displayType)
	if (existing !== undefined && existing.id !== '') return existing.id
	const { body } = await client.request('POST', '/v1/appScreenshotSets', {
		data: {
			type: 'appScreenshotSets',
			attributes: { screenshotDisplayType: displayType },
			relationships: {
				appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: safeResourceId(versionLocId) } }
			}
		}
	})
	const id = String(body?.data?.id ?? '')
	if (id === '') throw new AscError('SERVER', '创建截图集失败：Apple 未返回 id')
	return id
}

/**
 * 上传一张截图（建任务 → 预签名直传 → 提交处理）。
 * @param {import('./client.js').AscClient} client - API 客户端。
 * @param {object} options - 上传参数。
 * @param {string} options.setId - 截图集 id。
 * @param {string} options.fileName - 文件名。
 * @param {Buffer} options.buffer - 图片字节。
 * @returns {Promise<{ screenshotId: string, state: string }>} 截图 id 与处理状态。
 */
export async function uploadScreenshot(client, { setId, fileName, buffer }, upload = uploadViaPresignedUrl) {
	// sourceFileChecksum 是 Apple API 契约字段（Apple 文档定义为源文件 MD5，
	// 用于上传完整性比对，非安全原语），必须按协议提供 MD5。
	const checksum = createHash('md5').update(buffer).digest('hex')
	let create
	try { create = await client.request('POST', '/v1/appScreenshots', {
		data: {
			type: 'appScreenshots',
			attributes: { fileName, fileSize: buffer.length },
			relationships: {
				appScreenshotSet: { data: { type: 'appScreenshotSets', id: safeResourceId(setId) } }
			}
		}
	}) } catch (error) {
		// 创建响应丢失时不知道资源 ID，不能凭文件名删除，也不能直接重传。
		if (['NETWORK', 'SERVER'].includes(error.code)) throw screenshotRecoveryError()
		throw error
	}
	const data = create.body?.data
	const screenshotId = String(data?.id ?? '')
	const operations = data?.attributes?.uploadOperations
	if (!/^[a-z0-9-]+$/i.test(screenshotId)) throw screenshotRecoveryError()
	const path = `/v1/appScreenshots/${screenshotId}`
	let commitAttempted = false
	try {
		if (!Array.isArray(operations) || operations.length === 0) throw new AscError('SERVER', '创建截图上传任务失败：Apple 未返回 uploadOperations')
		for (const op of operations) {
			const offset = op?.offset ?? 0
			const length = op?.length ?? buffer.length
			if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length <= 0 || offset + length > buffer.length) {
				throw new AscError('SERVER', 'Apple 返回的截图上传分片不合法')
			}
			await upload(op, buffer.subarray(offset, offset + length))
		}
		commitAttempted = true
		const patch = await client.patch(path, {
			data: { type: 'appScreenshots', id: screenshotId, attributes: { uploaded: true, sourceFileChecksum: checksum } }
		})
		return { screenshotId, state: String(patch.body?.data?.attributes?.assetDeliveryState?.state ?? 'UPLOAD_COMPLETE') }
	} catch (error) {
		if (commitAttempted) {
			let current
			try { current = (await client.get(path)).body?.data }
			catch (readError) {
				if (readError.status === 404 || readError.code === 'NOT_FOUND') throw error
				throw screenshotRecoveryError()
			}
			if (current?.id !== screenshotId || current.type !== 'appScreenshots') throw screenshotRecoveryError()
			const state = current.attributes?.assetDeliveryState?.state
			// 提交可能已成功，只是响应丢失；保留已接受的截图，不以错误响应决定删除。
			if (['UPLOAD_COMPLETE', 'COMPLETE'].includes(state) || (current.attributes?.uploaded === true && state !== 'FAILED')) {
				return { screenshotId, state: state ?? 'UPLOAD_COMPLETE' }
			}
			if (!['AWAITING_UPLOAD', 'FAILED'].includes(state)) throw screenshotRecoveryError()
		}
		try { await client.request('DELETE', path) }
		catch (cleanupError) {
			if (cleanupError.status !== 404 && cleanupError.code !== 'NOT_FOUND') throw screenshotRecoveryError()
		}
		throw error
	}
}

function screenshotRecoveryError() {
	return new AscError('SCREENSHOT_RECOVERY', '无法确认截图上传结果或完成清理。请刷新截图列表并在 ASC 核对后再上传；未完成的上传可在列表中删除。')
}

/**
 * 删除一张截图。
 * @param {import('./client.js').AscClient} client - API 客户端。
 * @param {string} screenshotId - 截图 id。
 * @returns {Promise<void>}
 */
export async function deleteScreenshot(client, screenshotId) {
	await client.request('DELETE', `/v1/appScreenshots/${safeResourceId(screenshotId)}`)
}
