import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { apply, internals } from '../index.js'

const { sanitizeStem, resolveMindmapPath, resolveTreePath, listDirectoryLevel, isTrustedRequest, buildResult } = internals

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
              return {
                get: () => ({
                  requireApproval: base.requireApproval === true,
                  defaultPanelWidth: typeof base.defaultPanelWidth === 'number' ? base.defaultPanelWidth : 42,
                  lineStyle: base.lineStyle === 'curve' ? 'curve' : 'elbow',
                  cardStyle: base.cardStyle === 'square' ? 'square' : 'rounded',
                  colorTheme: base.colorTheme ?? 'ocean',
                  growthAnimation: base.growthAnimation !== false,
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
  return { tools, sections, listeners, routes, sessions, byName }
}

async function tmpWorkspace() {
  return mkdtemp(join(tmpdir(), 'dsh-mindmap-test-'))
}

function parseResult(value) {
  return JSON.parse(value)
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

test('mindmap_create writes an empty file and reports root title', async () => {
  const cwd = await tmpWorkspace()
  const { byName } = createContext()
  const result = parseResult(await byName('mindmap_create').execute({ name: '产品规划' }, execution(cwd)))
  assert.equal(result.ok, true)
  assert.equal(result.op, 'create')
  assert.equal(result.path, join(cwd, '产品规划.md'))
  assert.equal(result.rootTitle, '产品规划')
  assert.equal(result.content, '')
  assert.equal(await readFile(join(cwd, '产品规划.md'), 'utf8'), '')
})

test('mindmap_create accepts a name with .md suffix and rejects unsafe names', async () => {
  const cwd = await tmpWorkspace()
  const { byName } = createContext()
  const create = byName('mindmap_create')
  const result = parseResult(await create.execute({ name: 'notes.md' }, execution(cwd)))
  assert.equal(result.path, join(cwd, 'notes.md'))
  await assert.rejects(create.execute({ name: 'a/b' }, execution(cwd)), /not allowed/)
  await assert.rejects(create.execute({ name: '..' }, execution(cwd)), /Invalid mindmap name/)
  await assert.rejects(create.execute({ name: '  ' }, execution(cwd)), /must not be empty/)
  await assert.rejects(create.execute({ name: 'x'.repeat(81) }, execution(cwd)), /must not exceed/)
})

test('mindmap_create fails when the file already exists', async () => {
  const cwd = await tmpWorkspace()
  const { byName } = createContext()
  await byName('mindmap_create').execute({ name: 'dup' }, execution(cwd))
  await assert.rejects(byName('mindmap_create').execute({ name: 'dup' }, execution(cwd)), /already exists/)
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
  // cwd 缺失时接受绝对路径
  assert.equal(await resolveMindmapPath(null, '/tmp/x/../y.md'), '/tmp/y.md')
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
  // 015：pre-execute 钩子常驻注册；默认（false）直接放行
  const plain = createContext()
  const plainListener = plain.listeners.get('tools/pre-execute')
  assert.ok(plainListener)
  const allow = async () => ({ kind: 'allow' })
  assert.deepEqual(await plainListener({ name: 'mindmap_update', arguments: { path: 'a.md', content: 'x' } }, allow), { kind: 'allow' })

  const gated = createContext({ requireApproval: true })
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
