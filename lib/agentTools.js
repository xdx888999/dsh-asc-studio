/** 无外部依赖的 DSH ToolDefinition；只提供读取和本地草稿，不提供 ASC 写入。 */
import { AgentDraftError, validateAgentSessionId } from './agentDrafts.js'
import { FIELD_DEFS, LIMITS } from './shared.js'

const stringSchema = { type: 'string' }
const booleanSchema = { type: 'boolean' }
const objectSchema = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
const nullable = (schema) => ({ oneOf: [schema, { type: 'null' }] })
const fieldSchema = { type: 'string', enum: FIELD_DEFS.map(({ key }) => key) }
const appSchema = objectSchema({ id: stringSchema, name: stringSchema, bundleId: stringSchema, primaryLocale: stringSchema })
const resourceProperties = { id: stringSchema, appStoreState: stringSchema, editable: booleanSchema }
const listingSchema = objectSchema({
	contextId: stringSchema,
	app: appSchema,
	version: nullable(objectSchema({ ...resourceProperties, versionString: stringSchema, promoOnly: booleanSchema })),
	appInfo: nullable(objectSchema(resourceProperties)),
	locales: { type: 'array', items: objectSchema({
		locale: stringSchema, appInfoLocId: stringSchema, versionLocId: stringSchema,
		...Object.fromEntries(FIELD_DEFS.map(({ key }) => [key, stringSchema])),
		editableFields: { type: 'array', items: fieldSchema }
	}) },
	limits: objectSchema(Object.fromEntries(Object.keys(LIMITS).map((key) => [key, { type: 'integer' }])))
})

const WORKFLOW = '以当前会话项目和用户明确指定的 Git 变更范围为依据生成文案；不要猜测项目对应的 App、版本或语言，先列出 App 并读取目标文案。不要读取或索取 .p8、私钥、JWT 或其他凭据。生成结果仅进入本地草稿，不会写入、发布或提交 App Store Connect；请告知用户在同一会话打开 App Store 面板查看，并由用户人工确认同步。'
const STAGED_MESSAGE = '文案已暂存为本地草稿，尚未写入或发布到 App Store Connect。请在同一会话打开 App Store 面板查看草稿，检查差异后人工确认同步。'

function exactArgs(args, keys) {
	if (args === null || typeof args !== 'object' || Array.isArray(args)
		|| Object.keys(args).length !== keys.length || keys.some((key) => !Object.hasOwn(args, key))) throw new AgentDraftError('REQUEST')
}

/** 注册工具并返回幂等清理函数；ctx.tools 不可用时由调用方决定兼容策略。 */
export function registerAgentTools(ctx, bridge) {
	const disposers = []
	const register = (name, description, parameters, schema, run) => {
		const dispose = ctx.tools.register({
			name,
			description: `${description}\n${WORKFLOW}`,
			parameters,
			output: { schema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
			async execute(args, exec) {
				try {
					const sessionId = validateAgentSessionId(exec?.agent?.session?.id)
					exactArgs(args, Object.keys(parameters.properties))
					return await run(args, sessionId, exec.signal)
				} catch (error) {
					// DSH 会向模型输出异常消息，因此绝不传出原始网络错误、响应正文或凭据。
					throw new AgentDraftError(error instanceof AgentDraftError ? error.code : 'SOURCE')
				}
			}
		})
		if (typeof dispose === 'function') disposers.push(dispose)
	}
	const dispose = () => {
		for (const release of disposers.splice(0).reverse()) release()
	}
	try {
		register('asc_list_apps', '读取当前已连接账号的 App 标识、名称和主要语言，以确定用户要编辑的目标。',
			objectSchema({}), { type: 'array', items: appSchema },
			(_args, sessionId, signal) => bridge.listApps(sessionId, signal))
		register('asc_read_listing', '读取指定 App 当前版本的六个文案字段、可编辑字段及长度上限，返回仅属于当前会话的 contextId。',
			objectSchema({ appId: { type: 'string', description: '由 asc_list_apps 返回并与用户项目核对过的纯数字 App id。' } }), listingSchema,
			(args, sessionId, signal) => bridge.readListing(sessionId, args.appId, signal))
		register('asc_stage_draft', '将生成的文案填入当前会话的本地待处理草稿。必须使用 asc_read_listing 的 contextId 和已有语言，只改 editableFields 中的字段。',
			objectSchema({ contextId: stringSchema, changes: { type: 'array', items: objectSchema({ locale: stringSchema, field: fieldSchema, value: stringSchema }) } }),
			objectSchema({ staged: booleanSchema, id: stringSchema, app: objectSchema({ id: stringSchema, name: stringSchema, bundleId: stringSchema }), versionId: nullable(stringSchema), versionString: nullable(stringSchema), count: { type: 'integer' }, message: stringSchema }),
			async (args, sessionId, signal) => {
				const proposal = await bridge.stageDraft(sessionId, args, signal)
				return { staged: true, id: proposal.id, app: { id: proposal.app.id, name: proposal.app.name, bundleId: proposal.app.bundleId }, versionId: proposal.versionId, versionString: proposal.versionString, count: proposal.changes.length, message: STAGED_MESSAGE }
			})
	} catch (error) {
		dispose()
		throw error
	}
	return dispose
}
