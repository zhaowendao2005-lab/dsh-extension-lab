#!/usr/bin/env node
// Trusted external wrapper. It never runs model-provided argv directly on the host.
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, realpath, stat, writeFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'

const MAX_REQUEST_BYTES = 2 * 1024 * 1024
const MAX_CONFIG_BYTES = 256 * 1024
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024
const CHECK_KINDS = new Set(['compile', 'cli', 'journey'])
const CARD_KINDS = new Set(['compile', 'cli', 'journey', 'json', 'text', 'source', 'semantic', 'manual'])
const ACTIONS = new Set(['goto', 'fill', 'click', 'wait', 'assertText', 'assertVisible', 'assertValue', 'download', 'checkpoint'])
const forbiddenArg = /[\0\r\n]/
const arg = name => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? null : process.argv[i + 1] }
const within = (parent, child) => { const rel = relative(parent, child); return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) }
const safeString = (value, name, max = 16 * 1024) => { if (typeof value !== 'string' || !value || value.length > max || forbiddenArg.test(value)) throw new Error(`${name} must be a bounded nonempty string`); return value }
const safeArray = (value, name, max = 128) => { if (!Array.isArray(value) || value.length < 1 || value.length > max || value.some(item => typeof item !== 'string' || forbiddenArg.test(item) || item.length > 16 * 1024)) throw new Error(`${name} must be a bounded string array`); return value }
async function canonical(path, label) { if (!isAbsolute(path)) throw new Error(`${label} must be absolute`); return realpath(path) }
async function boundedJson(path, max, label) { const info = await stat(path); if (!info.isFile() || info.size > max) throw new Error(`${label} is not a bounded file`); return JSON.parse(await readFile(path, 'utf8')) }
async function readStdin(max) {
  const chunks = []; let total = 0
  for await (const chunk of process.stdin) { total += chunk.length; if (total > max) throw new Error('request exceeds byte limit'); chunks.push(chunk) }
  return Buffer.concat(chunks).toString('utf8')
}
function checkConfig(config) {
  if (!config || config.version !== 'RunnerConfigV1') throw new Error('config.version must be RunnerConfigV1')
  if (config.runnerApproved !== true) throw new Error('config.runnerApproved must be true')
  const image = safeString(config.imageDigest, 'imageDigest')
  if (!config.outputRoot || !isAbsolute(config.outputRoot)) throw new Error('outputRoot must be an absolute configured directory')
  if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error('imageDigest must be a pinned sha256 digest')
  const docker = safeString(config.dockerBinary, 'dockerBinary')
  if (!isAbsolute(docker)) throw new Error('dockerBinary must be absolute')
  if (config.network !== 'none') throw new Error('only network:none is supported by this wrapper')
  const resources = config.resources
  if (!resources || !Number.isFinite(resources.cpus) || resources.cpus <= 0 || resources.cpus > 32 || !Number.isSafeInteger(resources.memoryMb) || resources.memoryMb < 128 || resources.memoryMb > 131072 || !Number.isSafeInteger(resources.pidsLimit) || resources.pidsLimit < 32 || resources.pidsLimit > 10000) throw new Error('resources require bounded cpus, memoryMb and pidsLimit')
  if (!config.allowedExecutables || typeof config.allowedExecutables !== 'object') throw new Error('allowedExecutables is required')
  for (const kind of CHECK_KINDS) {
    const values = config.allowedExecutables[kind]
    if (!Array.isArray(values) || values.some(value => typeof value !== 'string' || !value.startsWith('/'))) throw new Error(`allowedExecutables.${kind} must contain absolute paths`)
  }
  if (!Array.isArray(config.journeyArgv) || !config.journeyArgv.length) throw new Error('journeyArgv is required')
  return { ...config, dockerBinary: docker, imageDigest: image }
}
function validateRequest(request) {
  if (!request || request.version !== 'RunnerRequestV1') throw new Error('request.version must be RunnerRequestV1')
  for (const key of ['nonce', 'runId', 'unitId', 'candidateId', 'candidateHash', 'workspace']) safeString(request[key], key)
  if (!/^[a-f0-9]{32,128}$/i.test(request.candidateHash)) throw new Error('candidateHash must be an opaque hash string')
  if (!isAbsolute(request.workspace)) throw new Error('workspace must be absolute')
  if (!Array.isArray(request.candidateFiles) || request.candidateFiles.length > 10000) throw new Error('candidateFiles is required and bounded')
  for (const file of request.candidateFiles) {
    if (!file || typeof file.path !== 'string' || !file.path || isAbsolute(file.path) || file.path.includes('\\') || file.path.split('/').some(part => part === '..' || part === '')) throw new Error('candidateFiles paths must be relative, normalized, and nonempty')
    if (!/^[a-f0-9]{64}$/i.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0) throw new Error('candidateFiles require sha256 and bytes')
  }
  const card = request.card
  if (!card || !Array.isArray(card.checks)) throw new Error('card.checks is required')
  const ids = new Set()
  for (const check of card.checks) {
    if (!check || typeof check.id !== 'string' || ids.has(check.id) || !CARD_KINDS.has(check.kind)) throw new Error('checks require unique ids and supported card kinds')
    ids.add(check.id)
    if (check.kind === 'compile' || check.kind === 'cli') safeArray(check.argv, `${check.id}.argv`)
    if (check.kind === 'compile' || check.kind === 'journey') safeString(check.expected, `${check.id}.expected`, 64 * 1024)
    if (check.kind === 'cli') safeString(check.stdoutContains, `${check.id}.stdoutContains`, 64 * 1024)
    if (check.critical !== undefined && typeof check.critical !== 'boolean') throw new Error(`${check.id}.critical must be boolean`)
  }
  const journeyChecks = request.card.checks.filter(check => check.kind === 'journey')
  if (journeyChecks.length) validateScenario(request.scenario, journeyChecks)
  return request
}
function validateScenario(scenario, checks) {
  if (!scenario || scenario.version !== 'ScenarioV1' || !Array.isArray(scenario.serverArgv) || !Array.isArray(scenario.journeys) || !scenario.journeys.length) throw new Error('journey checks require ScenarioV1')
  safeArray(scenario.serverArgv, 'scenario.serverArgv')
  if (!Number.isSafeInteger(scenario.port) || scenario.port < 1024 || scenario.port > 65535) throw new Error('scenario.port must be 1024..65535')
  const ids = new Set(checks.map(check => check.id))
  if (scenario.journeys.length !== 1) throw new Error('one prewritten journey is required per runner invocation')
  for (const journey of scenario.journeys) {
    if (!ids.has(journey.checkId) || !Array.isArray(journey.steps) || !journey.steps.length || journey.steps.length > 200) throw new Error('journey must bind a check and bounded steps')
    for (const step of journey.steps) {
      if (!step || !ACTIONS.has(step.action)) throw new Error('journey step action is not allowed')
      if (step.selector !== undefined) safeString(step.selector, 'step.selector', 4096)
      if (step.value !== undefined) safeString(step.value, 'step.value', 64 * 1024)
      if (step.name !== undefined) safeString(step.name, 'step.name', 512)
      if (step.url !== undefined && (typeof step.url !== 'string' || !step.url.startsWith('/') || step.url.startsWith('//') || step.url.includes('..'))) throw new Error('journey URLs must be local relative slash paths')
      if (step.timeoutMs !== undefined && (!Number.isSafeInteger(step.timeoutMs) || step.timeoutMs < 1 || step.timeoutMs > 30000)) throw new Error('step timeoutMs must be 1..30000')
    }
  }
}
async function verifyCandidate(request, workspace) {
  const seen = new Set()
  for (const file of request.candidateFiles) {
    if (seen.has(file.path)) throw new Error('duplicate candidate file')
    seen.add(file.path)
    const target = await canonical(join(workspace, file.path), `candidate file ${file.path}`)
    if (!within(workspace, target)) throw new Error('candidate file escapes workspace')
    const info = await stat(target)
    if (!info.isFile() || info.size !== file.bytes) throw new Error(`candidate file metadata mismatch: ${file.path}`)
    const digest = createHash('sha256').update(await readFile(target)).digest('hex')
    if (digest !== file.sha256.toLowerCase()) throw new Error(`candidate file hash mismatch: ${file.path}`)
  }
}
function allowedArgv(config, kind, argv) {
  safeArray(argv, `${kind}.argv`)
  if (!config.allowedExecutables[kind].includes(argv[0])) throw new Error(`executable is not allowlisted for ${kind}`)
  const denied = ['--privileged', '--network', '-v', '--volume', '--mount', '--cap-add', '--pid', '--user', '--security-opt', 'docker', 'podman', 'sh', 'bash', 'sudo']
  if (argv.some(value => denied.includes(value) || value.includes('&&') || value.includes(';') || value.includes('|') || value.includes('>'))) throw new Error(`unsafe argv denied for ${kind}`)
}
function substitute(argv, values) { return argv.map(value => value.replaceAll('{workspace}', values.workspace).replaceAll('{output}', values.output).replaceAll('{scenario}', values.scenario).replaceAll('{port}', String(values.port))) }
async function runContainer(config, kind, argv, mounts, timeoutMs) {
  const output = { stdout: '', stderr: '', exitCode: null, signal: null, timedOut: false, truncated: false }
  const args = ['run', '--rm', '--init', '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit', String(config.resources.pidsLimit), '--cpus', String(config.resources.cpus), '--memory', `${config.resources.memoryMb}m`, '--tmpfs', '/tmp:rw,noexec,nosuid,size=256m']
  for (const mount of mounts) args.push('--mount', `type=bind,src=${mount.src},dst=${mount.dst},readonly=${mount.readonly ? 'true' : 'false'}`)
  args.push(config.imageDigest, ...argv)
  const child = spawn(config.dockerBinary, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false })
  let timer
  const append = (key, chunk) => { const remaining = MAX_OUTPUT_BYTES - Buffer.byteLength(output[key]); const text = chunk.subarray(0, Math.max(0, remaining)).toString('utf8'); output[key] += text; if (chunk.length > remaining) output.truncated = true }
  child.stdout.on('data', chunk => append('stdout', chunk)); child.stderr.on('data', chunk => append('stderr', chunk))
  const result = await new Promise(resolveResult => {
    timer = setTimeout(() => { output.timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 2000) }, timeoutMs)
    child.on('error', error => resolveResult({ error }))
    child.on('close', (exitCode, signal) => resolveResult({ exitCode, signal }))
  })
  clearTimeout(timer); Object.assign(output, result)
  return output
}
function responseCheck(id, status, observed, evidenceRefs = []) { return { id, status, observed: String(observed ?? '').slice(0, 64 * 1024), evidenceRefs: evidenceRefs.slice(0, 100) } }
async function main() {
  if (!process.argv.includes('--execute')) throw new Error('runner refuses execution without explicit --execute')
  const configPath = arg('config'); if (!configPath) throw new Error('--config is required')
  const config = checkConfig(await boundedJson(await canonical(configPath, 'config'), MAX_CONFIG_BYTES, 'config'))
  const request = validateRequest(JSON.parse(await readStdin(MAX_REQUEST_BYTES)))
  const workspace = await canonical(request.workspace, 'workspace')
  await verifyCandidate(request, workspace)
  const outputRoot = await canonical(config.outputRoot, 'outputRoot')
  if (!within(outputRoot, workspace)) throw new Error('workspace must be inside configured outputRoot')
  const runOutput = await mkdtemp(join(outputRoot, `.runner-${randomUUID()}-`))
  const scenarioPath = join(runOutput, 'scenario.json')
  if (request.scenario) await writeFile(scenarioPath, `${JSON.stringify(request.scenario)}\n`, { mode: 0o600 })
  const checks = []; let compileFailed = false
  try {
    for (const check of request.card.checks.filter(item => item.kind === 'compile' || item.kind === 'cli')) {
      allowedArgv(config, check.kind, check.argv)
      const argv = substitute(check.argv, { workspace: '/workspace', output: '/output', scenario: '/scenario.json', port: request.scenario?.port ?? 0 })
      const result = await runContainer(config, check.kind, argv, [{ src: workspace, dst: '/workspace', readonly: true }, { src: runOutput, dst: '/output', readonly: false }], config.timeoutMs)
      const observed = `${result.stdout}${result.stderr}`
      const pass = result.exitCode === 0 && !result.signal && !result.timedOut && !result.truncated && (check.kind === 'compile' ? result.stdout.includes(check.expected) || result.stderr.includes(check.expected) : result.stdout.includes(check.stdoutContains))
      const status = result.timedOut || result.truncated || result.error ? 'unknown' : pass ? 'pass' : 'fail'
      if (check.kind === 'compile' && status !== 'pass') compileFailed = true
      checks.push(responseCheck(check.id, status, observed, [`${check.id}.stdout`, `${check.id}.stderr`]))
    }
    for (const check of request.card.checks.filter(item => item.kind === 'journey')) {
      if (compileFailed) { checks.push(responseCheck(check.id, 'unknown', 'compile gate failed; journey not run')); continue }
      allowedArgv(config, 'journey', config.journeyArgv)
      const argv = substitute(config.journeyArgv, { workspace: '/workspace', output: '/output', scenario: '/scenario.json', port: request.scenario.port })
      const result = await runContainer(config, 'journey', argv, [{ src: workspace, dst: '/workspace', readonly: true }, { src: runOutput, dst: '/output', readonly: false }, { src: scenarioPath, dst: '/scenario.json', readonly: true }], config.timeoutMs)
      let payload = null
      try { payload = JSON.parse(result.stdout) } catch {}
      const item = payload?.checks?.find(value => value?.id === check.id)
      const status = result.timedOut || result.truncated || !item || !['pass', 'fail', 'unknown'].includes(item.status) ? 'unknown' : item.status
      checks.push(responseCheck(check.id, status, item?.observed ?? `${result.stdout}${result.stderr}`, Array.isArray(item?.evidenceRefs) ? item.evidenceRefs : []))
    }
  } finally { await rm(runOutput, { recursive: true, force: true }).catch(() => {}) }
  const expectedIds = request.card.checks.filter(check => CHECK_KINDS.has(check.kind)).map(check => check.id)
  if (new Set(checks.map(check => check.id)).size !== expectedIds.length || checks.some(check => !expectedIds.includes(check.id))) throw new Error('runner did not produce exactly one result for each supported expected check')
  const response = { version: 'RunnerResponseV1', nonce: request.nonce, runId: request.runId, unitId: request.unitId, candidateId: request.candidateId, candidateHash: request.candidateHash, checks, artifacts: [], runner: { imageDigest: config.imageDigest, network: 'none', resources: config.resources, execution: 'docker-readonly-candidate' } }
  process.stdout.write(`${JSON.stringify(response)}\n`)
}
main().catch(error => { console.error(`runner: ${error.message}`); process.exitCode = 2 })
