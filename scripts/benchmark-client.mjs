import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import vm from 'node:vm'

// 纯计算：重放虚构的长会话，不启动浏览器、服务或模型，也不写文件。
let definition
vm.runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load(value) { definition = value } } },
  URL,
})
const { internals } = definition.factory(() => ({}))
const content = '# Benchmark\n' + '- Example content for a large document.\n'.repeat(850)
const nodes = Array.from({ length: 3000 }, (_, i) => i % 15 === 0 ? {
  kind: 'tool-result', callId: `result-${i}`, call: { name: 'mindmap_update' },
  content: [{ type: 'text', text: JSON.stringify({ ok: true, op: 'update', path: '/workspace/benchmark.md', content, revision: `revision-${i}` }) }],
} : { kind: 'assistant-message', callId: `message-${i}` })
const cached = internals.createDocumentReducer()
assert.equal(JSON.stringify(cached(nodes)), JSON.stringify(internals.reduceDocuments(nodes)))

function medianTime(replay) {
  const samples = []
  for (let i = 0; i < 9; i++) {
    const start = performance.now()
    for (let j = 0; j < 5; j++) replay(nodes)
    samples.push((performance.now() - start) / 5)
  }
  return samples.sort((a, b) => a - b)[4]
}

const fullReplay = medianTime(internals.reduceDocuments)
const cachedReplay = medianTime(cached)
console.log(JSON.stringify({
  conversationNodes: nodes.length,
  mindmapResults: nodes.filter(node => node.kind === 'tool-result').length,
  documentBytes: Buffer.byteLength(content),
  fullReplayMedianMs: Number(fullReplay.toFixed(3)),
  cachedReplayMedianMs: Number(cachedReplay.toFixed(3)),
  speedup: Number((fullReplay / cachedReplay).toFixed(2)),
}, null, 2))
