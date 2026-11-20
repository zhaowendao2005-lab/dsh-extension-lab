// Pure external projections. No Host imports, model calls or production state changes.
const TYPES = new Set(['session', 'status', 'text', 'thinking', 'tool_call', 'tool_result', 'error', 'final'])
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const timestamp = value => Number.isFinite(value) ? value : typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null
const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
export class StrictStream {
  constructor(maxLineBytes = 1024 * 1024) {
    this.maxLineBytes = maxLineBytes; this.buffer = ''; this.decoder = new TextDecoder('utf-8', { fatal: true }); this.events = []; this.errors = []; this.final = null; this.session = null; this.lines = 0
  }
  error(code) { if (this.errors.length < 32 && !this.errors.includes(code)) this.errors.push(code) }
  push(chunk) {
    if (this.errors.length) return
    try { this.buffer += this.decoder.decode(chunk, { stream: true }) } catch { this.error('invalid_utf8'); return }
    let newline
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '')
      this.buffer = this.buffer.slice(newline + 1)
      this.consume(line)
      if (this.errors.length) { this.buffer = ''; return }
    }
    if (Buffer.byteLength(this.buffer) > this.maxLineBytes) { this.error('line_limit'); this.buffer = '' }
  }
  consume(line) {
    this.lines++
    if (!line.trim()) { this.error('empty_ndjson_line'); return }
    if (Buffer.byteLength(line) > this.maxLineBytes) { this.error('line_limit'); return }
    if (this.events.length >= 10000) { this.error('event_limit'); return }
    let event
    try { event = JSON.parse(line) } catch { this.error('malformed_json'); return }
    if (!object(event) || !TYPES.has(event.type)) { this.error('unknown_or_invalid_event'); return }
    if (this.final) this.error('event_after_final')
    if (event.type === 'session') {
      if (this.session || this.events.length) this.error('session_must_be_unique_and_first')
      if (typeof event.sessionId !== 'string' || !event.sessionId) this.error('session_identity_missing')
      this.session = event
    } else if (!this.session && event.type !== 'error') this.error('event_before_session')
    if (this.session && Object.hasOwn(event, 'sessionId') && event.sessionId !== this.session.sessionId) this.error('session_identity_mismatch')
    if (event.type === 'final') {
      if (this.final) this.error('duplicate_final')
      if (!this.session || event.sessionId !== this.session.sessionId) this.error('final_identity_missing_or_mismatch')
      if (!object(event.reason) || typeof event.reason.kind !== 'string' || !event.reason.kind) this.error('final_terminal_reason_missing')
      this.final = event
    }
    this.events.push(event)
  }
  end() {
    try { this.buffer += this.decoder.decode() } catch { this.error('invalid_utf8') }
    if (this.buffer.length) this.error('unterminated_ndjson_line')
    this.buffer = ''
    if (!this.session) this.error('missing_session')
    if (!this.final) this.error('missing_final')
    if (this.events.at(-1)?.type !== 'final') this.error('final_not_last')
  }
}
function deliveryProjection(value) {
  if (!object(value) || value.schemaVersion !== 'DeliveryRunV3' || typeof (value.runId ?? value.id) !== 'string' || !Array.isArray(value.units) || !Array.isArray(value.events)) return null
  return value
}
function findDelivery(events) {
  // Only known structured result envelopes; never parse assistant prose as evidence.
  let found = null
  for (const event of events) {
    if (event.type !== 'tool_result') continue
    const candidates = [event.result, event.output, event.result?.run, event.output?.run, event.result?.data, event.output?.data]
    for (const value of candidates) { const run = deliveryProjection(value); if (run) found = run }
  }
  return found
}
function numericUsage(value) {
  if (!object(value)) return null
  const entries = Object.entries(value).filter(([, v]) => Number.isFinite(v) && v >= 0)
  return entries.length ? Object.fromEntries(entries) : null
}
function summarizeDelivery(delivery, processCompleted) {
  if (!delivery) return { runId: null, state: null, reportedVerdict: null, verdict: 'NO_DECISION', evidenceComplete: false, accepted: null, source: 'missing', authoritative: false }
  const units = delivery.units
  const decisions = units.map(unit => unit?.decision?.verdict?.toUpperCase?.() ?? null)
  const reportedVerdict = !units.length || decisions.some(value => !['PASS', 'FAIL', 'NO_DECISION', 'BLOCKED'].includes(value)) ? null : decisions.includes('FAIL') ? 'FAIL' : decisions.every(value => value === 'PASS') ? 'PASS' : 'NO_DECISION'
  const evidenceComplete = units.length > 0 && units.every(unit => {
    const candidateId = unit.candidate?.id
    const checks = unit.decision?.checks
    return typeof candidateId === 'string' && typeof unit.candidate?.hash === 'string' && unit.decision?.candidateId === candidateId && Array.isArray(unit.snapshots) && unit.snapshots.some(snapshot => snapshot.candidateId === candidateId) && Array.isArray(checks) && checks.length > 0 && checks.every(check => check.status === 'pass' || check.verdict === 'PASS')
  })
  const terminal = String(delivery.state).toUpperCase() === 'COMPLETED'
  const accepted = processCompleted && terminal && reportedVerdict === 'PASS' && evidenceComplete
  return { runId: delivery.runId ?? delivery.id, state: delivery.state ?? null, reportedVerdict, verdict: accepted ? 'PASS' : reportedVerdict === 'FAIL' ? 'FAIL' : 'NO_DECISION', evidenceComplete, accepted, source: 'DeliveryRunV3', authoritative: false }
}
export function buildReport({ events, protocolErrors, outcome, startedAt, endedAt, delivery = null }) {
  const session = events.find(event => event.type === 'session') ?? null
  const finals = events.filter(event => event.type === 'final')
  const final = finals.length === 1 ? finals[0] : null
  const strictTerminal = protocolErrors.length === 0 && finals.length === 1 && events.at(-1)?.type === 'final' && events[0]?.type === 'session' && events.filter(event => event.type === 'session').length === 1 && final.sessionId === session?.sessionId
  const processCompleted = outcome.exitCode === 0 && !outcome.signal && !outcome.spawnError && !outcome.stopReason && outcome.closed && strictTerminal && final?.reason?.kind === 'completed' && outcome.cleanup === 'settled'
  const run = deliveryProjection(delivery) ?? findDelivery(events)
  const business = summarizeDelivery(run, processCompleted)
  const pluginEvents = (run?.events ?? []).filter(object)
  const units = (run?.units ?? []).filter(object)
  const timeline = pluginEvents.map((event, index) => {
    const at = timestamp(event.at)
    return { index, seq: event.seq ?? null, runId: event.runId ?? null, unitId: event.unitId ?? event.detail?.unitId ?? null, kind: event.kind ?? null, at, elapsedMs: at !== null ? at - startedAt : null, detail: event.detail ?? null }
  })
  const nodes = units.map(unit => ({ id: unit.id, title: unit.title ?? null, state: unit.state ?? null, candidateId: unit.candidate?.id ?? null, verdict: unit.decision?.verdict ?? null }))
  const edges = units.flatMap(unit => (Array.isArray(unit.dependsOn) ? unit.dependsOn : []).map(parent => ({ from: parent, to: unit.id })))
  const ids = new Set(nodes.map(node => node.id)); const indegree = new Map(nodes.map(node => [node.id, 0])); const adjacency = new Map(nodes.map(node => [node.id, []])); const dagErrors = []
  if (ids.size !== nodes.length) dagErrors.push('duplicate_unit_id')
  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) { dagErrors.push('unknown_dependency'); continue }
    indegree.set(edge.to, indegree.get(edge.to) + 1); adjacency.get(edge.from).push(edge.to)
  }
  const order = []; const ready = [...indegree].filter(([, count]) => count === 0).map(([id]) => id)
  for (let i = 0; i < ready.length; i++) { const id = ready[i]; order.push(id); for (const next of adjacency.get(id)) { indegree.set(next, indegree.get(next) - 1); if (!indegree.get(next)) ready.push(next) } }
  if (order.length !== nodes.length) dagErrors.push('cycle')
  const observedUsage = numericUsage(run?.usage)
  const acceptedAt = pluginEvents.find(event => event.kind === 'run.completed')?.at
  const acceptedTime = timestamp(acceptedAt)
  const durationMs = endedAt - startedAt
  const report = {
    schemaVersion: 'dsh-delivery-experiment.v3', startedAt, endedAt, durationMs, sessionId: session?.sessionId ?? null,
    strictTerminal, protocolErrors, finalReason: final?.reason ?? null,
    process: { ...outcome }, processCompleted, business, usage: observedUsage,
    delivery: run, timeline, dag: { nodes, edges, topologicalOrder: dagErrors.length ? null : order, errors: [...new Set(dagErrors)] },
    metrics: { durationMs, eventCount: events.length, pluginEventCount: pluginEvents.length, unitCount: run ? units.length : null, eventTypes: Object.fromEntries(events.reduce((map, event) => map.set(event.type, (map.get(event.type) ?? 0) + 1), new Map())), usage: observedUsage, cost: null, cacheHitRate: null, acceptedUnits: run ? units.filter(unit => unit.decision?.verdict === 'PASS').length : null, timeToAcceptanceMs: business.accepted && acceptedTime !== null && acceptedTime >= startedAt ? acceptedTime - startedAt : null, stopTailMs: null, processCompleted, accepted: business.accepted },
    limitations: ['Headless NDJSON is a capped projection, not the lossless Session log.', 'Missing cost, cache and stop timing remain null.', 'Observed plugin acceptance is not independent business verification or a production verdict.', 'No event or report causes production actions.'],
  }
  if (dagErrors.length) { report.business.accepted = false; report.business.verdict = 'NO_DECISION'; report.metrics.accepted = false; report.metrics.timeToAcceptanceMs = null }
  return report
}
export function renderReport(report) {
  const table = (headers, rows) => `<table><thead><tr>${headers.map(header => `<th>${escape(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${escape(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>DSH delivery experiment</title><style>body{font:15px system-ui;margin:2rem;max-width:1100px;color:#172033;background:#f9fafb}table{border-collapse:collapse;width:100%;margin:1rem 0}td,th{border:1px solid #ccd2da;padding:.6rem;text-align:left;overflow-wrap:anywhere}th{background:#e8edf2}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#edf0f4;padding:1rem}h2{margin-top:2rem}</style><h1>External delivery report</h1><p>Process completion: <strong>${escape(report.processCompleted)}</strong> · Observed acceptance: <strong>${escape(report.business.verdict)}</strong>. This report is not a production gate.</p><h2>Units and dependency DAG</h2>${table(['Unit', 'Outcome', 'State', 'Candidate', 'Verdict', 'Depends on'], report.dag.nodes.map(node => [node.id, node.title, node.state, node.candidateId, node.verdict, report.dag.edges.filter(edge => edge.to === node.id).map(edge => edge.from).join(', ')]))}<p>Topological order: ${escape(report.dag.topologicalOrder?.join(' → ') ?? 'unavailable')}. DAG errors: ${escape(report.dag.errors.join(', ') || 'none observed')}.</p><h2>Plugin event timeline</h2>${table(['Sequence', 'Time', 'Unit', 'Event'], report.timeline.map(event => [event.seq, event.at === null ? 'unknown' : new Date(event.at).toISOString(), event.unitId, event.kind]))}<h2>Metrics</h2><pre>${escape(JSON.stringify(report.metrics, null, 2))}</pre><h2>Complete evidence projection</h2><pre>${escape(JSON.stringify(report, null, 2))}</pre></html>`
}
