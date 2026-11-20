// Pure contract validation. No model-produced field grants capabilities.
export const POLICY = 'delivery-policy/v1'
export function requireValue(ok, code) { if (!ok) throw new Error(code) }
export function text(value, label, max = 16000) { requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `INVALID_${label}`); return value }
export function pathName(value) {
  text(value, 'PATH', 240)
  requireValue(!value.startsWith('/') && !/[\\\x00-\x1f:]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..' && !part.startsWith('.')), 'UNSAFE_PATH')
  return value
}
export const overlaps = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
export function parseObject(output, maxBytes = 1000000) {
  const raw = output.trim().replace(/^```(?:json)?\s*\n/, '').replace(/\n```$/, '')
  requireValue(Buffer.byteLength(raw) <= maxBytes, 'OUTPUT_LIMIT')
  const parsed = JSON.parse(raw)
  requireValue(parsed && !Array.isArray(parsed) && typeof parsed === 'object', 'OBJECT_REQUIRED')
  return parsed
}
export function validateSpec(spec, request, maxUnits = 16) {
  requireValue(spec?.version === 'SpecV1', 'SPEC_VERSION')
  requireValue(Array.isArray(spec.requirements) && spec.requirements.length > 0 && spec.requirements.length <= 64, 'REQUIREMENTS_REQUIRED')
  const reqIds = new Set()
  for (const req of spec.requirements) {
    text(req.id, 'REQUIREMENT_ID', 64); text(req.quote, 'QUOTE'); text(req.outcome, 'OUTCOME')
    requireValue(request.includes(req.quote) && !reqIds.has(req.id), 'REQUIREMENT_PROVENANCE'); reqIds.add(req.id)
  }
  requireValue(Array.isArray(spec.units) && spec.units.length > 0 && spec.units.length <= maxUnits, 'UNIT_COUNT')
  const ids = new Set(), paths = [], covered = new Set()
  for (const unit of spec.units) {
    requireValue(/^[a-z][a-z0-9-]{0,47}$/.test(unit.id) && !ids.has(unit.id), 'UNIT_ID'); ids.add(unit.id)
    text(unit.title, 'UNIT_TITLE', 240); text(unit.outcome, 'UNIT_OUTCOME'); text(unit.interface, 'UNIT_INTERFACE')
    requireValue(['software', 'document', 'data', 'research', 'boundary'].includes(unit.kind), 'UNIT_KIND')
    requireValue(Array.isArray(unit.owns) && unit.owns.length > 0 && unit.owns.length <= 64, 'UNIT_WRITE_SCOPE')
    for (const file of unit.owns) { pathName(file); requireValue(!paths.some(p => overlaps(p, file)), 'OVERLAPPING_WRITE_LEASE'); paths.push(file) }
    requireValue(Array.isArray(unit.dependsOn) && new Set(unit.dependsOn).size === unit.dependsOn.length, 'UNIT_DEPENDENCIES')
    requireValue(Array.isArray(unit.requirementIds) && unit.requirementIds.length > 0, 'UNIT_REQUIREMENTS')
    for (const id of unit.requirementIds) { requireValue(reqIds.has(id), 'UNKNOWN_REQUIREMENT'); covered.add(id) }
    validateCard(unit.card, unit, reqIds)
  }
  requireValue([...reqIds].every(id => covered.has(id)), 'UNCOVERED_REQUIREMENT')
  const visited = new Set(), pending = new Set()
  const visit = id => { requireValue(ids.has(id) && !pending.has(id), 'DEPENDENCY_CYCLE_OR_UNKNOWN'); if (visited.has(id)) return; pending.add(id); for (const dep of spec.units.find(u => u.id === id).dependsOn) visit(dep); pending.delete(id); visited.add(id) }
  for (const id of ids) visit(id)
  requireValue(Array.isArray(spec.factGates), 'FACT_GATES_REQUIRED')
  const gateIds = new Set()
  for (const gate of spec.factGates) {
    text(gate.id, 'GATE_ID', 64); requireValue(!gateIds.has(gate.id), 'DUPLICATE_GATE'); gateIds.add(gate.id)
    text(gate.question, 'GATE_QUESTION'); text(gate.source, 'GATE_SOURCE', 2048); text(gate.contains, 'GATE_PREDICATE', 1024)
    requireValue(Array.isArray(gate.affects) && gate.affects.length > 0 && gate.affects.every(id => ids.has(id)), 'GATE_AFFECTS')
  }
  return spec
}
export function validateCard(card, unit, reqIds) {
  requireValue(card?.version === 'CardV1' && card.unitId === unit.id, 'CARD_BINDING')
  requireValue(Array.isArray(card.checks) && card.checks.length > 0 && card.checks.length <= 48, 'CARD_CHECKS')
  const ids = new Set(), covered = new Set()
  for (const c of card.checks) {
    text(c.id, 'CHECK_ID', 64); requireValue(!ids.has(c.id), 'DUPLICATE_CHECK'); ids.add(c.id)
    requireValue(reqIds.has(c.requirementId) && unit.requirementIds.includes(c.requirementId), 'CHECK_REQUIREMENT'); covered.add(c.requirementId)
    requireValue(['compile','journey','cli','json','text','source','semantic','manual'].includes(c.kind), 'CHECK_KIND')
    text(c.expected, 'EXPECTED'); requireValue(typeof c.critical === 'boolean', 'CHECK_CRITICAL')
    if (['json','text'].includes(c.kind)) { pathName(c.path); requireValue(unit.owns.includes(c.path), 'CHECK_PATH_OWNERSHIP') }
    if (c.kind === 'text') text(c.contains, 'TEXT_PREDICATE', 16000)
    if (c.kind === 'json') { requireValue(Array.isArray(c.requiredKeys) && c.requiredKeys.every(k => typeof k === 'string'), 'JSON_KEYS'); requireValue(c.requiredKeys.length > 0, 'JSON_PREDICATE_REQUIRED') }
    if (c.kind === 'source') { text(c.url, 'SOURCE_URL', 2048); text(c.contains, 'SOURCE_PREDICATE', 1024) }
    if (['compile','cli'].includes(c.kind)) { requireValue(Array.isArray(c.argv) && c.argv.length > 0 && c.argv.length <= 32 && c.argv.every(a => typeof a === 'string' && a.length <= 4000), 'ARGV'); if (c.kind === 'cli') text(c.stdoutContains, 'CLI_EXPECTED', 4000) }
  }
  requireValue(unit.requirementIds.every(id => covered.has(id)), 'CARD_COVERAGE')
  if (['software','boundary'].includes(unit.kind)) requireValue(card.checks.some(c => c.kind === 'compile') && card.checks.some(c => ['journey','cli'].includes(c.kind)), 'SOFTWARE_NEEDS_COMPILE_AND_E2E')
  return card
}
export function validateCandidate(payload, unit, maxBytes) {
  requireValue(Array.isArray(payload?.files) && payload.files.length > 0 && payload.files.length <= 64, 'CANDIDATE_FILES')
  const ids = new Set(); let bytes = 0
  for (const file of payload.files) {
    pathName(file.path); requireValue(unit.owns.includes(file.path) && !ids.has(file.path), 'WRITE_LEASE_VIOLATION'); ids.add(file.path)
    requireValue(typeof file.content === 'string', 'FILE_CONTENT'); bytes += Buffer.byteLength(file.content)
  }
  requireValue(bytes <= maxBytes && unit.owns.every(p => ids.has(p)), 'CANDIDATE_INCOMPLETE_OR_LIMIT')
  return payload.files
}
export function validateScenario(payload, unit) {
  requireValue(payload?.version === 'ScenarioV1' && Array.isArray(payload.journeys), 'SCENARIO_VERSION')
  const expected = unit.card.checks.filter(c => c.kind === 'journey').map(c => c.id)
  const ids = new Set()
  for (const j of payload.journeys) {
    requireValue(expected.includes(j.checkId) && !ids.has(j.checkId), 'JOURNEY_BINDING'); ids.add(j.checkId)
    requireValue(Array.isArray(j.steps) && j.steps.length > 0 && j.steps.length <= 64, 'JOURNEY_STEPS')
    requireValue(j.steps.some(s => ['assertText','assertVisible','assertValue','download'].includes(s.action)), 'JOURNEY_ASSERTION_REQUIRED')
    for (const s of j.steps) {
      requireValue(['goto','fill','click','wait','assertText','assertVisible','assertValue','download','checkpoint'].includes(s.action), 'FORBIDDEN_ACTION')
      requireValue(Object.keys(s).every(k => ['action','selector','value','url','timeoutMs','name'].includes(k)), 'UNKNOWN_STEP_FIELD')
      if (s.selector !== undefined) text(s.selector, 'SELECTOR', 512)
      if (s.url !== undefined) text(s.url, 'URL', 2048)
      if (s.value !== undefined) text(s.value, 'VALUE', 16000)
      if (s.timeoutMs !== undefined) requireValue(Number.isInteger(s.timeoutMs) && s.timeoutMs > 0 && s.timeoutMs <= 30000, 'STEP_TIMEOUT')
      if (['fill','click','assertText','assertVisible','assertValue','download'].includes(s.action)) text(s.selector,'SELECTOR',512)
      if (['fill','assertText','assertValue'].includes(s.action)) text(s.value,'VALUE',16000)
      if (s.action === 'goto') { text(s.url,'URL',2048); requireValue(s.url.startsWith('/') && !s.url.startsWith('//'), 'LOCAL_JOURNEY_URL_REQUIRED') }
    }
  }
  requireValue(expected.every(id => ids.has(id)), 'MISSING_JOURNEY')
  if (expected.length) {
    requireValue(Array.isArray(payload.serverArgv) && payload.serverArgv.length > 0 && payload.serverArgv.length <= 32 && payload.serverArgv.every(s => typeof s === 'string' && s.length <= 4000), 'SERVER_ARGV')
    requireValue(Number.isInteger(payload.port) && payload.port >= 1024 && payload.port <= 65535, 'SERVER_PORT')
  }
  return payload
}
