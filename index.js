// dsh-mindmap —— host 半边：mindmap_* 文件工具。
//
// 设计（001 拍板决策 + 002/003 spike 结论）：
// - 脑图 = 会话工作目录里的普通 .md 文件（决策 1）；本模块只做纯文件操作，
//   不解析 markdown——解析在 client 半边（结果渲染文本同时进模型上下文，
//   带树会 double token；见 004 完成报告的架构说明）。
// - 根节点标题 = 文档名（决策 2）：renameRoot 触发文件重命名，撞名报错不覆盖；
//   文件被外部改名时根标题由 client 从路径推导，天然跟随。
// - 四工具都带 path/name 参数（决策 3：多脑图并存，作用于指定那颗）。
// - 结果 JSON {ok, op, path, rootTitle, content, renamedFrom?}：content 全文
//   供模型续编辑，client 用同一份重放面板（工具结果即实时通道，002 第二节）。
// - requireApproval 配置（决策 6）：默认 false 免审批；置 true 时 mindmap_update
//   走原生 ask（tools/pre-execute，照 dsh-grafana 的钩子模式）。015 起经 settings
//   namespace 可在设置面板运行时切换（见 SETTINGS_NAMESPACE/Config）。
// - 依赖：仅 @deepseek-ai/schemastery（settings schema；发布包正常解析，
//   link 开发需先 npm i）。工具参数 schema 仍手写 JSON Schema（003 偏差 1）。
import { access, opendir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path'
import Schema from '@deepseek-ai/schemastery'

export const name = 'mindmap'
export const inject = ['tools', 'systemPrompt', 'webServer', 'sessions']

// 015 设置面板：settings namespace（dsh-grafana 同款模式）。
// requireApproval 在 pre-execute 时读当前值（运行时切换即时生效）；
// defaultPanelWidth 供客户端面板取默认宽度（20-80 钳制由客户端执行）。
export const SETTINGS_NAMESPACE = 'mindmap'
export const Config = Schema.object({
  requireApproval: Schema.boolean().default(false).description('Require native DSH approval for every mindmap_update (including renameRoot). Files are git-managed, so it defaults to off. Hidden from the settings panel; still honored at runtime.'),
  defaultPanelWidth: Schema.number().default(42).description('Default floating-panel width as a percentage of the viewport (clamped 20-80 on the client).'),
  lineStyle: Schema.union(['curve', 'elbow']).default('elbow').description('Connector line style between nodes: curve (bezier) or elbow (orthogonal).'),
  cardStyle: Schema.union(['rounded', 'square']).default('rounded').description('Node card corner style.'),
  colorTheme: Schema.union(['ocean', 'sunset', 'forest']).default('ocean').description('Node color theme.'),
  growthAnimation: Schema.boolean().default(true).description('Progressive growth animation: newly added/changed nodes fade in one by one after each update (total capped at ~2s). Turn off for instant full render.'),
})

const MAX_CONTENT_BYTES = 2 * 1024 * 1024
const MAX_NAME_CHARS = 80
const TOOL_TIMEOUT_MS = 15_000
const MAX_TREE_ENTRIES = 500
const MAX_BODY_BYTES = 1 << 20

const GUIDANCE = `## Mindmap editing (dsh-mindmap)

A mindmap is a plain markdown file in the session working directory. The right-side panel renders it live; the filename (without .md) is the root node title. These files are ordinary documents: the user reviews and commits them with git themselves.

Tools:
- mindmap_create(name): create <name>.md in the working directory (fails if it exists) and show it in the panel.
- mindmap_open(path): open an existing .md as a mindmap in the panel.
- mindmap_get(path): read the current markdown content.
- mindmap_update(path, content, renameRoot?): write the FULL updated markdown. renameRoot renames the file to match a new root title (fails on name collision); use it only when the user asks to rename the root node.

Markdown mapping (the panel's parser): headings nest by level (H1 are root children, H2 under the previous H1, ...); list items are child nodes nested by 2-space indentation; an EMPTY list item ("- " followed by nothing) renders as a placeholder node — use placeholders for planned-but-unwritten nodes; a fenced code block becomes a leaf node titled "[lang] first line"; plain paragraphs become the note text of the nearest heading.

Behavior rules:
- When the user asks to create a mindmap, call mindmap_create. When the user asks to open, view, show, or switch to an existing mindmap, call mindmap_open (do not use mindmap_get alone). Both operations bring that document to the visible mindmap panel automatically.
- Always mindmap_get before editing, then send the complete updated document to mindmap_update. One tool call per step so the panel follows along live.
- Never delete the whole document or restructure it without an explicit user request. Make the smallest change that answers the request.
- When the user steps away or pauses (e.g. "我去买咖啡"), stop all mindmap edits immediately and wait — never continue autonomously.
- Never run any git command for these files. The user commits themselves.
- Mindmap files stay inside the session working directory.`

function textOut(value) {
  return [{ type: 'text', text: String(value) }]
}

/** 会话工作目录：工具执行的 agent → session → header.cwd（dsh-session 契约）。 */
function sessionCwd(exec) {
  return exec?.agent?.session?.header?.cwd
}

//#region 013 目录树 API（host 自建只读 HTTP 路由；dsh-better-sidebar 同款机制）
/** 带 status/code 的错误：路由层据此回 JSON 信封。 */
function httpError(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

/**
 * 同源/loopback fence：只服务本 web 页面发来的请求。
 * - Host 头必须是 loopback 或与 Origin 同 host；
 * - sec-fetch-site=cross-site 一律拒绝（better-sidebar 同款思路）。
 */
function isTrustedRequest(req) {
  const host = String(req?.headers?.host ?? '')
  if (!host) return false
  const site = String(req?.headers?.['sec-fetch-site'] ?? '')
  if (site === 'cross-site') return false
  const origin = String(req?.headers?.origin ?? '')
  if (!origin) {
    const hostname = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
  }
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** 会话 id → 工作目录（与工具同源：sessions header.cwd）。 */
function sessionCwdOf(sessions, sessionId) {
  const cwd = sessions?.get?.(sessionId)?.header?.cwd
  return typeof cwd === 'string' && cwd ? cwd : null
}

/** 相对路径是否越出 base（`..` 本身或以 `..` + 分隔符开头；不能只看 `..` 前缀——
 *  `..notes.md` 这类文件名会被误判）。 */
function escapesBase(rel) {
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
}

/** 请求路径校验：缺省 = 根 cwd；显式路径必须绝对且落在 cwd 内。 */
function resolveTreePath(cwd, input) {
  if (!cwd) throw httpError(400, 'no-cwd', 'session has no working directory')
  if (input === undefined || input === null || String(input).trim() === '') return cwd
  const p = String(input).trim()
  if (!isAbsolute(p)) throw httpError(400, 'bad-request', `path must be absolute: ${JSON.stringify(p)}`)
  const resolved = resolvePath(p)
  const rel = relative(cwd, resolved)
  if (escapesBase(rel)) {
    throw httpError(400, 'bad-request', `path must stay inside the session working directory (${cwd})`)
  }
  return resolved
}

/** 单层目录列表：目录优先排序、条目上限截断、隐藏标记。 */
async function listDirectoryLevel(path, maxEntries = MAX_TREE_ENTRIES) {
  let dir
  try {
    dir = await opendir(path)
  } catch (error) {
    throw httpError(400, 'fs-error', `cannot list "${path}": ${error instanceof Error ? error.message : String(error)}`)
  }
  const rows = []
  let overflow = 0
  try {
    for await (const dirent of dir) {
      if (rows.length >= maxEntries) {
        overflow += 1
        continue
      }
      rows.push({
        name: dirent.name,
        path: join(path, dirent.name),
        isDir: dirent.isDirectory(),
        hidden: dirent.name.startsWith('.'),
      })
    }
  } catch (error) {
    throw httpError(400, 'fs-error', `cannot list "${path}": ${error instanceof Error ? error.message : String(error)}`)
  }
  rows.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
  return { path, entries: rows, truncated: overflow > 0 }
}

/** 有界 JSON body 读取（better-sidebar 同款防御）。 */
async function readJsonBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    total += buffer.length
    if (total > MAX_BODY_BYTES) throw httpError(400, 'bad-request', 'request body too large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    throw httpError(400, 'bad-request', 'request body is not valid JSON')
  }
}

/** JSON 响应信封。 */
function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}
//#endregion

/**
 * 根标题 → 安全文件名主干：去 .md 后缀；拒绝路径分隔符、越界名与控制字符。
 * @returns 干净的文件名主干。
 */
function sanitizeStem(input) {
  const raw = String(input ?? '').trim()
  const stem = raw.toLowerCase().endsWith('.md') ? raw.slice(0, -3).trim() : raw
  if (!stem) throw new Error('mindmap name must not be empty.')
  if (stem === '.' || stem === '..') throw new Error(`Invalid mindmap name ${JSON.stringify(raw)}.`)
  if (/[\\/:*?"<>|]/.test(stem)) throw new Error(`Invalid mindmap name ${JSON.stringify(raw)}: path separators and :*?"<>| are not allowed.`)
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(stem)) throw new Error(`Invalid mindmap name: control characters are not allowed.`)
  if ([...stem].length > MAX_NAME_CHARS) throw new Error(`mindmap name must not exceed ${MAX_NAME_CHARS} characters.`)
  return stem
}

/**
 * 解析脑图文件路径：相对路径以会话 cwd 为基；结果必须落在 cwd 内（决策 1），
 * 且必须以 .md 结尾。cwd 缺失时仅接受绝对路径。
 * @returns 绝对规范化路径。
 */
function resolveMindmapPath(cwd, input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('path is required.')
  const p = input.trim()
  if (!/\.md$/i.test(p)) throw new Error(`mindmap path must end with .md: ${JSON.stringify(p)}.`)
  if (!cwd) {
    if (!isAbsolute(p)) throw new Error('The session has no working directory; pass an absolute .md path.')
    return resolvePath(p)
  }
  const resolved = resolvePath(cwd, p)
  const rel = relative(cwd, resolved)
  if (rel === '' || escapesBase(rel)) {
    throw new Error(`mindmap path must stay inside the session working directory (${cwd}).`)
  }
  return resolved
}

async function pathExists(p) {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

/**
 * 两个路径是否指向同一个文件（dev + inode 比较）。大小写不敏感 FS（macOS/
 * Windows）上仅大小写不同的路径命中同一文件——case-only 改名时据此区分
 * 「目标就是自己」（放行）与「真有另一个同名文件」（碰撞报错）。
 */
async function sameFile(a, b) {
  try {
    const [sa, sb] = await Promise.all([stat(a), stat(b)])
    return sa.dev === sb.dev && sa.ino === sb.ino
  } catch {
    return false
  }
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength
}

/** 工具结果信封：client 面板与模型共用的唯一载体。 */
function buildResult(op, path, extra = {}) {
  const base = String(path ?? '').split(/[\\/]/).pop() || 'mindmap'
  return JSON.stringify({ ok: true, op, path, rootTitle: base.replace(/\.md$/i, ''), ...extra })
}

function defineTool(spec) {
  // 内联 defineTool 的最小等价物（避免 peer 依赖；见 003 偏差 1）：
  // 参数已按手写 JSON Schema 声明，execute 自行校验必填与类型。
  return spec
}

export function apply(ctx, config = {}) {
  // 入口配置作为 settings 组合层的 base：视觉三件套与默认宽度在这里
  // 透传（带 schema 同款默认值），用户设置层仍可在设置面板覆盖。
  const entryConfig = {
    requireApproval: config.requireApproval === true,
    defaultPanelWidth: typeof config.defaultPanelWidth === 'number' ? config.defaultPanelWidth : 42,
    lineStyle: config.lineStyle === 'curve' ? 'curve' : 'elbow',
    cardStyle: config.cardStyle === 'square' ? 'square' : 'rounded',
    colorTheme: config.colorTheme === 'sunset' || config.colorTheme === 'forest' ? config.colorTheme : 'ocean',
    growthAnimation: config.growthAnimation !== false,
  }

  // 015 设置面板：settings 服务可用时以命名空间解析值为准
  // （schema 默认 → 组合层 base → 用户设置层），否则回退入口配置
  // （dsh-grafana 同款模式；link 环境缺 schemastery 时见 003 偏差 1 的
  // 依赖说明——发布包正常安装依赖）。
  let activeConfig = () => entryConfig
  ctx.inject(['settings'], (sctx) => {
    const scope = sctx.settings.register(SETTINGS_NAMESPACE, Config, { base: entryConfig })
    activeConfig = () => scope.get()
    sctx.effect(() => () => {
      activeConfig = () => entryConfig
    })
  })

  ctx.systemPrompt.section({ name: 'tool:mindmap', order: 106, text: GUIDANCE })

  // 后悔药开关（决策 6）：钩子常驻注册，运行时读 activeConfig().requireApproval
  // ——设置面板切换立即生效；关闭时直接放行（默认 false 免审批）。
  ctx.on('tools/pre-execute', async (exec, next) => {
    const decision = await next()
    if (decision.kind !== 'allow') return decision
    if (!activeConfig().requireApproval) return decision
    if (exec.name !== 'mindmap_update') return decision
    const args = exec.arguments ?? {}
    const renameNote = typeof args.renameRoot === 'string' && args.renameRoot ? `, rename root to "${args.renameRoot}"` : ''
    const bytes = typeof args.content === 'string' ? byteLength(args.content) : 0
    return {
      kind: 'ask',
      reason: `Write mindmap ${JSON.stringify(String(args.path ?? '?'))} (${bytes} bytes${renameNote}). dsh-mindmap is configured with requireApproval.`,
    }
  })

  ctx.tools.register(defineTool({
    name: 'mindmap_create',
    description: 'Create a new mindmap markdown file <name>.md in the session working directory and show it in the mindmap panel. Fails if the file already exists. The filename becomes the root node title.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Mindmap document name (without .md). Becomes the filename and the root node title.' },
      },
      required: ['name'],
    },
    output: { schema: { type: 'string' }, render: (_args, value) => textOut(value) },
    timeoutMs: TOOL_TIMEOUT_MS,
    async execute(args, exec) {
      const cwd = sessionCwd(exec)
      if (!cwd) throw new Error('The session has no working directory; cannot create a mindmap.')
      const stem = sanitizeStem(args?.name)
      const path = resolveMindmapPath(cwd, `${stem}.md`)
      // wx = 不存在才创建：原子拒绝已存在（含并发竞态）与同名目录，无 TOCTOU 窗口。
      try {
        await writeFile(path, '', { encoding: 'utf8', flag: 'wx' })
      } catch (error) {
        if (error && (error.code === 'EEXIST' || error.code === 'EISDIR')) {
          throw new Error(`Mindmap already exists: ${JSON.stringify(path)}. Open it with mindmap_open instead.`)
        }
        throw error
      }
      return buildResult('create', path, { content: '', created: true })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mindmap_open',
    description: 'Open an existing .md file as a mindmap in the panel. The filename becomes the root node title. Use it when the user wants to view or continue an existing mindmap document.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the .md file, relative to the session working directory or absolute.' },
      },
      required: ['path'],
    },
    output: { schema: { type: 'string' }, render: (_args, value) => textOut(value) },
    timeoutMs: TOOL_TIMEOUT_MS,
    async execute(args, exec) {
      const path = resolveMindmapPath(sessionCwd(exec), args?.path)
      const content = await readFile(path, 'utf8')
      return buildResult('open', path, { content })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mindmap_get',
    description: 'Read the current markdown content of a mindmap document. Always call it before editing so changes apply to the latest text.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the .md file, relative to the session working directory or absolute.' },
      },
      required: ['path'],
    },
    output: { schema: { type: 'string' }, render: (_args, value) => textOut(value) },
    timeoutMs: TOOL_TIMEOUT_MS,
    async execute(args, exec) {
      const path = resolveMindmapPath(sessionCwd(exec), args?.path)
      const content = await readFile(path, 'utf8')
      return buildResult('get', path, { content })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mindmap_update',
    description: 'Write the FULL updated markdown of a mindmap document. Call mindmap_get first, then send the complete new content so the panel updates in one step. Optionally renameRoot to change the root title (renames the file; fails on name collision).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the .md file, relative to the session working directory or absolute.' },
        content: { type: 'string', description: 'The complete new markdown content of the document.' },
        renameRoot: { type: 'string', description: 'Optional new root title: renames the file to <renameRoot>.md. Only when the user asks to rename the root node.' },
      },
      required: ['path'],
    },
    output: { schema: { type: 'string' }, render: (_args, value) => textOut(value) },
    timeoutMs: TOOL_TIMEOUT_MS,
    async execute(args, exec) {
      const cwd = sessionCwd(exec)
      const path = resolveMindmapPath(cwd, args?.path)
      const hasContent = typeof args?.content === 'string'
      if (!hasContent && typeof args?.renameRoot !== 'string') {
        throw new Error('mindmap_update requires content (or renameRoot alone for a pure rename).')
      }
      if (hasContent && byteLength(args.content) > MAX_CONTENT_BYTES) {
        throw new Error(`mindmap content exceeds the ${MAX_CONTENT_BYTES}-byte limit.`)
      }
      if (!(await pathExists(path))) throw new Error(`Mindmap not found: ${JSON.stringify(path)}. Create it with mindmap_create first.`)

      let finalPath = path
      let renamedFrom
      if (typeof args?.renameRoot === 'string' && args.renameRoot.trim()) {
        const stem = sanitizeStem(args.renameRoot)
        // 重命名目标取原文件所在目录（path 已校验落在 cwd 内，其目录必然同域；
        // cwd 缺失的绝对路径场景同样成立）。
        const target = resolvePath(dirname(path), `${stem}.md`)
        if (target !== path) {
          // case-only 改名（如 Plan → plan）在大小写不敏感 FS 上 pathExists(target)
          // 命中的就是自己——用 sameFile 放行；真碰撞（不同文件）才报错。
          if (await pathExists(target) && !(await sameFile(path, target))) {
            throw new Error(`Cannot rename root: ${JSON.stringify(target)} already exists. Pick another name.`)
          }
          await rename(path, target)
          renamedFrom = path
          finalPath = target
        }
      }
      if (hasContent) await writeFile(finalPath, args.content, 'utf8')
      const content = hasContent ? args.content : await readFile(finalPath, 'utf8')
      return buildResult('update', finalPath, { content, ...(renamedFrom ? { renamedFrom } : {}) })
    },
  }))

  // 013 目录树 tab：/mindmap/api/tree 只读路由（dsh-better-sidebar 同款机制——
  // host 插件在 dsh webServer 上自建路由，客户端 fetch 拉会话工作目录的单层
  // 列表；与 native/browse picker 互斥无关）。只有读路由，没有写路由：
  // 客户端永不直接写文件（红线与 001 决策不动）。
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/mindmap/api',
    handler: async (req, res) => {
      if (!isTrustedRequest(req)) {
        sendJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
        return
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
        return
      }
      try {
        const method = new URL(req.url ?? '/', 'http://dsh.internal').pathname.slice('/mindmap/api/'.length)
        if (method !== 'tree') {
          sendJson(res, 404, { ok: false, error: { code: 'not-found', message: `unknown mindmap API method ${JSON.stringify(method)}` } })
          return
        }
        const payload = await readJsonBody(req)
        const sessionId = payload.sessionId
        if (typeof sessionId !== 'string' || !sessionId) {
          sendJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'missing or invalid "sessionId"' } })
          return
        }
        const cwd = sessionCwdOf(ctx.sessions, sessionId)
        if (!cwd) {
          sendJson(res, 400, { ok: false, error: { code: 'no-cwd', message: 'session has no working directory' } })
          return
        }
        const dir = resolveTreePath(cwd, payload.path)
        const listing = await listDirectoryLevel(dir)
        sendJson(res, 200, { ok: true, value: { ...listing, cwd } })
      } catch (error) {
        const status = error && typeof error.status === 'number' ? error.status : 500
        sendJson(res, status, {
          ok: false,
          error: {
            code: error && typeof error.code === 'string' ? error.code : 'internal',
            message: error instanceof Error ? error.message : String(error),
          },
        })
      }
    },
  }), 'dsh-mindmap: /mindmap/api routes')
}

export const internals = Object.freeze({
  GUIDANCE,
  MAX_CONTENT_BYTES,
  sanitizeStem,
  resolveMindmapPath,
  sessionCwd,
  sessionCwdOf,
  resolveTreePath,
  listDirectoryLevel,
  isTrustedRequest,
  buildResult,
})
