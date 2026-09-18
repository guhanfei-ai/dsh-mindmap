import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { apply, internals } from '../index.js'

const {
  DEFAULT_MINDMAP_DIR,
  sanitizeStem,
  sanitizeDescription,
  timestampStamp,
  planCreatePaths,
  stemForAttempt,
  firstFreeAttempt,
  createMindmapFile,
  resolveWriteTimeTarget,
  resolveMindmapPath,
  resolveTreePath,
  listDirectoryLevel,
  isTrustedRequest,
  buildResult,
} = internals

function execution(cwd) {
  return {
    signal: new AbortController().signal,
    agent: { session: { header: { cwd } } },
  }
}

function createContext(config = {}) {
  const tools = []
  const sections = []
  const listeners = new Map()
  const routes = []
  const sessions = new Map()
  let settingsState
  const ctx = {
    on(name, listener) {
      listeners.set(name, listener)
      return () => listeners.delete(name)
    },
    systemPrompt: {
      section(section) {
        sections.push(section)
      },
    },
    tools: {
      register(tool) {
        tools.push(tool)
        return () => {}
      },
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    sessions: {
      get(id) {
        return sessions.get(id)
      },
    },
    effect(fn) {
      fn()
      return () => {}
    },
    // 015 settings 命名空间注入：模拟 dsh-settings 的注册面（config → base）。
    inject(names, callback) {
      if (names && names.includes('settings')) {
        callback({
          settings: {
            register(ns, schema, options = {}) {
              const base = options.base ?? {}
              settingsState = { ...base }
              return {
                get: () => ({
                  requireApproval: settingsState.requireApproval !== false,
                  approvalMode: settingsState.approvalMode ?? 'session',
                  defaultPanelWidth: typeof settingsState.defaultPanelWidth === 'number' ? settingsState.defaultPanelWidth : 42,
                  lineStyle: settingsState.lineStyle === 'curve' ? 'curve' : 'elbow',
                  cardStyle: settingsState.cardStyle === 'square' ? 'square' : 'rounded',
                  colorTheme: settingsState.colorTheme ?? 'ocean',
                  growthAnimation: settingsState.growthAnimation !== false,
                }),
                update: async () => {},
              }
            },
          },
          effect(fn) {
            fn()
            return () => {}
          },
        })
      }
    },
  }
  apply(ctx, config)
  const byName = (name) => {
    const tool = tools.find((t) => t.name === name)
    if (!tool) throw new Error(`tool not registered: ${name}`)
    return tool
  }
  return { tools, sections, listeners, routes, sessions, byName, get settingsState() { return settingsState } }
}

async function tmpWorkspace() {
  return mkdtemp(join(tmpdir(), 'dsh-mindmap-test-'))
}

function parseResult(value) {
  return JSON.parse(value)
}

/** 取回 create 审批里用户实际确认的那条路径（reason 中以 `at "<path>"` 呈现）。 */
function approvedPath(decision) {
  const found = /at "((?:[^"\\]|\\.)*)"/.exec(decision?.reason ?? '')
  if (!found) throw new Error(`approval reason lost the target path: ${decision?.reason}`)
  return JSON.parse(`"${found[1]}"`)
}

test('apply registers the four tools and the GUIDANCE section', () => {
  const { tools, sections } = createContext()
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    ['mindmap_create', 'mindmap_get', 'mindmap_open', 'mindmap_update'],
  )
  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, 'tool:mindmap')
  assert.ok(sections[0].text.includes('Never run any git command'))
  assert.ok(sections[0].text.includes('steps away or pauses'))
  // 019 分步更新约定：配合面板生长动画，每完成一小块就 update 一次（永远全量）。
  assert.ok(sections[0].text.includes('Update step by step'))
  assert.ok(sections[0].text.includes('never a fragment'))
})

test('mindmap_create files an explicit name into the inbox and reports root title', async () => {
  const cwd = await tmpWorkspace()
  const { byName } = createContext()
  const result = parseResult(await byName('mindmap_create').execute({ name: '产品规划' }, execution(cwd)))
  assert.equal(result.ok, true)
  assert.equal(result.op, 'create')
  assert.equal(result.path, join(cwd, DEFAULT_MINDMAP_DIR, '产品规划.md'))
  assert.equal(result.rootTitle, '产品规划')
  assert.equal(result.content, '')
  assert.equal(await readFile(join(cwd, DEFAULT_MINDMAP_DIR, '产品规划.md'), 'utf8'), '')
  // 036：收件箱按需创建，且不替用户动 .gitignore——脑图是普通 Markdown，
  // 审阅、diff、提交由用户自己决定。
  assert.deepEqual(await readdir(cwd), [DEFAULT_MINDMAP_DIR])
})

test('mindmap_create auto-names a nameless request with the host timestamp', async () => {
  const cwd = await tmpWorkspace()
  const { byName } = createContext()
  const result = parseResult(await byName('mindmap_create').execute({ description: '项目盘点' }, execution(cwd)))
  assert.match(result.path, new RegExp(`^${join(cwd, DEFAULT_MINDMAP_DIR).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/\\d{8}-\\d{6}-项目盘点\\.md$`))
  assert.match(result.rootTitle, /^\d{8}-\d{6}-项目盘点$/)
  assert.equal(await readFile(result.path, 'utf8'), '')
  // 根标题暂时带上时间戳（036 第四节）：文件名与显示标题分离是独立需求。
  assert.equal(JSON.parse(await byName('mindmap_get').execute({ path: result.path }, execution(cwd))).op, 'get')
})

test('mindmap_create reuses an existing inbox without disturbing it', async () => {
  const cwd = await tmpWorkspace()
  const dir = join(cwd, DEFAULT_MINDMAP_DIR)
  await mkdir(dir)
  await writeFile(join(dir, 'keep.md'), '# keep\n', 'utf8')
  const { byName } = createContext()
  const first = parseResult(await byName('mindmap_create').execute({ description: '第一颗' }, execution(cwd)))
  const second = parseResult(await byName('mindmap_create').execute({ description: '第二颗' }, execution(cwd)))
  assert.notEqual(first.path, second.path)
  assert.deepEqual(
    (await readdir(dir)).sort(),
    ['keep.md', first.path.split('/').pop(), second.path.split('/').pop()].sort(),
  )
  assert.equal(await readFile(join(dir, 'keep.md'), 'utf8'), '# keep\n')
})

test('mindmap_create requires either a name or a description', async () => {
  const cwd = await tmpWorkspace()
  const { byName } = createContext()
  const create = byName('mindmap_create')
  await assert.rejects(create.execute({}, execution(cwd)), /needs either `name`/)
  await assert.rejects(create.execute({ description: '   ' }, execution(cwd)), /needs either `name`/)
  await assert.rejects(create.execute({ name: '  ' }, execution(cwd)), /needs either `name`/)
})

test('timestampStamp renders local time as YYYYMMDD-HHmmss with zero padding', () => {
  assert.equal(timestampStamp(new Date(2026, 0, 5, 9, 8, 7)), '20260105-090807')
  assert.equal(timestampStamp(new Date(2026, 8, 18, 15, 52, 30)), '20260918-155230')
})

test('sanitizeDescription cleans whitespace, truncates and rejects unsafe phrases', () => {
  assert.equal(sanitizeDescription('  项目   盘点 '), '项目 盘点')
  assert.equal(sanitizeDescription('迭代计划。'), '迭代计划。')
  assert.equal(sanitizeDescription('x'.repeat(internals.MAX_DESCRIPTION_CHARS + 12)).length, internals.MAX_DESCRIPTION_CHARS)
  // 截断只按字符数走，不切开代理对（emoji 是一个 code point）。
  assert.equal([...sanitizeDescription('🧠'.repeat(30))].length, internals.MAX_DESCRIPTION_CHARS)
  assert.throws(() => sanitizeDescription(''), /must not be empty/)
  assert.throws(() => sanitizeDescription('  ..  '), /must not be empty/)
  assert.throws(() => sanitizeDescription('a/b'), /not allowed/)
  assert.throws(() => sanitizeDescription('a\\b'), /not allowed/)
  // eslint-disable-next-line no-control-regex
  assert.throws(() => sanitizeDescription('a\u0007b'), /control characters/)
})

test('planCreatePaths is pure and pins the stamp for both approval and execute', () => {
  const now = new Date(2026, 8, 18, 15, 52, 30)
  assert.deepEqual(planCreatePaths('/w', { description: '项目盘点' }, now), {
    stem: '20260918-155230-项目盘点',
    relative: join('.mindmaps', '20260918-155230-项目盘点.md'),
    defaultDir: true,
    autoNamed: true,
  })
  // 显式名 + 无目录：落进收件箱，但主干是用户的命名意图，不能自动改名。
  const explicit = planCreatePaths('/w', { name: '路线图' }, now)
  assert.deepEqual([explicit.stem, explicit.defaultDir, explicit.autoNamed], ['路线图', true, false])
  // 显式目录优先，且没有 `.mindmaps` 影子。
  const placed = planCreatePaths('/w', { name: '架构', directory: 'docs' }, now)
  assert.deepEqual([placed.relative, placed.defaultDir], [join('docs', '架构.md'), false])
  assert.throws(() => planCreatePaths(null, { description: 'x' }, now), /no working directory/)
})

test('stemForAttempt and firstFreeAttempt pick the next free default name', async () => {
  assert.equal(stemForAttempt('stem', 1), 'stem')
  assert.equal(stemForAttempt('stem', 2), 'stem-2')
  assert.equal(stemForAttempt('stem', 3), 'stem-3')
  const dir = await tmpWorkspace()
  assert.equal(await firstFreeAttempt(dir, 'stem'), 1)
  await writeFile(join(dir, 'stem.md'), '# 已有\n', 'utf8')
  await writeFile(join(dir, 'stem-2.md'), '', 'utf8')
  assert.equal(await firstFreeAttempt(dir, 'stem'), 3)
  // 目录不存在（收件箱还没建）时不报错，首个候选即空位。
  assert.equal(await firstFreeAttempt(join(dir, 'nope'), 'stem'), 1)
})

test('createMindmapFile prefers the approved candidate and steps only when it is taken', async () => {
  const dir = await tmpWorkspace()
  const plan = (stem, attempt = 1, autoNamed = true) => ({ relative: `${stem}.md`, stem, attempt, autoNamed })
  // 候选空着就写候选，一个字节都不挪。
  assert.equal(await createMindmapFile(dir, plan('free')), join(dir, 'free.md'))
  await writeFile(join(dir, 'stem.md'), '# 已有内容\n', 'utf8')
  // 审批到写盘之间被别人抢注：往后挪一个空闲后缀，且绝不覆盖抢注者的字节。
  assert.equal(await createMindmapFile(dir, plan('stem')), join(dir, 'stem-2.md'))
  assert.equal(await readFile(join(dir, 'stem.md'), 'utf8'), '# 已有内容\n')
  // 显式命名维持既有语义：只试那一条，撞名报错让他去开那份旧的，绝不代他改名。
  await assert.rejects(createMindmapFile(dir, plan('stem', 1, false)), /already exists.*mindmap_open/)
  assert.deepEqual((await readdir(dir)).sort(), ['free.md', 'stem-2.md', 'stem.md'])
})

test('resolveWriteTimeTarget re-resolves the path and rejects a directory swapped for an outside symlink', async () => {
  const dir = await tmpWorkspace()
  const outside = await tmpWorkspace()
  assert.equal(await resolveWriteTimeTarget(dir, 'notes/x.md'), join(dir, 'notes', 'x.md'))
  await mkdir(join(dir, 'notes'))
  await rename(join(dir, 'notes'), join(dir, 'notes-old'))
  await symlink(outside, join(dir, 'notes'))
  // 审批阶段这条路径合法；写盘瞬间重解析发现它已经出界，一律拒。
  await assert.rejects(resolveWriteTimeTarget(dir, 'notes/x.md'), /Refusing to create the mindmap.*stay inside/)
  await assert.rejects(resolveMindmapPath(dir, 'notes/x.md'), /stay inside/)
  assert.deepEqual(await readdir(outside), [])
})

test('mindmap_create can create inside a relative directory without escaping cwd', async () => {
  const cwd = await tmpWorkspace()
  await mkdir(join(cwd, 'notes'))
  const { byName } = createContext()
  const result = parseResult(await byName('mindmap_create').execute({ name: 'roadmap', directory: 'notes' }, execution(cwd)))
  assert.equal(result.path, join(cwd, 'notes', 'roadmap.md'))
  assert.equal(await readFile(join(cwd, 'notes', 'roadmap.md'), 'utf8'), '')
  await assert.rejects(byName('mindmap_create').execute({ name: 'escape', directory: '../outside' }, execution(cwd)), /stay inside/)
})

test('mindmap_create accepts a name with .md suffix and rejects unsafe names', async () => {
  const cwd = await tmpWorkspace()
  const { byName } = createContext()
  const create = byName('mindmap_create')
  const result = parseResult(await create.execute({ name: 'notes.md' }, execution(cwd)))
  assert.equal(result.path, join(cwd, DEFAULT_MINDMAP_DIR, 'notes.md'))
  await assert.rejects(create.execute({ name: 'a/b' }, execution(cwd)), /not allowed/)
  await assert.rejects(create.execute({ name: '..' }, execution(cwd)), /Invalid mindmap name/)
  // 只有空白的名等同于没给名：报「二选一」比报「名字不能为空」更可执行。
  await assert.rejects(create.execute({ name: '  ' }, execution(cwd)), /needs either `name`/)
  await assert.rejects(create.execute({ name: 'x'.repeat(81) }, execution(cwd)), /must not exceed/)
})

test('mindmap_create fails when the file already exists', async () => {
  const cwd = await tmpWorkspace()
  const { byName } = createContext()
  await byName('mindmap_create').execute({ name: 'dup' }, execution(cwd))
  await assert.rejects(byName('mindmap_create').execute({ name: 'dup' }, execution(cwd)), /already exists/)
})

test('mindmap_create rejects an inbox blocked by a same-named file', async () => {
  const cwd = await tmpWorkspace()
  await writeFile(join(cwd, DEFAULT_MINDMAP_DIR), 'not a directory', 'utf8')
  const { byName } = createContext()
  await assert.rejects(
    byName('mindmap_create').execute({ description: '无处安放' }, execution(cwd)),
    /exists and is not a directory/,
  )
  assert.equal(await readFile(join(cwd, DEFAULT_MINDMAP_DIR), 'utf8'), 'not a directory')
})

test('mindmap_create rejects an inbox symlinked out of the working directory', async () => {
  const cwd = await tmpWorkspace()
  const outside = await tmpWorkspace()
  await symlink(outside, join(cwd, DEFAULT_MINDMAP_DIR))
  const { byName } = createContext()
  await assert.rejects(
    byName('mindmap_create').execute({ description: '越狱' }, execution(cwd)),
    /stay inside/,
  )
  assert.deepEqual(await readdir(outside), [])
})

test('the approval target of a default create is the path actually written', async () => {
  const cwd = await tmpWorkspace()
  const session = { header: { cwd } }
  const { listeners, byName } = createContext({ approvalMode: 'session' })
  const listener = listeners.get('tools/pre-execute')
  const resultListener = listeners.get('tools/result')
  const args = { description: '待确认' }
  const exec = { ...execution(cwd), agent: { session }, name: 'mindmap_create', arguments: args }
  const ask = await listener(exec, async () => ({ kind: 'allow' }))
  assert.equal(ask.kind, 'ask')
  const target = approvedPath(ask)
  assert.equal(target, join(cwd, DEFAULT_MINDMAP_DIR, `${target.split('/').pop()}`))
  assert.match(target.split('/').pop(), /^\d{8}-\d{6}-待确认\.md$/)
  // 审批算出的路径必须就是写盘的那条：否则会话授权既记错文件、又白要一次确认。
  const created = parseResult(await byName('mindmap_create').execute(args, exec))
  assert.equal(created.path, target)
  resultListener(exec, { isError: false })
  assert.deepEqual(await listener(exec, async () => ({ kind: 'allow' })), { kind: 'allow' })
})

test('the approval candidate is always a free name, and the write lands exactly there', async () => {
  const cwd = await tmpWorkspace()
  const inbox = join(cwd, DEFAULT_MINDMAP_DIR)
  const session = { header: { cwd } }
  const { listeners, byName } = createContext({ approvalMode: 'session' })
  const listener = listeners.get('tools/pre-execute')
  const args = { description: '项目盘点' }
  const first = parseResult(await byName('mindmap_create').execute(args, execution(cwd)))
  // 连做两轮「审批 → 写盘」：第二轮若与第一轮同秒，探测必须把 -2 报出来；
  // 跨到下一秒则是全新名字。两种情况下不变式都一样——确认的路径没被占用。
  for (let round = 0; round < 2; round += 1) {
    const exec = { ...execution(cwd), agent: { session }, name: 'mindmap_create', arguments: args }
    const target = approvedPath(await listener(exec, async () => ({ kind: 'allow' })))
    assert.equal((await readdir(inbox)).includes(target.split('/').pop()), false, round)
    // 确认框不能报一条已经被占用、因此必定写不进去的路径：那等于让用户确认一个
    // 永远不会存在的文件，而实际写盘的 -2 他从没见过。
    assert.notEqual(target, first.path)
    const created = parseResult(await byName('mindmap_create').execute(args, exec))
    assert.equal(created.path, target, round)
    assert.equal(created.rootTitle, target.split('/').pop().replace(/\.md$/, ''), round)
  }
  const names = await readdir(inbox)
  assert.equal(names.length, 3)
  assert.equal(await readFile(first.path, 'utf8'), '')
})

test('a default name claimed while the confirmation is pending rebinds the grant to the real path', async () => {
  const cwd = await tmpWorkspace()
  const inbox = join(cwd, DEFAULT_MINDMAP_DIR)
  const session = { header: { cwd } }
  const { listeners, byName } = createContext({ approvalMode: 'session' })
  const listener = listeners.get('tools/pre-execute')
  const resultListener = listeners.get('tools/result')
  const allow = async () => ({ kind: 'allow' })
  const args = { description: '并发盘点' }
  const exec = { ...execution(cwd), agent: { session }, name: 'mindmap_create', arguments: args }
  const approved = approvedPath(await listener(exec, allow))
  // 用户还在读确认框，另一个调用把这个名字抢注了——探测与写盘之间唯一的残留窗口。
  await mkdir(inbox, { recursive: true })
  await writeFile(approved, '# 别人先建的\n', 'utf8')
  const created = parseResult(await byName('mindmap_create').execute(args, exec))
  // 抢注者的字节分毫未动，本次只挪到下一个空闲后缀，且没有半成品。
  assert.equal(await readFile(approved, 'utf8'), '# 别人先建的\n')
  assert.deepEqual((await readdir(inbox)).sort(), [approved, created.path].map((p) => p.split('/').pop()).sort())
  // 工具结果报出的必须是真实落盘路径（用户可见的最终路径）。
  assert.notEqual(created.path, approved)
  assert.equal(created.path, join(inbox, `${approved.split('/').pop().replace(/\.md$/, '')}-2.md`))
  assert.equal(created.rootTitle, created.path.split('/').pop().replace(/\.md$/, ''))
  resultListener(exec, { isError: false })
  const relOf = (path) => `${DEFAULT_MINDMAP_DIR}/${path.split('/').pop()}`
  const update = (path) => ({ ...execution(cwd), agent: { session }, name: 'mindmap_update', arguments: { path: relOf(path), content: 'x' } })
  // 会话授权记的是实际创建的那条：新文档免确认，抢注者那份仍须单独确认。
  assert.deepEqual(await listener(update(created.path), allow), { kind: 'allow' })
  assert.equal((await listener(update(approved), allow)).kind, 'ask')
})

test('a directory replaced by an outside symlink during the confirmation window blocks the write', async () => {
  const cwd = await tmpWorkspace()
  const outside = await tmpWorkspace()
  await mkdir(join(cwd, 'notes'))
  const session = { header: { cwd } }
  const { listeners, byName } = createContext({ approvalMode: 'session' })
  const listener = listeners.get('tools/pre-execute')
  const resultListener = listeners.get('tools/result')
  const allow = async () => ({ kind: 'allow' })
  const args = { name: 'review', directory: 'notes' }
  const exec = { ...execution(cwd), agent: { session }, name: 'mindmap_create', arguments: args }
  // 审批确认的是当时合法的 cwd 内路径。
  assert.equal(approvedPath(await listener(exec, allow)), join(cwd, 'notes', 'review.md'))
  // 用户还在读确认框：目录被改名，原位换成指向工作区外的符号链接。
  await rename(join(cwd, 'notes'), join(cwd, 'notes-old'))
  await symlink(outside, join(cwd, 'notes'))
  // 审批阶段查过不算数：写盘前按当前文件系统重新解析，越界一律拒。
  await assert.rejects(byName('mindmap_create').execute(args, exec), /Refusing to create the mindmap/)
  assert.deepEqual(await readdir(outside), [])
  // 工作区内的原目录还在原地，只是被改了名，没有被覆盖或塞进文件。
  assert.deepEqual(await readdir(join(cwd, 'notes-old')), [])
  assert.deepEqual((await readdir(cwd)).sort(), ['notes', 'notes-old'])
  // 失败结果不发授权：目录恢复原样后，同一条路径仍须重新确认才能写。
  resultListener(exec, { isError: true })
  await rm(join(cwd, 'notes'))
  await rename(join(cwd, 'notes-old'), join(cwd, 'notes'))
  const update = { ...execution(cwd), agent: { session }, name: 'mindmap_update', arguments: { path: 'notes/review.md', content: 'x' } }
  assert.equal((await listener(update, allow)).kind, 'ask')
})

test('an inbox swapped for an outside symlink during the confirmation window blocks the write', async () => {
  const cwd = await tmpWorkspace()
  const outside = await tmpWorkspace()
  const session = { header: { cwd } }
  const { listeners, byName } = createContext({ approvalMode: 'session' })
  const listener = listeners.get('tools/pre-execute')
  const args = { description: '越狱' }
  const exec = { ...execution(cwd), agent: { session }, name: 'mindmap_create', arguments: args }
  // 审批时收件箱还不存在，计划的是「第一次需要时按需创建」。
  assert.equal(dirname(approvedPath(await listener(exec, async () => ({ kind: 'allow' })))), join(cwd, DEFAULT_MINDMAP_DIR))
  // 确认期间收件箱位置被占成指向工作区外的符号链接。
  await symlink(outside, join(cwd, DEFAULT_MINDMAP_DIR))
  await assert.rejects(byName('mindmap_create').execute(args, exec), /stay inside/)
  assert.deepEqual(await readdir(outside), [])
})

test('inbox paths round-trip through open, get, update and renameRoot', async () => {
  const cwd = await tmpWorkspace()
  const { byName } = createContext()
  const created = parseResult(await byName('mindmap_create').execute({ description: '迭代计划' }, execution(cwd)))
  const rel = `${DEFAULT_MINDMAP_DIR}/${created.path.split('/').pop()}`
  const opened = parseResult(await byName('mindmap_open').execute({ path: rel }, execution(cwd)))
  assert.equal(opened.path, created.path)
  assert.equal(opened.rootTitle, created.rootTitle)
  const updated = parseResult(await byName('mindmap_update').execute(
    { path: rel, content: '# 迭代计划\n- 目标\n', expectedRevision: opened.revision },
    execution(cwd),
  ))
  assert.equal(updated.path, created.path)
  assert.equal(await readFile(created.path, 'utf8'), '# 迭代计划\n- 目标\n')
  const renamed = parseResult(await byName('mindmap_update').execute({ path: rel, renameRoot: '本季度迭代' }, execution(cwd)))
  assert.equal(renamed.renamedFrom, created.path)
  assert.equal(renamed.path, join(cwd, DEFAULT_MINDMAP_DIR, '本季度迭代.md'))
  assert.equal(renamed.rootTitle, '本季度迭代')
  assert.deepEqual(await readdir(join(cwd, DEFAULT_MINDMAP_DIR)), ['本季度迭代.md'])
})

test('GUIDANCE and the create schema teach the inbox default', () => {
  const { sections, byName } = createContext()
  const guidance = sections[0].text
  assert.ok(guidance.includes('mindmap_create(name? | description, directory?)'))
  assert.ok(guidance.includes(`\`${DEFAULT_MINDMAP_DIR}/\``), 'GUIDANCE must name the inbox directory')
  assert.match(guidance, /the host stamps the real current time/)
  assert.match(guidance, /never overwritten/)
  // 036 并发一致性：抢注后挪名要在结果里报真实路径，模型不能假设就是确认过的那条。
  assert.match(guidance, /reports the final path in the tool result/)
  const create = byName('mindmap_create')
  assert.deepEqual(create.parameters.required, [])
  assert.deepEqual(Object.keys(create.parameters.properties).sort(), ['description', 'directory', 'name'])
})

test('mindmap_open reads content and requires the file to exist', async () => {
  const cwd = await tmpWorkspace()
  const { byName } = createContext()
  await writeFile(join(cwd, 'doc.md'), '# A\n- x\n', 'utf8')
  const result = parseResult(await byName('mindmap_open').execute({ path: 'doc.md' }, execution(cwd)))
  assert.equal(result.op, 'open')
  assert.equal(result.content, '# A\n- x\n')
  assert.equal(result.rootTitle, 'doc')
  await assert.rejects(byName('mindmap_open').execute({ path: 'missing.md' }, execution(cwd)), /ENOENT/)
})

test('filenames starting with .. stay inside the cwd and open fine', async () => {
  // 回归：`..` 前缀曾被误判为越界（只看了字符串前缀，没带分隔符）
  const cwd = await tmpWorkspace()
  const { byName } = createContext()
  await writeFile(join(cwd, '..notes.md'), '# A\n', 'utf8')
  const result = parseResult(await byName('mindmap_open').execute({ path: '..notes.md' }, execution(cwd)))
  assert.equal(result.path, join(cwd, '..notes.md'))
  assert.equal(result.rootTitle, '..notes')
  await assert.rejects(byName('mindmap_open').execute({ path: '../escape.md' }, execution(cwd)), /stay inside/)
})

test('mindmap_get returns the current content', async () => {
  const cwd = await tmpWorkspace()
  const { byName } = createContext()
  await writeFile(join(cwd, 'doc.md'), 'hello', 'utf8')
  const result = parseResult(await byName('mindmap_get').execute({ path: join(cwd, 'doc.md') }, execution(cwd)))
  assert.equal(result.op, 'get')
  assert.equal(result.content, 'hello')
})

test('mindmap_open and mindmap_get reject files over the read limit', async () => {
  const cwd = await tmpWorkspace()
  const { byName } = createContext()
  await writeFile(join(cwd, 'big.md'), 'x'.repeat(internals.MAX_READ_BYTES + 1), 'utf8')
  await assert.rejects(
    byName('mindmap_open').execute({ path: 'big.md' }, execution(cwd)),
    /exceeds the .*-byte limit/,
  )
  await assert.rejects(
    byName('mindmap_get').execute({ path: 'big.md' }, execution(cwd)),
    /exceeds the .*-byte limit/,
  )
})

test('mindmap_open and mindmap_get accept a file exactly at the read limit', async () => {
  const cwd = await tmpWorkspace()
  const { byName } = createContext()
  await writeFile(join(cwd, 'exact.md'), 'x'.repeat(internals.MAX_READ_BYTES), 'utf8')
  const opened = parseResult(await byName('mindmap_open').execute({ path: 'exact.md' }, execution(cwd)))
  assert.equal(opened.op, 'open')
  assert.equal(opened.content.length, internals.MAX_READ_BYTES)
  const got = parseResult(await byName('mindmap_get').execute({ path: 'exact.md' }, execution(cwd)))
  assert.equal(got.op, 'get')
  assert.equal(got.content.length, internals.MAX_READ_BYTES)
})

test('mindmap_update writes full content and echoes it back', async () => {
  const cwd = await tmpWorkspace()
  const { byName } = createContext()
  await writeFile(join(cwd, 'doc.md'), '# old\n', 'utf8')
  const next = '# new\n- a\n- \n'
  const result = parseResult(await byName('mindmap_update').execute({ path: 'doc.md', content: next }, execution(cwd)))
  assert.equal(result.op, 'update')
  assert.equal(result.content, next)
  assert.equal(await readFile(join(cwd, 'doc.md'), 'utf8'), next)
})

test('mindmap_update rejects a stale expected revision without overwriting newer content', async () => {
  const cwd = await tmpWorkspace()
  const { byName } = createContext()
  await writeFile(join(cwd, 'doc.md'), '# old\n', 'utf8')
  const opened = parseResult(await byName('mindmap_get').execute({ path: 'doc.md' }, execution(cwd)))
  await writeFile(join(cwd, 'doc.md'), '# newer\n', 'utf8')
  await assert.rejects(
    byName('mindmap_update').execute({ path: 'doc.md', content: '# ai\n', expectedRevision: opened.revision }, execution(cwd)),
    /changed since it was read/,
  )
  assert.equal(await readFile(join(cwd, 'doc.md'), 'utf8'), '# newer\n')
})

test('mindmap_update renameRoot renames the file and reports renamedFrom', async () => {
  const cwd = await tmpWorkspace()
  const { byName } = createContext()
  await writeFile(join(cwd, 'old.md'), '# keep\n', 'utf8')
  const result = parseResult(await byName('mindmap_update').execute(
    { path: 'old.md', content: '# keep\n- more\n', renameRoot: '新名字' },
    execution(cwd),
  ))
  assert.equal(result.path, join(cwd, '新名字.md'))
  assert.equal(result.renamedFrom, join(cwd, 'old.md'))
  assert.equal(result.rootTitle, '新名字')
  assert.deepEqual(await readdir(cwd), ['新名字.md'])
  assert.equal(await readFile(join(cwd, '新名字.md'), 'utf8'), '# keep\n- more\n')
})

test('mindmap_update renameRoot collision fails without touching either file', async () => {
  const cwd = await tmpWorkspace()
  const { byName } = createContext()
  await writeFile(join(cwd, 'a.md'), 'A', 'utf8')
  await writeFile(join(cwd, 'b.md'), 'B', 'utf8')
  await assert.rejects(
    byName('mindmap_update').execute({ path: 'a.md', renameRoot: 'b' }, execution(cwd)),
    /already exists/,
  )
  assert.equal(await readFile(join(cwd, 'a.md'), 'utf8'), 'A')
  assert.equal(await readFile(join(cwd, 'b.md'), 'utf8'), 'B')
})

test('mindmap_update pure rename without content keeps file bytes', async () => {
  const cwd = await tmpWorkspace()
  const { byName } = createContext()
  await writeFile(join(cwd, 'a.md'), '# x\n- y\n', 'utf8')
  const result = parseResult(await byName('mindmap_update').execute({ path: 'a.md', renameRoot: 'renamed' }, execution(cwd)))
  assert.equal(result.op, 'update')
  assert.equal(result.content, '# x\n- y\n')
  assert.deepEqual(await readdir(cwd), ['renamed.md'])
})

test('mindmap_update renameRoot supports case-only renames', async () => {
  // 回归：大小写不敏感 FS（macOS/Windows）上 pathExists(target) 命中自己，
  // 曾被误报 already exists；sameFile 判定放行后 Plan → plan 可正常改名。
  const cwd = await tmpWorkspace()
  const { byName } = createContext()
  await writeFile(join(cwd, 'Plan.md'), '# keep\n', 'utf8')
  const result = parseResult(await byName('mindmap_update').execute({ path: 'Plan.md', renameRoot: 'plan' }, execution(cwd)))
  assert.equal(result.renamedFrom, join(cwd, 'Plan.md'))
  assert.equal(result.path, join(cwd, 'plan.md'))
  assert.deepEqual(await readdir(cwd), ['plan.md'])
  assert.equal(await readFile(join(cwd, 'plan.md'), 'utf8'), '# keep\n')
})

test('mindmap_update rejects missing file, missing args and oversized content', async () => {
  const cwd = await tmpWorkspace()
  const { byName } = createContext()
  const update = byName('mindmap_update')
  await assert.rejects(update.execute({ path: 'nope.md', content: 'x' }, execution(cwd)), /not found/)
  await assert.rejects(update.execute({ path: 'nope.md' }, execution(cwd)), /requires content/)
  await writeFile(join(cwd, 'doc.md'), '', 'utf8')
  await assert.rejects(
    update.execute({ path: 'doc.md', content: 'x'.repeat(2 * 1024 * 1024 + 1) }, execution(cwd)),
    /exceeds/,
  )
})

test('paths must stay inside the working directory and end with .md', async () => {
  const cwd = await tmpWorkspace()
  await assert.rejects(async () => resolveMindmapPath(cwd, '../escape.md'), /stay inside/)
  await assert.rejects(async () => resolveMindmapPath(cwd, '/etc/passwd.md'), /stay inside/)
  await assert.rejects(async () => resolveMindmapPath(cwd, 'notes.txt'), /\.md/)
  // cwd 是授权边界，缺失时不能以绝对路径退化到工作区外访问。
  await assert.rejects(async () => resolveMindmapPath(null, '/tmp/x/../y.md'), /no working directory/)
})

test('resolveMindmapPath rejects symlink escapes out of the working directory', async () => {
  // 字符串规范化挡不住符号链接：cwd 内的链接指向外部时，读写会越狱。
  const cwd = await tmpWorkspace()
  const outside = await tmpWorkspace()
  await writeFile(join(outside, 'secret.md'), '', 'utf8')
  await symlink(join(outside, 'secret.md'), join(cwd, 'link-out.md'))
  await symlink(outside, join(cwd, 'dir-out'))
  await assert.rejects(async () => resolveMindmapPath(cwd, 'link-out.md'), /stay inside/)
  await assert.rejects(async () => resolveMindmapPath(cwd, 'dir-out/secret.md'), /stay inside/)
  // 指向 cwd 内部的符号链接仍然合法
  await writeFile(join(cwd, 'inside.md'), '', 'utf8')
  await symlink(join(cwd, 'inside.md'), join(cwd, 'link-in.md'))
  assert.equal(await resolveMindmapPath(cwd, 'link-in.md'), join(cwd, 'link-in.md'))
  // 尚不存在的新建路径（mindmap_create）照常放行
  assert.equal(await resolveMindmapPath(cwd, 'fresh.md'), join(cwd, 'fresh.md'))
})

test('sanitizeStem strips .md and normalizes input', () => {
  assert.equal(sanitizeStem('plan'), 'plan')
  assert.equal(sanitizeStem(' plan.md '), 'plan')
  assert.equal(sanitizeStem('计划'), '计划')
})

test('buildResult derives rootTitle from the path', () => {
  const parsed = JSON.parse(buildResult('get', '/w/sub/my map.md'))
  assert.equal(parsed.rootTitle, 'my map')
  assert.equal(parsed.ok, true)
})

test('requireApproval gates mindmap_create and mindmap_update, and reads the settings namespace at runtime', async () => {
  // 015：pre-execute 钩子常驻注册；默认开启，只有明确关闭才直接放行。
  const disabled = createContext({ requireApproval: false })
  const plainListener = disabled.listeners.get('tools/pre-execute')
  assert.ok(plainListener)
  const allow = async () => ({ kind: 'allow' })
  assert.deepEqual(await plainListener({ name: 'mindmap_update', arguments: { path: 'a.md', content: 'x' } }, allow), { kind: 'allow' })

  const gated = createContext()
  const listener = gated.listeners.get('tools/pre-execute')
  assert.ok(listener)
  let asked = null
  const next = async () => ({ kind: 'allow' })
  const askUpdate = await listener({ name: 'mindmap_update', arguments: { path: 'a.md', content: 'x' } }, next)
  assert.equal(askUpdate.kind, 'ask')
  assert.ok(askUpdate.reason.includes('Write mindmap'))
  // 022：create 同为写路径，同样走审批（CONTRIBUTING：所有写路径安全敏感）
  const askCreate = await listener({ name: 'mindmap_create', arguments: { name: 'x' } }, next)
  assert.equal(askCreate.kind, 'ask')
  assert.ok(askCreate.reason.includes('Create mindmap'))
  const askOther = await listener({ name: 'mindmap_get', arguments: {} }, next)
  assert.deepEqual(askOther, { kind: 'allow' })
  // 上游已拒绝时透传
  const denied = { kind: 'deny' }
  assert.equal(await listener({ name: 'mindmap_update', arguments: {} }, async () => denied), denied)
})

test('approval hook keeps malformed create arguments on the normal tool path', async () => {
  const { listeners } = createContext()
  const listener = listeners.get('tools/pre-execute')
  const result = await listener({ name: 'mindmap_create', arguments: { name: '../bad' } }, async () => ({ kind: 'allow' }))
  assert.equal(result.kind, 'ask')
})

test('approval modes reuse a successful document grant only within the same session', async () => {
  const cwd = await tmpWorkspace()
  const { listeners } = createContext({ approvalMode: 'session' })
  const listener = listeners.get('tools/pre-execute')
  const resultListener = listeners.get('tools/result')
  const session = { header: { cwd } }
  const first = { ...execution(cwd), agent: { session }, name: 'mindmap_update', arguments: { path: 'a.md', content: 'x' } }
  const second = { ...execution(cwd), agent: { session }, name: 'mindmap_update', arguments: { path: 'a.md', content: 'x' } }
  const next = async () => ({ kind: 'allow' })
  assert.equal((await listener(first, next)).kind, 'ask')
  resultListener(first, { isError: false })
  assert.deepEqual(await listener(second, next), { kind: 'allow' })
})

test('approval grants use the session service when the agent carries only an id', async () => {
  const cwd = await tmpWorkspace()
  const { listeners, sessions } = createContext({ approvalMode: 'session' })
  const session = { header: { cwd } }
  sessions.set('s1', session)
  const listener = listeners.get('tools/pre-execute')
  const resultListener = listeners.get('tools/result')
  const next = async () => ({ kind: 'allow' })
  const first = { ...execution(cwd), agent: { id: 's1' }, name: 'mindmap_update', arguments: { path: 'a.md', content: 'x' } }
  const second = { ...execution(cwd), agent: { id: 's1' }, name: 'mindmap_update', arguments: { path: 'a.md', content: 'y' } }
  assert.equal((await listener(first, next)).kind, 'ask')
  resultListener(first, { isError: false })
  assert.deepEqual(await listener(second, next), { kind: 'allow' })
})

test('approval policy keeps high-risk renames gated and revocation clears grants', async () => {
  const cwd = await tmpWorkspace()
  const session = { header: { cwd } }
  const next = async () => ({ kind: 'allow' })
  const gated = createContext({ approvalMode: 'session' })
  const listener = gated.listeners.get('tools/pre-execute')
  const resultListener = gated.listeners.get('tools/result')
  const first = { ...execution(cwd), agent: { session }, name: 'mindmap_update', arguments: { path: 'a.md', content: 'x' } }
  assert.equal((await listener(first, next)).kind, 'ask')
  resultListener(first, { isError: false })
  const rename = { ...execution(cwd), agent: { session }, name: 'mindmap_update', arguments: { path: 'a.md', content: 'x', renameRoot: 'b' } }
  assert.equal((await listener(rename, next)).kind, 'ask')

  const revoked = createContext({ approvalMode: 'session' })
  revoked.sessions.set('revoke-session', session)
  const revokedListener = revoked.listeners.get('tools/pre-execute')
  const revokedResult = revoked.listeners.get('tools/result')
  const approved = { ...execution(cwd), agent: { id: 'revoke-session' }, name: 'mindmap_update', arguments: { path: 'a.md', content: 'x' } }
  assert.equal((await revokedListener(approved, next)).kind, 'ask')
  revokedResult(approved, { isError: false })
  const status = fakeRes()
  await revoked.routes[0].handler(fakeReq({ url: '/mindmap/api/approval', headers: TRUSTED, body: JSON.stringify({ sessionId: 'revoke-session', action: 'status' }) }), status)
  assert.equal(JSON.parse(status.body).value.grantedDocuments, 1)
  const revoke = fakeRes()
  await revoked.routes[0].handler(fakeReq({ url: '/mindmap/api/approval', headers: TRUSTED, body: JSON.stringify({ sessionId: 'revoke-session', action: 'revoke' }) }), revoke)
  assert.equal(JSON.parse(revoke.body).value.grantedDocuments, 0)
  const second = { ...execution(cwd), agent: { id: 'revoke-session' }, name: 'mindmap_update', arguments: { path: 'a.md', content: 'y' } }
  assert.equal((await revokedListener(second, next)).kind, 'ask')
})

test('off skips ordinary prompts while per-operation asks every time', async () => {
  const cwd = await tmpWorkspace()
  const session = { header: { cwd } }
  const next = async () => ({ kind: 'allow' })
  const off = createContext({ approvalMode: 'off' })
  const offListener = off.listeners.get('tools/pre-execute')
  const ordinary = { ...execution(cwd), agent: { session }, name: 'mindmap_update', arguments: { path: 'a.md', content: 'x' } }
  assert.deepEqual(await offListener(ordinary, next), { kind: 'allow' })
  const rename = { ...execution(cwd), agent: { session }, name: 'mindmap_update', arguments: { path: 'a.md', content: 'x', renameRoot: 'b' } }
  assert.equal((await offListener(rename, next)).kind, 'ask')
  const erase = { ...execution(cwd), agent: { session }, name: 'mindmap_update', arguments: { path: 'a.md', content: '' } }
  assert.equal((await offListener(erase, next)).kind, 'ask')

  const every = createContext({ approvalMode: 'per-operation' })
  const everyListener = every.listeners.get('tools/pre-execute')
  const one = { ...execution(cwd), agent: { session }, name: 'mindmap_update', arguments: { path: 'a.md', content: 'x' } }
  const two = { ...execution(cwd), agent: { session }, name: 'mindmap_update', arguments: { path: 'a.md', content: 'y' } }
  assert.equal((await everyListener(one, next)).kind, 'ask')
  assert.equal((await everyListener(two, next)).kind, 'ask')
})

test('high-risk writes stay gated and broad rewrites do not reuse a session grant', async () => {
  const cwd = await tmpWorkspace()
  const path = join(cwd, 'a.md')
  const original = 'a'.repeat(20 * 1024)
  await writeFile(path, original, 'utf8')
  const session = { header: { cwd } }
  const gated = createContext({ approvalMode: 'session' })
  const listener = gated.listeners.get('tools/pre-execute')
  const resultListener = gated.listeners.get('tools/result')
  const next = async () => ({ kind: 'allow' })
  const small = { ...execution(cwd), agent: { session }, name: 'mindmap_update', arguments: { path: 'a.md', content: `${original}b` } }
  assert.equal((await listener(small, next)).kind, 'ask')
  resultListener(small, { isError: false })
  const broad = { ...execution(cwd), agent: { session }, name: 'mindmap_update', arguments: { path: 'a.md', content: 'z'.repeat(20 * 1024) } }
  assert.equal((await listener(broad, next)).kind, 'ask')
  const erase = { ...execution(cwd), agent: { session }, name: 'mindmap_update', arguments: { path: 'a.md', content: '' } }
  assert.equal((await listener(erase, next)).kind, 'ask')
  const disabled = createContext({ requireApproval: false })
  const disabledListener = disabled.listeners.get('tools/pre-execute')
  assert.equal((await disabledListener(broad, next)).kind, 'ask')
  assert.equal((await disabledListener(erase, next)).kind, 'ask')
})

test('short documents are not treated as broad rewrites', async () => {
  const cwd = await tmpWorkspace()
  const original = `# Title\n- ${'x'.repeat(200)}\n`
  await writeFile(join(cwd, 'small.md'), original, 'utf8')
  const { listeners } = createContext({ approvalMode: 'session' })
  const listener = listeners.get('tools/pre-execute')
  const resultListener = listeners.get('tools/result')
  const session = { header: { cwd } }
  const next = async () => ({ kind: 'allow' })
  const first = { ...execution(cwd), agent: { session }, name: 'mindmap_update', arguments: { path: 'small.md', content: `${original}- y\n` } }
  assert.equal((await listener(first, next)).kind, 'ask')
  resultListener(first, { isError: false })
  // 与旧文几乎没有公共首尾，但整篇也只有几百字节：属于普通改写，不该按
  // 「大范围重写」重新确认（旧实现按 50% 比例会误判）。
  const rewrite = { ...execution(cwd), agent: { session }, name: 'mindmap_update', arguments: { path: 'small.md', content: `# Other\n- ${'y'.repeat(150)}\n` } }
  assert.deepEqual(await listener(rewrite, next), { kind: 'allow' })
})

test('approval mode aliases normalize to the three public modes', () => {
  assert.equal(internals.normalizeApprovalMode('always'), 'per-operation')
  assert.equal(internals.normalizeApprovalMode('once-per-document'), 'session')
  assert.equal(internals.normalizeApprovalMode('off'), 'off')
  assert.equal(internals.normalizeApprovalMode(undefined), 'session')
  assert.equal(internals.normalizeApprovalMode(undefined, false), 'off')
})

test('session cwd comes from the ≤0.1.1 agent.session chain first, then the 0.1.2-rc.1 agent.id lookup', () => {
  // 023：dsh ≤0.1.1 的 Agent 直挂 live session——旧链优先，语义不变。
  assert.equal(internals.sessionCwd(execution('/w')), '/w')
  assert.equal(internals.sessionCwd({}), undefined)
  assert.equal(internals.sessionCwd(), undefined)
  // 0.1.2-rc.1 起 Agent 只剩 { id }，经 sessions 服务按 id 查 header.cwd。
  const sessions = { get: (id) => (id === 's1' ? { header: { cwd: '/w2' } } : undefined) }
  assert.equal(internals.sessionCwd({ agent: { id: 's1' } }, sessions), '/w2')
  assert.equal(internals.sessionCwd({ agent: { id: 'missing' } }, sessions), undefined)
  assert.equal(internals.sessionCwd({ agent: { id: 's1' } }), undefined)
  // 两链并存（升级窗口期）时旧链优先
  assert.equal(internals.sessionCwd({ agent: { id: 's1', session: { header: { cwd: '/w-old' } } } }, sessions), '/w-old')
})

// —— 013 目录树路由 ——

function fakeReq({ method = 'POST', url = '/mindmap/api/tree', headers = {}, body = '{}' }) {
  const chunks = [Buffer.from(body)]
  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.statusCode = status
      this.headers = headers
    },
    end(payload) {
      this.body = payload
    },
  }
}

const TRUSTED = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }

test('apply registers the /mindmap/api tree route', () => {
  const { routes } = createContext()
  assert.equal(routes.length, 1)
  assert.equal(routes[0].kind, 'prefix')
  assert.equal(routes[0].path, '/mindmap/api')
  assert.equal(typeof routes[0].handler, 'function')
})

test('tree route lists the session cwd with directories first', async () => {
  const cwd = await tmpWorkspace()
  await mkdir(join(cwd, 'sub'))
  await writeFile(join(cwd, 'a.md'), '', 'utf8')
  await writeFile(join(cwd, 'notes.txt'), '', 'utf8')
  const { routes, sessions } = createContext()
  sessions.set('s1', { header: { cwd } })
  const res = fakeRes()
  await routes[0].handler(fakeReq({ headers: TRUSTED, body: JSON.stringify({ sessionId: 's1' }) }), res)
  assert.equal(res.statusCode, 200)
  const parsed = JSON.parse(res.body)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.value.cwd, cwd)
  assert.equal(parsed.value.path, cwd)
  assert.deepEqual([...parsed.value.entries.map((e) => e.name)], ['sub', 'a.md', 'notes.txt'])
  assert.equal(parsed.value.entries[0].isDir, true)
  assert.equal(parsed.value.entries[1].isDir, false)
  assert.equal(parsed.value.entries[1].hidden, false)
})

test('tree route lists the inbox as a hidden entry the tree still shows', async () => {
  const cwd = await tmpWorkspace()
  const { byName, routes, sessions } = createContext()
  sessions.set('s1', { header: { cwd } })
  await byName('mindmap_create').execute({ description: '收件箱' }, execution(cwd))
  const res = fakeRes()
  await routes[0].handler(fakeReq({ headers: TRUSTED, body: JSON.stringify({ sessionId: 's1' }) }), res)
  const entry = JSON.parse(res.body).value.entries.find((e) => e.name === DEFAULT_MINDMAP_DIR)
  assert.equal(entry.isDir, true)
  assert.equal(entry.hidden, true)
})

test('tree route expands a subdirectory inside the cwd and rejects escapes', async () => {
  const cwd = await tmpWorkspace()
  await mkdir(join(cwd, 'sub'))
  await writeFile(join(cwd, 'sub', 'b.md'), '', 'utf8')
  const { routes, sessions } = createContext()
  sessions.set('s1', { header: { cwd } })

  const ok = fakeRes()
  await routes[0].handler(fakeReq({ headers: TRUSTED, body: JSON.stringify({ sessionId: 's1', path: join(cwd, 'sub') }) }), ok)
  assert.equal(ok.statusCode, 200)
  assert.deepEqual([...JSON.parse(ok.body).value.entries.map((e) => e.name)], ['b.md'])

  const escape = fakeRes()
  await routes[0].handler(fakeReq({ headers: TRUSTED, body: JSON.stringify({ sessionId: 's1', path: '/etc' }) }), escape)
  assert.equal(escape.statusCode, 400)

  const relative = fakeRes()
  await routes[0].handler(fakeReq({ headers: TRUSTED, body: JSON.stringify({ sessionId: 's1', path: 'sub' }) }), relative)
  assert.equal(relative.statusCode, 400)
})

test('document route reads a markdown file without a model tool call', async () => {
  const cwd = await tmpWorkspace()
  await writeFile(join(cwd, 'doc.md'), '# A\n', 'utf8')
  const { routes, sessions } = createContext()
  sessions.set('s1', { header: { cwd } })
  const res = fakeRes()
  await routes[0].handler(fakeReq({ url: '/mindmap/api/document', headers: TRUSTED, body: JSON.stringify({ sessionId: 's1', path: 'doc.md' }) }), res)
  assert.equal(res.statusCode, 200)
  const parsed = JSON.parse(res.body)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.value.path, join(cwd, 'doc.md'))
  assert.equal(parsed.value.content, '# A\n')
  assert.match(parsed.value.revision, /^[0-9a-f]{64}$/)
})

test('tree route guards: non-POST, cross-site, missing sessionId, unknown cwd', async () => {
  const { routes } = createContext()
  const tree = routes[0].handler

  const get = fakeRes()
  await tree(fakeReq({ method: 'GET', headers: TRUSTED }), get)
  assert.equal(get.statusCode, 405)

  const cross = fakeRes()
  await tree(fakeReq({ headers: { host: '127.0.0.1:3080', origin: 'http://evil.example', 'sec-fetch-site': 'cross-site' } }), cross)
  assert.equal(cross.statusCode, 403)

  const noSession = fakeRes()
  await tree(fakeReq({ headers: TRUSTED, body: JSON.stringify({}) }), noSession)
  assert.equal(noSession.statusCode, 400)

  const unknown = fakeRes()
  await tree(fakeReq({ headers: TRUSTED, body: JSON.stringify({ sessionId: 'nope' }) }), unknown)
  assert.equal(unknown.statusCode, 400)

  const notFound = fakeRes()
  await tree(fakeReq({ headers: TRUSTED, url: '/mindmap/api/other' }), notFound)
  assert.equal(notFound.statusCode, 404)
})

test('isTrustedRequest accepts same-origin and rejects cross-site/missing host', () => {
  assert.equal(isTrustedRequest({ headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' } }), true)
  assert.equal(isTrustedRequest({ headers: { host: '127.0.0.1:3080' } }), true)
  assert.equal(isTrustedRequest({ headers: { host: 'localhost:3080', origin: 'http://localhost:3080' } }), true)
  assert.equal(isTrustedRequest({ headers: { host: '127.0.0.1:3080', origin: 'http://evil.example' } }), false)
  assert.equal(isTrustedRequest({ headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'cross-site' } }), false)
  assert.equal(isTrustedRequest({ headers: {} }), false)
})

test('resolveTreePath defaults to cwd and requires absolute paths inside it', async () => {
  const cwd = await tmpWorkspace()
  assert.equal(await resolveTreePath(cwd, undefined), cwd)
  assert.equal(await resolveTreePath(cwd, ''), cwd)
  assert.equal(await resolveTreePath(cwd, join(cwd, 'sub')), join(cwd, 'sub'))
  await assert.rejects(async () => resolveTreePath(cwd, '../x'), /must be absolute/)
  await assert.rejects(async () => resolveTreePath(cwd, '/etc'), /stay inside/)
  await assert.rejects(async () => resolveTreePath(null, undefined), /no working directory/)
  // 符号链接越狱同样拒绝（realpath 一层兜底）
  const outside = await tmpWorkspace()
  await symlink(outside, join(cwd, 'dir-out'))
  await assert.rejects(async () => resolveTreePath(cwd, join(cwd, 'dir-out')), /stay inside/)
})

test('listDirectoryLevel caps entries at maxEntries and flags truncation', async () => {
  const cwd = await tmpWorkspace()
  for (let i = 0; i < 5; i += 1) await writeFile(join(cwd, `f${i}.md`), '', 'utf8')
  const capped = await listDirectoryLevel(cwd, 3)
  assert.equal(capped.entries.length, 3)
  assert.equal(capped.truncated, true)
  const full = await listDirectoryLevel(cwd)
  assert.equal(full.entries.length, 5)
  assert.equal(full.truncated, false)
})
