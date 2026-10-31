/** 只读加载当前版本语言的创意素材；不将远端放置导入本机写入或撤回记录。 */
import { AscError, ASC_BASE_URL } from './client.js'
import { PLACEMENT_TYPES } from './assetLibrary.js'
import { URLSearchParams } from 'node:url'

const MAX_PLACEMENT_PAGES = 50
const KINDS = new Map(Object.entries(PLACEMENT_TYPES).map(([kind, type]) => [type, kind]))
const STATES_WITHOUT_IMAGE = new Set(['AWAITING_UPLOAD', 'UPLOAD_COMPLETE', 'FAILED', 'ARCHIVED'])

function resourceId(value) {
	if (typeof value !== 'string' || !/^[0-9a-z-]{1,200}$/i.test(value)) {
		throw new AscError('REQUEST', '素材资源标识不合法')
	}
	return value
}

function invalidResponse(message) {
	return new AscError('SERVER', `ASC 创意素材响应不完整：${message}`)
}

function nextPage(value, currentUrl, expectedPath) {
	let url
	try { url = new URL(value, currentUrl) } catch { throw invalidResponse('分页地址不合法') }
	if (typeof value !== 'string' || url.origin !== ASC_BASE_URL || url.pathname !== expectedPath || url.username || url.password || url.hash) {
		throw invalidResponse('分页地址不属于当前版本语言')
	}
	return url
}

async function readDeviceGroups(client) {
	const { body } = await client.get('/v1/appAssetLibraryRefData?fields%5BappAssetLibraryRefData%5D=placementProfileGroups%2CdisplayClasses')
	if (!Array.isArray(body?.data) || body.data.length === 0) throw invalidResponse('缺少设备规格数据')
	const groups = new Map(), classes = new Map()
	for (const item of body.data) {
		const attrs = item?.attributes
		if (!Array.isArray(attrs?.placementProfileGroups) || !Array.isArray(attrs?.displayClasses)) {
			throw invalidResponse('缺少设备分组或显示规格')
		}
		for (const group of attrs.placementProfileGroups) {
			if (typeof group?.placementProfileGroupId === 'string') groups.set(group.placementProfileGroupId, group)
		}
		for (const display of attrs.displayClasses) {
			if (typeof display?.displayClassId === 'string') classes.set(display.displayClassId, display)
		}
	}
	return { groups, classes }
}

/**
 * 返回当前版本语言的所有产品页头图和搜索素材，包括尚无预览 URL 的处理状态。
 * 未知设备分组仍返回原始 placementGroup，由显示层保守选择。
 */
export async function listCreativePreviewAssets(client, versionLocId) {
	const path = `/v1/appStoreVersionLocalizations/${resourceId(versionLocId)}/placements`
	const query = new URLSearchParams({
		'filter[placementType]': [...KINDS.keys()].join(','),
		include: 'image',
		'fields[appAssetLibraryPlacements]': 'placementType,placementGroup,state,image,appStoreVersionLocalization',
		'fields[appAssetLibraryImages]': 'imageAsset,state,fileName',
		sort: 'placementGroupPosition', limit: '200'
	})
	let url = new URL(`${path}?${query}`, ASC_BASE_URL)
	const visited = new Set(), placements = new Map(), images = new Map()
	while (url) {
		if (visited.has(url.href) || visited.size >= MAX_PLACEMENT_PAGES) throw invalidResponse('分页循环或页数超出限制')
		visited.add(url.href)
		const { body } = await client.get(`${url.pathname}${url.search}`)
		if (!Array.isArray(body?.data) || (body.included !== undefined && !Array.isArray(body.included))) {
			throw invalidResponse('缺少放置列表或关联图片列表')
		}
		for (const placement of body.data) {
			if (!placement || typeof placement !== 'object') throw invalidResponse('放置记录不合法')
			if (placement.type !== 'appAssetLibraryPlacements') throw invalidResponse('放置资源类型不正确')
			if (typeof placement.attributes?.placementType !== 'string') throw invalidResponse('缺少放置类型')
			if (!KINDS.has(placement.attributes.placementType)) continue
			const owner = placement.relationships?.appStoreVersionLocalization?.data?.id
			if (owner && owner !== versionLocId) throw invalidResponse('放置不属于当前版本语言')
			placements.set(resourceId(placement.id), placement)
		}
		for (const image of body.included ?? []) {
			if (image?.type === 'appAssetLibraryImages' && typeof image.id === 'string') images.set(image.id, image)
		}
		const next = body.links?.next
		url = next === undefined || next === null || next === '' ? null : nextPage(next, url, path)
	}
	if (placements.size === 0) return []
	const { groups, classes } = await readDeviceGroups(client)
	const result = []
	for (const placement of placements.values()) {
		const imageLink = placement.relationships?.image?.data
		if (imageLink?.type !== 'appAssetLibraryImages' || !imageLink.id) throw invalidResponse('放置缺少图片关联')
		const imageId = resourceId(imageLink.id)
		let image = images.get(imageId)
		if (!image) {
			const response = await client.get(`/v1/appAssetLibraryImages/${imageId}?fields%5BappAssetLibraryImages%5D=imageAsset%2Cstate%2CfileName`)
			image = response.body?.data
			images.set(imageId, image)
		}
		if (image?.type !== 'appAssetLibraryImages' || image.id !== imageId || typeof image.attributes?.state !== 'string') {
			throw invalidResponse('关联图片缺失或资源标识不匹配')
		}
		const asset = image.attributes.imageAsset
		const imageAssetUrl = typeof asset?.templateUrl === 'string' ? asset.templateUrl : ''
		if (!imageAssetUrl && !STATES_WITHOUT_IMAGE.has(image.attributes.state)) throw invalidResponse('已处理图片缺少预览地址')
		const placementGroup = typeof placement.attributes.placementGroup === 'string' ? placement.attributes.placementGroup : ''
		const group = groups.get(placementGroup)
		const displayClassId = typeof group?.displayClassId === 'string' ? group.displayClassId : ''
		const display = classes.get(displayClassId)
		result.push({
			kind: KINDS.get(placement.attributes.placementType), placementId: placement.id, imageId, placementGroup,
			state: String(placement.attributes.state ?? ''), imageAssetUrl,
			width: Number.isFinite(asset?.width) ? asset.width : null,
			height: Number.isFinite(asset?.height) ? asset.height : null,
			deviceFamily: typeof display?.deviceFamily === 'string' ? display.deviceFamily : '', displayClassId
		})
	}
	return result
}
