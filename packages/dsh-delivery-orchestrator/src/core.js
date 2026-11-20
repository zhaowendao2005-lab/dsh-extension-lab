import { Artifacts } from './artifacts.js'
import { deepClone, hash, PersistentLedger, uuid } from './persistence.js'
import { validateSpec } from './protocol.js'

export function runView(run) {
  return deepClone(run)
}
function stamp() { return Date.now() }
function ownerCheck(run, owner) { if (!run || run.owner !== owner) throw new Error('RUN_NOT_OWNED') }
function emit(run, kind, detail = {}) {
  if (run.events.length >= run.config.maxEvents) return
  run.seq += 1
  run.updatedAt = stamp()
  run.events.push({ runId: run.runId, seq: run.seq, at: run.updatedAt, kind, detail: deepClone(detail) })
}
function unitFromLine(line, index) {
  const id = `unit-${index + 1}`
  const title = line.replace(/^[-*\d.)\s]+/, '').trim().slice(0, 240) || id
  const path = `units/${id}.md`
  return {
    id, title, outcome: title, kind: 'research', owns: [path], consumes: [], dependsOn: [], requirementIds: [`req-${index + 1}`], cardId: `card-${index + 1}`, state: 'READY', owner: null, lease: null,
    card: { version: 'CardV1', id: `card-${index + 1}`, unitId: id, livePreconditions: [], orderedSteps: [], visualCheckpoints: [], sourcePolicyId: 'user-request', checks: [{ id: `check-${index + 1}`, requirementId: `req-${index + 1}`, kind: 'manual', expected: '可信 Runner 或人工提供证据', critical: true }] },
    candidates: [], candidate: null, snapshots: [], decision: null, attempts: 0,
  }
}
function plan(request, maxUnits) {
  const lines = request.split(/\r?\n/).map(x => x.trim()).filter(Boolean).slice(0, maxUnits)
  const source = lines.length ? lines : [request]
  const units = source.map(unitFromLine)
  const spec = {
    version: 'SpecV1',
    requirements: units.map((unit, i) => ({ id: `req-${i + 1}`, quote: source[i], outcome: unit.outcome })),
    design: { partitionDecision: 'deterministic-line-split', generated: false },
    factGates: [], partitionDecision: 'deterministic-line-split',
    units, nodes: units.map(unit => ({ id: `node-${unit.id}`, unitId: unit.id, role: 'external-adapter', readyWhen: 'request-accepted' })), edges: [], acceptanceCards: units.map(unit => unit.card), deliveryRule: 'each unit has an independent card; no shared late reviewer', gaps: ['semantic decomposition', 'trusted implementation', 'trusted acceptance'],
  }
  validateSpec(spec, request, maxUnits)
  return spec
}
function summary(run) {
  return { runId: run.runId, schemaVersion: run.schemaVersion, owner: run.owner, state: run.state, createdAt: run.createdAt, updatedAt: run.updatedAt, seq: run.seq, persistence: 'storage-domain', spec: deepClone(run.spec), units: deepClone(run.units), events: deepClone(run.events), blockers: deepClone(run.blockers), delivery: deepClone(run.delivery) }
}

export class Orchestrator {
  constructor(ctx, config) {
    this.ctx = ctx
    this.config = config
    this.ledger = new PersistentLedger(ctx)
    this.artifacts = new Artifacts(config.workspaceRoot)
    this.runs = new Map()
    this.listeners = new Map()
    this.ready = this.restore()
  }
  async restore() { await this.ledger.ready; for (const run of await this.ledger.values()) this.runs.set(run.runId, run); return this }
  async save(run) { await this.ledger.transact(run.runId, () => run); this.notify(run) }
  notify(run) { const listeners = this.listeners.get(run.owner); for (const listener of listeners ?? []) listener({ type: 'run', run: summary(run) }) }
  async create(owner, request) {
    await this.ready
    if (!request || request.length > this.config.maxRequestChars) throw new Error('INVALID_REQUEST')
    const spec = plan(request, this.config.maxUnits)
    const at = stamp(); const runId = `run-${uuid()}`
    const run = { schemaVersion: 'DeliveryRunV3', id: runId, runId, owner, request, requestHash: hash(request), specHash: hash(spec), spec, units: deepClone(spec.units), state: 'PLANNED', blockers: [], delivery: null, config: { maxEvents: this.config.maxEvents }, createdAt: at, updatedAt: at, seq: 0, events: [] }
    emit(run, 'run.created', { specHash: run.specHash, unitIds: run.units.map(u => u.id) })
    emit(run, 'plan.frozen', { version: spec.version })
    this.runs.set(runId, run); await this.save(run); return summary(run)
  }
  status(owner, runId) {
    if (runId) { const run = this.runs.get(String(runId)); ownerCheck(run, owner); return summary(run) }
    return [...this.runs.values()].filter(run => run.owner === owner).map(summary)
  }
  subscribe(owner, listener) { const set = this.listeners.get(owner) ?? new Set(); set.add(listener); this.listeners.set(owner, set); return () => { set.delete(listener); if (!set.size) this.listeners.delete(owner) } }
  async execute(owner, runId, agent, signal) {
    await this.ready
    const run = this.runs.get(String(runId)); ownerCheck(run, owner)
    if (['DELIVERED', 'CANCELLED'].includes(run.state)) return summary(run)
    if (signal?.aborted) throw new Error('ABORTED')
    // The core never fabricates candidate files or acceptance. Without explicitly configured trusted role routes,
    // the run becomes BLOCKED with a durable reason instead of being reported as delivered.
    const missing = ['planner', 'implementer', 'scenario'].filter(role => !this.config.routes?.[role]?.provider || !this.config.routes?.[role]?.model)
    if (missing.length) {
      run.state = 'BLOCKED'; run.blockers = [{ code: 'ROLE_ROUTE_UNCONFIGURED', roles: missing, message: '未配置可信角色路由；未伪造候选、证据或通过结果。' }]
      emit(run, 'run.blocked', { code: 'ROLE_ROUTE_UNCONFIGURED', roles: missing }); await this.save(run); return summary(run)
    }
    if (!agent || !this.ctx.subagents?.startActivation) {
      run.state = 'BLOCKED'; run.blockers = [{ code: 'SUBAGENT_SERVICE_UNAVAILABLE', message: 'subagents/parent Agent 不可用。' }]
      emit(run, 'run.blocked', { code: 'SUBAGENT_SERVICE_UNAVAILABLE' }); await this.save(run); return summary(run)
    }
    // Model execution is deliberately an explicit adapter boundary. This version does not infer acceptance from prose.
    run.state = 'BLOCKED'; run.blockers = [{ code: 'ADAPTER_REQUIRED', message: '已锁定 Spec，但仍需绑定受信实施、Scenario 和 Runner/Judge adapter。' }]
    emit(run, 'run.blocked', { code: 'ADAPTER_REQUIRED' }); await this.save(run); return summary(run)
  }
  async checkpoint(owner, runId, unitId, kind, detail = {}) {
    await this.ready
    const run = this.runs.get(String(runId)); ownerCheck(run, owner)
    const unit = run.units.find(item => item.id === String(unitId))
    if (!unit) throw new Error('UNIT_NOT_FOUND')
    if (kind !== 'ready_for_acceptance') throw new Error('CHECKPOINT_KIND_UNSUPPORTED')
    if (['CANCELLED', 'DELIVERED'].includes(run.state) || ['CANCELLED', 'SUCCEEDED'].includes(unit.state)) throw new Error('CHECKPOINT_CLOSED')
    unit.state = 'QUEUED'
    unit.checkpoint = { kind, detail: typeof detail === 'string' ? detail.slice(0, 4000) : deepClone(detail), at: stamp(), owner }
    emit(run, 'unit.acceptance.queued', { unitId: unit.id, kind })
    await this.save(run)
    return { runId: run.runId, unitId: unit.id, state: unit.state, receiptSeq: run.seq }
  }
  async cancel(owner, runId) {
    await this.ready
    const run = this.runs.get(String(runId)); ownerCheck(run, owner)
    if (run.state !== 'DELIVERED') {
      run.state = 'CANCELLED'; run.blockers = []
      for (const unit of run.units) if (!['SUCCEEDED', 'FAILED'].includes(unit.state)) unit.state = 'CANCELLED'
      emit(run, 'run.cancelled', {}); await this.save(run)
    }
    return summary(run)
  }
  async close() { await this.ledger.close() }
}

