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

const runtime = loadBrowserModule()
const { parseMarkdownToTree, reduceDocuments, mergeDocuments, stemOf, buildExportSvg, resultTextOfBlocks, relPathWithin, visibleTreeRows } = runtime.internals

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

test('apply registers the header M slot (panel host + button) and takes no other slot', () => {
  const registered = []
  const ctx = {
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
  assert.ok(button, 'header actions registration missing')
  // 014：details 槽归还官方、shell.overlay 方案弃用，均不再注册
  assert.equal(registered.find((r) => r.key === 'details'), undefined)
  assert.equal(registered.find((r) => r.key === 'shell.overlay'), undefined)
  assert.equal(registered.length, 1)
  assert.equal(button.options.id, 'dsh-mindmap')
  assert.equal(typeof button.component, 'function')
  const face = button.options.inject()
  assert.equal(typeof face.mindmapFace.listTree, 'function')
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

test('apply wires listTree through the mindmapFace (header slot inject)', () => {
  const registered = []
  const ctx = {
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
})
