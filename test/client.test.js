import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

// 照 dsh-grafana test/client.test.js 的套路：vm 里伪造 window.__ModuleLoader__
// 捕获浏览器模块定义，再用 require 桩喂 react，拿到 exports 测纯函数。
function loadBrowserModule() {
  let definition
  const window = {
    __ModuleLoader__: {
      load(value) {
        definition = value
      },
    },
  }
  vm.runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), { URL, window })
  assert.equal(definition.id, 'dsh-mindmap')
  const runtime = definition.factory((id) => {
    if (id === 'react/jsx-runtime') return { jsx() {}, jsxs() {}, Fragment: {} }
    if (id === 'react') {
      return { useState, useEffect, useMemo, useRef }
    }
    throw new Error(`Unexpected browser dependency: ${id}`)
  })
  return runtime
}

// react 桩：组件不真正渲染，只保证钩子在模块加载与 apply 时可用。
function useState(initial) {
  return [typeof initial === 'function' ? initial() : initial, () => {}]
}
function useEffect() {}
function useMemo(factory) {
  return factory()
}
function useRef(value) {
  return { current: value }
}

function toolResultNode(name, payload, { isError = false, callId = `call-${Math.random().toString(36).slice(2)}` } = {}) {
  return {
    kind: 'tool-result',
    callId,
    call: { name, argsRaw: '{}' },
    content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) }],
    isError,
  }
}

function toolResultWithSubCalls(name, payload, subCalls, options = {}) {
  return { ...toolResultNode(name, payload, options), subCalls }
}

const runtime = loadBrowserModule()
const { parseMarkdownToTree, reduceDocuments, mergeDocuments, autoOpenTarget, openingEventKeys, nodesFingerprint, matchDocError, errorEventKeys, stemOf, buildExportSvg, resultTextOfBlocks, relPathWithin, visibleTreeRows, colorThemeTokens, clampZoom, stepZoom, fitZoom, focusZoom } = runtime.internals

test('browser module declares the expected service inject list', () => {
  // 014：layout 随 details 形态退役；shell.overlay 注册不需要额外服务。
  assert.deepEqual(Array.from(runtime.inject), ['slots'])
})

test('headings nest by level with H1 children of the root', () => {
  const tree = parseMarkdownToTree('# A\n## B\n### C\n# D\n## E', 'doc')
  assert.equal(tree.topic, 'doc')
  assert.equal(tree.kind, 'root')
  assert.deepEqual([...tree.children.map((n) => n.topic)], ['A', 'D'])
  assert.deepEqual([...tree.children[0].children.map((n) => n.topic)], ['B'])
  assert.deepEqual([...tree.children[0].children[0].children.map((n) => n.topic)], ['C'])
  assert.deepEqual([...tree.children[1].children.map((n) => n.topic)], ['E'])
  assert.equal(tree.children[0].data.level, 1)
})

test('first H1 echoing the root title merges into the root node', () => {
  // 记录文档常以文件名作首行 H1，与根节点标题重复——并入根节点
  const tree = parseMarkdownToTree('# doc.md\n## A\n- x', 'doc')
  assert.deepEqual([...tree.children.map((n) => n.topic)], ['A'])
  // 不带 .md 后缀的同名 H1 同样并入
  const bare = parseMarkdownToTree('# doc\n## B', 'doc')
  assert.deepEqual([...bare.children.map((n) => n.topic)], ['B'])
  // 不同名的 H1 保留为子节点（映射语义不变）
  const other = parseMarkdownToTree('# other\n## C', 'doc')
  assert.deepEqual([...other.children.map((n) => n.topic)], ['other'])
})

test('lists nest by indentation and empty items become placeholders', () => {
  const tree = parseMarkdownToTree('- a\n  - b\n    - c\n- \n- d', 'doc')
  const [a, placeholder, d] = tree.children
  assert.equal(a.topic, 'a')
  assert.equal(a.children[0].topic, 'b')
  assert.equal(a.children[0].children[0].topic, 'c')
  assert.equal(placeholder.kind, 'placeholder')
  assert.equal(placeholder.topic, '')
  assert.equal(d.topic, 'd')
})

test('ordered list items keep their numbers in the topic', () => {
  const tree = parseMarkdownToTree('1. first\n2. second', 'doc')
  assert.deepEqual([...tree.children.map((n) => n.topic)], ['1. first', '2. second'])
  assert.equal(tree.children[0].data.ordered, true)
})

test('code fences become leaf nodes titled by language and first line', () => {
  const tree = parseMarkdownToTree('```js\nconsole.log(1)\nsecond line\n```', 'doc')
  const [node] = tree.children
  assert.equal(node.kind, 'code')
  assert.equal(node.topic, '[js] console.log(1)')
  assert.equal(node.data.code, 'console.log(1)\nsecond line')
  // 超长首行截断："[code] " 前缀（7 字符）+ 40 字符 + 省略号
  const long = parseMarkdownToTree('```\n' + 'x'.repeat(80) + '\n```', 'doc')
  assert.ok(long.children[0].topic.endsWith('…'))
  assert.ok([...long.children[0].topic].length <= 7 + 40 + 1)
})

test('paragraphs become the nearest heading note, not nodes', () => {
  const tree = parseMarkdownToTree('# T\nfirst note\nsecond line\n\nanother para', 'doc')
  assert.equal(tree.children.length, 1)
  assert.equal(tree.children[0].data.description, 'first note second line\nanother para')
  // 没有标题时挂到根
  const bare = parseMarkdownToTree('just text', 'doc')
  assert.equal(bare.children.length, 0)
  assert.equal(bare.data.description, 'just text')
})

test('frontmatter, thematic breaks and blockquotes are skipped', () => {
  const tree = parseMarkdownToTree('---\ntitle: x\n---\n# A\n---\n> quote\n## B', 'doc')
  assert.deepEqual([...tree.children.map((n) => n.topic)], ['A'])
  assert.deepEqual([...tree.children[0].children.map((n) => n.topic)], ['B'])
  assert.equal(tree.children[0].data.description, undefined)
})

test('node ids stay stable when siblings are inserted or removed', () => {
  const before = parseMarkdownToTree('# A\n- x\n- y', 'doc')
  const after = parseMarkdownToTree('# A\n- x\n- NEW\n- y', 'doc')
  const idOf = (tree, topic) => {
    const found = []
    const walk = (n) => {
      if (n.topic === topic) found.push(n.id)
      n.children.forEach(walk)
    }
    walk(tree)
    return found[0]
  }
  for (const topic of ['A', 'x', 'y']) {
    assert.equal(idOf(after, topic), idOf(before, topic), `id drifted for ${topic}`)
  }
  assert.notEqual(idOf(after, 'NEW'), idOf(before, 'x'))
})

test('duplicate identical siblings get unique ids', () => {
  const tree = parseMarkdownToTree('- dup\n- dup\n- dup', 'doc')
  const ids = tree.children.map((n) => n.id)
  assert.equal(new Set(ids).size, 3)
})

test('reduceDocuments replays tool results and follows renames', () => {
  const nodes = [
    toolResultNode('mindmap_create', { ok: true, op: 'create', path: '/w/plan.md', rootTitle: 'plan', content: '' }),
    { kind: 'user/message' },
    toolResultNode('mindmap_update', { ok: true, op: 'update', path: '/w/plan.md', content: '# A\n' }),
    toolResultNode('mindmap_get', { ok: true, op: 'get', path: '/w/other.md', content: 'zzz' }),
    toolResultNode('mindmap_update', { ok: true, op: 'update', path: '/w/renamed.md', renamedFrom: '/w/plan.md', content: '# B\n' }),
    toolResultNode('bash', 'irrelevant'),
    toolResultNode('mindmap_get', 'not json', {}),
    toolResultNode('mindmap_get', { ok: false }, {}),
  ]
  const docs = reduceDocuments(nodes)
  assert.deepEqual([...docs.order], ['/w/other.md', '/w/renamed.md'])
  assert.equal(docs.byPath['/w/renamed.md'].content, '# B\n')
  assert.equal(docs.byPath['/w/renamed.md'].rootTitle, 'renamed')
  assert.equal(docs.byPath['/w/renamed.md'].renamedFrom, '/w/plan.md')
  assert.equal(docs.byPath['/w/plan.md'], undefined)
})

test('reduceDocuments remembers the latest open intent even when an update follows it', () => {
  const nodes = [
    toolResultNode('mindmap_create', { ok: true, op: 'create', path: '/w/a.md', content: '' }, { callId: 'create-a' }),
    toolResultNode('mindmap_create', { ok: true, op: 'create', path: '/w/b.md', content: '' }, { callId: 'create-b' }),
    toolResultNode('mindmap_open', { ok: true, op: 'open', path: '/w/a.md', content: 'a' }, { callId: 'open-a' }),
    toolResultNode('mindmap_update', { ok: true, op: 'update', path: '/w/a.md', content: 'a\n- child' }, { callId: 'update-a' }),
  ]
  const docs = reduceDocuments(nodes)
  assert.equal(docs.latestOpeningPath, '/w/a.md')
  assert.equal(docs.latestOpeningEventKey, 'call:open-a')
  assert.equal(docs.byPath['/w/a.md'].openingEventKey, 'call:open-a')
  assert.equal(autoOpenTarget(docs, null), '/w/a.md')
  assert.equal(autoOpenTarget(docs, new Set(['call:create-a', 'call:create-b'])), '/w/a.md')
})

test('reduceDocuments replays a mindmap result nested in a code tool subCalls list', () => {
  const docs = reduceDocuments([
    toolResultWithSubCalls('code', 'ignored parent result', [
      toolResultNode('mindmap_open', { ok: true, op: 'open', path: '/w/nested.md', content: '# Nested\n' }, { callId: 'nested-open' }),
    ], { callId: 'code-parent' }),
  ])
  assert.deepEqual([...docs.order], ['/w/nested.md'])
  assert.equal(docs.byPath['/w/nested.md'].content, '# Nested\n')
  assert.equal(docs.byPath['/w/nested.md'].eventKey, 'call:nested-open')
  assert.equal(docs.byPath['/w/nested.md'].openingEventKey, 'call:nested-open')
  assert.equal(docs.latestOpeningPath, '/w/nested.md')
})

test('reduceDocuments follows multiple levels of subCalls in event order', () => {
  const docs = reduceDocuments([
    toolResultWithSubCalls('code', 'ignored', [
      toolResultWithSubCalls('bash', 'ignored', [
        toolResultWithSubCalls('wrapper', 'ignored', [
          toolResultNode('mindmap_create', { ok: true, op: 'create', path: '/w/deep.md', content: 'first' }, { callId: 'deep-create' }),
          toolResultNode('mindmap_update', { ok: true, op: 'update', path: '/w/deep.md', content: 'latest' }, { callId: 'deep-update' }),
        ], { callId: 'wrapper-call' }),
      ], { callId: 'bash-call' }),
    ], { callId: 'code-call' }),
  ])
  assert.deepEqual([...docs.order], ['/w/deep.md'])
  assert.equal(docs.byPath['/w/deep.md'].content, 'latest')
  assert.equal(docs.byPath['/w/deep.md'].eventKey, 'call:deep-update')
  assert.equal(docs.byPath['/w/deep.md'].openingEventKey, 'call:deep-create')
})

test('reduceDocuments ignores an errored nested mindmap result', () => {
  const docs = reduceDocuments([
    toolResultWithSubCalls('code', 'ignored', [
      toolResultNode('mindmap_open', { ok: true, op: 'open', path: '/w/error.md', content: 'must not show' }, {
        callId: 'nested-error',
        isError: true,
      }),
    ]),
  ])
  assert.deepEqual([...docs.order], [])
  assert.equal(docs.byPath['/w/error.md'], undefined)
  assert.equal(docs.latestOpeningPath, null)
})

test('reduceDocuments migrates the latest opening path and event across a rename', () => {
  const docs = reduceDocuments([
    toolResultNode('mindmap_open', { ok: true, op: 'open', path: '/w/old.md', content: 'old' }, { callId: 'open-old' }),
    toolResultNode('mindmap_update', {
      ok: true,
      op: 'update',
      path: '/w/new.md',
      renamedFrom: '/w/old.md',
      content: 'new',
    }, { callId: 'rename-new' }),
  ])
  assert.equal(docs.latestOpeningPath, '/w/new.md')
  assert.equal(docs.latestOpeningEventKey, 'call:open-old')
  assert.equal(docs.byPath['/w/new.md'].openingEventKey, 'call:open-old')
  assert.equal(autoOpenTarget(docs, null), '/w/new.md')
  assert.equal(docs.byPath['/w/old.md'], undefined)
})

test('repeated nested mindmap_open results expose the newest opening event', () => {
  const first = reduceDocuments([
    toolResultWithSubCalls('code', 'ignored', [
      toolResultNode('mindmap_open', { ok: true, op: 'open', path: '/w/repeat.md', content: 'v1' }, { callId: 'nested-open-1' }),
    ]),
  ])
  const repeated = reduceDocuments([
    toolResultWithSubCalls('code', 'ignored', [
      toolResultNode('mindmap_open', { ok: true, op: 'open', path: '/w/repeat.md', content: 'v1' }, { callId: 'nested-open-1' }),
    ]),
    toolResultWithSubCalls('code', 'ignored', [
      toolResultNode('mindmap_open', { ok: true, op: 'open', path: '/w/repeat.md', content: 'v2' }, { callId: 'nested-open-2' }),
    ]),
  ])
  assert.equal(repeated.byPath['/w/repeat.md'].openingEventKey, 'call:nested-open-2')
  assert.equal(repeated.latestOpeningEventKey, 'call:nested-open-2')
  assert.equal(autoOpenTarget(repeated, openingEventKeys(first)), '/w/repeat.md')
})

test('autoOpenTarget ignores already consumed opens but switches to a repeated open', () => {
  const first = reduceDocuments([
    toolResultNode('mindmap_open', { ok: true, op: 'open', path: '/w/a.md', content: 'a' }, { callId: 'open-a-1' }),
  ])
  assert.deepEqual([...openingEventKeys(first)], ['call:open-a-1'])
  assert.equal(autoOpenTarget(first, openingEventKeys(first)), null)

  const repeated = reduceDocuments([
    toolResultNode('mindmap_open', { ok: true, op: 'open', path: '/w/a.md', content: 'a' }, { callId: 'open-a-1' }),
    toolResultNode('mindmap_open', { ok: true, op: 'open', path: '/w/a.md', content: 'a' }, { callId: 'open-a-2' }),
  ])
  assert.equal(autoOpenTarget(repeated, openingEventKeys(first)), '/w/a.md')
})

test('mergeDocuments: snapshot wins, locals append, rename drops stale local tabs', () => {
  const snapshot = {
    order: ['/w/a.md', '/w/renamed.md'],
    byPath: {
      '/w/a.md': { path: '/w/a.md', rootTitle: 'a', content: 'AI 版', op: 'open', callId: 'c1', renamedFrom: null },
      '/w/renamed.md': { path: '/w/renamed.md', rootTitle: 'renamed', content: 'x', op: 'update', callId: 'c2', renamedFrom: '/w/old.md' },
    },
  }
  const locals = {
    '/w/a.md': { path: '/w/a.md', rootTitle: 'a', content: '本地占位', op: 'local', callId: null, renamedFrom: null },
    '/w/b.md': { path: '/w/b.md', rootTitle: 'b', content: '本地', op: 'local', callId: null, renamedFrom: null },
    '/w/old.md': { path: '/w/old.md', rootTitle: 'old', content: '旧名', op: 'local', callId: null, renamedFrom: null },
  }
  const merged = mergeDocuments(snapshot, locals)
  // 快照优先：同 path 用 AI 版
  assert.equal(merged.byPath['/w/a.md'].content, 'AI 版')
  // 本地追加在快照之后
  assert.deepEqual([...merged.order], ['/w/a.md', '/w/renamed.md', '/w/b.md'])
  // renamedFrom 指向的本地旧名条目被丢弃
  assert.equal(merged.byPath['/w/old.md'], undefined)
  assert.equal(merged.byPath['/w/b.md'].content, '本地')
})

test('nodesFingerprint changes when a node is appended in place (same array reference)', () => {
  // 016 故障 B 根因：store 原地改数组（引用不变、长度/结构已变）——
  // 引用比较短路失效，指纹按值比较必须感知。
  const nodes = [toolResultNode('mindmap_open', { ok: true, op: 'open', path: '/w/a.md', content: 'a' })]
  const before = nodesFingerprint(nodes)
  nodes.push(toolResultNode('mindmap_update', { ok: true, op: 'update', path: '/w/a.md', content: 'b' }))
  const after = nodesFingerprint(nodes)
  assert.notEqual(after, before)
  // 同内容重复计算稳定（selector 值比较语义，不引发多余重渲染）
  assert.equal(nodesFingerprint(nodes), after)
  // 非数组输入
  assert.equal(nodesFingerprint(null), '[]')
  assert.equal(nodesFingerprint(undefined), '[]')
})

test('nodesFingerprint tracks structure identity only, ignoring content text', () => {
  // content 文本变化（流式 token 增长）不改变指纹——避免每个 token 都重算快照
  const a = [toolResultNode('mindmap_open', { ok: true, op: 'open', path: '/w/a.md', content: 'x'.repeat(100) }, { callId: 'c1' })]
  const b = [toolResultNode('mindmap_open', { ok: true, op: 'open', path: '/w/a.md', content: 'y'.repeat(50) }, { callId: 'c1' })]
  assert.equal(nodesFingerprint(a), nodesFingerprint(b))
  // 结构身份差异会变指纹：callId
  const otherCall = [toolResultNode('mindmap_open', { ok: true, op: 'open', path: '/w/a.md', content: 'x' }, { callId: 'c2' })]
  assert.notEqual(nodesFingerprint(a), nodesFingerprint(otherCall))
  // 结构身份差异会变指纹：isError
  const errored = [toolResultNode('mindmap_open', 'oops', { isError: true, callId: 'c1' })]
  assert.notEqual(nodesFingerprint(a), nodesFingerprint(errored))
  // 结构身份差异会变指纹：subCalls 数量（嵌套调用树）
  const nested = [toolResultWithSubCalls('code', 'ignored', [
    toolResultNode('mindmap_open', { ok: true, op: 'open', path: '/w/n.md', content: '' }, { callId: 'c1' }),
  ], { callId: 'c9' })]
  const nestedMore = [toolResultWithSubCalls('code', 'ignored', [
    toolResultNode('mindmap_open', { ok: true, op: 'open', path: '/w/n.md', content: '' }, { callId: 'c1' }),
    toolResultNode('mindmap_get', { ok: true, op: 'get', path: '/w/n.md', content: '' }, { callId: 'c2' }),
  ], { callId: 'c9' })]
  assert.notEqual(nodesFingerprint(nested), nodesFingerprint(nestedMore))
})

test('reduceDocuments collects errored mindmap results as error signals without polluting docs', () => {
  // S2 成因：host 工具抛错 → isError 纯文本结果。不进文档集（语义不变），
  // 但记为 latestError（无路径归因，message 取原文）。
  const docs = reduceDocuments([
    toolResultNode('mindmap_open', 'Mindmap not found: "/w/a.md".', { isError: true, callId: 'err-1' }),
  ])
  assert.deepEqual([...docs.order], [])
  assert.equal(docs.byPath['/w/a.md'], undefined)
  assert.equal(docs.latestError.message, 'Mindmap not found: "/w/a.md".')
  assert.equal(docs.latestError.op, 'mindmap_open')
  assert.equal(docs.latestError.eventKey, 'call:err-1')
  assert.equal(Object.keys(docs.errorByPath).length, 0)
})

test('reduceDocuments attributes path-carrying failures to errorByPath and success clears them', () => {
  // 有 JSON 信封但 ok!==true：可归因路径的进 errorByPath
  const failed = reduceDocuments([
    toolResultNode('mindmap_open', { ok: false, op: 'open', path: '/w/a.md', error: { message: 'not found' } }, { callId: 'err-1' }),
  ])
  assert.equal(failed.errorByPath['/w/a.md'].message, 'not found')
  assert.equal(failed.errorByPath['/w/a.md'].eventKey, 'call:err-1')
  assert.equal(failed.byPath['/w/a.md'], undefined)
  assert.equal(failed.latestError.eventKey, 'call:err-1')

  // 成功结果清除同路径历史错误；latestError 保留最近一次失败（日志语义，
  // 面板按「点击时刻基线」过滤旧错误）
  const recovered = reduceDocuments([
    toolResultNode('mindmap_open', { ok: false, op: 'open', path: '/w/a.md', error: { message: 'not found' } }, { callId: 'err-1' }),
    toolResultNode('mindmap_open', { ok: true, op: 'open', path: '/w/a.md', content: '# A\n' }, { callId: 'ok-1' }),
  ])
  assert.equal(recovered.errorByPath['/w/a.md'], undefined)
  assert.equal(recovered.byPath['/w/a.md'].content, '# A\n')
  assert.equal(recovered.latestError.eventKey, 'call:err-1')
})

test('mergeDocuments drops a local placeholder that matches a snapshot doc case-insensitively', () => {
  // S5 成因：macOS 大小写不敏感 FS 上，AI 回传的规范 path（/w/Docs/Plan.md）
  // 与树点击 key（/w/docs/plan.md）仅大小写不同——占位被丢弃、保留规范 path，
  // 加载态随之解除（auto-open / 焦点同步照常接管）。
  const snapshot = {
    order: ['/w/Docs/Plan.md'],
    byPath: {
      '/w/Docs/Plan.md': { path: '/w/Docs/Plan.md', rootTitle: 'Plan', content: '# A\n', op: 'open', callId: 'c1', renamedFrom: null },
    },
    latestOpeningPath: '/w/Docs/Plan.md',
    latestOpeningEventKey: 'call:c1',
  }
  const merged = mergeDocuments(snapshot, {
    '/w/docs/plan.md': { path: '/w/docs/plan.md', rootTitle: 'plan', content: '', op: 'local', callId: null, renamedFrom: null },
  })
  assert.equal(merged.byPath['/w/docs/plan.md'], undefined)
  assert.equal(merged.byPath['/w/Docs/Plan.md'].content, '# A\n')
  assert.deepEqual([...merged.order], ['/w/Docs/Plan.md'])
  // 错误信号透传 + 容缺（旧快照无错误字段）。errorByPath 是 vm 域对象，
  // deepEqual 会因跨 realm 原型不等而失败（012 同款坑）——断言键数。
  assert.equal(Object.keys(merged.errorByPath).length, 0)
  assert.equal(merged.latestError, null)

  // 小写不碰撞的其它本地占位不受影响
  const distinct = mergeDocuments(snapshot, {
    '/w/docs/other.md': { path: '/w/docs/other.md', rootTitle: 'other', content: '', op: 'local', callId: null, renamedFrom: null },
  })
  assert.equal(distinct.byPath['/w/docs/other.md'].op, 'local')
  assert.deepEqual([...distinct.order], ['/w/Docs/Plan.md', '/w/docs/other.md'])
})

test('matchDocError matches exact and case-insensitive paths and honors the since baseline', () => {
  const base = reduceDocuments([
    toolResultNode('mindmap_open', { ok: false, op: 'open', path: '/w/Docs/Plan.md', error: { message: 'not found' } }, { callId: 'err-1' }),
    toolResultNode('mindmap_update', 'write failed', { isError: true, callId: 'err-2' }),
  ])
  // 精确匹配
  assert.equal(matchDocError(base, '/w/Docs/Plan.md').eventKey, 'call:err-1')
  // 小写 fallback（本地占位路径与快照规范 path 仅大小写不同）
  assert.equal(matchDocError(base, '/w/docs/plan.md').eventKey, 'call:err-1')
  // 无匹配路径 → null（无基线时不回落 latestError）
  assert.equal(matchDocError(base, '/w/none.md'), null)

  // 基线（openMindmap 点击时刻 errorEventKeys）过滤旧错误：不归因
  const since = errorEventKeys(base)
  assert.ok(since.has('call:err-1'))
  assert.ok(since.has('call:err-2'))
  assert.equal(matchDocError(base, '/w/Docs/Plan.md', since), null)

  // 基线之后新出现的 latestError（无路径归因）兜底命中——host 抛错的
  // 纯文本结果没有 path，靠这条路径归因到在途的打开请求
  const next = reduceDocuments([
    toolResultNode('mindmap_open', { ok: false, op: 'open', path: '/w/Docs/Plan.md', error: { message: 'not found' } }, { callId: 'err-1' }),
    toolResultNode('mindmap_update', 'write failed', { isError: true, callId: 'err-2' }),
    toolResultNode('mindmap_open', 'read timeout', { isError: true, callId: 'err-3' }),
  ])
  assert.equal(matchDocError(next, '/w/Docs/Plan.md', since).eventKey, 'call:err-3')

  // 容缺：空快照 / 旧结构
  assert.equal(matchDocError({}, '/w/a.md'), null)
  assert.deepEqual([...errorEventKeys(null)], [])
})

test('reduceDocuments ignores error results and derives rootTitle from the path', () => {
  const nodes = [
    toolResultNode('mindmap_create', { ok: true, op: 'create', path: '/w/a.md', content: '' }),
    toolResultNode('mindmap_update', { ok: true, op: 'update', path: '/w/a.md', content: 'x' }, { isError: true }),
  ]
  const docs = reduceDocuments(nodes)
  assert.equal(docs.byPath['/w/a.md'].content, '')
  const bare = reduceDocuments([toolResultNode('mindmap_open', { ok: true, op: 'open', path: '/w/deep/my map.md', content: 'c' })])
  assert.equal(bare.byPath['/w/deep/my map.md'].rootTitle, 'my map')
})

test('stemOf and resultTextOfBlocks helpers', () => {
  assert.equal(stemOf('/w/sub/name.md'), 'name')
  assert.equal(stemOf('name'), 'name')
  assert.equal(resultTextOfBlocks([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }]), 'a\nb')
  assert.equal(resultTextOfBlocks(undefined), '')
})

test('buildExportSvg renders the tree with connectors and placeholder labels', () => {
  const tree = parseMarkdownToTree('# A & <b>\n- x\n- \n- y', '导出&测试')
  const { svg, width, height } = buildExportSvg(tree)
  assert.ok(svg.startsWith('<svg'))
  assert.ok(svg.includes('导出&amp;测试'))
  assert.ok(svg.includes('A &amp; &lt;b&gt;'))
  assert.ok(svg.includes('待填写'))
  assert.ok(svg.includes('<path'))
  assert.ok(width > 0 && height > 0)
})

test('buildExportSvg renders any subtree as its own rooted export', () => {
  // 017 节点右键「复制/导出为图片」：buildExportSvg 以任意节点为根重排——
  // 子树根照常渲染、子树外的兄弟不出现、叶子子树无连线。
  const tree = parseMarkdownToTree('# A\n- x\n  - deep\n- y', 'doc')
  const sub = buildExportSvg(tree.children[0])
  assert.ok(sub.svg.includes('>A<'))
  assert.ok(sub.svg.includes('>x<'))
  assert.ok(sub.svg.includes('>deep<'))
  assert.ok(sub.svg.includes('<path'))
  assert.ok(!sub.svg.includes('>y<'))
  assert.ok(sub.width > 0 && sub.height > 0)
  const leaf = buildExportSvg(tree.children[0].children[0].children[0])
  assert.ok(leaf.svg.includes('>deep<'))
  assert.ok(!leaf.svg.includes('<path'))
})

test('apply registers the header M slot and the settings section, and takes no other slot', () => {
  const registered = []
  const ctx = {
    get() { return undefined },
    slots: {
      inject(key, factory) {
        factory()
      },
      register(options, component) {
        registered.push({ key: options.name, options, component })
        return () => {}
      },
    },
  }
  runtime.apply(ctx)
  const button = registered.find((r) => r.key === 'conversation.session.header.actions')
  const settings = registered.find((r) => r.key === 'settings.section')
  assert.ok(button, 'header actions registration missing')
  assert.ok(settings, 'settings.section registration missing')
  // 014/015：details 槽归还官方、shell.overlay 方案弃用，均不再注册
  assert.equal(registered.find((r) => r.key === 'details'), undefined)
  assert.equal(registered.find((r) => r.key === 'shell.overlay'), undefined)
  assert.equal(registered.length, 2)
  assert.equal(button.options.id, 'dsh-mindmap')
  assert.equal(typeof button.component, 'function')
  // 015 设置面板：左栏导航项
  assert.equal(settings.options.id, 'dsh-mindmap')
  assert.equal(settings.options.label, '思维脑图')
  assert.equal(typeof settings.component, 'function')
  const face = button.options.inject()
  assert.equal(typeof face.mindmapFace.listTree, 'function')
  assert.equal(typeof face.mindmapFace.readSettings, 'function')
  assert.equal(typeof face.mindmapFace.updateSettings, 'function')
})

test('visibleTreeRows walks only expanded directories in pre-order', () => {
  const nodes = {
    '/w': { path: '/w', name: 'w', parentPath: null, entries: [
      { name: 'a.md', path: '/w/a.md', isDir: false, hidden: false },
      { name: 'sub', path: '/w/sub', isDir: true, hidden: false },
      { name: 'b.md', path: '/w/b.md', isDir: false, hidden: false },
    ] },
    '/w/sub': { path: '/w/sub', name: 'sub', parentPath: '/w', entries: [
      { name: 'c.md', path: '/w/sub/c.md', isDir: false, hidden: false },
    ] },
  }
  // 根未展开：只有根节点本身（面板挂载时会自动展开根，见 loadTree）
  const collapsed = visibleTreeRows(nodes, {})
  assert.deepEqual([...collapsed.map((r) => r.kind)], ['dir'])
  assert.equal(collapsed[0].node.name, 'w')
  assert.equal(collapsed[0].depth, 0)
  // 只展开根：根 + 一层条目（sub 已加载但未展开 → 仍是 entry 行，不重复渲染）
  const rootOnly = visibleTreeRows(nodes, { '/w': true })
  assert.deepEqual([...rootOnly.map((r) => r.kind)], ['dir', 'entry', 'entry', 'entry'])
  assert.equal(rootOnly[2].entry.name, 'sub')
  // 展开根 + sub：sub 只渲染为节点行（不重复），先序遍历里 c.md 紧跟其后
  const expanded = visibleTreeRows(nodes, { '/w': true, '/w/sub': true })
  assert.equal(expanded.length, 5)
  assert.equal(expanded[1].entry.name, 'a.md')
  assert.equal(expanded[1].depth, 1)
  assert.equal(expanded[2].kind, 'dir')
  assert.equal(expanded[2].depth, 1)
  assert.equal(expanded[2].node.name, 'sub')
  assert.equal(expanded[3].entry.name, 'c.md')
  assert.equal(expanded[3].depth, 2)
  assert.equal(expanded[4].entry.name, 'b.md')
  assert.equal(expanded[4].depth, 1)
})

test('visibleTreeRows returns nothing without a root node', () => {
  assert.deepEqual([...visibleTreeRows({}, {})], [])
  assert.deepEqual([...visibleTreeRows({ '/w': { parentPath: '/x' } }, {})], [])
})

test('relPathWithin strips the cwd prefix and falls back to the entry name outside it', () => {
  assert.equal(relPathWithin('/w', '/w/sub/x.md', 'x.md'), 'sub/x.md')
  assert.equal(relPathWithin('/w/', '/w/a.md', 'a.md'), 'a.md')
  assert.equal(relPathWithin('/w', '/elsewhere/x.md', 'x.md'), 'x.md')
  assert.equal(relPathWithin('', 'a.md', 'a.md'), 'a.md')
  // Windows 分隔符折算
  assert.equal(relPathWithin('C:\\w', 'C:\\w\\a.md', 'a.md'), 'a.md')
})

test('colorThemeTokens serves three distinct palettes and falls back to ocean', () => {
  const ocean = colorThemeTokens('ocean')
  const sunset = colorThemeTokens('sunset')
  const forest = colorThemeTokens('forest')
  for (const t of [ocean, sunset, forest]) {
    assert.equal(typeof t.rootBg, 'string')
    assert.equal(typeof t.rootBorder, 'string')
    assert.equal(typeof t.heading, 'string')
  }
  assert.notEqual(ocean.heading, sunset.heading)
  assert.notEqual(sunset.heading, forest.heading)
  assert.notEqual(ocean.heading, forest.heading)
  // 未知名回落海洋蓝
  assert.equal(colorThemeTokens('nope').heading, ocean.heading)
})

test('clampZoom clamps to [0.25, 3] and guards non-finite or non-positive input', () => {
  assert.equal(clampZoom(1), 1)
  assert.equal(clampZoom(0.5), 0.5)
  assert.equal(clampZoom(0.1), 0.25)
  assert.equal(clampZoom(5), 3)
  assert.equal(clampZoom(NaN), 1)
  assert.equal(clampZoom(Infinity), 1)
  assert.equal(clampZoom(0), 1)
  assert.equal(clampZoom(-2), 1)
})

test('stepZoom steps by 1.2 per level and saturates at the bounds', () => {
  const up = stepZoom(1, 1)
  assert.ok(Math.abs(up - 1.2) < 1e-9)
  // 往返：一级放大再一级缩小回到原值
  assert.ok(Math.abs(stepZoom(up, -1) - 1) < 1e-9)
  // 已在下限：再缩小原地踏步
  assert.equal(stepZoom(0.25, -1), 0.25)
  // 已在上限：再放大原地踏步
  assert.equal(stepZoom(3, 1), 3)
  // 非法基线回退 1 后照常步进
  assert.ok(Math.abs(stepZoom(NaN, 1) - 1.2) < 1e-9)
})

test('fitZoom fits without enlarging, clamps giant trees, and guards zero sizes', () => {
  // 48px 画布余量：水平约束 (800-48)/1000 < (600-48)/500
  assert.ok(Math.abs(fitZoom(1000, 500, 800, 600) - 0.752) < 1e-9)
  // 垂直约束
  assert.ok(Math.abs(fitZoom(500, 1000, 800, 600) - 0.552) < 1e-9)
  // 小图不放大：上限 1
  assert.equal(fitZoom(200, 150, 800, 600), 1)
  // 巨图夹到下限 0.25（保持可读，超出部分滚动浏览）
  assert.equal(fitZoom(100000, 100000, 800, 600), 0.25)
  // 零/非法尺寸守卫：返回 1
  assert.equal(fitZoom(0, 500, 800, 600), 1)
  assert.equal(fitZoom(500, 0, 800, 600), 1)
  assert.equal(fitZoom(500, 500, 0, 600), 1)
  assert.equal(fitZoom(500, 500, 800, 0), 1)
  assert.equal(fitZoom(NaN, 500, 800, 600), 1)
})

test('focusZoom fits the subtree and caps zoom-in at focusMax', () => {
  // 与 fitZoom 同基底，但小子树允许放大到 focusMax（1 = 100%）而非停在更小值
  assert.ok(Math.abs(focusZoom(1000, 500, 800, 600) - 0.752) < 1e-9)
  assert.ok(Math.abs(focusZoom(500, 1000, 800, 600) - 0.552) < 1e-9)
  // 小子树放大上限 100%（与全局适配一致，节点保持设计基准字号）
  assert.equal(focusZoom(200, 150, 800, 600), 1)
  // 巨子树夹下限 0.25
  assert.equal(focusZoom(100000, 100000, 800, 600), 0.25)
  // 零/非法尺寸守卫：返回 1
  assert.equal(focusZoom(0, 500, 800, 600), 1)
  assert.equal(focusZoom(500, 500, 800, 0), 1)
  assert.equal(focusZoom(NaN, 500, 800, 600), 1)
})

test('apply wires listTree and settings faces through the mindmapFace (header slot inject)', () => {
  const registered = []
  const ctx = {
    get() { return undefined },
    slots: {
      inject(key, factory) {
        factory()
      },
      register(options, component) {
        registered.push({ key: options.name, options, component })
        return () => {}
      },
    },
  }
  runtime.apply(ctx)
  const button = registered.find((r) => r.key === 'conversation.session.header.actions')
  const face = button.options.inject()
  assert.equal(typeof face.mindmapFace.listTree, 'function')
  // 014：face 不再携带 layout（details 时代的遗留）
  assert.equal(face.mindmapFace.layout, undefined)
  // 015：connection 缺失时 readSettings 返回 null、updateSettings 抛错（降级语义）
  return face.mindmapFace.readSettings().then((v) => {
    assert.equal(v, null)
    return assert.rejects(() => face.mindmapFace.updateSettings({ requireApproval: true }), /settings service unavailable/)
  })
})
