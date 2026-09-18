// dsh-mindmap —— host 半边：mindmap_* 文件工具。
//
// 设计（001 拍板决策 + 002/003 spike 结论）：
// - 脑图 = 会话工作目录里的普通 .md 文件（决策 1）；本模块只做纯文件操作，
//   不解析 markdown——解析在 client 半边（结果渲染文本同时进模型上下文，
//   带树会 double token；见 004 完成报告的架构说明）。
// - 根节点标题 = 文档名（决策 2）：renameRoot 触发文件重命名，撞名报错不覆盖；
//   文件被外部改名时根标题由 client 从路径推导，天然跟随。
// - 四工具都带 path/name 参数（决策 3：多脑图并存，作用于指定那颗）。
// - 036 默认落点：用户没指定目录的随手创建进 `.mindmaps/` 脑图收件箱，
//   名字 `YYYYMMDD-HHmmss-中文描述.md`——时间戳由 host 读表（模型不猜时间），
//   描述由 AI 给。收件箱按需创建、不进 .gitignore，同秒撞名加 -2/-3 不覆盖。
// - 结果 JSON {ok, op, path, rootTitle, content, renamedFrom?}：content 全文
//   供模型续编辑，client 用同一份重放面板（工具结果即实时通道，002 第二节）。
// - requireApproval 配置（决策 6）：默认 true；approvalMode 默认按「当前会话 + 当前文件」
//   首次确认，后续普通更新复用授权；per-operation 可恢复每次确认，off 关闭普通确认。
//   重命名、清空和大范围重写始终重新确认，关闭普通确认也不能跳过。
//   015 起经 settings namespace 可运行时切换。
// - 依赖：仅 @deepseek-ai/schemastery（settings schema；发布包正常解析，
//   link 开发需先 npm i）。工具参数 schema 仍手写 JSON Schema（003 偏差 1）。
import { access, mkdir, open, opendir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path'
import Schema from '@deepseek-ai/schemastery'

export const name = 'mindmap'
export const inject = ['tools', 'systemPrompt', 'webServer', 'sessions']

// 015 设置面板：settings namespace（dsh-grafana 同款模式）。
// requireApproval / approvalMode 在 pre-execute 时读当前值（运行时切换即时生效）；
// defaultPanelWidth 供客户端面板取默认宽度（20-80 钳制由客户端执行）。
export const SETTINGS_NAMESPACE = 'mindmap'
const APPROVAL_MODES = ['per-operation', 'session', 'off']

/** Normalize the public three-mode policy while accepting the previous names. */
function normalizeApprovalMode(value, requireApproval = true) {
  if (requireApproval === false) return 'off'
  if (value === 'per-operation' || value === 'always') return 'per-operation'
  if (value === 'off') return 'off'
  if (value === 'session' || value === 'once-per-document') return 'session'
  return 'session'
}

export const Config = Schema.object({
  requireApproval: Schema.boolean().default(true).description('Legacy switch: false skips ordinary confirmations only, and is lifted when the settings panel picks an explicit approval mode. Rename, clearing content, and broad rewrites always require approval.'),
  approvalMode: Schema.union([...APPROVAL_MODES, 'once-per-document', 'always']).default('session').description('Confirm every ordinary write, once per document in the current session, or disable ordinary confirmations. High-risk writes always require approval.'),
  defaultPanelWidth: Schema.number().default(42).description('Default floating-panel width as a percentage of the viewport (clamped 20-80 on the client).'),
  lineStyle: Schema.union(['curve', 'elbow']).default('elbow').description('Connector line style between nodes: curve (bezier) or elbow (orthogonal).'),
  cardStyle: Schema.union(['rounded', 'square']).default('rounded').description('Node card corner style.'),
  colorTheme: Schema.union(['ocean', 'sunset', 'forest']).default('ocean').description('Node color theme.'),
  growthAnimation: Schema.boolean().default(true).description('Progressive growth animation: newly added/changed nodes fade in one by one after each update (total capped at ~2s). Turn off for instant full render.'),
})

const MAX_CONTENT_BYTES = 2 * 1024 * 1024
const MAX_READ_BYTES = 2 * 1024 * 1024
const MAX_NAME_CHARS = 80
const TOOL_TIMEOUT_MS = 15_000
const MAX_TREE_ENTRIES = 500
const MAX_BODY_BYTES = 1 << 20
const BROAD_REWRITE_MIN_BYTES = 16 * 1024
// 比例判定只对足够大的文档生效：几百字节的脑图整体改写不算「大范围重写」，
// 否则小文档的每次更新都会被升级成高风险确认，会话授权形同虚设。
const BROAD_REWRITE_RATIO_MIN_BYTES = 4 * 1024
// 036 默认脑图收件箱：用户没指定目录时的落点。目录只在第一次需要时按需创建，
// 也不自动进 .gitignore——脑图仍是普通 Markdown，用户可以审阅、diff、提交。
export const DEFAULT_MINDMAP_DIR = '.mindmaps'
// 描述只占默认名的一段，上限留足时间戳（15）与连接符的余量后仍远低于 MAX_NAME_CHARS。
const MAX_DESCRIPTION_CHARS = 24
// 同一秒同名（默认命名）时的后缀尝试次数上限。
const MAX_CREATE_ATTEMPTS = 50

const GUIDANCE = `## Mindmap editing (dsh-mindmap)

A mindmap is a plain markdown file in the session working directory. The right-side panel renders it live; the filename (without .md) is the root node title. These files are ordinary documents: the user reviews and commits them with git themselves.

Tools:
- mindmap_create(name? | description, directory?): create a mindmap and show it in the panel (fails if the file already exists). Give \`name\` when the user named the mindmap; otherwise give a short \`description\` and the host names the file \`YYYYMMDD-HHmmss-<description>.md\`. Give \`directory\` only when the user picked a location.
- mindmap_open(path): open an existing .md as a mindmap in the panel.
- mindmap_get(path): read the current markdown content.
- mindmap_update(path, content, renameRoot?, expectedRevision?): write the FULL updated markdown. Pass the revision returned by mindmap_get/open when editing; a mismatch stops the write instead of overwriting newer changes. renameRoot renames the file to match a new root title (fails on name collision); use it only when the user asks to rename the root node.

Markdown mapping (the panel's parser): headings nest by level (H1 are root children, H2 under the previous H1, ...); list items are child nodes nested by 2-space indentation; a list item with no text after the marker renders as a placeholder node (both "-" and "- " work; no trailing space is required) — use placeholders for planned-but-unwritten nodes; a fenced code block becomes a leaf node titled "[lang] first line"; plain paragraphs become their own text/Markdown block nodes under the nearest heading.

Behavior rules:
- Where new files go: for casual requests ("创建一个脑图", "把刚才的讨论整理成脑图", "盘点一下这个问题") omit \`directory\` — the host files them in \`${DEFAULT_MINDMAP_DIR}/\`, the mindmap inbox, created on first use. That is the only location the plugin ever chooses on its own: when the user names a directory (or right-clicks one in the tree), pass that \`directory\` and leave their placement alone.
- Never write a date or time into a mindmap filename yourself. Pass a bare \`description\` (e.g. 项目盘点) and the host stamps the real current time, then takes the first free name (\`-2\`, \`-3\`, …) so an existing file is never overwritten. The path the user confirms is the path it writes; if another create claims that name while the confirmation is pending, the host steps to the next free suffix and reports the final path in the tool result — relay that path to the user rather than assuming the one they confirmed.
- Because the root node title is the filename, a default-created mindmap shows its timestamp as the root title (e.g. 20260918-155230-项目盘点). Rename it with renameRoot only when the user asks; do not restructure the document to hide the stamp.
- When the user asks to create a mindmap, call mindmap_create. When the user asks to open, view, show, or switch to an existing mindmap, call mindmap_open (do not use mindmap_get alone). Both operations bring that document to the visible mindmap panel automatically.
- Always mindmap_get before editing, then send the complete updated document and the returned revision as expectedRevision to mindmap_update. If the tool reports a revision conflict, stop and ask the user whether to reload or merge; never overwrite newer text silently. Every call must carry the FULL document, never a fragment.
- Update step by step: whenever the request involves several parts, call mindmap_update as soon as each part is ready — several small updates beat one giant update at the end. The panel plays a growth animation on newly added/changed nodes, so step-by-step updates make the tree visibly grow while you work. Do not call mindmap_update twice in a row with identical content.
- Never delete the whole document or restructure it without an explicit user request. Make the smallest change that answers the request.
- When the user steps away or pauses (e.g. "我去买咖啡"), stop all mindmap edits immediately and wait — never continue autonomously.
- Native write approval defaults to once per document in the current session, so step-by-step updates stay fluid after the first confirmation. \`per-operation\` asks every time; \`off\` skips ordinary confirmations. A new document, a new session, or renameRoot requires a fresh confirmation. The current mindmap workspace shows and can revoke the current-session grants. Never treat a rejected or failed write as approved.
- Never run any git command for these files. The user commits themselves.
- Mindmap files stay inside the session working directory.`

function textOut(value) {
  return [{ type: 'text', text: String(value) }]
}

/**
 * 会话工作目录：工具执行的 agent → session → header.cwd（dsh-session 契约）。
 * 023 双路径：dsh ≤0.1.1 的 Agent 直挂 live session（agent.session.header.cwd）；
 * 0.1.2-rc.1 起 Agent 只剩 { id }，改经 sessions 服务按 id 查 header.cwd
 * （SessionStore.get / SessionHeader.cwd 两代同名）。旧链优先，新链兜底。
 */
function sessionCwd(exec, sessions) {
  const direct = exec?.agent?.session?.header?.cwd
  if (direct) return direct
  const id = exec?.agent?.id
  if (id && sessions?.get) {
    const cwd = sessions.get(id)?.header?.cwd
    if (cwd) return cwd
  }
  return undefined
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

/**
 * realpath 包含性校验（#5）：字符串规范化只挡字面 `..`，cwd 内指向外部
 * 的符号链接能骗过它。尾部不存在的段（待建文件）向上走最近的存在祖先
 * 逐个 realpath——符号链接只能藏在已存在的段里。解析后仍在 base 内返回
 * true；base 自身不存在或越界返回 false。
 */
async function resolvesInsideBase(resolved, base) {
  let realBase
  try {
    realBase = await realpath(base)
  } catch {
    return false
  }
  let probe = resolved
  for (;;) {
    try {
      const real = await realpath(probe)
      if (real === realBase) return true
      return !escapesBase(relative(realBase, real))
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error
      const parent = dirname(probe)
      if (parent === probe) return false
      probe = parent
    }
  }
}

/** 请求路径校验：缺省 = 根 cwd；显式路径必须绝对、落在 cwd 内，
 *  且解析符号链接后仍在内（#5）。 */
async function resolveTreePath(cwd, input) {
  if (!cwd) throw httpError(400, 'no-cwd', 'session has no working directory')
  if (input === undefined || input === null || String(input).trim() === '') return cwd
  const p = String(input).trim()
  if (!isAbsolute(p)) throw httpError(400, 'bad-request', `path must be absolute: ${JSON.stringify(p)}`)
  const resolved = resolvePath(p)
  const rel = relative(cwd, resolved)
  if (escapesBase(rel) || !(await resolvesInsideBase(resolved, cwd))) {
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
        // 022：到达上限即停（旧实现 continue 会把巨型目录整个遍历一遍）。
        // truncated 只取布尔语义，无需精确计数剩余条目。
        overflow = 1
        break
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

/** 本地时间 → `YYYYMMDD-HHmmss`。时间只由 host 读表，绝不交给模型猜。 */
function timestampStamp(date) {
  const pad = (value, width = 2) => String(value).padStart(width, '0')
  return `${pad(date.getFullYear(), 4)}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/**
 * AI 描述 → 默认名的描述段：折叠空白、按 sanitizeStem 同款安全规则拒绝越界字符、
 * 截断到 MAX_DESCRIPTION_CHARS。清理后为空（含只剩点号）一律拒绝，不静默造怪文件名。
 */
function sanitizeDescription(input) {
  const raw = String(input ?? '').replace(/\s+/g, ' ').trim().replace(/\.+$/, '')
  if (!raw) throw new Error('mindmap description must not be empty.')
  if (/[\\/:*?"<>|]/.test(raw)) throw new Error(`Invalid mindmap description ${JSON.stringify(input)}: path separators and :*?"<>| are not allowed.`)
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(raw)) throw new Error('Invalid mindmap description: control characters are not allowed.')
  const chars = [...raw]
  return chars.length > MAX_DESCRIPTION_CHARS ? chars.slice(0, MAX_DESCRIPTION_CHARS).join('') : raw
}

/** 默认脑图主干：`YYYYMMDD-HHmmss-中文描述`（例 20260918-155230-项目盘点）。 */
function defaultStem(date, description) {
  return `${timestampStamp(date)}-${sanitizeDescription(description)}`
}

/** create 参数里的显式目录（去空白）；缺省 = 走默认收件箱。 */
function explicitDirectory(args) {
  return typeof args?.directory === 'string' && args.directory.trim() ? args.directory.trim() : ''
}

/**
 * 一次 create 的路径计划——纯计算，不落盘，因此可以安全地在审批钩子里调用。
 * 主干与目录在此定死，`execute` 复用同一份（含同一时间戳），避免两处二次取时间
 * 算出不同文件名，让审批确认的路径和真正写入的路径脱节。
 * @returns {{stem: string, relative: string, defaultDir: boolean, autoNamed: boolean}}
 *   `defaultDir` = 落点由插件决定（需要时现建收件箱）；`autoNamed` = 主干由 host
 *   生成，撞名可以加后缀。两者互相独立：只给名字不给目录时进收件箱，但那是用户的
 *   命名意图，撞名了不能替他改名。
 */
function planCreatePaths(cwd, args, now = new Date()) {
  if (!cwd) throw new Error('The session has no working directory; cannot create a mindmap.')
  const directory = explicitDirectory(args)
  const explicitName = typeof args?.name === 'string' ? args.name.trim() : ''
  if (!explicitName && (typeof args?.description !== 'string' || !args.description.trim())) {
    throw new Error('mindmap_create needs either `name` (an explicit title) or `description` (a short phrase such as 项目盘点); the host supplies the timestamp.')
  }
  const stem = explicitName ? sanitizeStem(explicitName) : defaultStem(now, args?.description)
  return {
    stem,
    relative: join(directory || DEFAULT_MINDMAP_DIR, `${stem}.md`),
    defaultDir: !directory,
    autoNamed: !explicitName,
  }
}

/**
 * 解析脑图文件路径：相对路径以会话 cwd 为基；结果必须落在 cwd 内（决策 1），
 * 且必须以 .md 结尾。cwd 是文件授权边界，缺失时必须失败关闭。
 * @returns 绝对规范化路径。
 */
async function resolveMindmapPath(cwd, input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('path is required.')
  const p = input.trim()
  if (!/\.md$/i.test(p)) throw new Error(`mindmap path must end with .md: ${JSON.stringify(p)}.`)
  if (!cwd) throw new Error('The session has no working directory; cannot access a mindmap.')
  const resolved = resolvePath(cwd, p)
  const rel = relative(cwd, resolved)
  // realpath 兜底（#5）：写路径经符号链接越狱是安全敏感操作。
  if (rel === '' || escapesBase(rel) || !(await resolvesInsideBase(resolved, cwd))) {
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
 * 默认收件箱目录按需创建（036）：不在插件初始化时预生成，第一次需要时才落盘，
 * 已存在则直接复用（不重复 mkdir，免得碰用户目录的 mtime）。
 * 三条失败关闭：符号链接越界、同名普通文件占位、真建不出来（权限/只读盘）。
 * @returns 绝对目录路径。
 */
async function ensureDefaultDirectory(cwd) {
  const dir = resolvePath(cwd, DEFAULT_MINDMAP_DIR)
  const rel = relative(cwd, dir)
  if (escapesBase(rel) || !(await resolvesInsideBase(dir, cwd))) {
    throw new Error(`Mindmap directory must stay inside the session working directory (${cwd}).`)
  }
  let info = await stat(dir).catch(() => null)
  if (!info) {
    const failure = await mkdir(dir, { recursive: true }).then(() => null, (error) => error)
    info = await stat(dir).catch(() => null)
    if (!info) {
      // 并发创建下另一个调用可能刚建好（所以 stat 得到了结果）；这里仍拿不到，
      // 才是真失败——把 mkdir 的原始错误码带出去，别只报一句"建不出来"。
      throw new Error(`Cannot create the default mindmap directory ${JSON.stringify(dir)}: ${String(failure?.message ?? 'it vanished right after creation')}`)
    }
  }
  if (!info.isDirectory()) {
    throw new Error(`Cannot create the default mindmap directory: ${JSON.stringify(dir)} exists and is not a directory.`)
  }
  return dir
}

/**
 * 默认命名的候选主干：第 1 次原名，之后依次 `-2`、`-3`。
 * 后缀规则的唯一出口，挑名字和写文件都走它，避免两处算法各写一遍就漂。
 */
function stemForAttempt(stem, attempt) {
  return attempt > 1 ? `${stem}-${attempt}` : stem
}

/**
 * 收件箱里第一个没被占用的候选序号（纯探测，不建文件）。必须由**审批钩子**先跑一遍：
 * 确认框里报出的路径若已被上一个同秒创建占用，用户点的就不是真正会写的那条，会话授权
 * 也会登记到错文件上（036 并发一致性）。显式 `name` 不走这里——用户的命名意图优先，
 * 撞名不能替他改名。
 * @returns 候选序号（1 = 原名）。
 */
async function firstFreeAttempt(directory, stem, maxAttempts = MAX_CREATE_ATTEMPTS) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (!(await pathExists(join(directory, `${stemForAttempt(stem, attempt)}.md`)))) return attempt
  }
  throw new Error(`Too many mindmaps already share ${JSON.stringify(stem)} in this second; give the description more detail.`)
}

/**
 * 写入瞬间的路径复核（P1）：审批只代表"用户同意往这条路径写"，不是路径安全的
 * 长期保证——等待确认期间目录可能被改名、原位换成指向 cwd 外的符号链接。审批
 * 阶段的校验结论不能顶替落盘前的校验，每条候选都用当前文件系统状态重新解析。
 * @returns 重解析后的绝对路径（写盘用这一份，不用审批阶段缓存的）。
 */
async function resolveWriteTimeTarget(cwd, relativeTarget) {
  try {
    return await resolveMindmapPath(cwd, relativeTarget)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Refusing to create the mindmap at ${JSON.stringify(relativeTarget)}: ${detail} The target directory may have changed while the write was being confirmed; start the create again.`)
  }
}

/**
 * 原子新建空脑图：`wx` 不存在才创建，挡掉已存在与同名目录，无 TOCTOU 窗口。
 * 首选候选 `plan.relative`（= `stem` 第 `attempt` 号）——就是审批确认过的那条，
 * 绝大多数情况一次即中。默认命名只有在极窄的竞态窗口里（探测到写盘之间被别人
 * 抢注）才往后挪 -2、-3：覆盖别人的文件永远不可能发生，而挪了名之后授权由
 * `actualCreates` 跟着纠正，工具结果里的 `path` 也始终是真正落盘的那条。
 * 显式 `name` 只试一次、不改名。
 * 每条候选落盘前都过 `resolveWriteTimeTarget`（P1）：审批报的路径在确认期间被
 * 换成越界符号链接时，这里拒写，绝不把文件建到工作区外面。
 * @param {{relative: string, stem: string, attempt: number, autoNamed: boolean}} plan
 * @returns 实际创建出来的绝对路径。
 */
async function createMindmapFile(cwd, plan) {
  const { stem, attempt, autoNamed } = plan
  const relDirectory = dirname(plan.relative)
  const planned = join(cwd, plan.relative)
  const targetFor = (index) => resolveWriteTimeTarget(cwd, join(relDirectory, `${stemForAttempt(stem, index)}.md`))
  if (!autoNamed) {
    // 显式命名只试这一条：命名意图优先，撞名就报错让他去开那份旧的。
    try {
      const target = await targetFor(attempt)
      await writeFile(target, '', { encoding: 'utf8', flag: 'wx' })
      return target
    } catch (error) {
      if (error?.code === 'EEXIST' || error?.code === 'EISDIR') {
        throw new Error(`Mindmap already exists: ${JSON.stringify(planned)}. Open it with mindmap_open instead.`)
      }
      throw error
    }
  }
  for (let index = attempt; index <= MAX_CREATE_ATTEMPTS; index += 1) {
    try {
      const candidate = await targetFor(index)
      await writeFile(candidate, '', { encoding: 'utf8', flag: 'wx' })
      return candidate
    } catch (error) {
      if (error?.code !== 'EEXIST' && error?.code !== 'EISDIR') throw error
    }
  }
  throw new Error(`Cannot create mindmap ${JSON.stringify(planned)}: every nearby suffix is already taken, give the description more detail.`)
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

/** Stable document revision shared by read and write tool results. */
function revisionOfContent(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex')
}

/** 保守比较公共首尾之间被替换的旧文本；纯增量插入不算重写。 */
function isBroadRewrite(before, after) {
  if (!before || before === after) return false
  let prefix = 0
  const limit = Math.min(before.length, after.length)
  while (prefix < limit && before[prefix] === after[prefix]) prefix += 1
  let suffix = 0
  while (suffix < limit - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1
  const beforeBytes = byteLength(before)
  const removedBytes = byteLength(before.slice(prefix, before.length - suffix))
  if (removedBytes >= BROAD_REWRITE_MIN_BYTES) return true
  return beforeBytes >= BROAD_REWRITE_RATIO_MIN_BYTES && removedBytes / beforeBytes >= 0.5
}

/**
 * mindmap_open / mindmap_get 共用的有界读取。句柄打开后持续分块读取，文件在
 * 初检后增长也不会绕过上限；非常规文件直接拒绝。
 */
async function readMindmap(path) {
  const handle = await open(path, 'r')
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new Error('mindmap path must be a regular file.')
    if (info.size > MAX_READ_BYTES) {
      throw new Error(`mindmap size exceeds the ${MAX_READ_BYTES}-byte limit.`)
    }
    const chunks = []
    let total = 0
    let position = 0
    for (;;) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_READ_BYTES + 1 - total))
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position)
      if (bytesRead === 0) break
      total += bytesRead
      if (total > MAX_READ_BYTES) {
        throw new Error(`mindmap size exceeds the ${MAX_READ_BYTES}-byte limit.`)
      }
      chunks.push(chunk.subarray(0, bytesRead))
      position += bytesRead
    }
    return Buffer.concat(chunks, total).toString('utf8')
  } finally {
    await handle.close()
  }
}

/** 同目录临时文件完整落盘后再替换，任何写入失败都保留旧内容。 */
async function writeMindmap(path, content) {
  const temp = join(dirname(path), `.${randomUUID()}.mindmap-tmp`)
  const { mode } = await stat(path)
  let handle
  try {
    handle = await open(temp, 'wx', mode & 0o777)
    await handle.writeFile(content, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temp, path)
  } finally {
    if (handle) await handle.close().catch(() => {})
    await unlink(temp).catch(() => {})
  }
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
    requireApproval: config.requireApproval !== false,
    approvalMode: normalizeApprovalMode(config.approvalMode, config.requireApproval !== false),
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

  // 写入授权按 session + canonical document path 缓存；只在 tools/result 确认
  // 成功后写入，拒绝、失败或取消都不会消耗授权。WeakMap 随 session 生命周期
  // 自然释放，不把授权带到别的会话。
  let approvedTargets = new WeakMap()
  const pendingApprovals = new WeakMap()
  // 实际写盘路径：默认命名在「审批到写盘」之间被别人抢注时会挪到下一个空闲后缀，
  // 授权必须跟着记真实路径，不能把审批阶段的旧候选登记成本次会话的授权目标。
  const actualCreates = new WeakMap()
  let lastMode
  const readApprovalMode = () => {
    const value = activeConfig()
    const mode = normalizeApprovalMode(value.approvalMode, value.requireApproval)
    if (mode !== lastMode) {
      approvedTargets = new WeakMap()
      lastMode = mode
    }
    return mode
  }
  const stateOf = (session) => {
    if (!session || typeof session !== 'object') return null
    let state = approvedTargets.get(session)
    if (!state) {
      state = { paths: new Set(), generation: 0 }
      approvedTargets.set(session, state)
    }
    return state
  }
  const approvalStatusOf = (session) => {
    const state = session && typeof session === 'object' ? approvedTargets.get(session) : null
    return { mode: readApprovalMode(), grantedDocuments: state?.paths.size ?? 0 }
  }
  const revokeApproval = (session) => {
    if (!session || typeof session !== 'object') return approvalStatusOf(session)
    const state = stateOf(session)
    state.paths.clear()
    state.generation += 1
    return approvalStatusOf(session)
  }
  const sessionOf = (exec) => {
    const direct = exec?.agent?.session
    if (direct) return direct
    const id = exec?.agent?.id
    return id && ctx.sessions?.get ? ctx.sessions.get(id) ?? null : null
  }
  // 036：一次 create 的路径计划只算一遍，审批钩子与 execute 共用（含同一个时间戳）。
  // WeakMap 以 exec 为键，和 pendingApprovals 一样依赖「整个工具生命周期内 exec
  // 对象稳定」这一宿主契约；取不到缓存时 execute 自行重算，最多多要一次确认，
  // 不会把审批过的路径和写盘的路径搞混。
  const createPlans = new WeakMap()
  /**
   * 定稿一次 create 的落盘路径：纯计划 → 权威路径校验（越界与符号链接在这里拒）→
   * 默认命名避开已占用的名字 → 重算并再校验一次。顺序不能换：先校验才敢探测，
   * 否则 `.mindmaps` 是指向外部的符号链接时，探测会把外面的目录当成候选清单读。
   * 也不在这里建目录——用户可能当场拒绝，不能凭一次确认之前先落一只空目录。
   */
  const plannedCreate = async (exec, cwd, args) => {
    const cached = createPlans.get(exec)
    if (cached && cached.args === args) return cached.plan
    const base = planCreatePaths(cwd, args ?? {})
    const first = await resolveMindmapPath(cwd, base.relative)
    // 顺序不能换：先过权威路径校验才敢探测。`.mindmaps` 若是指向外部的符号链接，
    // 上面这一步已经拒了，不会把别人的目录当成候选清单来读。
    const attempt = base.autoNamed ? await firstFreeAttempt(dirname(first), base.stem) : 1
    const path = attempt === 1 ? first : await resolveMindmapPath(cwd, join(dirname(base.relative), `${stemForAttempt(base.stem, attempt)}.md`))
    const plan = { ...base, attempt, path }
    createPlans.set(exec, { args, plan })
    return plan
  }
  const targetOf = async (exec) => {
    const args = exec.arguments ?? {}
    const cwd = sessionCwd(exec, ctx.sessions)
    if (exec.name === 'mindmap_create') {
      try {
        // 审批目标 = 校验过、且已避开占用名字的最终绝对路径：确认的就是真正会写的那条。
        return (await plannedCreate(exec, cwd, args)).path
      } catch {
        // Let the tool return its normal argument error; approval lookup must
        // never turn malformed input into a hook-level exception.
        return `mindmap_create:${typeof args.name === 'string' ? args.name.trim() : '?'}`
      }
    }
    const raw = typeof args.path === 'string' ? args.path.trim() : ''
    if (cwd && raw) {
      try { return await resolveMindmapPath(cwd, raw) } catch { /* 工具本身负责报告参数错误 */ }
    }
    return `${exec.name}:${raw || '?'}`
  }

  const needsRewriteApproval = async (exec, target, content) => {
    if (exec.name !== 'mindmap_update' || typeof content !== 'string') return false
    // 缺少会话工作目录或参数尚未解析时，交给工具本身报告参数错误；不要让
    // 审批钩子把普通的兼容关闭误判成高风险写入。
    if (!isAbsolute(target)) return false
    if (byteLength(content) > MAX_CONTENT_BYTES) return true
    try {
      const before = await readMindmap(target)
      return isBroadRewrite(before, content)
    } catch (error) {
      if (error?.code === 'ENOENT') return false
      // 无法判断风险时不复用授权；具体读取错误仍由工具报告。
      return true
    }
  }

  // 022：create 同为写路径，一并纳入审批；高风险 renameRoot 不复用普通授权。
  ctx.on('tools/pre-execute', async (exec, next) => {
    const decision = await next()
    if (decision.kind !== 'allow') return decision
    if (exec.name !== 'mindmap_create' && exec.name !== 'mindmap_update') return decision
    const args = exec.arguments ?? {}
    const session = sessionOf(exec)
    const target = await targetOf(exec)
    const rename = exec.name === 'mindmap_update' && typeof args.renameRoot === 'string' && args.renameRoot.trim()
    const deleteDocument = exec.name === 'mindmap_update' && typeof args.content === 'string' && args.content.trim() === ''
    const mode = readApprovalMode()
    const broadRewrite = await needsRewriteApproval(exec, target, args.content)
    const highRisk = Boolean(rename || deleteDocument || broadRewrite)
    const state = stateOf(session)
    if (mode === 'off' && !highRisk) return decision
    if (mode === 'session' && !highRisk && state?.paths.has(target)) return decision
    if (mode === 'session' && !highRisk && state) pendingApprovals.set(exec, { session, target, state, generation: state.generation })
    if (exec.name === 'mindmap_create') {
      const title = String(target).split(/[\\/]/).pop()?.replace(/\.md$/i, '') ?? '?'
      return {
        kind: 'ask',
        reason: `Create mindmap ${JSON.stringify(title)} at ${JSON.stringify(target)}. ${mode === 'per-operation' ? 'Confirm this write.' : 'Confirm once for this document in the current session.'}`,
      }
    }
    const renameNote = rename ? `, rename root to "${args.renameRoot}"` : ''
    const bytes = typeof args.content === 'string' ? byteLength(args.content) : 0
    return {
      kind: 'ask',
      reason: `${rename ? 'Rename and write' : deleteDocument ? 'Delete mindmap content' : broadRewrite ? 'Broad rewrite' : 'Write'} mindmap ${JSON.stringify(String(args.path ?? '?'))} (${bytes} bytes${renameNote}). ${highRisk ? 'This operation always requires confirmation.' : mode === 'per-operation' ? 'Confirm this write.' : 'Confirm once for this document in the current session.'}`,
    }
  })

  // Mark the document only after the authoritative result is successful. The
  // listener sees the same frozen execution object as pre-execute, so rejected,
  // cancelled, and failed writes never grant future writes.
  ctx.on('tools/result', (exec, result) => {
    const pending = pendingApprovals.get(exec)
    if (!pending) return
    pendingApprovals.delete(exec)
    if (result?.isError !== false || exec.signal?.aborted) return
    if (readApprovalMode() !== 'session') return
    // 撤销或策略切换之后，尚未结束的旧调用不能重新恢复授权。
    if (approvedTargets.get(pending.session) !== pending.state || pending.state.generation !== pending.generation) return
    // 审批后被抢注、实际写到了 -2 的情形：授权记真实路径，不记用户没见过的那条。
    const actual = actualCreates.get(exec)
    if (actual) actualCreates.delete(exec)
    pending.state.paths.add(actual ?? pending.target)
  })

  ctx.tools.register(defineTool({
    name: 'mindmap_create',
    description: `Create a new mindmap markdown file and show it in the mindmap panel. Fails if the file already exists. The filename becomes the root node title. Pass \`name\` when the user gave an explicit title, otherwise pass \`description\` and the file is auto-named YYYYMMDD-HHmmss-<description>.md inside the default mindmap inbox (${DEFAULT_MINDMAP_DIR}/) — the host picks the next free -2/-3 suffix when that name is already taken, so nothing is ever overwritten. Only pass \`directory\` when the user chose a location.`,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Explicit mindmap document name (without .md). Becomes the filename and the root node title; a name collision is reported instead of auto-renaming. Omit it for a quick capture and pass `description` instead.' },
        description: { type: 'string', description: `Short phrase for the auto-generated filename when \`name\` is omitted (e.g. 项目盘点). Cleaned and truncated to ${MAX_DESCRIPTION_CHARS} characters. Never put a date or time here — the host stamps the real current time.` },
        directory: { type: 'string', description: `Directory relative to the session working directory, only when the user picked one (it must already exist). Omit it to file the mindmap in the default inbox ${DEFAULT_MINDMAP_DIR}/, which is created on first use.` },
      },
      required: [],
    },
    output: { schema: { type: 'string' }, render: (_args, value) => textOut(value) },
    timeoutMs: TOOL_TIMEOUT_MS,
    async execute(args, exec) {
      const cwd = sessionCwd(exec, ctx.sessions)
      const plan = await plannedCreate(exec, cwd, args)
      // 默认收件箱按需建；显式目录沿用既有边界（不代建，越界与不存在都直接失败）。
      if (plan.defaultDir) await ensureDefaultDirectory(cwd)
      // 审批阶段的 plan 只能当作「确认过哪条路径」的备忘，写盘前由 createMindmapFile
      // 重新解析校验，确认期间目录被掉包不会把文件写到工作区外。
      const created = await createMindmapFile(cwd, plan)
      actualCreates.set(exec, created)
      return buildResult('create', created, { content: '', created: true, revision: revisionOfContent('') })
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
      const path = await resolveMindmapPath(sessionCwd(exec, ctx.sessions), args?.path)
      const content = await readMindmap(path)
      return buildResult('open', path, { content, revision: revisionOfContent(content) })
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
      const path = await resolveMindmapPath(sessionCwd(exec, ctx.sessions), args?.path)
      const content = await readMindmap(path)
      return buildResult('get', path, { content, revision: revisionOfContent(content) })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mindmap_update',
    description: 'Write the FULL updated markdown of a mindmap document. Call mindmap_get first, then send the complete new content. When the edit has several parts, call once per finished part (always full content) so the panel grows the new nodes step by step. Optionally renameRoot to change the root title (renames the file; fails on name collision).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the .md file, relative to the session working directory or absolute.' },
        content: { type: 'string', description: 'The complete new markdown content of the document.' },
        renameRoot: { type: 'string', description: 'Optional new root title: renames the file to <renameRoot>.md. Only when the user asks to rename the root node.' },
        expectedRevision: { type: 'string', description: 'Optional revision returned by mindmap_get or mindmap_open. The write is rejected if the file changed since that read.' },
      },
      required: ['path'],
    },
    output: { schema: { type: 'string' }, render: (_args, value) => textOut(value) },
    timeoutMs: TOOL_TIMEOUT_MS,
    async execute(args, exec) {
      const cwd = sessionCwd(exec, ctx.sessions)
      const path = await resolveMindmapPath(cwd, args?.path)
      const hasContent = typeof args?.content === 'string'
      if (!hasContent && typeof args?.renameRoot !== 'string') {
        throw new Error('mindmap_update requires content (or renameRoot alone for a pure rename).')
      }
      if (hasContent && byteLength(args.content) > MAX_CONTENT_BYTES) {
        throw new Error(`mindmap content exceeds the ${MAX_CONTENT_BYTES}-byte limit.`)
      }
      if (!(await pathExists(path))) throw new Error(`Mindmap not found: ${JSON.stringify(path)}. Create it with mindmap_create first.`)
      const expectedRevision = typeof args?.expectedRevision === 'string' && args.expectedRevision ? args.expectedRevision : null
      if (expectedRevision) {
        const currentContent = await readMindmap(path)
        const currentRevision = revisionOfContent(currentContent)
        if (currentRevision !== expectedRevision) {
          throw new Error(`Mindmap changed since it was read (expected ${expectedRevision}, found ${currentRevision}). Reload it before writing.`)
        }
      }

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
      if (hasContent) await writeMindmap(finalPath, args.content)
      const content = hasContent ? args.content : await readMindmap(finalPath)
      return buildResult('update', finalPath, { content, revision: revisionOfContent(content), ...(renamedFrom ? { renamedFrom } : {}) })
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
        if (method !== 'tree' && method !== 'document' && method !== 'approval') {
          sendJson(res, 404, { ok: false, error: { code: 'not-found', message: `unknown mindmap API method ${JSON.stringify(method)}` } })
          return
        }
        const payload = await readJsonBody(req)
        const sessionId = payload.sessionId
        if (typeof sessionId !== 'string' || !sessionId) {
          sendJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'missing or invalid "sessionId"' } })
          return
        }
        if (method === 'approval') {
          const session = ctx.sessions?.get?.(sessionId)
          if (!session) {
            sendJson(res, 400, { ok: false, error: { code: 'unknown-session', message: 'unknown session' } })
            return
          }
          const value = payload.action === 'revoke' ? revokeApproval(session) : approvalStatusOf(session)
          sendJson(res, 200, { ok: true, value })
          return
        }
        const cwd = sessionCwdOf(ctx.sessions, sessionId)
        if (!cwd) {
          sendJson(res, 400, { ok: false, error: { code: 'no-cwd', message: 'session has no working directory' } })
          return
        }
        if (method === 'document') {
          const path = await resolveMindmapPath(cwd, payload.path)
          const content = await readMindmap(path)
          sendJson(res, 200, { ok: true, value: { path, content, revision: revisionOfContent(content) } })
          return
        }
        const dir = await resolveTreePath(cwd, payload.path)
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
  APPROVAL_MODES,
  normalizeApprovalMode,
  MAX_CONTENT_BYTES,
  MAX_READ_BYTES,
  DEFAULT_MINDMAP_DIR,
  MAX_DESCRIPTION_CHARS,
  readMindmap,
  writeMindmap,
  sanitizeStem,
  sanitizeDescription,
  timestampStamp,
  defaultStem,
  stemForAttempt,
  firstFreeAttempt,
  planCreatePaths,
  ensureDefaultDirectory,
  createMindmapFile,
  resolveWriteTimeTarget,
  resolveMindmapPath,
  sessionCwd,
  sessionCwdOf,
  resolveTreePath,
  listDirectoryLevel,
  isTrustedRequest,
  buildResult,
  revisionOfContent,
})
