import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { Context as CordisContext } from '@deepseek-ai/cordis'

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
  // 026：vm 沙箱里的 document。apply() 用 typeof document !== "undefined"
  // 判断是否在浏览器环境。测试需要控制 document（注入/清理 CSS 样式节点）。
  // 用 createContext + runInContext：沙箱 context 对象保留引用，测试可后设
  // context.document = fakeDoc 来模拟浏览器环境（初始 undefined = 非浏览器）。
  const context = vm.createContext({ URL, window })
  vm.runInContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), context)
  assert.equal(definition.id, 'dsh-mindmap')
  const runtime = definition.factory((id) => {
    if (id === 'react/jsx-runtime') return {
      // 019：桩返回最小元素形状（带 props），供 renderInline 等纯渲染函数断言。
      jsx(type, props, key) { return { type, props: props || {}, key } },
      jsxs(type, props, key) { return { type, props: props || {}, key } },
      Fragment: {},
    }
    if (id === 'react') {
      return { useState, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, useCallback }
    }
    throw new Error(`Unexpected browser dependency: ${id}`)
  })
  return { runtime, window, context }
}

// react 桩：组件不真正渲染，只保证钩子在模块加载与 apply 时可用。
// 021：useRef 统一登记，测试据此拿到组件内部的滚动区 ref 驱动平移手势。
// 026：useSyncExternalStore / useCallback 供 MindmapSlot / MindmapSidebarTab 测试。
const capturedRefs = []
function useState(initial) {
  return [typeof initial === 'function' ? initial() : initial, () => {}]
}
function useEffect() {}
function useLayoutEffect() {}
function useMemo(factory) {
  return factory()
}
function useRef(value) {
  const ref = { current: value }
  capturedRefs.push(ref)
  return ref
}
function useSyncExternalStore(subscribe, getSnapshot) {
  if (typeof subscribe === 'function') subscribe(() => {})
  return typeof getSnapshot === 'function' ? getSnapshot() : undefined
}
function useCallback(fn) {
  return fn
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

const { runtime, window: fakeWindow, context: sandboxContext } = loadBrowserModule()
const { parseMarkdownToTree, reduceDocuments, mergeDocuments, autoOpenTarget, openingEventKeys, nodesFingerprint, matchDocError, errorEventKeys, stemOf, buildExportSvg, measureExportBox, exportCanvasSize, resultTextOfBlocks, relPathWithin, visibleTreeRows, readDraftText, draftBlocksAutoSend, toggleCollapsed, countDescendants, pruneCollapsed, TreeRow, clampZoom, stepZoom, fitZoom, focusZoom, collectTreeIds, planGrowthReveal, resolveToken, resolveNodeStyle, exportPalette, hasInlineFormat, isTableSeparator, parseTableRow, nodeFullText, renderInline, stripInlineForExport, wrapExportText, openLink, COLOR_THEMES, PAN, shouldStartPan, panScroll, isTextEntry, isActivatable, MindmapCanvas, conversationNodesOf, settingsNamespacesOf, sidebarBus, sessionStore, MindmapSidebarTab, MindmapWorkspace, S, MindmapSlot } = runtime.internals

test('browser module declares the expected service inject list', () => {
  // 014：layout 随 details 形态退役；shell.overlay 注册不需要额外服务。
  assert.deepEqual(Array.from(runtime.inject), ['slots'])
})

test('conversationNodesOf reads legacy.nodes (0.1.2-rc.1+) first and falls back to s.nodes (≤0.1.1)', () => {
  // 023 双代快照选择：0.1.2-rc.1 的 SessionSnapshot 不带 nodes，会话内容
  // 在 useChat 的 ChatSnapshot.legacy.nodes；旧版快照直接带 s.nodes。
  const legacyNodes = [toolResultNode('mindmap_open', { ok: true, op: 'open', path: '/w/a.md', content: 'a' })]
  const oldNodes = [toolResultNode('mindmap_get', { ok: true, op: 'get', path: '/w/b.md', content: 'b' })]
  assert.equal(conversationNodesOf({ legacy: { nodes: legacyNodes } }), legacyNodes)
  assert.equal(conversationNodesOf({ nodes: oldNodes }), oldNodes)
  // 双形态并存（升级窗口期）时 legacy 优先
  assert.equal(conversationNodesOf({ legacy: { nodes: legacyNodes }, nodes: oldNodes }), legacyNodes)
  // legacy.nodes 非数组时不采用，回退 s.nodes
  assert.equal(conversationNodesOf({ legacy: { nodes: 'broken' }, nodes: oldNodes }), oldNodes)
  // 缺失/畸形输入回退共享空数组常量（selector 值比较稳定）
  assert.equal(conversationNodesOf({}), conversationNodesOf(null))
  assert.equal(conversationNodesOf(undefined).length, 0)
})

test('settingsNamespacesOf parses direct and wrapped array envelopes plus the legacy namespaces aggregate', () => {
  // 023 双代信封：0.1.2-rc.1 的 describe 直接返回描述符数组；≤0.1.1 聚合在
  // result.value.namespaces。描述符条目字段 ns/value 两代同名。
  const descriptors = [{ ns: 'mindmap', value: { requireApproval: false } }, { ns: 'other', value: {} }]
  assert.deepEqual(settingsNamespacesOf(descriptors), descriptors)
  assert.deepEqual(settingsNamespacesOf({ value: descriptors }), descriptors)
  assert.deepEqual(settingsNamespacesOf({ result: { value: descriptors } }), descriptors)
  assert.deepEqual(settingsNamespacesOf({ result: { value: { namespaces: descriptors } } }), descriptors)
  assert.deepEqual(settingsNamespacesOf({ ok: true, value: { namespaces: descriptors } }), descriptors)
  // 空值/畸形应答回退空数组（面板降级路径，不抛错）。
  // 断言形状而非 deepEqual([])：vm realm 造出的 [] 与本 realm 的 []
  // 结构相等但原型不同源，deepStrictEqual 会误报 not reference-equal。
  for (const bad of [{ result: {} }, null, { result: { value: { namespaces: 'broken' } } }]) {
    const out = settingsNamespacesOf(bad)
    assert.equal(Array.isArray(out), true)
    assert.equal(out.length, 0)
  }
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

test('placeholder list items need no trailing space at any depth', () => {
  // 反馈清单第 6 条的实证：占位节点不要求尾随空格，缩进层级同样成立。
  const tree = parseMarkdownToTree('- a\n-\n  -\n- b', 'doc')
  assert.deepEqual([...tree.children.map((n) => n.kind)], ['list', 'placeholder', 'list'])
  assert.equal(tree.children[1].children[0].kind, 'placeholder')
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

test('paragraphs become text/md block nodes (019 block concept)', () => {
  // 019 段落升格：不再塞 description，自己成为节点；含行内格式 → md，否则 text。
  const tree = parseMarkdownToTree('# T\nfirst note\nsecond line\n\nanother para', 'doc')
  assert.equal(tree.children.length, 1)
  assert.deepEqual([...tree.children[0].children.map((n) => n.kind)], ['text', 'text'])
  assert.equal(tree.children[0].children[0].topic, 'first note second line')
  assert.equal(tree.children[0].children[0].data.raw, 'first note second line')
  // 没有标题时挂到根
  const bare = parseMarkdownToTree('just text', 'doc')
  assert.equal(bare.children.length, 1)
  assert.equal(bare.children[0].kind, 'text')
  assert.equal(bare.children[0].topic, 'just text')
  // 行内格式分流：含粗体/行内代码/链接 → md 块（原文完整存 data.raw）
  const mixed = parseMarkdownToTree('plain words\n\n**bold** and `code` and [t](https://x.y)', 'doc')
  assert.equal(mixed.children[0].kind, 'text')
  assert.equal(mixed.children[1].kind, 'md')
  assert.equal(mixed.children[1].data.raw, '**bold** and `code` and [t](https://x.y)')
  assert.equal(hasInlineFormat('plain words'), false)
  assert.equal(hasInlineFormat('**bold**'), true)
  assert.equal(hasInlineFormat('see [doc](https://a.b)'), true)
})

test('blockquotes become quote nodes with the first paragraph promoted (001 §3.1)', () => {
  // frontmatter 与分隔线仍跳过；引用不再被吞。
  const tree = parseMarkdownToTree('---\ntitle: x\n---\n# A\n---\n> quoted words\n> second line\n## B', 'doc')
  const [a] = tree.children
  assert.deepEqual([...a.children.map((n) => n.kind)], ['quote', 'heading'])
  // 首段提升为自身内容，其余成子节点；原文存 data.raw。
  assert.equal(a.children[0].topic, 'quoted words second line')
  assert.equal(a.children[0].data.raw, 'quoted words\nsecond line')
  // 递归：引用内的标题/段落照同一套块规则解析（首段被提升后不重复）。
  // 段落的既有语义：挂到最近的未闭合标题下（历史行为是塞进该节点的 description）。
  const nested = parseMarkdownToTree('> intro\n> ## Inner\n> more', 'doc')
  const [q] = nested.children
  assert.equal(q.kind, 'quote')
  assert.equal(q.topic, 'intro')
  assert.deepEqual([...q.children.map((n) => n.kind)], ['heading'])
  assert.equal(q.children[0].topic, 'Inner')
  assert.deepEqual([...q.children[0].children.map((n) => n.kind)], ['text'])
  assert.equal(q.children[0].children[0].topic, 'more')
})

test('tables become table nodes keeping every cell (019 block concept)', () => {
  const tree = parseMarkdownToTree('| h1 | h2 |\n| --- | --- |\n| a | b |\n| c | d |', 'doc')
  const [t] = tree.children
  assert.equal(t.kind, 'table')
  assert.equal(t.topic, '3×2 表格')
  // vm 里产出的数组原型来自另一个 realm，deepStrictEqual 会拒绝——展开拆进宿主数组。
  assert.deepEqual([...t.data.rows.map((r) => [...r])], [['h1', 'h2'], ['a', 'b'], ['c', 'd']])
  // 无分隔行的 | 行不是表格，退化为段落。
  const notTable = parseMarkdownToTree('| only | one |', 'doc')
  assert.equal(notTable.children[0].kind, 'text')
  assert.deepEqual([...parseTableRow('| a | b |')], ['a', 'b'])
  assert.equal(isTableSeparator('| --- | :---: |'), true)
  assert.equal(isTableSeparator('| a | b |'), false)
  // GFM 转义：\| 是字面竖线，不切单元格。
  assert.deepEqual([...parseTableRow('| a \\| b | c |')], ['a | b', 'c'])
  // GFM 对齐契约：列数钉在分隔行——少列补空、多列截断（未转义竖线切碎的行网格不参差）。
  const ragged = parseMarkdownToTree('| x | y |\n| --- | --- |\n| 三栏 [会|脑图|聊天] | ⚠️ |\n| only |', 'doc')
  const [rt] = ragged.children
  assert.equal(rt.kind, 'table')
  assert.deepEqual([...rt.data.rows.map((r) => [...r])], [
    ['x', 'y'],
    ['三栏 [会', '脑图'],
    ['only', ''],
  ])
})

test('unclosed leading --- is not treated as frontmatter (doc not swallowed)', () => {
  // 只有分隔线开头、没有闭合 ---：整篇曾被当 frontmatter 吞成空树。
  // 回退为普通解析：--- 按水平分隔线跳过，其余内容照旧
  // （正文段落归属最近的标题，挂在 A 名下而非根级）。
  const tree = parseMarkdownToTree('---\n# A\nbody words', 'doc')
  assert.deepEqual([...tree.children.map((n) => n.kind)], ['heading'])
  assert.equal(tree.children[0].topic, 'A')
  assert.deepEqual([...tree.children[0].children.map((n) => n.kind)], ['text'])
  // 正常闭合的 frontmatter 仍被跳过（既有契约不变）
  const closed = parseMarkdownToTree('---\ntitle: x\n---\n# A', 'doc')
  assert.deepEqual([...closed.children.map((n) => n.topic)], ['A'])
})

test('root-title echo only counts top-level H1 (H2 or quoted headings do not consume it)', () => {
  // H2 先行：随后的同名顶层 H1 仍应并入根节点。
  const t1 = parseMarkdownToTree('## sub\n# doc\nbody', 'doc')
  assert.deepEqual([...t1.children.map((n) => n.topic)], ['sub'])
  // 引用块内的标题不消耗回声名额（递归不参与回声）。
  const t2 = parseMarkdownToTree('> ## Inner\n# doc\nbody', 'doc')
  assert.deepEqual([...t2.children.map((n) => n.kind)], ['quote', 'text'])
  // 只有首个顶层 H1 参与回声：它不匹配时，之后的同名 H1 保留为节点。
  const t3 = parseMarkdownToTree('# other\n# doc', 'doc')
  assert.deepEqual([...t3.children.map((n) => n.topic)], ['other', 'doc'])
})

test('table column count follows the separator row per GFM', () => {
  // 分隔行 3 列：表头 2 列补空到 3，数据 3 列完整保留。
  const wide = parseMarkdownToTree('| a | b |\n| --- | --- | --- |\n| 1 | 2 | 3 |', 'doc')
  const [w] = wide.children
  assert.equal(w.kind, 'table')
  assert.deepEqual([...w.data.rows.map((r) => [...r])], [['a', 'b', ''], ['1', '2', '3']])
  assert.equal(w.topic, '2×3 表格')
  // 分隔行 2 列：表头 3 列截断到 2。
  const narrow = parseMarkdownToTree('| a | b | c |\n| --- | --- |\n| 1 | 2 |', 'doc')
  const [n] = narrow.children
  assert.deepEqual([...n.data.rows.map((r) => [...r])], [['a', 'b'], ['1', '2']])
})

test('code fences close only on a matching marker of at least the same length', () => {
  // ~~~ 块不会被 ``` 行提前关闭。
  const tilde = parseMarkdownToTree('~~~\n``` inside\nstill code\n~~~', 'doc')
  assert.equal(tilde.children.length, 1)
  assert.equal(tilde.children[0].kind, 'code')
  assert.equal(tilde.children[0].data.code, '``` inside\nstill code')
  // 闭合围栏至少与开启围栏等长。
  const long = parseMarkdownToTree('````\n```\nstill code\n````', 'doc')
  assert.equal(long.children.length, 1)
  assert.equal(long.children[0].data.code, '```\nstill code')
})

test('parseTableRow treats \\\\| as escaped backslash plus a real separator', () => {
  // 双反斜杠是转义的反斜杠，其后的 | 是真切分（GFM）——
  // 回归点是「照常切开」（旧代码误当转义竖线不切）；
  // 反斜杠对本身保留原样（与解析器其余处保留字面反斜杠一致）。
  assert.deepEqual([...parseTableRow('| a\\\\| b |')], ['a\\\\', 'b'])
  // 单反斜杠转义语义不变（输入 a\| 本无空格，还原后也无空格）。
  assert.deepEqual([...parseTableRow('| a\\| b |')], ['a| b'])
})

test('nodeFullText returns the complete own content per kind (020 copy full text)', () => {
  const tree = parseMarkdownToTree('para words\n\n```js\nconst a = 1\nconst b = 2\n```\n\n| h1 | h2 |\n| --- | --- |\n| a | b |\n\n> q1\n> q2', 'doc')
  const [text, code, table, quote] = tree.children
  // 散文块取原文（data.raw）。
  assert.equal(nodeFullText(text), 'para words')
  // 代码块取围栏全文，不是盒内摘要。
  assert.equal(nodeFullText(code), 'const a = 1\nconst b = 2')
  // 表格块按 Markdown 源码形态输出完整网格。
  assert.equal(nodeFullText(table), '| h1 | h2 |\n| --- | --- |\n| a | b |')
  // 引用块取整块引用源码。
  assert.equal(nodeFullText(quote), 'q1\nq2')
  assert.equal(nodeFullText(null), '')
})

test('nodeFullText round-trips escaped table cells without changing their columns', () => {
  const table = parseMarkdownToTree('| value |\n| --- |\n| a \\| b |', 'doc').children[0]
  const copied = nodeFullText(table)
  const reparsed = parseMarkdownToTree(copied, 'doc').children[0]
  assert.deepEqual([...reparsed.data.rows.map((row) => [...row])], [['value'], ['a | b']])
})

test('table parsing limits pathological grid expansion', () => {
  const cols = Array.from({ length: 101 }, () => '---').join(' | ')
  const rows = Array.from({ length: 1200 }, () => '| x |').join('\n')
  const table = parseMarkdownToTree(`| h |\n| ${cols} |\n${rows}`, 'doc').children[0]
  assert.equal(table.kind, 'table')
  assert.equal(table.data.truncated, true)
  assert.ok(table.data.rows.length * table.data.rows[0].length <= 10000)
  assert.equal(table.data.rows[0].length, 100)
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

test('collectTreeIds gathers every node id including the root', () => {
  const tree = parseMarkdownToTree('# A\n- x\n  - y', 'doc')
  const ids = collectTreeIds(tree)
  assert.ok(ids.has('root'))
  assert.equal(ids.size, 4)
  assert.equal(collectTreeIds(null).size, 0)
})

test('planGrowthReveal animates only nodes missing from the previous id set', () => {
  // 兄弟插拔后稳定 id 不漂移（上方同款断言）→ 旧节点不进计划，只有新增节点渐显。
  const before = parseMarkdownToTree('# A\n- x\n- y', 'doc')
  const after = parseMarkdownToTree('# A\n- x\n- NEW\n- y', 'doc')
  const plan = planGrowthReveal(after, collectTreeIds(before))
  assert.equal(plan.nodes.size, 1)
  assert.ok(plan.nodes.has(after.children[0].children[1].id))
  assert.equal(plan.nodes.get(after.children[0].children[1].id), 0)
  // 连线浮现挂在其父节点（A）上，延迟 = 最早新子节点。
  assert.ok(plan.edges.has(after.children[0].id))
  assert.equal(plan.edges.size, 1)
  assert.ok(plan.totalMs > 0)
  // 无新增/变化 → 不出动画计划（旧节点不重播）。
  assert.equal(planGrowthReveal(after, collectTreeIds(after)), null)
})

test('planGrowthReveal covers first screen (null prev) and text-edited nodes', () => {
  // 首屏/切文档：全量节点含根，广度优先（根 → 一层子 → 二层孙）。
  const first = parseMarkdownToTree('# A\n- x\n  - deep\n# B', 'doc')
  const full = planGrowthReveal(first, null)
  assert.equal(full.nodes.size, 5)
  assert.ok(full.nodes.has('root'))
  const byDelay = [...full.nodes.entries()].sort((a, b) => a[1] - b[1])
  assert.equal(byDelay[0][0], 'root')
  assert.deepEqual([...full.nodes.values()].sort((a, b) => a - b), [0, 90, 180, 270, 360])
  // 文本修改 = 结构路径/内容变化 → 归入「变化」节点照样渐显。标题改名会
  // 级联其后代的结构路径（父路径进 id）→ 改名标题连同子树一起渐显。
  const edited = parseMarkdownToTree('# A 改名\n- x\n  - deep\n# B', 'doc')
  const diff = planGrowthReveal(edited, collectTreeIds(first))
  assert.equal(diff.nodes.size, 3)
  assert.ok(diff.nodes.has(edited.children[0].id))
  // 未改动的另一支（heading B）不受影响。
  assert.ok(!diff.nodes.has(edited.children[1].id))
})

test('planGrowthReveal staggers breadth-first and compresses large batches within budget', () => {
  // BFS 层级序：同层先于下层（A、B 先于 C），与文档先序（A、C、B）不同。
  const tree = parseMarkdownToTree('# A\n  - C\n# B'.replace('  - C', '## C'), 'doc')
  const plan = planGrowthReveal(tree, null)
  const delayOf = (topic) => {
    let found = null
    const walk = (n) => {
      if (n.topic === topic) found = plan.nodes.get(n.id)
      n.children.forEach(walk)
    }
    walk(tree)
    return found
  }
  assert.ok(delayOf('A') < delayOf('B'))
  assert.ok(delayOf('B') < delayOf('C'))
  // 大图：200 节点错峰自动压缩，末节点延迟 + 动画时长 ≤ 2s 预算。
  const big = parseMarkdownToTree(Array.from({ length: 200 }, (_, i) => `- item ${i}`).join('\n'), 'doc')
  const bigPlan = planGrowthReveal(big, null)
  assert.equal(bigPlan.nodes.size, 201)
  assert.ok(bigPlan.totalMs <= 2000)
  const step = bigPlan.nodes.get(big.children[1].id)
  assert.ok(step > 0 && step <= 90)
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

test('mergeDocuments keeps a live snapshot doc when another doc renamedFrom its path', () => {
  // A 改名 B（B.renamedFrom=A）后，A 又被重建为快照文档，且本地还有 A 占位：
  // 丢弃只应移除本地旧名条目，不能把新快照 A 一起删掉
  // （旧代码 order 有 A、byPath 无 A，面板打不开）。
  const snapshot = {
    order: ['/w/a.md', '/w/b.md'],
    byPath: {
      '/w/a.md': { path: '/w/a.md', rootTitle: 'a', content: '重生', op: 'create', callId: 'c2', renamedFrom: null },
      '/w/b.md': { path: '/w/b.md', rootTitle: 'b', content: '改名', op: 'update', callId: 'c1', renamedFrom: '/w/a.md' },
    },
  }
  const merged = mergeDocuments(snapshot, {
    '/w/a.md': { path: '/w/a.md', rootTitle: 'a', content: '本地占位', op: 'local', callId: null, renamedFrom: null },
  })
  assert.equal(merged.byPath['/w/a.md'].content, '重生')
  assert.deepEqual([...merged.order], ['/w/a.md', '/w/b.md'])
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
  const tree = parseMarkdownToTree('# A\n- x\n  - deep\n# Z\n- y', 'doc')
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

// —— 025 草稿保护 ——

test('readDraftText probes the known draft shapes and reports unknown as null', () => {
  assert.equal(readDraftText({ getDraft: () => '写到一半' }), '写到一半')
  assert.equal(readDraftText({ draft: '写到一半' }), '写到一半')
  assert.equal(readDraftText({ getState: () => ({ draft: '写到一半' }) }), '写到一半')
  // 宿主没有暴露草稿：不可知，必须是 null 而不是空串
  assert.equal(readDraftText({ setDraft() {}, submit() {} }), null)
  assert.equal(readDraftText(null), null)
  // 读取抛错同样按不可知处理
  assert.equal(readDraftText({ getDraft() { throw new Error('nope') } }), null)
})

test('draftBlocksAutoSend only blocks on a draft it can actually read', () => {
  // 关键回归：宿主不暴露草稿时不得拦截，否则点目录文件永远打不开
  assert.equal(draftBlocksAutoSend({ setDraft() {}, submit() {} }), false)
  assert.equal(draftBlocksAutoSend(undefined), false)
  // 可读且为空 → 放行；可读且非空 → 拦截
  assert.equal(draftBlocksAutoSend({ getDraft: () => '   ' }), false)
  assert.equal(draftBlocksAutoSend({ getDraft: () => '写到一半' }), true)
})

// —— 025 子树折叠 ——

test('toggleCollapsed adds and removes ids without mutating the input set', () => {
  const base = new Set(['a'])
  const added = toggleCollapsed(base, 'b')
  assert.deepEqual([...added].sort(), ['a', 'b'])
  assert.deepEqual([...base], ['a'], '入参集合不可被就地改写')
  const removed = toggleCollapsed(added, 'a')
  assert.deepEqual([...removed], ['b'])
  // 缺省入参（首次折叠）照常成集
  assert.deepEqual([...toggleCollapsed(undefined, 'x')], ['x'])
})

test('countDescendants counts the whole subtree below a node', () => {
  const tree = parseMarkdownToTree('# A\n- x\n  - deep\n- y', 'doc')
  const heading = tree.children[0]
  assert.equal(countDescendants(heading), 3)
  assert.equal(countDescendants(heading.children[0]), 1)
  assert.equal(countDescendants(heading.children[1]), 0)
  assert.equal(countDescendants(null), 0)
})

test('pruneCollapsed drops ids the reparsed tree no longer has', () => {
  const before = parseMarkdownToTree('# A\n- x\n- gone', 'doc')
  const after = parseMarkdownToTree('# A\n- x', 'doc')
  const kept = before.children[0].children[0].id
  const dropped = before.children[0].children[1].id
  const pruned = pruneCollapsed(new Set([kept, dropped]), after)
  assert.deepEqual([...pruned], [kept])
  // 无变化时返回同一引用，避免制造多余重渲染
  const stable = new Set([kept])
  assert.equal(pruneCollapsed(stable, after), stable)
  const empty = new Set()
  assert.equal(pruneCollapsed(empty, after), empty)
})

// TreeRow 用 jsx 桩渲染：子组件不递归执行，直接检查本行返回的 props 树。
function treeRowParts(node, collapsed, onToggleCollapse) {
  const row = TreeRow({ node, theme: null, collapsed, onToggleCollapse })
  const children = row.props.children.filter(Boolean)
  return {
    toggle: children.find((el) => el.props && el.props['data-mindmap-collapse'] !== undefined) ?? null,
    childrenColumn: children.find((el) => el.props && el.props['data-mindmap-children'] !== undefined) ?? null,
  }
}

test('TreeRow renders a collapse toggle only for parents and hides the subtree when collapsed', () => {
  const tree = parseMarkdownToTree('# A\n- x\n  - deep', 'doc')
  const heading = tree.children[0]
  const leaf = heading.children[0].children[0]

  const expanded = treeRowParts(heading, new Set(), () => {})
  assert.ok(expanded.toggle, '有子节点的行应渲染折叠开关')
  assert.equal(expanded.toggle.props.children, '−')
  assert.ok(expanded.childrenColumn, '展开态应渲染子列')

  const folded = treeRowParts(heading, new Set([heading.id]), () => {})
  assert.equal(folded.toggle.props.children, '+')
  assert.equal(folded.childrenColumn, null, '折叠态不得渲染子列')
  assert.ok(folded.toggle.props.title.includes('2'), '提示应说明隐藏了多少节点')

  // 叶子没有开关
  assert.equal(treeRowParts(leaf, new Set(), () => {}).toggle, null)
})

test('TreeRow collapse toggle reports the node id and never reaches the canvas click handler', () => {
  const tree = parseMarkdownToTree('# A\n- x', 'doc')
  const heading = tree.children[0]
  const toggled = []
  const { toggle } = treeRowParts(heading, new Set(), (id) => toggled.push(id))
  let stopped = 0
  let prevented = 0
  toggle.props.onClick({ stopPropagation: () => { stopped += 1 }, preventDefault: () => { prevented += 1 } })
  assert.deepEqual(toggled, [heading.id])
  assert.equal(stopped, 1, '必须阻断冒泡，否则会连带触发聚焦/取消选中')
  assert.equal(prevented, 1)
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

test('settings face looks up a late connection for direct descriptors and positional updates', async () => {
  const registered = []
  let connection
  const ctx = {
    get() { return connection },
    slots: {
      inject(_key, factory) { factory() },
      register(options) {
        registered.push(options)
        return () => {}
      },
    },
  }
  runtime.apply(ctx)
  const face = registered.find((options) => options.name === 'conversation.session.header.actions').inject().mindmapFace
  assert.equal(await face.readSettings(), null)

  const writes = []
  connection = {
    api: {
      settings: {
        async describe() {
          return [{ ns: 'mindmap', value: { colorTheme: 'forest' } }]
        },
        async update(ns, patch) {
          writes.push({ ns, patch })
        },
      },
    },
  }
  assert.equal((await face.readSettings()).colorTheme, 'forest')
  await face.updateSettings({ colorTheme: 'ocean' })
  assert.deepEqual(writes, [{ ns: 'mindmap', patch: { colorTheme: 'ocean' } }])
})

test('settings face uses the current remote settings API when connection is unavailable', async () => {
  const registered = []
  const writes = []
  // Cordis 契约：未注入的服务只能整名经 ctx.get 取。直接读 ctx.remote 会抛
  // 「without inject」；先取 remote 再读 .settings 也会抛（remote.settings 是
  // 独立服务名）。这里照实模拟这两道守卫。
  const remoteSettings = {
    async describe() {
      return { ok: true, value: { namespaces: [{ ns: 'mindmap', value: { cardStyle: 'square' } }] } }
    },
    async update(ns, patch, revision) {
      writes.push({ ns, patch, revision })
    },
  }
  const guardedRemote = new Proxy({}, {
    get(_target, prop) {
      throw new Error(`cannot get property "remote.${String(prop)}" without inject`)
    },
  })
  const ctx = {
    get(name) {
      if (name === 'remote.settings') return remoteSettings
      if (name === 'remote') return guardedRemote
      throw new Error(`cannot get property "${name}" without inject`)
    },
    get remote() {
      throw new Error('cannot get property "remote" without inject')
    },
    slots: {
      inject(_key, factory) { factory() },
      register(options) {
        registered.push(options)
        return () => {}
      },
    },
  }
  runtime.apply(ctx)
  const face = registered.find((options) => options.name === 'conversation.session.header.actions').inject().mindmapFace
  assert.equal((await face.readSettings()).cardStyle, 'square')
  await face.updateSettings({ cardStyle: 'rounded' })
  assert.equal(writes.length, 1)
  assert.equal(writes[0].ns, 'mindmap')
  assert.equal(writes[0].patch.cardStyle, 'rounded')
  assert.equal(writes[0].revision, undefined)
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

test('resolveToken walks override → fallback chain → registry default', () => {
  // 直查覆写
  assert.equal(resolveToken('color.accent.heading.strong', COLOR_THEMES.sunset), '#d96b2a')
  // 覆写缺失 → 沿回退链命中上级覆写 / 登记默认值
  assert.equal(resolveToken('color.accent.heading.medium', { 'color.accent.heading.strong': '#111111' }), '#111111')
  assert.equal(resolveToken('color.text.primary', {}), 'var(--dsw-alias-label-primary)')
  // 未登记令牌返回 null，主题名非法回落海洋蓝
  assert.equal(resolveToken('no.such.token', {}), null)
  const themes = ['ocean', 'sunset', 'forest'].map((n) => resolveToken('color.accent.root', COLOR_THEMES[n]))
  assert.equal(new Set(themes).size, 3)
})

test('resolveNodeStyle maps block identity and states to styles (pure function)', () => {
  const rootStyle = resolveNodeStyle({ kind: 'root' }, { colorTheme: 'ocean' })
  assert.equal(rootStyle.fontWeight, 700)
  assert.ok(rootStyle.background.includes('59,91,219'))
  // 标题分档：H1-H2 强 / H3-H4 中 / H5-H6 弱
  assert.equal(resolveNodeStyle({ kind: 'heading', data: { level: 1 } }, { colorTheme: 'forest' }).color, '#2a9d68')
  assert.equal(resolveNodeStyle({ kind: 'heading', data: { level: 5 } }, { colorTheme: 'forest' }).color, '#6fcf9f')
  // 血肉配方：引用左竖条、代码等宽、占位无底虚线框
  assert.ok(resolveNodeStyle({ kind: 'quote' }, {}).borderLeft.includes('solid'))
  assert.equal(resolveNodeStyle({ kind: 'code' }, {}).fontFamily, 'Menlo, monospace')
  assert.equal(resolveNodeStyle({ kind: 'placeholder' }, {}).background, 'none')
  // 直角卡片偏好 → 圆角归零；同输入同输出（纯函数性）
  assert.equal(resolveNodeStyle({ kind: 'text' }, { cardStyle: 'square' }).borderRadius, 0)
  const a = resolveNodeStyle({ kind: 'text' }, { states: { selected: true, hovered: true } })
  const b = resolveNodeStyle({ kind: 'text' }, { states: { selected: true, hovered: true } })
  assert.deepEqual(a, b)
  assert.ok(a.boxShadow.includes('0 0 0 2px'))
})

test('exportPalette gives a static light snapshot per theme', () => {
  const p = exportPalette('sunset')
  assert.equal(p.rootBorder, '#d96b2a')
  assert.equal(p.canvasBg, '#ffffff')
  // 未知名回落海洋蓝
  assert.equal(exportPalette('nope').heading, exportPalette('ocean').heading)
})

test('renderInline linkifies bare URLs and markdown links in full (no truncation)', () => {
  assert.equal(renderInline('plain'), 'plain')
  const out = renderInline('go https://example.com/very/long/path now', 'k')
  assert.ok(Array.isArray(out))
  const link = out.find((el) => el && el.props && el.props.href)
  assert.equal(link.props.href, 'https://example.com/very/long/path')
  // 完整呈现、永不缩减
  assert.equal(link.props.children, 'https://example.com/very/long/path')
  assert.equal(link.props.target, '_blank')
  // [文字](url) 与图片语法（暂缓期退化为链接）
  const named = renderInline('see [doc](https://a.b) and ![alt](https://img.c/d.png)', 'k')
  const links = named.filter((el) => el && el.props && el.props.href)
  assert.equal(links.length, 2)
  assert.equal(links[0].props.children, 'doc')
  assert.ok(String(links[1].props.children).includes('https://img.c/d.png'))
  // 导出剥离格式但保留完整 URL（PNG 不可点击，文本不缩减）
  assert.equal(stripInlineForExport('**b** and [doc](https://a.b)'), 'b and doc(https://a.b)')
})

test('renderInline bare links stop at CJK punctuation and never swallow trailing prose', () => {
  // 中文标点不再进 URL：， 是句读不是链接的一部分
  const cjk = renderInline('详见 https://a.com/x，然后继续', 'k')
  const cjkLink = cjk.find((el) => el && el.props && el.props.href)
  assert.equal(cjkLink.props.href, 'https://a.com/x')
  assert.ok(cjk.some((part) => typeof part === 'string' && part.includes('，然后继续')))
  // 、 分隔两个裸链接（旧正则把两个 URL 合并成一个坏链）
  const duo = renderInline('https://a.com、https://b.com', 'k')
  const duoLinks = duo.filter((el) => el && el.props && el.props.href)
  assert.deepEqual([...duoLinks.map((l) => l.props.href)], ['https://a.com', 'https://b.com'])
})

test('renderInline bare links keep balanced parens and return unbalanced tail to prose', () => {
  // 维基式括号配平：完整保留（链接永不缩减）
  const wiki = renderInline('go https://en.wikipedia.org/wiki/Foo_(bar) now', 'k')
  const wikiLink = wiki.find((el) => el && el.props && el.props.href)
  assert.equal(wikiLink.props.href, 'https://en.wikipedia.org/wiki/Foo_(bar)')
  assert.equal(wikiLink.props.children, 'https://en.wikipedia.org/wiki/Foo_(bar)')
  // 未配平的尾 )：退回正文（可见文本不丢字符，href 不带坏尾巴）
  const tail = renderInline('(见 https://a.com/x) 完', 'k')
  const tailLink = tail.find((el) => el && el.props && el.props.href)
  assert.equal(tailLink.props.href, 'https://a.com/x')
  assert.equal(tail.map((p) => (typeof p === 'string' ? p : p.props.children)).join(''), '(见 https://a.com/x) 完')
})

test('renderInline only linkifies allowlisted schemes (http/https/mailto)', () => {
  // javascript:/data: 不进 href——整串退化为纯文本（无锚点）
  const evil = renderInline('点我 [x](javascript:alert(1)) 和 [y](data:text/html,z)', 'k')
  const parts = Array.isArray(evil) ? evil : [evil]
  assert.ok(!parts.some((el) => el && el.type === 'a'))
  assert.equal(parts.map((p) => (typeof p === 'string' ? p : p.props.children)).join(''), '点我 [x](javascript:alert(1)) 和 [y](data:text/html,z)')
  // mailto 在白名单内
  const mail = renderInline('写信 [me](mailto:a@b.c)', 'k')
  const mailLink = mail.find((el) => el && el.props && el.props.href)
  assert.equal(mailLink.props.href, 'mailto:a@b.c')
})

test('openLink preventDefaults only when window.open succeeds (blocked falls back to native navigation)', () => {
  const mkEvent = () => ({ prevented: false, stopped: false, preventDefault() { this.prevented = true }, stopPropagation() { this.stopped = true } })
  // 成功开窗：拦默认行为（避免锚点再跳一次），事件已消费
  fakeWindow.open = (...args) => {
    fakeWindow.__openArgs = args
    return {}
  }
  const okEvent = mkEvent()
  openLink(okEvent, 'https://a.b/c')
  assert.deepEqual([...fakeWindow.__openArgs], ['https://a.b/c', '_blank', 'noopener'])
  assert.equal(okEvent.prevented, true)
  assert.equal(okEvent.stopped, true)
  // 宿主拦截（返回 null）：不拦默认行为，原生 <a target=_blank> 导航接管
  fakeWindow.open = () => null
  const blockedEvent = mkEvent()
  openLink(blockedEvent, 'https://a.b/c')
  assert.equal(blockedEvent.prevented, false)
  // 宿主抛异常：吞掉异常，同样退回原生导航
  fakeWindow.open = () => { throw new Error('blocked') }
  const thrownEvent = mkEvent()
  openLink(thrownEvent, 'https://a.b/c')
  assert.equal(thrownEvent.prevented, false)
})

test('wrapExportText wraps long content and keeps explicit newlines', () => {
  const lines = wrapExportText('a'.repeat(100), 220 - 24, 13)
  assert.ok(lines.length > 1)
  assert.equal(wrapExportText('l1\nl2', 100, 13).length, 2)
  assert.equal(wrapExportText('a'.repeat(100), 220 - 24, 13).join('').length, 100)
})

test('buildExportSvg measures wide-table height with the same clamped column width as rendering', () => {
  // 022 #12：6 列宽表被钳到 480（列宽 80 < tableCellW 110）。
  // 旧病：测量按 110 折行、渲染按 80 折行 → 盒高不足，文字画出盒外。
  const long = '字'.repeat(42)
  const table = {
    id: 't', kind: 'table', topic: '2×6 表格', children: [],
    data: { rows: [['h1', 'h2', 'h3', 'h4', 'h5', 'h6'], [long, 'x', 'x', 'x', 'x', 'x']] },
  }
  const tree = { id: 'r', kind: 'heading', topic: 'root', children: [table] }
  const { svg } = buildExportSvg(tree, 'ocean')
  const rects = [...svg.matchAll(/<rect x="([\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="7"/g)]
  assert.equal(rects.length, 2)
  const box = rects[1]
  const bx = Number(box[1])
  const by = Number(box[2])
  const bw = Number(box[3])
  const bottom = by + Number(box[4])
  const texts = [...svg.matchAll(/<text x="([\d.]+)" y="(-?[\d.]+)"/g)]
    .map((m) => ({ x: Number(m[1]), y: Number(m[2]) }))
    .filter((t) => t.x >= bx && t.x <= bx + bw)
  assert.ok(texts.length > 6)
  for (const t of texts) {
    assert.ok(t.y <= bottom, `text baseline y=${t.y} overflows table box bottom ${bottom}`)
  }
})

test('measureExportBox clamps the cell inner width so giant tables never degenerate', () => {
  // 60 列表格：列盒仅 8px 宽（480/60），减内距 16px 后 cellInner 为负——
  // 负宽会让每个字符独立成行，表格高度爆炸；钳到 12（一个全角字符宽）后
  // 每格 8 个半角字符 = 8 行，2 行数据 = 16 行 × 18px = 288px，高度归一。
  const cell = 'abcdefgh'
  const rows = [Array(60).fill(cell), Array(60).fill(cell)]
  const table = { id: 't', kind: 'table', topic: '60×2 表格', children: [], data: { rows } }
  const box = measureExportBox(table)
  assert.equal(box.w, 480) // 60×110 → 钳到 tableMaxW
  assert.equal(box.h, 288)
  // 渲染与测量共用同一钳制宽度：文字基线不越过表格盒底
  const tree = { id: 'r', kind: 'heading', topic: 'root', children: [table] }
  const { svg } = buildExportSvg(tree, 'ocean')
  const rects = [...svg.matchAll(/<rect x="([\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="7"/g)]
  assert.equal(rects.length, 2)
  const boxEl = rects[1]
  const bx = Number(boxEl[1])
  const by = Number(boxEl[2])
  const bw = Number(boxEl[3])
  const bottom = by + Number(boxEl[4])
  const texts = [...svg.matchAll(/<text x="([\d.]+)" y="(-?[\d.]+)"/g)]
    .map((m) => ({ x: Number(m[1]), y: Number(m[2]) }))
    .filter((t) => t.x >= bx && t.x <= bx + bw)
  assert.ok(texts.length > 60)
  for (const t of texts) {
    assert.ok(t.y <= bottom, `text baseline y=${t.y} overflows table box bottom ${bottom}`)
  }
})

test('exportCanvasSize rejects image dimensions that exceed the memory budget', () => {
  assert.deepEqual({ ...exportCanvasSize(320, 200) }, { width: 320, height: 200 })
  assert.throws(() => exportCanvasSize(8193, 1), /图片过大/)
  assert.throws(() => exportCanvasSize(4096, 4097), /图片过大/)
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

// 021 画布平移
test('shouldStartPan accepts the middle button anywhere, left only on blank or with space', () => {
  // 中键：画布惯例，压在节点上也拖
  assert.equal(shouldStartPan(1, { onNode: true }), true)
  assert.equal(shouldStartPan(1, {}), true)
  // 左键空白处：Mac 触摸板「按住拖」走这条
  assert.equal(shouldStartPan(0, { onNode: false }), true)
  // 左键压节点上：留给文字选区，不拖
  assert.equal(shouldStartPan(0, { onNode: true }), false)
  // 空格 + 左键：压节点上也能拖
  assert.equal(shouldStartPan(0, { onNode: true, spaceHeld: true }), true)
  // 右键与其它键：不拖
  assert.equal(shouldStartPan(2, { onNode: false }), false)
  assert.equal(shouldStartPan(-1, { onNode: false }), false)
  // 触摸：交还原生滚动（保住惯性），不劫持
  assert.equal(shouldStartPan(0, { onNode: false, touch: true }), false)
  // 缺参数：默认空白处左键
  assert.equal(shouldStartPan(0), true)
})

test('panScroll moves content with the pointer and flags drags past the threshold', () => {
  const start = { scrollLeft: 100, scrollTop: 40 }
  // 注：panScroll 的返回对象诞生在 vm 沙箱里，原型与外界不同，逐字段断言而不用 deepEqual。
  // 指针右移 30 → 内容右移 → scrollLeft 减小 30（跟手）
  assert.deepEqual({ ...panScroll(start, 30, 0, 4) }, { scrollLeft: 70, scrollTop: 40, moved: true })
  // 指针下移 30 → scrollTop 减小 30
  assert.deepEqual({ ...panScroll(start, 0, 30, 4) }, { scrollLeft: 100, scrollTop: 10, moved: true })
  // 指针左移/上移 → scroll 回升（反向拖回）
  assert.deepEqual({ ...panScroll(start, -50, -50, 4) }, { scrollLeft: 150, scrollTop: 90, moved: true })
  // 阈值内算点击：不吞随后的 click（保留点空白取消选中 / 点节点聚焦）
  assert.deepEqual({ ...panScroll(start, 2, -2, 4) }, { scrollLeft: 98, scrollTop: 42, moved: false })
  // 恰好 4px：越过阈值
  assert.equal(panScroll(start, 4, 0, 4).moved, true)
  assert.equal(panScroll(start, 3, 0, 4).moved, false)
  // 缺省阈值走 PAN.threshold；非法阈值回退缺省
  assert.equal(panScroll(start, PAN.threshold, 0).moved, true)
  assert.equal(panScroll(start, 3, 0, NaN).moved, false)
})

test('isTextEntry only claims spaces typed into inputs, textareas and contenteditable', () => {
  assert.equal(isTextEntry({ tagName: 'INPUT' }), true)
  assert.equal(isTextEntry({ tagName: 'TEXTAREA' }), true)
  assert.equal(isTextEntry({ tagName: 'DIV', isContentEditable: true }), true)
  // 画布/面板上的普通元素：空格归画布
  assert.equal(isTextEntry({ tagName: 'DIV', isContentEditable: false }), false)
  assert.equal(isTextEntry({ tagName: 'SPAN' }), false)
  // 无目标（keydown 落在 document 上）也归画布
  assert.equal(isTextEntry(null), false)
  assert.equal(isTextEntry(undefined), false)
  assert.equal(isTextEntry({}), false)
})

test('isActivatable spares space-activation targets when swallowing the space key', () => {
  // 选择器命中按钮 / 链接 / 自定义控件 → 空格的激活语义必须放行
  assert.equal(isActivatable({ closest: (sel) => (String(sel).includes('button') ? {} : null) }), true)
  // 普通画布元素：不在任何可激活控件里
  assert.equal(isActivatable({ closest: () => null }), false)
  // 没有 closest（keydown 落在 document / 非元素目标上）：同样不算可激活
  assert.equal(isActivatable(null), false)
  assert.equal(isActivatable({}), false)
})

// 021 冒烟：把画布组件的平移手势整体跑一遍。jsx 桩不调用子组件（TreeRow 不会
// 真的渲染），因此这里拿到的是 props 树——直接在上面驱动 pointer 处理器，
// 验证「按下 → 移动 → 松手」确实写到了 scroll 上。
function renderCanvasScroller() {
  capturedRefs.length = 0
  const canvas = MindmapCanvas({
    node: parseMarkdownToTree('# A\n## B', 'doc'),
    theme: null,
    fitKey: 'doc.md',
    reveal: null,
  })
  let scroller = null
  const walk = (el) => {
    if (!el || typeof el !== 'object' || scroller) return
    const props = el.props
    if (props && typeof props.onPointerDown === 'function' && typeof props.onPointerMove === 'function') {
      scroller = el
      return
    }
    const children = props && props.children
    if (Array.isArray(children)) children.forEach(walk)
    else walk(children)
  }
  walk(canvas)
  return scroller
}

// 021 假滚动区：只实现平移用到的三样（scroll 读写 / style / 指针捕获）。
function fakeScroller(left, top) {
  return { scrollLeft: left, scrollTop: top, style: {}, setPointerCapture() {}, releasePointerCapture() {} }
}

// 021 事件工厂：字段给全，免得漏字段误触发防御分支（buttons 尤其关键）。
// closest 按选择器区分：真实 DOM 里节点盒不会命中「button 等控件」选择器，
// 桩若一律命中会掩盖「按在控件上是否启动平移」这类判定。
const ON_NODE = { closest: (sel) => (String(sel).includes('data-mindmap-node') ? {} : null) }
const BLANK = { closest: () => null }
function pointer(overrides) {
  return {
    button: 1, buttons: 1, pointerId: 7, clientX: 0, clientY: 0,
    pointerType: 'mouse', target: ON_NODE, preventDefault() {},
    ...overrides,
  }
}

test('MindmapCanvas pans the scroller on middle-drag and swallows the trailing click', () => {
  const scroller = renderCanvasScroller()
  assert.ok(scroller, '画布里找不到带平移手势的滚动区')
  // 空白处抓手光标；滚到边时不把滚动链传给宿主页面（聊天区不跟着动）
  assert.equal(scroller.props.style.cursor, 'grab')
  assert.equal(scroller.props.style.overscrollBehavior, 'contain')
  const fake = fakeScroller(120, 60)
  capturedRefs[0].current = fake
  // 中键压在节点盒上：画布惯例，照样启动平移
  scroller.props.onPointerDown(pointer({ pointerId: 7, clientX: 300, clientY: 200 }))
  // 按下还不算拖拽：光标维持 grab（普通点击不该闪一下 grabbing）
  assert.equal(fake.style.cursor, undefined)
  scroller.props.onPointerMove(pointer({ pointerId: 7, clientX: 330, clientY: 180 }))
  // 越过阈值才上抓手光标 + 锁文本选择
  assert.equal(fake.style.cursor, 'grabbing')
  assert.equal(fake.style.userSelect, 'none')
  // 指针右移 30 → scrollLeft −30；上移 20 → scrollTop +20（内容跟手）
  assert.equal(fake.scrollLeft, 90)
  assert.equal(fake.scrollTop, 80)
  scroller.props.onPointerUp(pointer({ buttons: 0, pointerId: 7 }))
  assert.equal(fake.style.cursor, 'grab')
  assert.equal(fake.style.userSelect, '')
  // 拖过 → 随后那次 click 被吞：平移不该顺手把选中环清掉（closest 都不该被问）
  let asked = 0
  const clickBlank = () => scroller.props.onClick({ target: { closest: () => { asked += 1; return null } } })
  clickBlank()
  assert.equal(asked, 0)
  // 松手后浏览器补发的 lostpointercapture 不能把「吞 click」的标记洗掉：
  // 再拖一次，pointerup 与 lostpointercapture 之间不插 click。
  scroller.props.onPointerDown(pointer({ pointerId: 8, clientX: 100, clientY: 100 }))
  scroller.props.onPointerMove(pointer({ pointerId: 8, clientX: 140, clientY: 100 }))
  scroller.props.onPointerUp(pointer({ buttons: 0, pointerId: 8 }))
  scroller.props.onLostPointerCapture(pointer({ buttons: 0, pointerId: 8 }))
  clickBlank()
  assert.equal(asked, 0)
  // 标记只吃一次，不粘手：再点一次空白照常走「取消选中」
  clickBlank()
  assert.equal(asked, 1)
})

test('MindmapCanvas leaves left-press on nodes, touch and plain taps alone', () => {
  const scroller = renderCanvasScroller()
  const fake = fakeScroller(10, 10)
  capturedRefs[0].current = fake
  // 左键压节点上：不平移，节点里的文字照常可选
  scroller.props.onPointerDown(pointer({ button: 0, pointerId: 1, target: ON_NODE }))
  scroller.props.onPointerMove(pointer({ button: 0, pointerId: 1, clientX: 80, clientY: 80 }))
  assert.equal(fake.scrollLeft, 10)
  assert.equal(fake.scrollTop, 10)
  // 触摸：交还原生滚动（保住惯性），不劫持
  scroller.props.onPointerDown(pointer({ button: 0, pointerId: 2, pointerType: 'touch', target: BLANK }))
  scroller.props.onPointerMove(pointer({ button: 0, pointerId: 2, pointerType: 'touch', clientX: 80, clientY: 80 }))
  assert.equal(fake.scrollLeft, 10)
  assert.equal(fake.scrollTop, 10)
  // 左键空白处轻点（位移 2px，未过 4px 阈值）：不吞 click，点空白取消选中照常
  scroller.props.onPointerDown(pointer({ button: 0, pointerId: 3, target: BLANK }))
  scroller.props.onPointerMove(pointer({ button: 0, pointerId: 3, clientX: 2, clientY: 0 }))
  scroller.props.onPointerUp(pointer({ button: 0, buttons: 0, pointerId: 3 }))
  // 关键：手抖不挪画布（021 遗留修复 1）
  assert.equal(fake.scrollLeft, 10)
  assert.equal(fake.scrollTop, 10)
  let asked = 0
  scroller.props.onClick({ target: { closest: () => { asked += 1; return null } } })
  assert.equal(asked, 1)
})

test('MindmapCanvas holds the canvas still and the cursor plain below the threshold', () => {
  const scroller = renderCanvasScroller()
  const fake = fakeScroller(200, 100)
  capturedRefs[0].current = fake
  scroller.props.onPointerDown(pointer({ button: 0, pointerId: 4, target: BLANK }))
  // 3px 抖动：不写 scroll、不上 grabbing
  scroller.props.onPointerMove(pointer({ button: 0, pointerId: 4, clientX: 3, clientY: 1 }))
  assert.equal(fake.scrollLeft, 200)
  assert.equal(fake.scrollTop, 100)
  assert.equal(fake.style.cursor, undefined)
  // 第 4px 越线：这一下就把整段位移一次性补上（公式是相对按下锚点的绝对值，
  // 跳过早期写入不丢位移，仍 1:1 跟手）
  scroller.props.onPointerMove(pointer({ button: 0, pointerId: 4, clientX: 4, clientY: 1 }))
  assert.equal(fake.scrollLeft, 196)
  assert.equal(fake.style.cursor, 'grabbing')
  // 已经越过阈值后，小幅移动照常跟手
  scroller.props.onPointerMove(pointer({ button: 0, pointerId: 4, clientX: 6, clientY: 1 }))
  assert.equal(fake.scrollLeft, 194)
  scroller.props.onPointerUp(pointer({ button: 0, buttons: 0, pointerId: 4 }))
})

test('MindmapCanvas ends a hanging pan when the pointer moves with no button held', () => {
  // 捕获失败 + 指针在滚动区外松手 → pointerup 收不到，panRef 会悬挂；
  // 之后不按键移动就会变成「无键拖画布」。
  const scroller = renderCanvasScroller()
  const fake = fakeScroller(50, 50)
  fake.setPointerCapture = () => { throw new Error('capture failed') }
  capturedRefs[0].current = fake
  scroller.props.onPointerDown(pointer({ pointerId: 9, clientX: 100, clientY: 100 }))
  scroller.props.onPointerMove(pointer({ pointerId: 9, clientX: 160, clientY: 100 }))
  assert.equal(fake.scrollLeft, -10)
  assert.equal(fake.style.cursor, 'grabbing')
  // 不按任何按键的移动 = 早已松手：自动收尾，且不写 scroll
  scroller.props.onPointerMove(pointer({ buttons: 0, pointerId: 9, clientX: 400, clientY: 400 }))
  assert.equal(fake.style.cursor, 'grab')
  assert.equal(fake.style.userSelect, '')
  assert.equal(fake.scrollLeft, -10)
  assert.equal(fake.scrollTop, 50)
  // 收尾后继续晃也不再拖动画布
  scroller.props.onPointerMove(pointer({ buttons: 0, pointerId: 9, clientX: 900, clientY: 900 }))
  assert.equal(fake.scrollLeft, -10)
})

test('MindmapCanvas clears the click suppression at the top of every gesture', () => {
  // 遗留修复 3：拖完画布后若下一个手势走「不启动平移」的早退路径（触摸点按 /
  // 左键压节点），残留的 true 会白吞掉那次点击。
  const scroller = renderCanvasScroller()
  const fake = fakeScroller(0, 0)
  capturedRefs[0].current = fake
  // 走一遍「触摸点按」残留路径
  scroller.props.onPointerDown(pointer({ pointerId: 11 }))
  scroller.props.onPointerMove(pointer({ pointerId: 11, clientX: 60 }))
  scroller.props.onPointerUp(pointer({ buttons: 0, pointerId: 11 }))
  // 故意不发 click，标记残留 true
  scroller.props.onPointerDown(pointer({ button: 0, pointerId: 12, pointerType: 'touch', target: BLANK }))
  scroller.props.onPointerUp(pointer({ button: 0, buttons: 0, pointerId: 12 }))
  let asked = 0
  scroller.props.onClick({ target: { closest: () => { asked += 1; return null } } })
  assert.equal(asked, 1, '触摸点按路径也应清掉残留的吞 click 标记')
  // 走一遍「左键压节点」残留路径
  scroller.props.onPointerDown(pointer({ pointerId: 13 }))
  scroller.props.onPointerMove(pointer({ pointerId: 13, clientX: 60 }))
  scroller.props.onPointerUp(pointer({ buttons: 0, pointerId: 13 }))
  scroller.props.onPointerDown(pointer({ button: 0, pointerId: 14, target: ON_NODE }))
  scroller.props.onPointerUp(pointer({ button: 0, buttons: 0, pointerId: 14 }))
  asked = 0
  scroller.props.onClick({ target: { closest: () => { asked += 1; return null } } })
  assert.equal(asked, 1, '左键压节点路径也应清掉残留的吞 click 标记')
})

test('MindmapCanvas ignores a second pointer driving an existing pan', () => {
  const scroller = renderCanvasScroller()
  const fake = fakeScroller(0, 0)
  capturedRefs[0].current = fake
  scroller.props.onPointerDown(pointer({ pointerId: 21, clientX: 100, clientY: 100 }))
  scroller.props.onPointerMove(pointer({ pointerId: 21, clientX: 140, clientY: 100 }))
  assert.equal(fake.scrollLeft, -40)
  // 第二根指头（另一个 pointerId）的移动不该驱动第一根指头的锚点
  scroller.props.onPointerMove(pointer({ pointerId: 22, clientX: 900, clientY: 900 }))
  assert.equal(fake.scrollLeft, -40)
  assert.equal(fake.scrollTop, 0)
  scroller.props.onPointerUp(pointer({ buttons: 0, pointerId: 21 }))
})

test('MindmapCanvas leaves canvas controls alone so their click is not captured by panning', () => {
  // 回归：折叠开关按下若被平移接管，setPointerCapture 会把 click 改派到滚动区，
  // 按钮永远收不到点击（实测「折叠按钮点了没反应」）。
  const scroller = renderCanvasScroller()
  const fake = fakeScroller(10, 10)
  let captured = 0
  fake.setPointerCapture = () => { captured += 1 }
  capturedRefs[0].current = fake
  const onControl = { closest: (sel) => (String(sel).includes('button') ? {} : null) }
  let prevented = 0
  scroller.props.onPointerDown(pointer({
    button: 0, pointerId: 41, target: onControl, preventDefault: () => { prevented += 1 },
  }))
  scroller.props.onPointerMove(pointer({ button: 0, pointerId: 41, clientX: 90, clientY: 90 }))
  assert.equal(fake.scrollLeft, 10, '按在控件上不得平移画布')
  assert.equal(fake.scrollTop, 10)
  assert.equal(captured, 0, '不得抢占指针，否则 click 不会落到控件上')
  assert.equal(prevented, 0, '不得拦默认行为，否则控件的点击语义被吞')
})

test('MindmapCanvas keeps panning in both directions after native scroll reaches an edge', () => {
  const scroller = renderCanvasScroller()
  let scrollLeft = 0
  let scrollTop = 0
  const fake = {
    style: {}, clientWidth: 400, clientHeight: 300,
    get scrollLeft() { return scrollLeft },
    set scrollLeft(value) { scrollLeft = Math.max(0, Math.min(0, value)) },
    get scrollTop() { return scrollTop },
    set scrollTop(value) { scrollTop = Math.max(0, Math.min(0, value)) },
    setPointerCapture() {}, releasePointerCapture() {},
  }
  const content = { style: {} }
  capturedRefs[0].current = fake
  capturedRefs[1].current = content
  scroller.props.onPointerDown(pointer({ pointerId: 31, clientX: 100, clientY: 100 }))
  // 原生 scroll 没有余量也要横纵双向跟手。
  scroller.props.onPointerMove(pointer({ pointerId: 31, clientX: 160, clientY: 140 }))
  assert.equal(content.style.transform, 'translate(60px, 40px)')
  // 自由拖动仍有边界，防止把脑图永久拖离视野。
  scroller.props.onPointerMove(pointer({ pointerId: 31, clientX: 500, clientY: 500 }))
  assert.equal(content.style.transform, 'translate(200px, 150px)')
  scroller.props.onPointerMove(pointer({ pointerId: 31, clientX: -500, clientY: -500 }))
  assert.equal(content.style.transform, 'translate(-200px, -150px)')
  scroller.props.onPointerUp(pointer({ buttons: 0, pointerId: 31 }))
})

test('settings face keeps the legacy update envelope for legacy connections', async () => {
  const registered = []
  const writes = []
  const ctx = {
    get() {
      return {
        api: {
          settings: {
            async describe() {
              return { result: { value: { namespaces: [{ ns: 'mindmap', value: {} }] } } }
            },
            async update(payload) {
              writes.push(payload)
            },
          },
        },
      }
    },
    slots: {
      inject(_key, factory) { factory() },
      register(options) {
        registered.push(options)
        return () => {}
      },
    },
  }
  runtime.apply(ctx)
  const face = registered.find((options) => options.name === 'conversation.session.header.actions').inject().mindmapFace
  await face.readSettings()
  await face.updateSettings({ lineStyle: 'curve' })
  assert.equal(writes.length, 1)
  assert.equal(writes[0].ns, 'mindmap')
  assert.equal(writes[0].patch.lineStyle, 'curve')
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

// —— 026 better-sidebar 共存：sidebarBus + sessionStore + apply 双模式 ——

// 026 测试用桩：构造一个 apply() 调用环境，收集 slot 注册 / ctx.effect /
// ctx.inject / betterSidebar.registerTab 调用。effects 数组按声明顺序保留，
// disposer 在插件卸载时逆序调用。document 桩记录 style 元素的插入与移除。
// 每个测试创建独立 fakeDoc 并注入 vm 沙箱的 context.document（apply 里
// typeof document !== "undefined" 判断据此走浏览器分支）。
// 029 ctx.inject 模拟 Cordis 语义：服务已存在时回调立即执行并返回 disposer；
// 服务不存在时记录回调，供 injectDisposers 在「服务消失」时调用。
function applySandbox(options = {}) {
  const { betterSidebar } = options
  const registered = []
  const effects = []
  const injectDisposers = [] // ctx.inject 回调返回的 disposer（BS 依赖消失时执行）
  const headChildren = []
  const fakeDoc = {
    createElement(tag) {
      const el = { tagName: tag, _removed: false, attributes: {}, textContent: '', remove() { this._removed = true } }
      Object.defineProperty(el, 'setAttribute', { value(k, v) { this.attributes[k] = v } })
      return el
    },
    head: { appendChild(el) { headChildren.push(el) } },
    querySelectorAll(sel) { return headChildren.filter((el) => !el._removed) },
  }
  const ctx = {
    get(name) {
      if (name === 'betterSidebar') return betterSidebar || undefined
      return undefined
    },
    effect(fn) { effects.push(fn) },
    // 029 模拟 Cordis ctx.inject：服务已存在 → 回调立即执行，返回 disposer；
    // 服务不存在 → 记录回调（不执行），返回 noop（等服务到达再执行）。
    // Cordis 语义：inject 回调接收的 ctx2 带有注入的服务属性（ctx2.betterSidebar）。
    inject(deps, callback) {
      if (deps.includes('betterSidebar') && betterSidebar) {
        const ctx2 = { ...ctx, betterSidebar }
        const dispose = callback(ctx2)
        if (typeof dispose === 'function') injectDisposers.push(dispose)
        return dispose || (() => {})
      }
      return () => {}
    },
    slots: {
      inject(_key, factory) { factory() },
      register(opts, component) { registered.push({ key: opts.name, options: opts, component }); return () => {} },
    },
  }
  return { ctx, registered, effects, injectDisposers, headChildren, fakeDoc }
}

// 在 vm 沙箱里设 document，执行 fn，结束后恢复。
function withSandboxDoc(fakeDoc, fn) {
  const prev = sandboxContext.document
  sandboxContext.document = fakeDoc
  try { return fn() } finally { sandboxContext.document = prev }
}

test('sidebarBus reports null initially and updates on set', () => {
  assert.equal(sidebarBus.get(), null)
  const svc = { registerTab() { return () => {} } }
  let notified = false
  const unsub = sidebarBus.subscribe(() => { notified = true })
  sidebarBus.set(svc)
  assert.equal(sidebarBus.get(), svc)
  assert.equal(notified, true)
  sidebarBus.set(null)
  assert.equal(sidebarBus.get(), null)
  unsub()
})

test('sessionStore isolates data by sessionId and notifies subscribers', () => {
  const s1 = { nodes: [], mindmapFace: {} }
  const s2 = { nodes: [], mindmapFace: {} }
  let s1Notifs = 0
  const unsub1 = sessionStore.subscribe('sess-1', () => { s1Notifs += 1 })
  sessionStore.set('sess-1', s1)
  sessionStore.set('sess-2', s2)
  assert.equal(sessionStore.get('sess-1'), s1)
  assert.equal(sessionStore.get('sess-2'), s2)
  assert.equal(sessionStore.get('sess-3'), null)
  // sess-1 的订阅不应被 sess-2 的写入触发
  assert.equal(s1Notifs, 1)
  sessionStore.delete('sess-1')
  assert.equal(sessionStore.get('sess-1'), null)
  assert.equal(s1Notifs, 2)
  unsub1()
})

test('apply standalone: no betterSidebar → registers header slot + settings, injects layout-push CSS, no Tab registration', () => {
  const sb = applySandbox({ betterSidebar: undefined })
  withSandboxDoc(sb.fakeDoc, () => {
    runtime.apply(sb.ctx)
    // ctx.effect 声明了 layout-push + growth-anim，需执行才插入
    sb.effects.forEach((fn) => fn())
  })
  const button = sb.registered.find((r) => r.key === 'conversation.session.header.actions')
  assert.ok(button, 'header slot registered in standalone')
  assert.equal(sidebarBus.get(), null, 'sidebarBus stays null in standalone')
  const layoutPush = sb.headChildren.find((el) => el.attributes['data-dsh-mindmap'] === 'layout-push')
  assert.ok(layoutPush, 'layout-push CSS injected in standalone')
  const growthAnim = sb.headChildren.find((el) => el.attributes['data-dsh-mindmap'] === 'growth-anim')
  assert.ok(growthAnim, 'growth-anim CSS injected in standalone')
})

test('apply standalone: ctx.effect cleanup removes layout-push and growth-anim CSS from <head>', () => {
  const sb = applySandbox({ betterSidebar: undefined })
  let disposers
  withSandboxDoc(sb.fakeDoc, () => {
    runtime.apply(sb.ctx)
    disposers = sb.effects.map((fn) => fn())
    assert.equal(sb.headChildren.length, 2, 'two style nodes inserted')
  })
  disposers.forEach((d) => typeof d === 'function' && d())
  assert.equal(sb.headChildren.filter((el) => !el._removed).length, 0, 'all style nodes removed on cleanup')
})

test('apply sidebar mode: betterSidebar available → registers Tab via ctx.inject, sets sidebarBus, does NOT inject layout-push CSS', () => {
  sidebarBus.set(null) // 重置前序测试残留
  const registrations = []
  const svc = {
    registerTab(descriptor) {
      registrations.push(descriptor)
      return () => { registrations.pop() }
    },
  }
  const sb = applySandbox({ betterSidebar: svc })
  withSandboxDoc(sb.fakeDoc, () => {
    runtime.apply(sb.ctx)
    // 029 ctx.inject 在 apply 执行时立即执行回调（服务已存在）——sidebar 注册
    // 已完成，不需要 effects 触发。但 layout-push effect 仍需执行。
    sb.effects.forEach((fn) => fn())
  })
  // Tab 注册
  assert.equal(registrations.length, 1, 'registerTab called exactly once')
  assert.equal(registrations[0].id, 'dsh-mindmap:mindmap')
  assert.equal(registrations[0].single, true)
  assert.equal(typeof registrations[0].component, 'function')
  // sidebarBus 已设
  assert.equal(sidebarBus.get(), svc, 'sidebarBus set to service')
  // layout-push CSS 未注入
  const layoutPush = sb.headChildren.find((el) => el.attributes['data-dsh-mindmap'] === 'layout-push')
  assert.equal(layoutPush, undefined, 'layout-push CSS NOT injected in sidebar mode')
  // growth-anim CSS 仍注入（与布局无关，两种模式都需要）
  const growthAnim = sb.headChildren.find((el) => el.attributes['data-dsh-mindmap'] === 'growth-anim')
  assert.ok(growthAnim, 'growth-anim CSS still injected in sidebar mode')
  // header slot 仍注册（M 按钮始终需要）
  const button = sb.registered.find((r) => r.key === 'conversation.session.header.actions')
  assert.ok(button, 'header slot still registered in sidebar mode')
})

test('apply sidebar mode: BS-only dispose (inject disposer) unregisters Tab and resets sidebarBus to null', () => {
  sidebarBus.set(null) // 重置前序测试残留
  const disposed = []
  const svc = {
    registerTab() { return () => { disposed.push(true) } },
  }
  const sb = applySandbox({ betterSidebar: svc })
  withSandboxDoc(sb.fakeDoc, () => {
    runtime.apply(sb.ctx)
    sb.effects.forEach((fn) => fn()) // layout-push effect
  })
  assert.equal(sidebarBus.get(), svc)
  // 029 只调 injectDisposers（模拟只卸载 BS，不卸载 dsh-mindmap）
  sb.injectDisposers.forEach((d) => d())
  assert.equal(sidebarBus.get(), null, 'sidebarBus reset to null after BS-only dispose')
  assert.equal(disposed.length, 1, 'Tab disposer called via inject lifecycle')
})

test('apply sidebar mode: duplicate registration is prevented (first inject disposer runs before second register)', () => {
  sidebarBus.set(null) // 重置前序测试残留
  // 模拟 HMR：apply 被调用两次。strict mock 在重复 id 注册时抛错——
  // 只有第一次的 inject disposer 真正在第二次注册前执行，第二次才不会抛。
  const registeredIds = new Set()
  let registerCount = 0
  let disposedCount = 0
  const svc = {
    registerTab(descriptor) {
      if (registeredIds.has(descriptor.id)) {
        throw new Error(`Tab "${descriptor.id}" already registered`)
      }
      registeredIds.add(descriptor.id)
      registerCount += 1
      return () => { disposedCount += 1; registeredIds.delete(descriptor.id) }
    },
  }
  const sb1 = applySandbox({ betterSidebar: svc })
  const sb2 = applySandbox({ betterSidebar: svc })
  withSandboxDoc(sb1.fakeDoc, () => {
    runtime.apply(sb1.ctx)
    sb1.effects.forEach((fn) => fn())
  })
  assert.equal(registerCount, 1, 'first registerTab called')
  // 模拟 HMR：第一次的 inject disposer 必须在第二次 apply 前执行
  sb1.injectDisposers.forEach((d) => d())
  assert.equal(disposedCount, 1, 'first inject disposer executed before second apply')
  assert.equal(sidebarBus.get(), null, 'sidebarBus cleared after first dispose')
  withSandboxDoc(sb2.fakeDoc, () => {
    runtime.apply(sb2.ctx)
    sb2.effects.forEach((fn) => fn())
  })
  assert.equal(registerCount, 2, 'second registerTab called')
  assert.equal(disposedCount, 1, 'second register succeeded without throwing "already registered"')
  // 清理
  sb2.injectDisposers.forEach((d) => d())
})

test('MindmapSidebarTab reads sessionStore data and renders workspace with visible prop', () => {
  // MindmapSidebarTab 从 sessionStore 读数据；没有数据时显示等待态。
  const ctx = { betterSidebar: { openTab() {} } }
  const scope = { sessionId: 'sidebar-test-1' }
  // 无数据：渲染等待态
  const waiting = MindmapSidebarTab({ ctx, scope, visible: true })
  assert.equal(waiting.type, 'div')
  const waitingText = typeof waiting.props.children.props.children === 'string'
    ? waiting.props.children.props.children
    : String(waiting.props.children.props.children)
  assert.ok(waitingText.includes('等待'), 'shows waiting state without data')
  // 写入数据：渲染 MindmapWorkspace（jsx 桩返回元素，type = MindmapWorkspace 函数）
  sessionStore.set('sidebar-test-1', { nodes: [], nodesVersion: '', inputActions: null, mindmapFace: null })
  const rendered = MindmapSidebarTab({ ctx, scope, visible: true })
  assert.equal(typeof rendered.type, 'function', 'renders MindmapWorkspace component')
  assert.equal(rendered.type.name, 'MindmapWorkspace', 'component is MindmapWorkspace')
  // 清理
  sessionStore.delete('sidebar-test-1')
})

test('MindmapSidebarTab onAutoOpen is wired to betterSidebar.openTab via component callback', () => {
  let openedTab = null
  const ctx = {
    betterSidebar: {
      openTab(seed, scope) { openedTab = { seed, scope } },
    },
  }
  const scope = { sessionId: 'auto-open-test' }
  sessionStore.set('auto-open-test', { nodes: [], nodesVersion: '', inputActions: null, mindmapFace: null })
  // MindmapSidebarTab 用 useCallback 缓存 onAutoOpen，传给 MindmapWorkspace。
  // visible=false → MindmapWorkspace 返回 null（hooks 照跑），但 jsx 桩仍
  // 返回 { type: MindmapWorkspace, props: { onAutoOpen, ... } }。
  const rendered = MindmapSidebarTab({ ctx, scope, visible: false })
  // 从组件 props 拿到 onAutoOpen 回调（不是直接调 mock 的 openTab）。
  const onAutoOpen = rendered.props.onAutoOpen
  assert.equal(typeof onAutoOpen, 'function', 'onAutoOpen callback present in workspace props')
  onAutoOpen()
  // 验证组件回调确实调了 betterSidebar.openTab，且参数正确。
  assert.ok(openedTab, 'openTab was called via component callback')
  assert.equal(openedTab.seed.type, 'dsh-mindmap:mindmap')
  // 031：seed 附惰性 url，让 BS 把它当「内容型 open」自动展开右栏面板。
  assert.equal(openedTab.seed.url, 'dsh-mindmap://mindmap')
  assert.equal(openedTab.scope.sessionId, 'auto-open-test')
  sessionStore.delete('auto-open-test')
})

// —— 027 内嵌头部视觉对齐：sidebar 单行工具栏 + standalone 双层头部 ——

// 027 渲染 MindmapWorkspace 并从 JSX 树里找头部结构的辅助函数。
// jsx 桩返回 { type, props, key }；递归遍历 children 找匹配节点。
function renderWorkspace(variant) {
  const nodes = [toolResultNode('mindmap_open', { ok: true, op: 'open', path: '/w/test.md', content: '# A\n- x', rootTitle: '测试脑图' }, { callId: 'ws-open' })]
  const ws = MindmapWorkspace({
    mindmapFace: null,
    visible: true,
    sessionId: `ws-${variant}`,
    inputActions: null,
    nodes,
    nodesVersion: '',
    onAutoOpen: () => {},
    onClose: variant === 'standalone' ? () => {} : undefined,
    headerHeight: variant === 'standalone' ? 74 : null,
    variant,
  })
  return ws
}

// 从 JSX 树里递归找第一个 type === tag 且含指定 prop 的节点。
function findInTree(el, testFn) {
  if (!el || typeof el !== 'object') return null
  if (testFn(el)) return el
  const children = el.props && el.props.children
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findInTree(child, testFn)
      if (found) return found
    }
  } else if (children && typeof children === 'object') {
    return findInTree(children, testFn)
  }
  return null
}

// 收集 JSX 树里所有文本节点（字符串子节点），用于检查标签文案。
function collectTexts(el, out = []) {
  if (!el) return out
  if (typeof el === 'string') { out.push(el); return out }
  if (typeof el !== 'object') return out
  const children = el.props && el.props.children
  if (Array.isArray(children)) {
    for (const child of children) collectTexts(child, out)
  } else if (children && typeof children === 'object') {
    collectTexts(children, out)
  } else if (typeof children === 'string') {
    out.push(children)
  }
  return out
}

test('sidebar variant: toolbar is a single row with "脑图列表" label and export button on the same line', () => {
  const ws = renderWorkspace('sidebar')
  assert.ok(ws, 'workspace renders')
  // 027 sidebar 模式的工具栏 = sbToolbar 样式的 div。
  // 渲染树是 { type: 'div', props: { children: [toolbarDiv, contentDiv, ...] } }
  const texts = collectTexts(ws)
  assert.ok(texts.includes('脑图列表'), 'sidebar shows "脑图列表" label')
  assert.ok(texts.includes('导出图片'), 'export button present')
  // 不得出现 standalone 的 "目录" 文案
  assert.ok(!texts.includes('目录'), 'sidebar must NOT show "目录" label')
})

test('sidebar variant: no standalone headerTop row (no spacer + export + close split across two rows)', () => {
  const ws = renderWorkspace('sidebar')
  // sidebar 模式的第一个子节点是 sbToolbar（单行），不应该有 headerTop 样式的 div。
  // headerTop 是 standalone 独有的「spacer + 导出 + 关闭」行。
  const hasHeaderTop = findInTree(ws, (el) => el.props && el.props.style === S.headerTop)
  assert.equal(hasHeaderTop, null, 'sidebar must not render standalone headerTop row')
  // sidebar 不应有关闭按钮（BS 自带关闭）
  const hasCloseBtn = findInTree(ws, (el) => el.props && el.props.title === '收起脑图面板')
  assert.equal(hasCloseBtn, null, 'sidebar must not render close button')
})

test('standalone variant: shows "目录" label and preserves two-row header with close button', () => {
  const ws = renderWorkspace('standalone')
  assert.ok(ws, 'workspace renders')
  const texts = collectTexts(ws)
  assert.ok(texts.includes('目录'), 'standalone shows "目录" label')
  // 不得出现 sidebar 的 "脑图列表" 文案
  assert.ok(!texts.includes('脑图列表'), 'standalone must NOT show "脑图列表" label')
  // standalone 有 headerTop 行（spacer + 导出 + 关闭）
  const hasHeaderTop = findInTree(ws, (el) => el.props && el.props.style === S.headerTop)
  assert.ok(hasHeaderTop, 'standalone renders headerTop row')
  // standalone 有关闭按钮
  const hasCloseBtn = findInTree(ws, (el) => el.props && el.props.title === '收起脑图面板')
  assert.ok(hasCloseBtn, 'standalone renders close button')
})

test('sidebar variant: MindmapSidebarTab passes variant="sidebar" to MindmapWorkspace', () => {
  // 通过 MindmapSidebarTab 渲染的 workspace 应该是 sidebar variant。
  const ctx = { betterSidebar: { openTab() {} } }
  const scope = { sessionId: 'variant-check' }
  sessionStore.set('variant-check', { nodes: [], nodesVersion: '', inputActions: null, mindmapFace: null })
  const tab = MindmapSidebarTab({ ctx, scope, visible: true })
  // jsx 桩返回 { type: MindmapWorkspace, props: { variant: 'sidebar', ... } }
  assert.equal(tab.props.variant, 'sidebar', 'MindmapSidebarTab passes variant="sidebar"')
  sessionStore.delete('variant-check')
})

// —— 028 生命周期收口：BS 晚到/消失的 layout-push CSS 可逆翻转 ——

test('BS late arrival: standalone layout-push CSS is removed when sidebar service activates via bus', () => {
  sidebarBus.set(null)
  // 初始无 betterSidebar → standalone 模式，layout-push CSS 注入。
  const sb = applySandbox({ betterSidebar: undefined })
  withSandboxDoc(sb.fakeDoc, () => {
    runtime.apply(sb.ctx)
    sb.effects.forEach((fn) => fn())
  })
  let layoutPush = sb.headChildren.find((el) => !el._removed && el.attributes['data-dsh-mindmap'] === 'layout-push')
  assert.ok(layoutPush, 'layout-push CSS present in standalone mode')
  // 模拟 BS 服务晚到：sidebarBus.set 触发 layout-push effect 移除 CSS。
  // 真正的晚到路径由 ctx.inject 回调执行 set（下面的生命周期测试覆盖）。
  withSandboxDoc(sb.fakeDoc, () => {
    sidebarBus.set({ registerTab() { return () => {} }, openTab() {} })
  })
  layoutPush = sb.headChildren.find((el) => !el._removed && el.attributes['data-dsh-mindmap'] === 'layout-push')
  assert.equal(layoutPush, undefined, 'layout-push CSS removed after BS service activates')
  // 清理
  withSandboxDoc(sb.fakeDoc, () => { sidebarBus.set(null) })
})

test('BS disappearance: layout-push CSS is restored when BS inject disposer runs (BS-only unload)', () => {
  sidebarBus.set(null)
  const svc = { registerTab() { return () => {} }, openTab() {} }
  const sb = applySandbox({ betterSidebar: svc })
  withSandboxDoc(sb.fakeDoc, () => {
    runtime.apply(sb.ctx)
    sb.effects.forEach((fn) => fn()) // layout-push effect
  })
  // sidebar 模式：layout-push CSS 不存在。
  assert.equal(sb.headChildren.find((el) => !el._removed && el.attributes['data-dsh-mindmap'] === 'layout-push'), undefined,
    'layout-push CSS absent in sidebar mode')
  // 029 模拟只卸载 BS（不卸载 dsh-mindmap）：调 injectDisposers。
  withSandboxDoc(sb.fakeDoc, () => {
    sb.injectDisposers.forEach((d) => d())
  })
  assert.equal(sidebarBus.get(), null, 'sidebarBus cleared after BS-only dispose')
  // disposer 后 standalone 恢复：layout-push effect 监听到 bus 变化，重新注入。
  const layoutPush = sb.headChildren.find((el) => !el._removed && el.attributes['data-dsh-mindmap'] === 'layout-push')
  assert.ok(layoutPush, 'layout-push CSS restored after BS service disappears')
})

test('sessionStore snapshot is cleaned up when sessionId changes', () => {
  // 028 会话切换清理：MindmapSlot 的 effect 在 sessionId 变化时删旧快照。
  // 这里直接测 sessionStore 的 delete 语义——组件层通过 effect 调它。
  const sid = 'cleanup-test-1'
  sessionStore.set(sid, { nodes: [], nodesVersion: '', inputActions: null, mindmapFace: null })
  assert.ok(sessionStore.get(sid), 'snapshot exists')
  sessionStore.delete(sid)
  assert.equal(sessionStore.get(sid), null, 'snapshot deleted')
})

test('sessionStore does not leak data across session switches', () => {
  // 模拟 MindmapSlot 的会话切换清理：写新 sessionId 前删旧 sessionId。
  const sidA = 'leak-test-a'
  const sidB = 'leak-test-b'
  sessionStore.set(sidA, { nodes: ['a'], nodesVersion: '1', inputActions: null, mindmapFace: null })
  // 切换到 B：先删 A 再写 B（与 slot.js 的 lastSessionRef effect 一致）
  sessionStore.delete(sidA)
  sessionStore.set(sidB, { nodes: ['b'], nodesVersion: '2', inputActions: null, mindmapFace: null })
  assert.equal(sessionStore.get(sidA), null, 'old session data cleaned')
  assert.ok(sessionStore.get(sidB), 'new session data present')
  assert.equal(sessionStore.get(sidB).nodes[0], 'b', 'new session has its own data')
  sessionStore.delete(sidB)
})

// —— 029 真实 ctx.inject 生命周期：BS 单独卸载（不卸载 dsh-mindmap）——

// 029 支持延迟到达的 applySandbox：服务初始不存在，后续 arrive(svc) 触发
// ctx.inject 回调执行并收集 disposer；depart() 调 disposer 模拟 BS 卸载。
function applySandboxDelayed() {
  const registered = []
  const effects = []
  const injectDisposers = []
  const headChildren = []
  const fakeDoc = {
    createElement(tag) {
      const el = { tagName: tag, _removed: false, attributes: {}, textContent: '', remove() { this._removed = true } }
      Object.defineProperty(el, 'setAttribute', { value(k, v) { this.attributes[k] = v } })
      return el
    },
    head: { appendChild(el) { headChildren.push(el) } },
    querySelectorAll(sel) { return headChildren.filter((el) => !el._removed) },
  }
  let pendingInjectCb = null
  const ctx = {
    get() { return undefined },
    effect(fn) { effects.push(fn) },
    inject(deps, callback) {
      if (deps.includes('betterSidebar')) {
        pendingInjectCb = callback // 服务到达时执行
      }
      return () => {}
    },
    slots: {
      inject(_key, factory) { factory() },
      register(opts, component) { registered.push({ key: opts.name, options: opts, component }); return () => {} },
    },
  }
  return {
    ctx, registered, effects, injectDisposers, headChildren, fakeDoc,
    // 模拟 BS 服务到达：执行 inject 回调，收集 disposer。
    arrive(svc) {
      if (pendingInjectCb) {
        const ctx2 = { ...ctx, betterSidebar: svc }
        const dispose = pendingInjectCb(ctx2)
        if (typeof dispose === 'function') injectDisposers.push(dispose)
      }
    },
    // 模拟 BS 单独卸载：调 inject disposer。
    depart() { injectDisposers.forEach((d) => d()); injectDisposers.length = 0 },
  }
}

test('029 lifecycle: BS pre-existing → register Tab → BS-only unload clears bus, disposes Tab, restores layout-push', () => {
  sidebarBus.set(null)
  let tabDisposed = false
  const svc = { registerTab() { return () => { tabDisposed = true } }, openTab() {} }
  const sb = applySandbox({ betterSidebar: svc })
  withSandboxDoc(sb.fakeDoc, () => {
    runtime.apply(sb.ctx)
    sb.effects.forEach((fn) => fn())
  })
  // sidebar 模式：Tab 已注册，bus 已设，layout-push 不存在。
  assert.equal(sidebarBus.get(), svc, 'sidebarBus set in sidebar mode')
  assert.ok(!tabDisposed, 'Tab not disposed while BS active')
  assert.equal(sb.headChildren.find((el) => !el._removed && el.attributes['data-dsh-mindmap'] === 'layout-push'), undefined,
    'layout-push CSS absent in sidebar mode')
  // 只卸载 BS（不卸载 dsh-mindmap）：调 injectDisposers。
  withSandboxDoc(sb.fakeDoc, () => { sb.injectDisposers.forEach((d) => d()) })
  assert.equal(sidebarBus.get(), null, 'sidebarBus cleared after BS-only unload')
  assert.ok(tabDisposed, 'Tab disposed via inject lifecycle')
  // layout-push 恢复。
  const layoutPush = sb.headChildren.find((el) => !el._removed && el.attributes['data-dsh-mindmap'] === 'layout-push')
  assert.ok(layoutPush, 'layout-push CSS restored after BS-only unload')
})

test('029 lifecycle: BS late arrival → register Tab → BS-only unload clears bus, disposes Tab, restores layout-push', () => {
  sidebarBus.set(null)
  let tabDisposed = false
  const svc = { registerTab() { return () => { tabDisposed = true } }, openTab() {} }
  const sb = applySandboxDelayed()
  // 初始无 BS：standalone 模式，layout-push 注入。
  withSandboxDoc(sb.fakeDoc, () => {
    runtime.apply(sb.ctx)
    sb.effects.forEach((fn) => fn())
  })
  assert.ok(sb.headChildren.find((el) => !el._removed && el.attributes['data-dsh-mindmap'] === 'layout-push'),
    'layout-push CSS present before BS arrives')
  assert.equal(sidebarBus.get(), null, 'sidebarBus null before BS arrives')
  // BS 晚到：inject 回调执行，注册 Tab，设 bus，移除 layout-push。
  withSandboxDoc(sb.fakeDoc, () => { sb.arrive(svc) })
  assert.equal(sidebarBus.get(), svc, 'sidebarBus set after BS arrives')
  assert.ok(!tabDisposed, 'Tab not disposed while BS active')
  assert.equal(sb.headChildren.find((el) => !el._removed && el.attributes['data-dsh-mindmap'] === 'layout-push'), undefined,
    'layout-push CSS removed after BS arrives')
  // 只卸载 BS。
  withSandboxDoc(sb.fakeDoc, () => { sb.depart() })
  assert.equal(sidebarBus.get(), null, 'sidebarBus cleared after BS-only unload')
  assert.ok(tabDisposed, 'Tab disposed via inject lifecycle')
  const layoutPush = sb.headChildren.find((el) => !el._removed && el.attributes['data-dsh-mindmap'] === 'layout-push')
  assert.ok(layoutPush, 'layout-push CSS restored after BS-only unload')
})

// —— 029 会话清理组件测试：渲染 MindmapSlot、切换 sessionId、验证 store 清理 ——

test('029 session cleanup: MindmapSlot renders sidebar-mode button when sidebarBus is set', () => {
  sidebarBus.set(null)
  const svc = { registerTab() { return () => {} }, openTab() {} }
  const sb = applySandbox({ betterSidebar: svc })
  withSandboxDoc(sb.fakeDoc, () => {
    runtime.apply(sb.ctx)
    sb.effects.forEach((fn) => fn())
  })
  // sidebarBus 已设 → MindmapSlot 走 sidebar 模式。
  const face = sb.registered.find((r) => r.key === 'conversation.session.header.actions').options.inject().mindmapFace
  const sid = 'slot-render-test'
  // MindmapSlot 在 sidebar 模式下只渲染一个按钮（不渲染 MindmapDetailsPanel）。
  const rendered = MindmapSlot({ useSession: null, useChat: null, sessionId: sid, inputActions: null, mindmapFace: face })
  // jsx 桩的 Fragment 返回 {}（桩定义 Fragment: {}）。
  // sidebar 模式 Fragment 只有一个 child（button），standalone 模式有两个（button + panel）。
  const children = Array.isArray(rendered.props.children) ? rendered.props.children : [rendered.props.children]
  assert.equal(children.length, 1, 'sidebar mode renders only a button (no panel)')
  const btn = children[0]
  assert.ok(btn && btn.type === 'button', 'sidebar mode renders a button')
  assert.ok(btn.props.onClick, 'button has onClick handler')
  // 点击按钮应调 openTab（验证 sidebar 模式接线）。
  // 031：seed 附惰性 url，让 BS 把它当「内容型 open」自动展开右栏面板。
  let openedTab = null
  svc.openTab = (seed, scope) => { openedTab = { seed, scope } }
  btn.props.onClick()
  assert.ok(openedTab, 'sidebar button click calls betterSidebar.openTab')
  assert.equal(openedTab.seed.type, 'dsh-mindmap:mindmap')
  assert.equal(openedTab.seed.url, 'dsh-mindmap://mindmap')
  assert.equal(openedTab.scope.sessionId, sid)
  // 清理。
  sidebarBus.set(null)
})

// 031 负向用例：openTab 抛异常时按钮 onClick 不抛（helper 吞错）。
test('031 openMindmapTab swallows openTab exceptions (sidebar button click does not throw)', () => {
  sidebarBus.set(null)
  const svc = {
    registerTab() { return () => {} },
    openTab() { throw new Error('BS gone') },
  }
  const sb = applySandbox({ betterSidebar: svc })
  withSandboxDoc(sb.fakeDoc, () => {
    runtime.apply(sb.ctx)
    sb.effects.forEach((fn) => fn())
  })
  const face = sb.registered.find((r) => r.key === 'conversation.session.header.actions').options.inject().mindmapFace
  const rendered = MindmapSlot({ useSession: null, useChat: null, sessionId: 'throw-test', inputActions: null, mindmapFace: face })
  const children = Array.isArray(rendered.props.children) ? rendered.props.children : [rendered.props.children]
  const btn = children[0]
  // 不抛即通过。
  assert.doesNotThrow(() => btn.props.onClick(), 'sidebar button click does not throw when openTab fails')
  sidebarBus.set(null)
})

test('029 session cleanup: MindmapSlot renders standalone-mode button + panel when sidebarBus is null', () => {
  sidebarBus.set(null)
  const sb = applySandbox({ betterSidebar: undefined })
  withSandboxDoc(sb.fakeDoc, () => {
    runtime.apply(sb.ctx)
    sb.effects.forEach((fn) => fn())
  })
  const face = sb.registered.find((r) => r.key === 'conversation.session.header.actions').options.inject().mindmapFace
  const sid = 'slot-standalone-test'
  // standalone 模式：Fragment 包含 button + MindmapDetailsPanel。
  const rendered = MindmapSlot({ useSession: null, useChat: null, sessionId: sid, inputActions: null, mindmapFace: face })
  const children = Array.isArray(rendered.props.children) ? rendered.props.children : [rendered.props.children]
  // 第一个是 button，第二个是 MindmapDetailsPanel（jsx 桩返回 { type: Function, ... }）。
  assert.ok(children.length >= 2, 'standalone mode renders button + panel')
  assert.equal(children[0].type, 'button', 'standalone mode has button')
  assert.equal(typeof children[1].type, 'function', 'standalone mode has MindmapDetailsPanel')
  assert.equal(children[1].type.name, 'MindmapDetailsPanel', 'panel component is MindmapDetailsPanel')
})

// —— 030 真实 Cordis Context/provider/fiber 集成测试 ——
// 用真实 @deepseek-ai/cordis 的 Context、ctx.provide、ctx.inject、ctx.effect，
// 不用手写桩。证明 BS provider 到达/单独卸载时 inject disposer 和 layout-push
// effect 的真实行为。

// 创建真实 Cordis Context + 手动 slots（Cordis 没有 slots 服务）。
function createCordisCtx() {
  const ctx = new CordisContext()
  const registered = []
  // slots 是 dsh 客户端运行时提供的服务，Cordis 本身没有——手动挂。
  ctx.slots = {
    inject(_key, factory) { factory() },
    register(opts, component) { registered.push({ key: opts.name, options: opts, component }); return () => {} },
  }
  return { ctx, registered }
}

// 等待 Cordis fiber 调度稳定（effect/inject 回调是微任务 + 宏任务调度）。
function tick(ms = 20) { return new Promise((r) => setTimeout(r, ms)) }

test('030 cordis integration: BS absent → standalone; provide BS → Tab registered + bus set + layout-push removed; dispose BS → restored', async () => {
  sidebarBus.set(null)
  const headChildren = []
  const fakeDoc = {
    createElement(tag) {
      const el = { tagName: tag, _removed: false, attributes: {}, textContent: '', remove() { this._removed = true } }
      Object.defineProperty(el, 'setAttribute', { value(k, v) { this.attributes[k] = v } })
      return el
    },
    head: { appendChild(el) { headChildren.push(el) } },
    querySelectorAll() { return headChildren.filter((el) => !el._removed) },
  }

  const prev = sandboxContext.document
  sandboxContext.document = fakeDoc
  try {
    const { ctx } = createCordisCtx()
    runtime.apply(ctx)
    // Cordis ctx.effect 是同步执行的。

    // BS 不存在 → standalone：layout-push CSS 注入，bus 为 null。
    assert.equal(sidebarBus.get(), null, 'standalone: sidebarBus null')
    let layoutPush = headChildren.find((el) => !el._removed && el.attributes['data-dsh-mindmap'] === 'layout-push')
    assert.ok(layoutPush, 'standalone: layout-push CSS present')

    // provide BS → inject 回调执行：Tab 注册 + bus 设值 + layout-push 移除。
    let tabRegistered = false
    const svc = {
      registerTab() { tabRegistered = true; return () => { tabRegistered = false } },
      openTab() {},
    }
    const provideDispose = ctx.provide('betterSidebar', svc)
    await tick() // 等 inject fiber 执行

    assert.ok(tabRegistered, 'after provide: Tab registered')
    assert.equal(sidebarBus.get(), svc, 'after provide: sidebarBus set')
    layoutPush = headChildren.find((el) => !el._removed && el.attributes['data-dsh-mindmap'] === 'layout-push')
    assert.equal(layoutPush, undefined, 'after provide: layout-push CSS removed')

    // 只销毁 BS provider（不销毁 dsh-mindmap）。
    provideDispose()
    await tick() // 等 inject disposer + effect 恢复

    assert.equal(tabRegistered, false, 'after BS dispose: Tab disposed')
    assert.equal(sidebarBus.get(), null, 'after BS dispose: sidebarBus null')
    layoutPush = headChildren.find((el) => !el._removed && el.attributes['data-dsh-mindmap'] === 'layout-push')
    assert.ok(layoutPush, 'after BS dispose: layout-push CSS restored')
  } finally {
    sandboxContext.document = prev
  }
})

// —— 030 能执行 effect/cleanup 的 MindmapSlot 组件测试 ——
// 用一个能保持 hook 状态、记录 effect 回调、支持重渲染与卸载 cleanup 的
// react 桩，实际驱动 slot.js 里的 sessionStore 写入/清理逻辑。

// 030 组件 effect 驱动桩：能保持 hook 状态、按 deps 比较决定 effect 重跑、
// 支持 mount/update/unmount 生命周期。每次渲染收集新 effect 条目，渲染后
// 与上一轮的条目按调用顺序索引匹配——deps 变化时先 cleanup 再跑新 callback。
function createEffectDriver() {
  const stateValues = []
  let stateIdx = 0
  const refValues = []
  let refIdx = 0
  let prevSlots = [] // 上一轮的 effect 条目（含 cleanup + deps）
  let currSlots = [] // 本轮新收集的 effect 条目
  const hooks = {
    useState(initial) {
      const idx = stateIdx++
      if (stateValues[idx] === undefined) stateValues[idx] = typeof initial === 'function' ? initial() : initial
      return [stateValues[idx], (v) => { stateValues[idx] = typeof v === 'function' ? v(stateValues[idx]) : v }]
    },
    useEffect(callback, deps) { currSlots.push({ callback, deps, cleanup: null }) },
    useLayoutEffect(callback, deps) { currSlots.push({ callback, deps, cleanup: null }) },
    useMemo(factory) { return factory() },
    useRef(v) {
      const idx = refIdx++
      if (refValues[idx] === undefined) refValues[idx] = { current: v }
      return refValues[idx]
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      if (typeof subscribe === 'function') subscribe(() => {})
      return typeof getSnapshot === 'function' ? getSnapshot() : undefined
    },
    useCallback(fn) { return fn },
  }
  // 渲染前重置 hook 索引（不清 state/refs——它们跨渲染保持）。
  function beginRender() { stateIdx = 0; refIdx = 0; currSlots = [] }
  // mount：执行所有 effect，保存为本轮的 prev。
  function flushMount() {
    for (const s of currSlots) {
      const result = s.callback()
      s.cleanup = typeof result === 'function' ? result : null
    }
    prevSlots = currSlots
  }
  // update：按索引匹配 prev/curr，deps 变化时执行新 callback。
  function flushUpdate() {
    const next = []
    for (let i = 0; i < currSlots.length; i++) {
      const curr = currSlots[i]
      const prev = prevSlots[i]
      // 上一轮的 deps（用于比较）。
      const prevDeps = prev ? prev.deps : null
      const changed = !prev || !prevDeps || !curr.deps ||
        curr.deps.length !== prevDeps.length ||
        curr.deps.some((d, j) => !Object.is(d, prevDeps[j]))
      if (changed) {
        if (prev && prev.cleanup) prev.cleanup()
        const result = curr.callback()
        curr.cleanup = typeof result === 'function' ? result : null
      } else {
        // deps 不变：继承上一轮的 cleanup，不重跑 callback。
        curr.cleanup = prev ? prev.cleanup : null
      }
      next.push(curr)
    }
    prevSlots = next
  }
  // 卸载：执行所有 effect 的 cleanup。
  function unmount() {
    for (const s of prevSlots) {
      if (s.cleanup) { s.cleanup(); s.cleanup = null }
    }
  }
  return { hooks, beginRender, flushMount, flushUpdate, unmount }
}

// 030 组件 effect 测试公共设施：重新加载 client.js 到独立 vm 沙箱，
// 注入能保持 hook 状态、执行 effect/cleanup 的 driver，返回沙箱内的组件和 store。
function loadClientWithEffectDriver() {
  const driver = createEffectDriver()
  let def
  const win = { __ModuleLoader__: { load(v) { def = v } } }
  const ctx = vm.createContext({ URL, window: win })
  vm.runInContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), ctx)
  const rt = def.factory((id) => {
    if (id === 'react/jsx-runtime') return { jsx(t,p,k){return{type:t,props:p||{},key:k}}, jsxs(t,p,k){return{type:t,props:p||{},key:k}}, Fragment:{} }
    if (id === 'react') return driver.hooks
    throw new Error('unexpected:'+id)
  })
  return { driver, MindmapSlot: rt.internals.MindmapSlot, sessionStore: rt.internals.sessionStore, sidebarBus: rt.internals.sidebarBus }
}

// 用 applySandbox 拿到 mindmapFace（header 槽位的 inject 返回值）。
// 用完后清理原沙箱的 sidebarBus。
function getMindmapFace() {
  sidebarBus.set(null)
  const sb = applySandbox({ betterSidebar: { registerTab() { return () => {} }, openTab() {} } })
  withSandboxDoc(sb.fakeDoc, () => {
    runtime.apply(sb.ctx)
    sb.effects.forEach((fn) => fn())
  })
  const face = sb.registered.find((r) => r.key === 'conversation.session.header.actions').options.inject().mindmapFace
  sidebarBus.set(null) // 清理原沙箱 bus
  return face
}

test('030 component effects: A→B session switch deletes A, keeps B', () => {
  const face = getMindmapFace()
  const { driver, MindmapSlot, sessionStore, sidebarBus } = loadClientWithEffectDriver()
  const svc = { registerTab() { return () => {} }, openTab() {} }
  sidebarBus.set(svc)

  // 会话 A（mount）。
  driver.beginRender()
  MindmapSlot({ sessionId: 'sw-a', inputActions: { setDraft() {}, submit() {} }, mindmapFace: face })
  driver.flushMount()
  assert.ok(sessionStore.get('sw-a'), 'A in store after mount')

  // A→B（update）。
  driver.beginRender()
  MindmapSlot({ sessionId: 'sw-b', inputActions: { setDraft() {}, submit() {} }, mindmapFace: face })
  driver.flushUpdate()
  assert.equal(sessionStore.get('sw-a'), null, 'A deleted after switch to B')
  assert.ok(sessionStore.get('sw-b'), 'B in store after switch')
})

test('030 component effects: sidebar→standalone deletes current session snapshot', () => {
  const face = getMindmapFace()
  const { driver, MindmapSlot, sessionStore, sidebarBus } = loadClientWithEffectDriver()
  const svc = { registerTab() { return () => {} }, openTab() {} }
  sidebarBus.set(svc)

  // 会话 C（mount）。
  driver.beginRender()
  MindmapSlot({ sessionId: 'exit-c', inputActions: { setDraft() {}, submit() {} }, mindmapFace: face })
  driver.flushMount()
  assert.ok(sessionStore.get('exit-c'), 'C in store after mount')

  // sidebar→standalone：sidebarBus 设 null，同一组件实例重渲染。
  sidebarBus.set(null)
  driver.beginRender()
  MindmapSlot({ sessionId: 'exit-c', inputActions: { setDraft() {}, submit() {} }, mindmapFace: face })
  driver.flushUpdate()
  assert.equal(sessionStore.get('exit-c'), null, 'C deleted after sidebar→standalone')
})

test('030 component effects: unmount deletes current session snapshot (snapshot exists before unmount)', () => {
  const face = getMindmapFace()
  const { driver, MindmapSlot, sessionStore, sidebarBus } = loadClientWithEffectDriver()
  const svc = { registerTab() { return () => {} }, openTab() {} }
  sidebarBus.set(svc)

  // 会话 D（mount）——卸载前快照必须存在。
  driver.beginRender()
  MindmapSlot({ sessionId: 'unmount-d', inputActions: { setDraft() {}, submit() {} }, mindmapFace: face })
  driver.flushMount()
  assert.ok(sessionStore.get('unmount-d'), 'D in store before unmount')

  // 卸载：执行 cleanup。
  driver.unmount()
  assert.equal(sessionStore.get('unmount-d'), null, 'D deleted after unmount')
})
