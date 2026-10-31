/** 素材替换与撤回：先保存恢复信息，再执行不可逆步骤；同一目标串行保护。 */
import { AscError } from './client.js'
import * as assetLibrary from './assetLibrary.js'

const activeScopes = new Set()
const resourceId = (value) => {
	if (typeof value !== 'string' || !/^[0-9a-z-]+$/i.test(value)) throw new AscError('CONFLICT', '素材记录中的资源标识不合法')
	return value
}
const isMissing = (error) => error?.status === 404 || error?.code === 'NOT_FOUND'

export function createCreativeSync(store, library = assetLibrary) {
	async function exclusive(scope, operation) {
		const key = `${scope.appId}:${scope.versionLocId}:${scope.kind}`
		if (activeScopes.has(key)) throw new AscError('CONFLICT', '当前语言的素材正在操作，请稍后重试')
		activeScopes.add(key)
		try { return await operation() } finally { activeScopes.delete(key) }
	}
	async function getPlacement(client, id) {
		try {
			const { body } = await client.get(`/v1/appAssetLibraryPlacements/${resourceId(id)}?include=appStoreVersionLocalization,image`)
			if (!body?.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
				throw new AscError('SERVER', '无法确认素材的放置结果，记录已保留')
			}
			return body.data
		} catch (error) { if (isMissing(error)) return null; throw error }
	}
	function matches(placement, scope, imageId) {
		return placement?.attributes?.placementType === library.PLACEMENT_TYPES[scope.kind]
			&& placement?.relationships?.appStoreVersionLocalization?.data?.id === scope.versionLocId
			&& placement?.relationships?.image?.data?.id === imageId
	}
	async function readBound(client, scope) {
		const current = await store.read(scope)
		if (current) return current
		const legacy = await store.readLegacy(scope)
		if (!legacy) return null
		if (!legacy.placementId) throw new AscError('CONFLICT', '旧素材记录缺少语言归属，请先在 ASC 核对该素材')
		const placement = await getPlacement(client, legacy.placementId)
		if (!placement) throw new AscError('CONFLICT', '旧素材放置已不存在，请先在 ASC 核对旧素材记录')
		const owner = placement.relationships?.appStoreVersionLocalization?.data?.id
		if (!owner) throw new AscError('CONFLICT', '无法确认旧素材的语言归属')
		if (owner !== scope.versionLocId) return null
		if (!matches(placement, scope, legacy.imageId)) throw new AscError('CONFLICT', '旧素材的类型或图片归属不一致')
		const migrated = { ...legacy, versionLocId: scope.versionLocId }
		await store.write(scope, migrated)
		await store.removeLegacy(scope)
		return migrated
	}
	async function deleteImage(client, id) {
		try { await client.request('DELETE', `/v1/appAssetLibraryImages/${resourceId(id)}`) }
		catch (error) { if (!isMissing(error)) throw error }
	}
	async function deleteBoundPlacement(client, scope, meta) {
		if (!meta.placementId) return
		const placement = await getPlacement(client, meta.placementId)
		if (!placement) return
		if (!matches(placement, scope, meta.imageId)) throw new AscError('CONFLICT', '素材放置不属于当前语言，已停止操作')
		try { await library.deletePlacement(client, meta.placementId) }
		catch (error) { if (!isMissing(error)) throw error }
	}
	async function cleanPending(client, scope, meta) {
		if (meta.pendingImageId && meta.pendingImageId !== meta.imageId) {
			await deleteImage(client, meta.pendingImageId)
			meta.pendingImageId = ''
			await store.write(scope, meta)
		}
		for (const id of [...(meta.cleanupImageIds ?? [])]) {
			if (id !== meta.imageId) await deleteImage(client, id)
			meta.cleanupImageIds = meta.cleanupImageIds.filter((item) => item !== id)
			await store.write(scope, meta)
		}
	}
	async function findImagePlacement(client, scope, imageId) {
		let data
		try {
			const result = await client.get(`/v1/appAssetLibraryImages/${resourceId(imageId)}/placements?include=appStoreVersionLocalization,image`)
			data = result.body?.data
			if (!Array.isArray(data)) throw new AscError('SERVER', '无法确认素材的放置结果，记录已保留')
		} catch (error) { if (!isMissing(error)) throw error; return null }
		const found = data.filter((entry) => matches(entry, scope, imageId))
		if (found.length > 1) throw new AscError('CONFLICT', '素材存在多个匹配放置，请先在 ASC 核对')
		return found[0] ?? null
	}
	async function recoverPending(client, scope, meta) {
		if (!meta.pendingImageId || meta.pendingImageId === meta.imageId) return false
		const found = await findImagePlacement(client, scope, meta.pendingImageId)
		if (!found) return false
		// POST 响应丢失或本机保存失败时，按新图片查回已创建的放置，避免盲目重建。
		const previousImage = meta.imageId
		Object.assign(meta, { imageId: meta.pendingImageId, placementId: resourceId(found.id),
			state: found.attributes?.state ?? '', pendingImageId: '', restoreRequired: false,
			cleanupImageIds: [...new Set([...(meta.cleanupImageIds ?? []), previousImage].filter(Boolean))] })
		await store.write(scope, meta)
		return true
	}
	async function recoverPrevious(client, scope, meta) {
		if (!meta.imageId || !meta.restoreRequired) return false
		const found = await findImagePlacement(client, scope, meta.imageId)
		if (!found) return false
		Object.assign(meta, { placementId: resourceId(found.id), restoreRequired: false })
		await store.write(scope, meta)
		return true
	}
	async function restore(client, scope, meta) {
		if (meta.placementId) {
			const existing = await getPlacement(client, meta.placementId)
			if (existing) {
				if (!matches(existing, scope, meta.imageId)) throw new AscError('CONFLICT', '旧素材放置归属不一致，无法自动恢复')
				meta.restoreRequired = false
				await store.write(scope, meta)
				return
			}
		}
		// 回滚请求也可能已成功但响应丢失；先查旧图片，避免重试时重复创建。
		if (await recoverPrevious(client, scope, meta)) return
		let result
		try {
			result = await library.placeCreativeAsset(client, { ...scope, imageId: meta.imageId })
			if (!result.placementId) throw new AscError('SERVER', '恢复旧素材时未返回放置标识')
		} catch (error) {
			if (await recoverPrevious(client, scope, meta)) return
			throw error
		}
		Object.assign(meta, result, { restoreRequired: false })
		await store.write(scope, meta)
	}
	return {
		read: (client, scope) => exclusive(scope, async () => {
			const meta = await readBound(client, scope)
			if (!meta) return null
			return { ...meta, state: meta.restoreRequired ? 'RESTORE_REQUIRED' : (meta.pendingImageId || meta.cleanupImageIds?.length) ? 'CLEANUP_REQUIRED' : meta.state }
		}),
		state: (client, scope) => exclusive(scope, async () => {
			const meta = await readBound(client, scope)
			if (!meta) return null
			await recoverPending(client, scope, meta)
			await recoverPrevious(client, scope, meta)
			if (meta.restoreRequired) return { ...meta, state: 'RESTORE_REQUIRED' }
			if (!meta.imageId || meta.pendingImageId || meta.cleanupImageIds?.length) return { ...meta, state: 'CLEANUP_REQUIRED' }
			const state = await library.getImageState(client, meta.imageId)
			await store.write(scope, { ...meta, state: state.state })
			return { ...meta, ...state }
		}),
		upload: (client, scope, file) => exclusive(scope, async () => {
			const meta = (await readBound(client, scope)) ?? { imageId: '', placementId: '', versionLocId: scope.versionLocId }
			await recoverPending(client, scope, meta)
			if (meta.restoreRequired) await restore(client, scope, meta)
			await cleanPending(client, scope, meta)
			const { imageId } = await library.uploadCreativeAsset(client, {
				appId: scope.appId, ...file,
				onReserved: async (id) => { meta.pendingImageId = id; await store.write(scope, meta) }
			})
			meta.pendingImageId = imageId
			await store.write(scope, meta)
			await library.waitForImageReady(client, imageId)
			// 上传或处理失败时尚未触碰旧放置；切换前持久化恢复信息。
			const oldImageId = meta.imageId
			meta.restoreRequired = Boolean(meta.placementId)
			await store.write(scope, meta)
			await deleteBoundPlacement(client, scope, meta)
			meta.placementId = ''
			await store.write(scope, meta)
			let placement
			try {
				placement = await library.placeCreativeAsset(client, { ...scope, imageId })
				if (!placement.placementId) throw new AscError('SERVER', '创建素材放置时未返回标识')
			} catch (error) {
				if (await recoverPending(client, scope, meta)) {
					placement = { placementId: meta.placementId, state: meta.state }
				} else {
					if (oldImageId && meta.restoreRequired) {
						try { await restore(client, scope, meta) }
						catch { throw new AscError('SERVER', '新素材放置失败，旧素材尚未恢复；记录已保留，请重试同步或撤回') }
					}
					throw error
				}
			}
			Object.assign(meta, placement, { imageId, pendingImageId: '', restoreRequired: false, cleanupImageIds: oldImageId ? [oldImageId] : [] })
			await store.write(scope, meta)
			try { await cleanPending(client, scope, meta) }
			catch { return { ...meta, warning: '新素材已放置，旧图片尚未清理；记录已保留供重试',
				warningEn: 'The new asset is in place, but the old image has not been cleaned up. The recovery record is kept for retry.' } }
			return meta
		}),
		remove: (client, scope) => exclusive(scope, async () => {
			const meta = await readBound(client, scope)
			if (!meta) return
			await recoverPending(client, scope, meta)
			await recoverPrevious(client, scope, meta)
			await deleteBoundPlacement(client, scope, meta)
			meta.placementId = ''
			meta.restoreRequired = false
			await store.write(scope, meta)
			await cleanPending(client, scope, meta)
			if (meta.imageId) {
				await deleteImage(client, meta.imageId)
				meta.imageId = ''
				await store.write(scope, meta)
			}
			await store.remove(scope)
		})
	}
}
