import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

// 注入一棵已加载的虚构目录，直接检查实际工作区渲染出的文件行及事件。
function renderList(variant) {
  const entries = ['map.md', 'UPPER.MD', 'notes.txt', 'image.png', 'data.json'].map(name => ({ name, path: `/w/${name}`, isDir: false }))
  entries.push({ name: 'folder', path: '/w/folder', isDir: true })
  const fsTree = { cwd: '/w', nodes: { '/w': { path: '/w', name: 'workspace', parentPath: null, entries } }, expanded: { '/w': true }, loading: {}, error: null }
  const calls = []
  let definition
  const context = vm.createContext({ URL, window: { __ModuleLoader__: { load(value) { definition = value } } } })
  vm.runInContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), context)
  const jsx = (type, props, key) => ({ type, props: props || {}, key })
  const runtime = definition.factory(id => {
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: {} }
    if (id === 'react') return {
      useState(initial) {
        const value = typeof initial === 'function' ? initial() : initial
        return [value && 'expanded' in Object(value) && 'cwd' in Object(value) ? fsTree : value, () => {}]
      },
      useEffect() {}, useLayoutEffect() {}, useMemo: fn => fn(), useCallback: fn => fn,
      useRef: value => ({ current: value }), useSyncExternalStore: (_, read) => read(),
    }
    throw new Error(`Unexpected dependency: ${id}`)
  })
  const tree = runtime.internals.MindmapWorkspace({ variant, visible: true, sessionId: 'files', nodes: [], onAutoOpen() {}, inputActions: { getDraft: () => '', setDraft: text => calls.push(text), submit: () => calls.push('submit') } })
  function find(element, predicate) {
    if (!element || typeof element !== 'object') return null
    if (predicate(element)) return element
    for (const child of [element.props?.children].flat()) {
      const found = find(child, predicate)
      if (found) return found
    }
    return null
  }
  return { row: name => find(tree, el => (el.key ?? el.props.key) === `/w/${name}`), find, calls }
}

test('embedded list: Markdown has M badges; other files block interaction; folders stay expandable', () => {
  const { row, find, calls } = renderList('sidebar')
  for (const name of ['map.md', 'UPPER.MD']) {
    const file = row(name)
    assert.ok(find(file, el => el.props.children === 'M'))
    assert.equal(file.props['aria-disabled'], undefined)
    file.props.onClick()
  }
  assert.equal(calls.filter(value => value === 'submit').length, 2)
  for (const name of ['notes.txt', 'image.png', 'data.json']) {
    const file = row(name)
    assert.equal(file.props['aria-disabled'], true)
    assert.equal(file.props.title, undefined)
    assert.equal(file.props.onMouseEnter, undefined)
    assert.equal(file.props.onMouseLeave, undefined)
    assert.equal(file.props.draggable, false)
    assert.equal(file.props.style.userSelect, 'none')
    assert.equal(file.props.style.cursor, 'default')
    for (const event of ['onClick', 'onDoubleClick', 'onMouseDown', 'onDragStart', 'onContextMenu']) {
      let prevented = false, stopped = false
      file.props[event]({ preventDefault() { prevented = true }, stopPropagation() { stopped = true } })
      assert.ok(prevented && stopped, `${name}: ${event} must not reach host handlers`)
    }
  }
  assert.equal(calls.filter(value => value === 'submit').length, 2, 'inactive files send no commands')
  assert.equal(typeof row('folder').props.onClick, 'function')
})

test('standalone list retains its M badge and existing hover behavior', () => {
  const { row, find } = renderList('standalone')
  assert.ok(find(row('map.md'), el => el.props.children === 'M'))
  assert.equal(row('notes.txt').props['aria-disabled'], undefined)
  assert.equal(typeof row('notes.txt').props.onMouseEnter, 'function')
})
