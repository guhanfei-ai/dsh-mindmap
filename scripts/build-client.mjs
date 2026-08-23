import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_FILES = [
  'src/client/runtime/open.js',
  'src/client/core/theme.js',
  'src/client/core/markdown.js',
  'src/client/core/documents.js',
  'src/client/core/tree.js',
  'src/client/core/export.js',
  'src/client/ui/styles.js',
  'src/client/ui/settings.js',
  'src/client/ui/render.js',
  'src/client/ui/panel.js',
  'src/client/runtime/apply.js',
  'src/client/runtime/close.js',
]

const fragments = []
for (const relative of SOURCE_FILES) {
  const source = await readFile(resolve(ROOT, relative), 'utf8')
  fragments.push(source.replace(/^\/\/ Generated source fragment\.[^\n]*\n/, '').replace(/[\t ]*\n+$/, ''))
}

const output = `${fragments.map((fragment, index) => {
  if (index === 0) return fragment
  // 07→08 与 10→11 是同一逻辑块的物理拆分，不额外插入空行；其余
  // 片段按职责边界保留可读的空行。
  const separator = index === 8 || index === 11 ? '\n' : '\n\n'
  return `${separator}${fragment}`
}).join('').replace(/\s+$/, '')}\n`
if (!output.includes('window.__ModuleLoader__.load({')) {
  throw new Error('client bundle is missing the ModuleLoader entry.')
}
if (!output.includes('exports.apply = apply')) {
  throw new Error('client bundle is missing the plugin apply export.')
}

await writeFile(resolve(ROOT, 'client.js'), output, 'utf8')
console.log(`built client.js from ${SOURCE_FILES.length} source fragments`)
