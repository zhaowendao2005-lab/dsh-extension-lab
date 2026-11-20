#!/usr/bin/env node
// External supervision only. This module is never imported by the production plugin.
import { access, lstat, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { closeSync, constants, openSync, writeSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { buildReport, renderReport, StrictStream } from './report.mjs'

const VALUE_OPTIONS = new Set(['dsh-home', 'cwd', 'out', 'task', 'task-file', 'command', 'timeout-ms', 'grace-ms', 'max-log-bytes', 'max-line-bytes', 'credentials-file', 'permission-mode', 'delivery-file'])
const CREDENTIAL_KEYS = new Set(['DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'])
function options(argv) {
  const result = {}
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].replace(/^--/, '')
    if (!argv[i].startsWith('--') || Object.hasOwn(result, name)) throw new Error(`invalid or duplicate option: ${argv[i]}`)
    if (name === 'execute') { result[name] = true; continue }
    if (!VALUE_OPTIONS.has(name) || argv[i + 1] == null || argv[i + 1].startsWith('--')) throw new Error(`unknown or missing option: ${argv[i]}`)
    result[name] = argv[++i]
  }
  return result
}
function integer(value, fallback, max, name) {
  const n = value === undefined ? fallback : Number(value)
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new Error(`${name} must be 1..${max}`)
  return n
}
function within(parent, child) {
  const rel = relative(parent, child)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}
function overlap(a, b) { return within(a, b) || within(b, a) }
async function canonical(path, { missing = false } = {}) {
  if (!path || !isAbsolute(path)) throw new Error('all execution paths must be explicit absolute paths')
  try { return await realpath(path) } catch (error) {
    if (error.code !== 'ENOENT' || !missing) throw error
    return join(await canonical(dirname(path), { missing: true }), basename(path))
  }
}
async function directory(path) {
  const value = await canonical(path)
  if (!(await stat(value)).isDirectory()) throw new Error(`not a directory: ${path}`)
  return value
}
async function absent(path) {
  try { await lstat(path) } catch (error) { if (error.code === 'ENOENT') return; throw error }
  throw new Error(`path must not already exist: ${path}`)
}
async function boundedRead(path, max = 1024 * 1024) {
  const info = await stat(path)
  if (!info.isFile() || info.size > max) throw new Error('input is not a regular file or exceeds its byte limit')
  const data = await readFile(path)
  if (data.length > max) throw new Error('input grew beyond byte limit')
  return data.toString('utf8')
}
async function credentials(path) {
  if (!path) return {}
  const resolved = await canonical(path)
  const info = await stat(resolved)
  if ((info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) throw new Error('credentials file must be owner-only (0600) and owned by this user')
  let parsed
  try { parsed = JSON.parse(await boundedRead(resolved, 32 * 1024)) } catch { throw new Error('credentials file must contain bounded JSON; values were not logged') }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('credentials file must be a JSON object')
  for (const [key, value] of Object.entries(parsed)) {
    if (!CREDENTIAL_KEYS.has(key) || typeof value !== 'string' || !value || value.length > 8192 || value.includes('\0')) throw new Error('unsupported credential name or value; values were not logged')
  }
  return parsed
}
async function preflight(o) {
  if (!o.execute) throw new Error('execution disabled: explicitly approved runs require --execute')
  if (process.platform === 'win32') throw new Error('Windows process-tree cleanup is not implemented; execution refused')
  for (const key of ['dsh-home', 'cwd', 'out', 'command']) if (!o[key]) throw new Error(`--${key} is required`)
  const home = await directory(o['dsh-home'])
  const cwd = await directory(o.cwd)
  const out = await canonical(o.out, { missing: true })
  await directory(dirname(out))
  await absent(out)
  const invocationCwd = await directory(process.cwd())
  const protectedPaths = [invocationCwd, await canonical(join(homedir(), '.dsh'), { missing: true })]
  for (const key of ['DSH_HOME', 'DSH_PROFILE_DIR']) if (process.env[key]) protectedPaths.push(await canonical(resolve(process.env[key]), { missing: true }))
  for (const target of [home, cwd, out]) for (const protectedPath of protectedPaths) {
    if (overlap(target, protectedPath)) throw new Error(`isolation path overlaps invocation/production state: ${target}`)
  }
  if (overlap(home, cwd) || overlap(home, out) || overlap(cwd, out)) throw new Error('DSH_HOME, cwd and output must be pairwise disjoint')
  // The headless fallback reads both of these files; never silently use them.
  for (const root of [home, cwd]) await absent(join(root, '.env'))
  const command = await canonical(o.command)
  if (!(await stat(command)).isFile()) throw new Error('command must be a regular executable')
  await access(command, constants.X_OK)
  if ((o.task === undefined) === (o['task-file'] === undefined)) throw new Error('supply exactly one of --task or --task-file')
  const task = o.task ?? await boundedRead(await canonical(o['task-file']))
  if (!task.trim() || Buffer.byteLength(task) > 1024 * 1024) throw new Error('task must be nonempty and at most 1 MiB')
  const permission = o['permission-mode'] ?? 'read-only'
  if (!['read-only', 'workspace-write'].includes(permission)) throw new Error('permission-mode must be read-only or workspace-write')
  let deliveryFile = null
  if (o['delivery-file']) {
    deliveryFile = await canonical(o['delivery-file'], { missing: true })
    if (!within(cwd, deliveryFile)) throw new Error('delivery-file must be inside the dedicated workspace')
    await absent(deliveryFile)
  }
  return { home, cwd, out, command, task, permission, invocationCwd, protectedPaths, deliveryFile, secrets: await credentials(o['credentials-file']), timeoutMs: integer(o['timeout-ms'], 1_800_000, 86_400_000, 'timeout-ms'), graceMs: integer(o['grace-ms'], 5000, 60_000, 'grace-ms'), maxLogBytes: integer(o['max-log-bytes'], 8 * 1024 * 1024, 64 * 1024 * 1024, 'max-log-bytes'), maxLineBytes: integer(o['max-line-bytes'], 1024 * 1024, 8 * 1024 * 1024, 'max-line-bytes') }
}
class BoundedLog {
  constructor(path, limit) { this.fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); this.limit = limit; this.bytes = 0; this.droppedBytes = 0 }
  push(buffer) {
    const kept = buffer.subarray(0, Math.max(0, this.limit - this.bytes))
    let offset = 0
    while (offset < kept.length) offset += writeSync(this.fd, kept, offset, kept.length - offset)
    this.bytes += kept.length
    this.droppedBytes += buffer.length - kept.length
    return kept
  }
  close() { if (this.fd !== null) { closeSync(this.fd); this.fd = null } }
}
async function supervise(config, env, parser, stdout, stderr) {
  const argv = ['--profile', 'headless', '--json', '--permission-mode', config.permission, '--approval-policy', 'never', '-']
  const child = spawn(config.command, argv, { cwd: config.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true, shell: false })
  const outcome = { exitCode: null, signal: null, spawnError: null, stopReason: null, cleanup: 'pending', cleanupErrors: [], closed: false }
  let graceTimer; let hardTimer; let deadlineTimer; let settled = false
  let finish
  const done = new Promise(resolveDone => { finish = resolveDone })
  function groupAlive() {
    if (!child.pid) return false
    try { process.kill(-child.pid, 0); return true } catch (error) { if (error.code === 'ESRCH') return false; outcome.cleanupErrors.push(error.code ?? 'group_probe_error'); return true }
  }
  function signalGroup(signal) {
    if (!child.pid) return
    try { process.kill(-child.pid, signal) } catch (error) { if (error.code !== 'ESRCH') outcome.cleanupErrors.push(error.code ?? 'signal_error') }
  }
  function settle() {
    if (settled) return
    settled = true
    clearTimeout(graceTimer); clearTimeout(hardTimer); clearTimeout(deadlineTimer)
    outcome.cleanup = !groupAlive() && outcome.closed && !outcome.cleanupErrors.length ? 'settled' : 'pending'
    child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy()
    finish(outcome)
  }
  function cleanup(reason) {
    if (reason && !outcome.stopReason) outcome.stopReason = reason
    if (graceTimer || settled) return
    signalGroup('SIGTERM')
    graceTimer = setTimeout(() => {
      signalGroup('SIGKILL')
      // Always escalate by process group, even when the direct child already exited.
      hardTimer = setTimeout(settle, 1000)
      if (outcome.closed && !groupAlive()) settle()
    }, config.graceMs)
    if (outcome.closed && !groupAlive()) settle()
  }
  function receive(sink, buffer, parse) {
    if (settled) return
    try {
      const kept = sink.push(buffer)
      if (parse) parser.push(kept)
      if (sink.droppedBytes) cleanup('log_limit')
      if (parser.errors.length) cleanup('protocol_error')
    } catch { cleanup('log_write_error') }
  }
  const onInt = () => cleanup('SIGINT')
  const onTerm = () => cleanup('SIGTERM')
  process.on('SIGINT', onInt); process.on('SIGTERM', onTerm)
  child.stdout.on('data', chunk => receive(stdout, chunk, true))
  child.stderr.on('data', chunk => receive(stderr, chunk, false))
  child.stdout.on('error', () => cleanup('stdout_error'))
  child.stderr.on('error', () => cleanup('stderr_error'))
  child.stdin.on('error', error => { if (error.code !== 'EPIPE') cleanup('stdin_error') })
  child.on('error', error => { outcome.spawnError = error.code ?? 'spawn_error'; cleanup('spawn_error') })
  child.on('exit', (code, signal) => { outcome.exitCode = code; outcome.signal = signal; cleanup(null) })
  child.on('close', (code, signal) => {
    outcome.closed = true; outcome.exitCode = code; outcome.signal = signal
    if (!groupAlive()) settle(); else cleanup(null)
  })
  deadlineTimer = setTimeout(() => cleanup('timeout'), config.timeoutMs)
  child.stdin.end(config.task)
  try { return await done } finally { process.off('SIGINT', onInt); process.off('SIGTERM', onTerm) }
}
async function main() {
  const config = await preflight(options(process.argv.slice(2)))
  // All writes happen after isolation and explicit execution authorization checks.
  await mkdir(config.out, { mode: 0o700 })
  const runtimeHome = join(config.out, 'runtime-home')
  const tmp = join(config.out, 'tmp')
  for (const path of [runtimeHome, tmp, join(runtimeHome, 'config'), join(runtimeHome, 'cache'), join(runtimeHome, 'data')]) await mkdir(path, { mode: 0o700 })
  const env = { PATH: [...new Set([dirname(config.command), dirname(process.execPath), '/usr/bin', '/bin'])].join(':'), LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC', CI: '1', NO_COLOR: '1', HOME: runtimeHome, USERPROFILE: runtimeHome, XDG_CONFIG_HOME: join(runtimeHome, 'config'), XDG_CACHE_HOME: join(runtimeHome, 'cache'), XDG_DATA_HOME: join(runtimeHome, 'data'), TMPDIR: tmp, TMP: tmp, TEMP: tmp, DSH_HOME: config.home, DSH_TELEMETRY_MODE: 'DISABLED', AWS_EC2_METADATA_DISABLED: 'true', ...config.secrets }
  const parser = new StrictStream(config.maxLineBytes)
  const stdout = new BoundedLog(join(config.out, 'stdout.ndjson'), config.maxLogBytes)
  const stderr = new BoundedLog(join(config.out, 'stderr.log'), config.maxLogBytes)
  const startedAt = Date.now()
  let outcome
  try { outcome = await supervise(config, env, parser, stdout, stderr) } finally { stdout.close(); stderr.close() }
  parser.end()
  let delivery = null; let deliveryError = null
  if (config.deliveryFile) {
    try {
      const actual = await canonical(config.deliveryFile)
      if (!within(config.cwd, actual)) throw new Error('delivery_file_escaped_workspace')
      delivery = JSON.parse(await boundedRead(actual, 8 * 1024 * 1024))
    } catch { deliveryError = 'delivery_file_missing_invalid_or_outside_workspace' }
  }
  const report = buildReport({ events: parser.events, protocolErrors: parser.errors, outcome, startedAt, endedAt: Date.now(), delivery })
  report.execution = { command: config.command, profile: 'headless', permissionMode: config.permission, home: config.home, cwd: config.cwd, taskSha256: createHash('sha256').update(config.task).digest('hex'), environmentKeys: Object.keys(env).sort(), inheritedEnvironment: false, credentialKeys: Object.keys(config.secrets), timeoutMs: config.timeoutMs, graceMs: config.graceMs, maxLogBytes: config.maxLogBytes, maxLineBytes: config.maxLineBytes }
  report.logs = { stdoutBytes: stdout.bytes, stderrBytes: stderr.bytes, stdoutDroppedBytes: stdout.droppedBytes, stderrDroppedBytes: stderr.droppedBytes }
  report.deliveryImportError = deliveryError
  for (const [name, value] of Object.entries({ 'result.json': report, 'events.json': parser.events, 'timeline.json': report.timeline, 'dag.json': report.dag, 'metrics.json': report.metrics, 'delivery.json': delivery })) await writeFile(join(config.out, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  await writeFile(join(config.out, 'report.html'), renderReport(report), { mode: 0o600, flag: 'wx' })
  console.log(JSON.stringify({ out: config.out, processCompleted: report.processCompleted, business: report.business, cleanup: outcome.cleanup }))
  // 0 means only the process contract completed. It never means delivery acceptance.
  process.exitCode = report.processCompleted ? 0 : 1
}
main().catch(error => { console.error(`driver: ${error.message}`); process.exitCode = 2 })
