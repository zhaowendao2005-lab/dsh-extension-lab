import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'
import { Orchestrator } from './core.js'
import { hostContribution } from './contract.js'
import { DeliveryOrchestratorService } from './service.js'

export const name = 'dsh-delivery-orchestrator'
export const inject = ['commands', 'typert', 'storageDomain', 'subagents', 'tools', 'llm']

const defaults = Object.freeze({
  enabled: undefined,
  isolationRoot: '',
  workspaceRoot: '',
  workspaceRoots: [],
  maxConcurrent: 3,
  maxUnits: 16,
  maxRequestChars: 32000,
  maxDurationMs: 900000,
  roleTimeoutMs: 180000,
  maxSteps: 8,
  maxOutputBytes: 1000000,
  maxRepairAttempts: 1,
  maxEvents: 3000,
  routes: { planner: {}, implementer: {}, scenario: {}, judge: {} },
  judgeMode: 'none',
  jevEndpoint: 'https://api.typesafe.ai/v1/systemone',
  jevKeyEnv: 'JEV_API_KEY',
  runnerCommand: '',
  runnerArgs: [],
  runnerApproved: false,
  allowedOrigins: [],
})

// No Config export: Cordis would require a schemastery schema; apply(ctx, config) normalizes plain values.

function normalizeConfig(input = {}) {
  const value = input && typeof input === 'object' ? input : {}
  return {
    ...defaults,
    ...value,
    routes: { ...defaults.routes, ...(value.routes || {}) },
    workspaceRoots: Array.isArray(value.workspaceRoots) ? value.workspaceRoots.map(String) : [],
    runnerArgs: Array.isArray(value.runnerArgs) ? value.runnerArgs.map(String) : [],
    allowedOrigins: Array.isArray(value.allowedOrigins) ? value.allowedOrigins.map(String) : [],
  }
}

function canonical(path) {
  if (!isAbsolute(path)) throw new Error('路径必须是绝对路径')
  return realpathSync(path)
}
function canonicalCandidate(path) {
  if (!isAbsolute(path)) throw new Error('路径必须是绝对路径')
  let current = path
  const suffix = []
  while (true) {
    try {
      const base = realpathSync(current)
      return suffix.reverse().reduce((value, part) => join(value, part), base)
    } catch (error) {
      const parent = join(current, '..')
      if (parent === current) throw error
      suffix.push(current.slice(parent.length + 1))
      current = parent
    }
  }
}
function beneath(root, target) {
  const rel = relative(root, target)
  return rel === '' || (rel && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}
function isPluginDevHome(dshHome) {
  return /(^|[\\/])\.dsh[\\/]plugin-dev[\\/]/.test(dshHome)
}
function gate(config) {
  const rawHome = process.env.DSH_HOME
  if (!rawHome) throw new Error('DSH_HOME 未设置')
  const dshHome = canonical(rawHome)
  const explicit = process.env.DSH_DELIVERY_ISOLATED === '1'
  const sandbox = isPluginDevHome(dshHome)
  if (config.enabled !== true && !sandbox) {
    throw new Error('插件默认禁用；请显式设置 enabled=true（或运行于 dsh plugin-dev 沙箱）')
  }
  if (!explicit && !sandbox) {
    throw new Error('需要 DSH_DELIVERY_ISOLATED=1，或运行在 dsh plugin-dev 沙箱（DSH_HOME 含 /.dsh/plugin-dev/）')
  }
  const defaultHome = join(homedir(), '.dsh')
  let defaultReal = ''
  try { defaultReal = canonical(defaultHome) } catch {}
  if (defaultReal && beneath(defaultReal, dshHome)) throw new Error('拒绝使用 ~/.dsh 或其后代作为 isolationRoot')
  const root = config.isolationRoot ? canonical(config.isolationRoot) : dshHome
  if (root !== dshHome) throw new Error('isolationRoot 必须等于真实 DSH_HOME')
  const workspaceRoot = config.workspaceRoot || join(root, 'delivery')
  if (!isAbsolute(workspaceRoot)) throw new Error('workspaceRoot 必须是绝对路径')
  const roots = [workspaceRoot, ...config.workspaceRoots]
  for (const candidate of roots) {
    const resolved = canonicalCandidate(candidate)
    if (!beneath(root, resolved)) throw new Error('workspaceRoot 必须位于 isolationRoot 内')
  }
  return { ...config, isolationRoot: root, workspaceRoot: canonicalCandidate(workspaceRoot), workspaceRoots: roots.map(canonicalCandidate) }
}

function ownerOf(invocation) {
  const id = invocation?.agent?.id ?? invocation?.agent?.session?.id
  if (typeof id !== 'string' || !id) throw new Error('无法确定命令 owner')
  return id
}
function raw(invocation) { return String(invocation?.rawInput ?? '').trim() }
function parse(value) {
  if (!value) return {}
  if (value.startsWith('{') || value.startsWith('[')) return JSON.parse(value)
  return { request: value }
}
function result(value) { return { kind: 'success', text: JSON.stringify(value) } }
function failure(error) { return { kind: 'error', text: error instanceof Error ? error.message : String(error) } }

export function apply(ctx, input) {
  let config
  try { config = gate(normalizeConfig(input)) } catch (error) { console.warn(`[${name}] fail-closed:`, error); return }
  if (!ctx?.commands?.register || !ctx?.typert?.register || !ctx?.storageDomain) {
    console.warn(`[${name}] required Host services unavailable; plugin not enabled`)
    return
  }
  console.info(`[${name}] activated (isolated): ${config.workspaceRoot}`)
  const orchestrator = new Orchestrator(ctx, config)
  const service = new DeliveryOrchestratorService(ctx, orchestrator)
  const disposeRemote = ctx.effect(() => ctx.typert.register(hostContribution), `${name}.remote`)
  const call = fn => async invocation => { try { return result(await fn(invocation)) } catch (error) { return failure(error) } }
  const commandDefinitions = [
    { name: 'delivery-run', description: 'Create a delivery run and await its real pipeline.', input: { hint: '<raw request>', attachments: false }, recordInput: false, handler: call(async invocation => { const owner = ownerOf(invocation); const request = raw(invocation); const run = await orchestrator.create(owner, request); return orchestrator.execute(owner, run.runId, invocation.agent, invocation.signal).then(() => orchestrator.status(owner, run.runId)) }) },
    { name: 'delivery-status', description: 'Read owned delivery run status.', input: { hint: '{"runId":"..."}', attachments: false }, recordInput: false, handler: call(async invocation => { const data = parse(raw(invocation)); return orchestrator.status(ownerOf(invocation), data.runId) }) },
    { name: 'delivery-checkpoint', description: 'Freeze an owned unit for trusted acceptance.', input: { hint: '{runId,unitId,kind,detail}', attachments: false }, recordInput: false, handler: call(async invocation => { const data = parse(raw(invocation)); return orchestrator.checkpoint(ownerOf(invocation), String(data.runId || ''), String(data.unitId || ''), String(data.kind || ''), data.detail) }) },
    { name: 'delivery-cancel', description: 'Cancel an owned delivery run.', input: { hint: '{"runId":"..."}', attachments: false }, recordInput: false, handler: call(async invocation => { const data = parse(raw(invocation)); return orchestrator.cancel(ownerOf(invocation), String(data.runId || '')) }) },
    { name: 'delivery-export', description: 'Export an owned delivery run.', input: { hint: '{"runId":"..."}', attachments: false }, recordInput: false, handler: call(async invocation => { const data = parse(raw(invocation)); return orchestrator.status(ownerOf(invocation), data.runId) }) },
    { name: 'delivery-resume', description: 'Resume an owned delivery run.', input: { hint: '{"runId":"..."}', attachments: false }, recordInput: false, handler: call(async invocation => { const data = parse(raw(invocation)); const owner = ownerOf(invocation); return orchestrator.execute(owner, String(data.runId || ''), invocation.agent, invocation.signal).then(() => orchestrator.status(owner, data.runId)) }) },
  ]
  const disposers = commandDefinitions.map(definition => ctx.commands.register(definition))
  ctx.effect(() => () => { for (const dispose of disposers.reverse()) dispose?.(); disposeRemote?.(); service.close?.() }, `${name}.cleanup`)
}
