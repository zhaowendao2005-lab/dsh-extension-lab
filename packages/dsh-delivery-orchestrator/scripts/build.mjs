#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const src = join(root, 'src')
const out = join(root, 'lib')
const modules = ['index.js', 'service.js', 'contract.js', 'client.js', 'core.js', 'persistence.js', 'protocol.js', 'artifacts.js']
await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })
for (const module of modules) {
  const input = join(src, module)
  const content = await readFile(input, 'utf8')
  if (!content.trim()) throw new Error(`${module} is empty`)
  await writeFile(join(out, basename(module)), content.endsWith('\n') ? content : `${content}\n`)
}
console.log(`built ${modules.length} JavaScript modules into ${out}`)
