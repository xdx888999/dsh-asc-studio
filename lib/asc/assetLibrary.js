/**
 * 创意素材 → App Store Connect 素材库的完整上传链路。
 *
 * 对应官方 API（v4.5+）：
 *  1. GET  /v1/apps/{id}/assetLibrary                      → 素材库 id
 *  2. POST /v1/appAssetLibraryImages                       → 建上传任务（AWAITING_UPLOAD + uploadOperations）
 *  3. PUT  uploadOperations[].url（预签名直传，带 requestHeaders）
 *  4. PATCH /v1/appAssetLibraryImages/{id} { uploaded:true } → 提交字节
 *  5. POST /v1/appAssetLibraryPlacements                   → 放置到产品页头图 / 搜索结果槽位
 *
 * 图片处理完成后绑定版本语言，槽位随父版本审核和发布。
 *
 * @module dsh-asc-studio/asc/assetLibrary
 */

import { AscError, uploadViaPresignedUrl } from './client.js'

/**
 * ASC 资源 id 白名单净化（仅保留 UUID/数字字符），同时切断外部输入到 API 调用的污点链。
 * @param {unknown} value - 任意输入。
 * @returns {string} 净化后的 id。
 */
function safeResourceId(value) {
	return String(value ?? '').replace(/[^0-9a-zA-Z-]/g, '')
}

/** 预览 kind → ASC 槽位类型。 */
export const PLACEMENT_TYPES = Object.freeze({
	header: 'PRODUCT_PAGE_HEADER_ASSET',
	search: 'APP_STORE_SEARCH_RESULTS_ASSET'
})

/** @param {string} kind - header | search。 @returns {boolean} 是否支持。 */
export function isSupportedKind(kind) {
	return kind === 'header' || kind === 'search'
}

/**
 * 取 App 的素材库 id。
 * @param {import('./client.js').AscClient} client - API 客户端。
 * @param {string} appId - App id。
 * @returns {Promise<string>} 素材库 id。
 */
async function getLibraryId(client, appId) {
	const { body } = await client.get(`/v1/apps/${safeResourceId(appId)}/assetLibrary`)
	const id = String(body?.data?.id ?? '')
	if (id === '') {
		throw new AscError('NOT_FOUND', '该 App 没有素材库，请先在 ASC 后台打开过「产品页面信息」')
	}
	return id
}

/**
 * 上传一张创意素材到素材库（建任务 → 直传字节 → 提交）。
 * @param {import('./client.js').AscClient} client - API 客户端。
 * @param {object} options - 上传参数。
 * @param {string} options.appId - App id。
 * @param {string} options.fileName - 文件名（如 header.png）。
 * @param {Buffer} options.buffer - 图片字节。
 * @param {Function} [options.onReserved] - 预留图片后持久化其 id，用于失败恢复。
 * @returns {Promise<{ imageId: string, state: string }>} 素材 id 与状态。
 */
export async function uploadCreativeAsset(client, { appId, fileName, buffer, onReserved }) {
	const libraryId = await getLibraryId(client, appId)
	const create = await client.post('/v1/appAssetLibraryImages', {
		data: {
			type: 'appAssetLibraryImages',
			attributes: {
				fileName,
				fileSize: buffer.length,
				category: 'CREATIVE_ASSETS'
			},
			relationships: {
				assetLibrary: { data: { type: 'appAssetLibraries', id: safeResourceId(libraryId) } }
			}
		}
	})
	const data = create.body?.data
	const imageId = String(data?.id ?? '')
	const operations = data?.attributes?.uploadOperations
	if (imageId !== '') await onReserved?.(imageId)
	if (imageId === '' || !Array.isArray(operations) || operations.length === 0) {
		throw new AscError('SERVER', '创建素材上传任务失败：Apple 未返回 uploadOperations')
	}
	for (const op of operations) {
		const offset = Number.isFinite(op?.offset) ? op.offset : 0
		const length = Number.isFinite(op?.length) ? op.length : buffer.length
		await uploadViaPresignedUrl(op, buffer.subarray(offset, offset + length))
	}
	await client.patch(`/v1/appAssetLibraryImages/${safeResourceId(imageId)}`, {
		data: { type: 'appAssetLibraryImages', id: imageId, attributes: { uploaded: true } }
	})
	return { imageId, state: 'UPLOAD_COMPLETE' }
}

/** 等待 Apple 完成处理；上传完成不代表图片已经可用。 */
export async function waitForImageReady(client, imageId, { attempts = 30, delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
	for (let index = 0; index < attempts; index += 1) {
		const result = await getImageState(client, imageId)
		if (['PREPARE_FOR_SUBMISSION', 'APPROVED', 'ACCEPTED'].includes(result.state)) return result
		if (['FAILED', 'REJECTED', 'ARCHIVED'].includes(result.state)) {
			throw new AscError('VALIDATION', `素材处理失败（${result.state}）`)
		}
		if (index + 1 < attempts) await delay(1000)
	}
	throw new AscError('SERVER', '素材仍在处理中，请稍后重试；原素材保持不变')
}

/**
 * 把已上传的素材放置到头图 / 搜索结果槽位。
 * @param {import('./client.js').AscClient} client - API 客户端。
 * @param {object} options - 放置参数。
 * @param {string} options.kind - header | search。
 * @param {string} options.imageId - 已上传素材 id。
 * @param {string} [options.versionLocId] - 绑定的版本文案本地化 id（可选）。
 * @returns {Promise<{ placementId: string, state: string }>} 槽位 id 与状态。
 */
export async function placeCreativeAsset(client, { kind, imageId, versionLocId }) {
	const placementType = PLACEMENT_TYPES[kind]
	if (placementType === undefined) {
		throw new AscError('REQUEST', `未知的素材槽位：${kind}`)
	}
	const { body } = await client.post('/v1/appAssetLibraryPlacements', {
		data: {
			type: 'appAssetLibraryPlacements',
			attributes: { placementType },
			relationships: {
				image: { data: { type: 'appAssetLibraryImages', id: safeResourceId(imageId) } },
				...(typeof versionLocId === 'string' && versionLocId !== ''
					? { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: safeResourceId(versionLocId) } } }
					: {})
			}
		}
	})
	return {
		placementId: String(body?.data?.id ?? ''),
		state: String(body?.data?.attributes?.state ?? '')
	}
}

/**
 * 查询素材当前状态（AWAITING_UPLOAD / UPLOAD_COMPLETE / WAITING_FOR_REVIEW / …）。
 * @param {import('./client.js').AscClient} client - API 客户端。
 * @param {string} imageId - 素材 id。
 * @returns {Promise<{ state: string, imageAssetUrl: string | undefined }>} 状态与（若已处理）Apple 侧图片地址。
 */
export async function getImageState(client, imageId) {
	const { body } = await client.get(`/v1/appAssetLibraryImages/${safeResourceId(imageId)}`)
	const attributes = body?.data?.attributes ?? {}
	return {
		state: String(attributes.state ?? ''),
		imageAssetUrl: typeof attributes.imageAsset?.templateUrl === 'string' ? attributes.imageAsset.templateUrl : undefined
	}
}

/**
 * 删除槽位放置（换素材 / 撤回时用）。
 * @param {import('./client.js').AscClient} client - API 客户端。
 * @param {string} placementId - 槽位 id。
 * @returns {Promise<void>}
 */
export async function deletePlacement(client, placementId) {
	await client.request('DELETE', `/v1/appAssetLibraryPlacements/${safeResourceId(placementId)}`)
}
