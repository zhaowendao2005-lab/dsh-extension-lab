#!/usr/bin/env node
// Planning only: never imports the driver or spawns a child.
import { readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
function option(name) { const index = process.argv.indexOf(`--${name}`); return index === -1 ? null : process.argv[index + 1] }
async function main() {
  const input = option('input'); const output = option('out'); const seed = option('seed')
  if (!input || !output || seed === null) throw new Error('required: --input matrix.json --out new-plan.json --seed explicit-seed')
  if ((await stat(input)).size > 1024 * 1024) throw new Error('matrix input exceeds 1 MiB')
  const matrix = JSON.parse(await readFile(input, 'utf8'))
  if (!Array.isArray(matrix.cases) || !matrix.cases.length || matrix.cases.length > 100 || !Array.isArray(matrix.conditions) || !matrix.conditions.length || matrix.conditions.length > 20) throw new Error('matrix requires 1..100 cases and 1..20 conditions')
  const repeats = matrix.repeats ?? 1
  if (!Number.isSafeInteger(repeats) || repeats < 1 || repeats > 20) throw new Error('repeats must be 1..20')
  const ids = new Set()
  for (const item of matrix.cases) {
    if (typeof item.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(item.id) || ids.has(item.id) || typeof item.taskFile !== 'string' || !isAbsolute(item.taskFile)) throw new Error('cases require unique safe id and absolute taskFile')
    ids.add(item.id)
  }
  if (new Set(matrix.conditions).size !== matrix.conditions.length || matrix.conditions.some(condition => typeof condition !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(condition))) throw new Error('conditions must be unique safe strings; no commands are accepted')
  let state = createHash('sha256').update(seed).digest().readUInt32LE(0)
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000 }
  const rows = []
  for (const item of matrix.cases) {
    const taskFile = await realpath(item.taskFile)
    if ((await stat(taskFile)).size > 1024 * 1024) throw new Error('task exceeds 1 MiB')
    const taskSha256 = createHash('sha256').update(await readFile(taskFile)).digest('hex')
    for (let repeat = 0; repeat < repeats; repeat++) {
      // Randomized complete blocks: all conditions of one case/repeat stay together.
      const conditions = [...matrix.conditions]
      for (let i = conditions.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [conditions[i], conditions[j]] = [conditions[j], conditions[i]] }
      rows.push(conditions.map(condition => ({ id: `${item.id}-${repeat + 1}-${condition}`, caseId: item.id, condition, repeat: repeat + 1, taskFile, taskSha256 })))
    }
  }
  for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]] }
  const order = rows.flat().map((row, index) => ({ order: index + 1, ...row }))
  const plan = { schemaVersion: 'dsh-delivery-matrix.v1', seed, algorithm: 'sha256-u32le/lcg32/fisher-yates-complete-blocks-v1', executed: false, repeats, order, limitations: ['Plan only; each run needs separate approval and fresh isolated paths.', 'Randomized order is reproducible; model output, provider/cache state and time are not.', 'Conditions label external deployment configuration and never enter the production plugin API.'] }
  await writeFile(output, `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ out: output, plannedRuns: order.length, executed: false }))
}
main().catch(error => { console.error(`matrix: ${error.message}`); process.exitCode = 2 })
