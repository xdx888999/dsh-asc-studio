/** 在独立模块环境注入假依赖，测试不读取真实凭据、不访问网络。 */
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export async function loadModule(path, mocks = {}) {
	const context = vm.createContext({ Buffer, process, URL, AbortSignal, setTimeout, structuredClone, console,
		fetch: () => { throw new Error('Unexpected network access in test') } })
	const modules = new Map()
	function load(id) {
		if (modules.has(id)) return modules.get(id)
		// 读取完成前就缓存创建任务，确保共享依赖只有一个模块实例。
		const pending = (async () => {
			const mock = mocks[id]
			if (mock || id.startsWith('node:')) {
				const values = mock ?? await import(id)
				return new vm.SyntheticModule(Object.keys(values), function () {
					for (const [key, value] of Object.entries(values)) this.setExport(key, value)
				}, { context, identifier: id })
			}
			return new vm.SourceTextModule(await readFile(new URL(id), 'utf8'), { context, identifier: id, initializeImportMeta: (meta) => { meta.url = id } })
		})()
		modules.set(id, pending)
		return pending
	}
	const module = await load(pathToFileURL(path).href)
	// 由根模块统一链接依赖图，避免并行分支重复链接尚未完成的共享模块。
	await module.link((specifier, referencingModule) => load(specifier.startsWith('node:') ? specifier : new URL(specifier, referencingModule.identifier).href))
	await module.evaluate()
	return module.namespace
}
