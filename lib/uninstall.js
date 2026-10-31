/** 仅从明确的用户操作中调用宿主卸载；停用、HMR、退出进程均不清理用户数据。 */
import { AscError } from './asc/client.js'

export function createUninstaller(ctx, storage, logger) {
	function services() {
		return { manager: ctx.get('pluginManager'), hmr: ctx.get('hmr'), entry: ctx.fiber?.entry }
	}
	async function ownBundle() {
		const { manager, hmr, entry } = services()
		if (!hmr || !entry?.id || entry.options?.name !== 'dsh-asc-studio' || typeof manager?.listBundles !== 'function' || typeof manager?.removeBundle !== 'function') return null
		const bundles = await manager.listBundles()
		if (!Array.isArray(bundles)) return null
		const matches = bundles.filter((bundle) => bundle.rows?.some((row) => row.entryId === entry.id && row.moduleName === 'dsh-asc-studio'))
		if (matches.length !== 1) return null
		const bundle = matches[0]
		// 不允许此按钮连带卸载包含其他插件或配置覆盖的组合包。
		if (!bundle.installed || !bundle.removable || bundle.error || bundle.rows.length !== 1 || bundle.overrides?.length || typeof bundle.name !== 'string') return null
		return { manager, bundle }
	}
	return {
		async available() { try { return Boolean(await ownBundle()) } catch { return false } },
		async uninstall() {
			const target = await ownBundle()
			if (!target) throw new AscError('CONFLICT', '当前加载方式不支持直接卸载，请先清理本地数据，再从 DSH 插件管理页卸载')
			await storage.prepareUninstall(logger)
			try {
				const result = await target.manager.removeBundle(target.bundle.name)
				if (!['applied', 'restart-required'].includes(result?.application) || result.error ||
					(result.packageResult && (result.packageResult.exitCode !== 0 || result.packageResult.timedOut))) throw new Error('Host removal failed')
				const remaining = await target.manager.listBundles()
				if (!Array.isArray(remaining) || remaining.some((bundle) => bundle.name === target.bundle.name && bundle.installed)) throw new Error('Package is still installed')
				return { uninstalled: true, restartRequired: result.application === 'restart-required' }
			} catch {
				throw new AscError('SERVER', '本机数据已清理，但插件卸载未完成；请到 DSH 插件管理页完成卸载')
			}
		}
	}
}
