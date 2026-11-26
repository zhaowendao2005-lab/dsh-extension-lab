import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FingerprintError } from '../fingerprint/engine.js';
import { tokenIdentity } from '../a6/slots.js';
import { createSandbox, openSandbox, removeSandbox } from './sandbox.js';
import { executeSession } from './session.js';
import { createA6Stream } from './a6-llm.js';
import { errorDetail } from './errors.js';

const END = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
const RESUMABLE = new Set(['failed', 'cancelled', 'interrupted']);
const MAX_MODELS = 6;
const REQUEST_CAP = 500;
const TRIGGER_CAP = 120;
const copy = value => JSON.parse(JSON.stringify(value));
const known = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const sum = values => values.length && values.every(v => v !== null) ? values.reduce((a, b) => a + b, 0) : null;
const mean = values => { const n = values.filter(v => v !== null); return n.length ? n.reduce((a, b) => a + b, 0) / n.length : null; };
const err = (code, message) => new FingerprintError(code, message);
const emptyUsage = () => ({ requestCount: 0, inputTokens: null, inputTotalTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, cost: null, currency: null, billingState: 'unknown' });
const emptyMetrics = () => ({ ttftMs: null, generationMs: null, e2eMs: null, modelTokensPerSecond: null, endToEndTokensPerSecond: null, cacheRate: null });
const publicRun = data => copy(data.summary);
const summaryError = (code, message, phase, detail = null) => ({ code, message, phase, detail });
/** One bounded line: the steps view must never receive embedded newlines from a trigger preview. */
const clipLine = (value, limit = TRIGGER_CAP) => { const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''; return text.length > limit ? `${text.slice(0, limit - 1)}…` : text; };
const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch));
function spawnDetached(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
async function launchWebViewWindow({ html, title }) {
  const safeTitle = String(title || '查看结果').slice(0, 200);
  const filePath = path.join(os.tmpdir(), `mit-webview-${randomUUID()}.html`);
  const doc = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(safeTitle)}</title><style>html,body,iframe{margin:0;padding:0;width:100%;height:100%;border:0;overflow:hidden;background:#fff}</style></head><body><iframe sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="${escapeHtml(html)}"></iframe></body></html>`;
  await fs.writeFile(filePath, doc, { encoding: 'utf8', mode: 0o600 });
  const fileUrl = pathToFileURL(filePath).href;
  if (process.platform === 'darwin') {
    const jxa = `
ObjC.import('Cocoa');
ObjC.import('WebKit');
var app = $.NSApplication.sharedApplication;
app.setActivationPolicy($.NSApplicationActivationPolicyRegular);
ObjC.registerSubclass({
  name: 'MitWebViewDelegate',
  methods: {
    'applicationShouldTerminateAfterLastWindowClosed:': { types: ['bool', ['id']], implementation: function() { return true; } }
  }
});
var delegate = $.MitWebViewDelegate.alloc.init;
app.setDelegate(delegate);
var style = $.NSWindowStyleMaskTitled | $.NSWindowStyleMaskClosable | $.NSWindowStyleMaskMiniaturizable | $.NSWindowStyleMaskResizable;
var rect = $.NSMakeRect(0, 0, 1200, 820);
var win = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer(rect, style, $.NSBackingStoreBuffered, false);
win.setTitle(${JSON.stringify(safeTitle)});
win.center;
var webview = $.WKWebView.alloc.initWithFrame(rect);
var url = $.NSURL.URLWithString(${JSON.stringify(fileUrl)});
webview.loadFileURLAllowingReadAccessToURL(url, url.URLByDeletingLastPathComponent);
win.setContentView(webview);
win.makeKeyAndOrderFront(null);
app.activateIgnoringOtherApps(true);
app.run;
`;
    await spawnDetached('osascript', ['-l', 'JavaScript', '-e', jxa]);
    return { opened: true, filePath };
  }
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      'msedge.exe',
      'chrome.exe',
    ].filter(Boolean);
    const exe = candidates.find(item => !item.includes('\\') || existsSync(item));
    if (exe) {
      try {
        await spawnDetached(exe, [`--app=${fileUrl}`, '--window-size=1200,820']);
        return { opened: true, filePath };
      } catch { /* fall through */ }
    }
    return { opened: false, filePath };
  }
  for (const bin of ['google-chrome', 'chromium', 'microsoft-edge']) {
    try {
      await spawnDetached(bin, [`--app=${fileUrl}`, '--window-size=1200,820']);
      return { opened: true, filePath };
    } catch { /* try next */ }
  }
  return { opened: false, filePath };
}
/** Latest integer turn/step pair the Host recorded for the run; both stay null until one is observed. */
const latestTurnStep = events => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (Number.isInteger(event.turn) && Number.isInteger(event.step)) return { turn: event.turn, step: event.step };
  }
  return { turn: null, step: null };
};
/** Short cause for the steps view: whichever of the latest user instruction or tool activity came last. */
const latestTrigger = events => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === 'message' && event.role === 'user') return clipLine(`用户指令：${typeof event.text === 'string' ? event.text : ''}`);
    if (event.type !== 'tool') continue;
    const name = clipLine(event.name, 48);
    const preview = clipLine(event.text ?? event.arguments ?? event.content, 60);
    return clipLine(`${name ? `工具 ${name}` : '工具调用'}${preview ? `：${preview}` : ''}`);
  }
  return null;
};
/** Session events carry the local request id; a persisted row may also know the ledger execution id. */
const findRequest = (data, executionId) => typeof executionId === 'string' && executionId ? data.requests?.find(row => row.id === executionId || row.executionId === executionId) ?? null : null;
/** Real per-model Agent sessions. Secrets remain in short-lived transport closures only. */
export class CustomCoordinator {
  constructor(ctx, { storage, capacity, ledger, a6, onTouch, onSettled }) {
    Object.assign(this, { ctx, storage, capacity, ledger, a6, onTouch, onSettled });
    this.jobs = new Map(); this.removed = new Set(); this.writes = new Map();
    this.timers = new Map(); this.active = 0; this.closing = false; this.disposed = false; this.ready = this.boot();
    this.ready.catch(() => {});
  }
  async boot() {
    const domain = await this.storage.records();
    for (const [id, data] of domain.table('custom_runs').entries()) {
      if (END.has(data.summary?.phase)) continue;
      const interruptedAt = Date.now();
      const interrupted = { code: 'interrupted', message: '运行时已重启，会话已中断；不会自动重新发送请求', phase: data.summary.phase };
      data.summary.phase = 'interrupted'; data.summary.finishedAt = interruptedAt;
      if (data.resumeQueued) data.summary.resumeError = interrupted;
      else data.summary.error = interrupted;
      delete data.resumeQueued;
      data.revision += 1; data.summary.updatedAt = interruptedAt;
      for (const request of data.requests ?? []) {
        if (request.status === 'running') request.status = 'interrupted';
        // The stop instant is unknown after restart. Never include downtime or reactivate open calls.
        if (request.timing?.tools.some(tool => tool.endedAt === null)) request.timing.toolsClosed = true;
      }
      await domain.table('custom_runs').put(id, data);
    }
    return domain;
  }
  async dataRoot() {
    if (!this.rootPromise) this.rootPromise = (async () => {
      const settings = this.ctx.get('settings');
      if (!settings?.prepareDocument) throw err('sandbox-root-unavailable', '当前运行时无法定位此配置的沙箱目录');
      const document = await settings.prepareDocument();
      if (typeof document !== 'string' || !path.isAbsolute(document)) throw err('sandbox-root-unavailable', '配置目录不可用');
      return path.join(path.dirname(document), 'model-intelligence-test', 'sandboxes');
    })();
    return this.rootPromise;
  }
  has(id) { return this.jobs.has(id); }
  status(id, revision) {
    const job = this.jobs.get(id);
    if (!job) throw err('not-found', '自定义任务不存在');
    if (revision === job.revision) return { id, revision, unchanged: true };
    return { id, revision: job.revision, status: job.status, finishedAt: job.finishedAt, runs: job.runs.map(publicRun) };
  }
  touch(job) { job.revision += 1; this.onTouch?.(job); }
  async save(data) {
    if (this.disposed || this.removed.has(data.recordId)) return;
    const snapshot = copy(data);
    const previous = this.writes.get(data.id) ?? Promise.resolve();
    const work = previous.catch(() => {}).then(async () => {
      if (!this.disposed && !this.removed.has(data.recordId)) await (await this.ready).table('custom_runs').put(data.id, snapshot);
    });
    const settled = work;
    this.writes.set(data.id, settled);
    try { await settled; } finally { if (this.writes.get(data.id) === settled) this.writes.delete(data.id); }
  }
  makeJob(id, record, attempt, runs) {
    return { id, record, attemptId: attempt.id, revision: attempt.custom?.revision ?? 1, status: 'running', finishedAt: null, bound: false, admitting: false, controller: new AbortController(), active: new Map(), slotBusy: new Set(), options: { concurrency: 2, timeoutMs: 180_000, ...record.options }, runs };
  }
  activate(id) {
    const job = this.jobs.get(id);
    if (job) job.bound = true;
    this.pump();
  }
  async start(record, attempt) {
    await this.ready;
    if (this.disposed || this.removed.has(record.id)) throw err('disposed', '任务正在结束');
    if (!record.prompt?.trim()) throw err('empty-prompt', '请填写自定义测试提示词');
    if (record.models.some(model => model.relay && !record.a6api)) throw err('invalid-target', '渠道模型必须从 a6api 专项入口创建');
    if (record.a6api) { await this.a6().config(); this.a6().assertAccount(record.a6api); }
    {
      const native = record.models.filter(model => !model.a6api);
      const llm = this.ctx.get('llm');
      if (native.length && !llm) throw err('llm-unavailable', '模型服务不可用');
      for (const model of native) {
        const models = await llm.listModels(model.provider);
        if (!models.some(item => item.id === model.id)) throw err('model-unavailable', '所选模型已不在当前提供商目录中，请重新选择');
      }
    }
    const id = `custom-${randomUUID()}`;
    const job = this.makeJob(id, record, attempt, []);
    for (const model of record.models) {
      const runId = randomUUID();
      const target = { kind: model.a6api ? 'a6api' : 'dsh', providerId: model.provider, modelId: model.id, displayName: model.name || model.id, ...(model.a6api ? { channelId: model.a6api.channelId, supplierId: model.a6api.supplierId, listingId: model.a6api.listingId, marketSnapshot: model.a6api.market ?? null } : {}) };
      const data = { id: runId, recordId: record.id, attemptId: attempt.id, jobId: id, root: null, revision: 1, events: [], requests: [], summary: { id: runId, target, phase: 'queued', sessionId: null, sandboxState: 'preparing', eventCount: 0, startedAt: null, updatedAt: Date.now(), finishedAt: null, output: { state: 'none', relativePath: null, size: null, modifiedAt: null, validation: 'pending' }, usage: emptyUsage(), metrics: emptyMetrics(), error: null } };
      job.runs.push(data); await this.save(data);
    }
    this.jobs.set(id, job);
    // RecordsService explicitly starts the scheduler after persisting the attempt/job mapping.
    return this.status(id);
  }
  update(job, data, phase) {
    if (phase) data.summary.phase = phase;
    data.revision += 1; data.summary.updatedAt = Date.now(); this.touch(job);
  }
  saveSoon(data) {
    if (!this.timers.has(data.id)) this.timers.set(data.id, setTimeout(() => { this.timers.delete(data.id); void this.save(data).catch(() => {}); }, 500));
  }
  event(job, data, input) {
    const event = { id: `event-${randomUUID()}`, at: known(input.at) ?? Date.now(), type: input.type, role:input.role ?? null, delta:input.delta === true, phase:input.phase ?? null, name:input.name ?? null, callId:input.callId ?? null, executionId:input.executionId ?? null, turn:Number.isInteger(input.turn) ? input.turn : null, step:Number.isInteger(input.step) ? input.step : null, index:Number.isInteger(input.index) ? input.index : null, text:typeof input.text === 'string' ? input.text.slice(0,32000) : (input.type === 'error' && typeof input.message === 'string' ? input.message.slice(0, 800) : null), ...(input.type === 'error' && typeof input.code === 'string' ? {code: input.code.slice(0, 64)} : {}), ...(input.type === 'error' && input.detail ? {detail: input.detail} : {}), ...(input.content !== undefined ? {content:JSON.stringify(input.content).slice(0,32000)} : {}), ...(input.arguments !== undefined ? {arguments:JSON.stringify(input.arguments).slice(0,32000)} : {}), isError:input.isError === true || input.type === 'error' };
    // Keep bounded durable events; coalesce adjacent text deltas.
    if (typeof event.text === 'string') event.text = event.text.slice(0, 100_000);
    const previous = data.events.at(-1);
    if (event.delta && previous?.delta && previous.type === event.type && previous.role === event.role && previous.executionId === event.executionId && previous.index === event.index && (previous.text?.length ?? 0) < 100_000) previous.text = `${previous.text ?? ''}${event.text ?? ''}`.slice(0, 100_000);
    else data.events.push(event);
    // Any streamed delta (text, reasoning or tool) pins the first-delta latency of its own request row.
    if (event.delta) {
      const row = findRequest(data, event.executionId);
      if (row && (row.firstDeltaMs ?? null) === null && Number.isFinite(event.at) && Number.isFinite(row.startedAt)) row.firstDeltaMs = Math.max(0, event.at - row.startedAt);
    }
    if (data.events.length > 500) data.events.splice(0, data.events.length - 500);
    while (data.events.length > 1 && JSON.stringify(data.events).length > 500000) data.events.shift();
    data.summary.eventCount += 1;
    if (event.type === 'tool') data.summary.phase = event.phase === 'call' ? 'tooling' : 'running';
    this.update(job, data);
    this.saveSoon(data);
  }
  settle(job) {
    if (job.admitting || job.status !== 'running' || job.active.size || !job.runs.every(item => END.has(item.summary.phase))) return;
    job.status = job.controller.signal.aborted || job.runs.every(item => item.summary.phase === 'cancelled') ? 'cancelled' : job.runs.some(item => item.summary.phase === 'completed') ? 'done' : 'failed';
    job.finishedAt = Date.now(); this.touch(job); this.onSettled?.(job);
  }
  pump() {
    if (this.closing || this.disposed) return;
    for (const job of this.jobs.values()) {
      if (this.removed.has(job.record.id) || !job.bound || job.status !== 'running' || job.admitting) continue;
      this.settle(job);
      if (job.status !== 'running' || job.controller.signal.aborted) continue;
      const limit = Math.min(MAX_MODELS, Math.max(1, job.options.concurrency));
      while (this.active < MAX_MODELS && job.active.size < limit) {
        const availableSlot = job.record.a6api?.slots.find(item => !job.slotBusy.has(item.tokenId));
        const data = job.runs.find(item => item.summary.phase === 'queued' && !job.active.has(item.id) && (item.summary.target.kind !== 'a6api' || availableSlot));
        if (!data) break;
        const slot = data.summary.target.kind === 'a6api' ? availableSlot : null;
        if (slot) job.slotBusy.add(slot.tokenId);
        this.active += 1;
        const control = { controller: new AbortController(), timer: null, promise: null, resume: data.resumeQueued === true };
        job.active.set(data.id, control);
        control.promise = this.run(job, data, slot, control).catch(() => {}).finally(() => {
          this.active -= 1; job.active.delete(data.id); if (slot) job.slotBusy.delete(slot.tokenId);
          this.settle(job);
          this.pump();
        });
      }
    }
  }
  armTimeout(job, data, control) {
    const requestedDeadline = (control.startedAt ?? data.summary.startedAt) + job.options.timeoutMs;
    if (control.deadlineAt !== undefined && requestedDeadline <= control.deadlineAt) return;
    control.deadlineAt = requestedDeadline;
    clearTimeout(control.timer);
    control.timer = setTimeout(() => { control.timeout = true; control.controller.abort(); }, Math.max(1, control.deadlineAt - Date.now()));
  }
  aggregate(data) {
    const rows = data.requests;
    const usage = emptyUsage(); usage.requestCount = rows.length;
    for (const key of ['inputTokens', 'inputTotalTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'cost']) usage[key] = sum(rows.map(row => known(row.usage[key])));
    usage.currency = rows.length && rows.every(row => row.usage.currency === rows[0].usage.currency) ? rows[0].usage.currency : null;
    usage.billingState = rows.some(row => row.billingState === 'ambiguous') ? 'ambiguous' : rows.length && rows.every(row => row.billingState === 'settled') ? 'settled' : rows.some(row => row.billingState === 'settled') ? 'partial' : rows.length && data.summary.target.kind === 'a6api' ? 'pending' : 'unknown';
    data.summary.usage = usage;
    const metrics = emptyMetrics();
    for (const key of Object.keys(metrics)) metrics[key] = mean(rows.map(row => known(row.metrics[key])));
    data.summary.metrics = metrics;
  }
  async run(job, data, slot, control) {
    const signal = control.controller.signal;
    const abort = () => control.controller.abort();
    job.controller.signal.addEventListener('abort', abort, { once: true });
    if (job.controller.signal.aborted) abort();
    const handles = new Map(); const heldRequests = new Set();
    const openTools = new Map();
    let stopAt = null;
    const stopTiming = () => {
      stopAt = Date.now();
      for (const row of data.requests) {
        const timing = row.timing;
        if (timing && ((row.status === 'running' && timing.streamEndedAt === undefined) || timing.tools.some(tool => tool.endedAt === null))) timing.cancelledAt ??= stopAt;
      }
      this.update(job, data); this.saveSoon(data);
    };
    signal.addEventListener('abort', stopTiming, { once: true });
    const onEvent = event => {
      if (event.type === 'tool' && event.callId && event.executionId) {
        const timing = findRequest(data, event.executionId)?.timing;
        if (timing && event.phase === 'call' && !openTools.has(event.callId) && (stopAt === null || event.at < stopAt)) {
          const tool = { startedAt: event.at, endedAt: null };
          timing.tools.push(tool);
          if (stopAt !== null) timing.cancelledAt ??= stopAt;
          openTools.set(event.callId, { tool, timing });
        } else if (event.phase === 'result') {
          const tool = openTools.get(event.callId)?.tool;
          if (tool && (stopAt === null || event.at <= stopAt)) tool.endedAt = event.at;
          openTools.delete(event.callId);
        }
      }
      this.event(job, data, event);
    };
    let identity, lockHeld = false, attemptedPin = false, sandbox, target;
    // A continuation resumes the same DSH session and sandbox; a fresh run creates both.
    const resume = control.resume;
    let submitted = false;
    const onSubmitted = () => {
      submitted = true;
      if (!resume) return;
      delete data.resumeQueued;
      data.summary.error = null;
      data.summary.resumeError = null;
      data.summary.continuations = (data.summary.continuations ?? 0) + 1;
      this.update(job, data); this.saveSoon(data);
    };
    control.startedAt = Date.now();
    if (!resume) { data.summary.startedAt = control.startedAt; data.summary.sessionId = `mit-${randomUUID()}`; }
    this.armTimeout(job, data, control); this.update(job, data, 'preparing');
    const checked = () => { if (signal.aborted || this.disposed || this.removed.has(data.recordId)) throw err('cancelled', '任务已取消'); };
    const onRequest = {
      start: async meta => {
        checked();
        if (!await this.capacity.acquire(signal, 1)) throw err('cancelled', '请求等待已取消');
        heldRequests.add(meta.id);
        let handle = null;
        try {
          checked();
          if (slot) {
            handle = await this.ledger.begin({ recordId: data.recordId, attemptId: data.attemptId, jobId: job.id, accountId: job.record.a6api.accountId, siteOrigin: job.record.a6api.siteOrigin, provider: data.summary.target.providerId, model: data.summary.target.modelId, tokenId: slot.tokenId, intendedChannelId: data.summary.target.channelId, challengeIndex: null });
            if (!handle) throw err('ledger-unavailable', '请求账本未准备好，未发送模型请求');
            handles.set(meta.id, handle);
            await this.ledger.dispatch(handle);
          }
          // The steps view needs the Agent position and the cause that produced this request row.
          // The Agent reports the exact turn/step it is preparing; persisted events are only the fallback.
          const observed = latestTurnStep(data.events);
          const position = { turn: Number.isInteger(meta.turn) ? meta.turn : observed.turn, step: Number.isInteger(meta.step) ? meta.step : observed.step };
          data.requests.push({ id: meta.id, executionId: handle?.id ?? null, requestId: null, status: 'running', startedAt: meta.startedAt, finishedAt: null, turn: position.turn, step: position.step, firstDeltaMs: null, timing: { tools: [] }, trigger: latestTrigger(data.events), usage: { inputTokens: null, inputTotalTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, cost: null, currency: null }, metrics: emptyMetrics(), billingState: slot ? 'pending' : 'unknown' });
          this.aggregate(data); this.update(job, data, 'running'); await this.save(data);
          return meta.id;
        } catch (error) { if (heldRequests.delete(meta.id)) this.capacity.release(1); throw error; }
      },
      progress: (id, stamps) => {
        const row = findRequest(data, id);
        if (!row?.timing || signal.aborted) return;
        Object.assign(row.timing, stamps);
        this.update(job, data); this.saveSoon(data);
      },
      metadata: async (id, meta) => {
        const row = data.requests.find(item => item.id === id); if (!row) return;
        row.requestId = meta.requestId ?? row.requestId; row.httpStatus = meta.httpStatus ?? null;
        if (handles.has(id)) await this.ledger.metadata(handles.get(id), meta);
      },
      usage: async (id, usage) => {
        const row = data.requests.find(item => item.id === id); if (!row) return;
        const { streamUsageFrames, ...canonicalUsage } = usage ?? {};
        row.streamUsage = copy(canonicalUsage);
        row.streamUsageFrames = Array.isArray(streamUsageFrames) ? copy(streamUsageFrames).slice(-32) : [];
        row.usage = { ...row.usage, inputTokens: known(usage?.inputTokens), inputTotalTokens: known(usage?.inputTotalTokens) ?? (known(usage?.inputTokens) !== null && known(usage?.cacheReadTokens) !== null ? usage.inputTokens + usage.cacheReadTokens + (known(usage?.cacheWriteTokens) ?? 0) : null), outputTokens: known(usage?.outputTokens), cacheReadTokens: known(usage?.cacheReadTokens), cacheWriteTokens: known(usage?.cacheWriteTokens), cost: known(usage?.cost), currency: usage?.currency ?? null };
        this.aggregate(data); this.update(job, data);
      },
      finish: async (id, finish) => {
        try {
          if (finish.usage) await onRequest.usage(id, finish.usage);
          const row = data.requests.find(item => item.id === id);
          if (row) {
            row.status = finish.status; row.finishedAt = finish.finishedAt; row.finishReason = finish.finishReason ?? null;
            row.error = finish.error ? { code: finish.error.code ?? null, message: finish.error.message ?? '', ...(finish.error.status ? { status: finish.error.status } : {}), detail: finish.error.detail ?? null } : null;
            const duration = known(finish.durationMs); const generation = known(finish.generationMs); const output = row.usage.outputTokens;
            row.metrics = { ttftMs: known(finish.firstTokenMs), generationMs: generation, e2eMs: duration, modelTokensPerSecond: output !== null && generation > 0 ? output * 1000 / generation : null, endToEndTokensPerSecond: output !== null && duration > 0 ? output * 1000 / duration : null, cacheRate: row.usage.cacheReadTokens !== null && row.usage.inputTotalTokens > 0 ? Math.min(1, row.usage.cacheReadTokens / row.usage.inputTotalTokens) : null };
            if (handles.has(id)) await this.ledger.finish(handles.get(id), { state: finish.status, finishKind: finish.finishReason, streamUsage: row.streamUsage });
            handles.delete(id); this.aggregate(data); this.update(job, data); await this.save(data);
          }
        } finally { if (heldRequests.delete(id)) this.capacity.release(1); }
      },
    };
    try {
      checked();
      const onFile = event => { this.event(job, data, { type: 'tool', phase: 'result', name: 'sandbox_file', text: JSON.stringify(event) }); };
      sandbox = resume ? await openSandbox({ root: data.root, onFile, signal }) : await createSandbox({ dataRoot: await this.dataRoot(), runId: data.id, prompt: job.record.prompt, preset: job.record.preset, signal, onFile });
      data.root = sandbox.root; data.summary.sandboxState = 'ready'; await this.save(data);
      if (resume && !await this.recoveryAvailable(data, sandbox.root)) throw err('resume-unavailable', '原会话已不可恢复，请使用重试');
      checked();
      let stream;
      if (slot) {
        await this.a6().config(); this.a6().assertAccount(job.record.a6api);
        identity = tokenIdentity(job.record.a6api, slot.tokenId);
        if (!await this.capacity.tokenSlots.acquire(identity, signal)) throw err('cancelled', '令牌等待已取消');
        lockHeld = true;
        checked(); await this.a6().assertTestSlot(slot.tokenId, job.record.a6api); checked();
        const key = await this.a6().key(slot.tokenId); checked();
        target = { tokenId: slot.tokenId, model: data.summary.target.modelId, channelId: data.summary.target.channelId };
        attemptedPin = true;
        const pin = await this.a6().site.pin(target);
        if (!pin.routeEffective) throw err('pin-unverified', '固定渠道未读回生效，未发送模型请求');
        const model = job.record.models.find(model => model.provider === data.summary.target.providerId && model.id === data.summary.target.modelId && model.a6api?.channelId === target.channelId);
        checked(); stream = createA6Stream({ key, api: model?.relay?.api ?? 'openai-completions' });
      }
      this.update(job, data, 'running');
      const result = await executeSession(this.ctx, { sessionId: data.summary.sessionId, provider: slot ? `mit-a6-${data.id}` : data.summary.target.providerId, model: data.summary.target.modelId, prompt: resume ? 'continue' : job.record.prompt, resume, systemPrompt: sandbox.systemPrompt, sandbox, signal, limits: { maxRequests: 24, maxSteps: 24, maxToolCalls: 96, maxTokens: 8192, maxDurationMs: job.options.timeoutMs }, onRequest, onEvent, onSubmitted, stream });
      checked(); this.update(job, data, 'validating');
      data.summary.output = await sandbox.output();
      if (!submitted || result.outcome !== 'completed') {
        const detail = result.error ? `${result.error.code}: ${result.error.message}` : '';
        const failure = err('session-failed', result.outcome === 'limited' ? '会话已达到执行预算' : `模型会话未完成${detail ? `（${detail}）` : ''}`);
        failure.detail = result.error?.detail ?? null;
        throw failure;
      }
      if (data.summary.output.state !== 'ready') throw err('output-invalid', '会话已结束，但未声明有效输出文件');
      this.update(job, data, 'completed');
    } catch (error) {
      if (data.summary.sandboxState === 'preparing') data.summary.sandboxState = 'failed';
      const phase = signal.aborted ? (control.timeout ? 'failed' : 'cancelled') : 'failed';
      const detail = error?.detail ?? errorDetail(error);
      const raw = clipLine(detail?.message, 240);
      const failure = summaryError(control.timeout ? 'timeout' : signal.aborted ? 'cancelled' : error instanceof FingerprintError ? error.code : 'execution-failed', control.timeout ? '模型会话超时' : signal.aborted ? '任务已取消' : error instanceof FingerprintError ? error.message : `模型会话执行失败${raw ? `（${raw}）` : ''}`, data.summary.phase, detail);
      if (resume && !submitted) data.summary.resumeError = failure;
      else data.summary.error = failure;
      delete data.resumeQueued;
      this.update(job, data, phase);
    } finally {
      clearTimeout(control.timer); job.controller.signal.removeEventListener('abort', abort); signal.removeEventListener('abort', stopTiming);
      for (const [id, handle] of handles) await this.ledger.finish(handle, { state: 'cancelled', finishKind: 'interrupted', streamUsage: data.requests.find(row => row.id === id)?.streamUsage }).catch(() => {});
      for (const id of heldRequests) { this.capacity.release(1); heldRequests.delete(id); }
      if (attemptedPin && target) {
        try {
          await this.a6().site.unpin(target);
          if ((await this.a6().site.pins()).some(pin => pin.tokenId === target.tokenId && pin.model === target.model && pin.channelId === target.channelId)) throw err('restore-failed', '固定仍未解除');
        } catch {
          data.summary.phase = 'failed'; data.summary.error = { code: 'restore-failed', message: '测试固定关系未能确认解除，请在站点手工检查；该任务已停止领取模型', phase: 'cleanup' };
          this.cancel(job.id);
        }
      }
      // Release only a lock this run successfully acquired.
      if (lockHeld) this.capacity.tokenSlots.release(identity);
      if (sandbox) { try { data.summary.output = await sandbox.output(); } catch { data.summary.output.validation = 'unknown'; } }
      for (const { timing } of openTools.values()) timing.toolsClosed = true;
      for (const row of data.requests) if (row.status === 'running') {row.status = signal.aborted ? 'cancelled' : 'failed'; row.finishedAt=Date.now();}
      clearTimeout(this.timers.get(data.id)); this.timers.delete(data.id);
      data.summary.finishedAt = Date.now(); this.aggregate(data); this.update(job, data); await this.save(data);
    }
  }
  async recoveryAvailable(data, root = data.root) {
    if (!data.summary.sessionId || !root || data.summary.sandboxState !== 'ready') return false;
    const persistence = this.ctx.get('sessionPersistence');
    const agents = this.ctx.get('agents');
    if (!persistence?.stat || !agents?.resume) return false;
    const saved = await persistence.stat(data.summary.sessionId, { signal: AbortSignal.timeout(5_000) });
    return Boolean(saved?.location && saved.formatStatus !== 'migration-required' && saved.header?.id === data.summary.sessionId && saved.header.cwd === root);
  }
  /** Called under the record's launch lock. Nothing is runnable until both snapshots are durable. */
  async continueRun({ record, attempt, runId, bind }) {
    const data = await this.load(attempt.id, runId);
    const existing = attempt.jobId ? this.jobs.get(attempt.jobId) : null;
    if (this.closing || this.disposed || this.removed.has(record.id) || !RESUMABLE.has(data.summary.phase) || existing?.active.has(runId) || (existing?.controller.signal.aborted && existing.active.size)) {
      throw err('not-resumable', '此模型仍在运行、清理或已经排队，暂不能继续');
    }
    let available = false;
    try {
      if (data.root) {
        const sandbox = await openSandbox({ root: data.root });
        available = await this.recoveryAvailable(data, sandbox.root);
      }
    } catch { throw err('resume-unavailable', '无法读取原会话或沙箱，请检查后重试'); }
    if (!available) throw err('not-resumable', '原会话未持久化、已迁移或与沙箱不一致，请使用重试');
    if (data.summary.target.kind === 'a6api' && !record.a6api?.slots.length) throw err('slot-missing', '原轮次没有可用的测试令牌');
    const domain = await this.ready;
    const rows = existing?.runs ?? [...domain.table('custom_runs').entries()].map(([, run]) => run).filter(run => run.attemptId === attempt.id && run.recordId === record.id);
    const job = existing ?? this.makeJob(`custom-${randomUUID()}`, record, attempt, rows);
    const index = job.runs.findIndex(item => item.id === runId);
    if (index < 0) throw err('not-found', '原轮次未找到此模型运行');
    if (this.closing || this.disposed || this.removed.has(record.id) || job.active.has(runId) || (job.controller.signal.aborted && job.active.size) || !RESUMABLE.has(job.runs[index].summary.phase)) throw err('not-resumable', '此模型当前不能继续');
    const queued = copy(job.runs[index]);
    Object.assign(queued, { jobId: job.id, resumeQueued: true, revision: queued.revision + 1 });
    Object.assign(queued.summary, { phase: 'queued', finishedAt: null, updatedAt: Date.now(), resumeError: null, canContinue: false });
    const wasAborted = job.controller.signal.aborted;
    job.admitting = true;
    try {
      await this.save(queued);
      if (!wasAborted && job.controller.signal.aborted) throw err('task-cancelled', '本轮已停止，未重新启动此模型');
      await bind(job.id, job.runs.map((item, i) => publicRun(i === index ? queued : item)), job.revision + 1);
      job.runs[index] = queued;
      job.record = record;
      job.options = { ...job.options, ...record.options };
      if (wasAborted) job.controller = new AbortController();
      job.status = 'running'; job.finishedAt = null;
      this.jobs.set(job.id, job);
      if (job.controller.signal.aborted) await this.cancelQueued(job, queued).catch(() => {});
      this.touch(job);
    } catch (error) {
      // A saved queue entry is never dispatched if the attempt binding failed.
      await this.save(job.runs[index]).catch(() => {});
      throw error;
    } finally {
      job.admitting = false;
      this.pump();
    }
    const accepted = publicRun(queued);
    this.activate(job.id);
    return accepted;
  }
  /**
   * In-place retry for a run that died before (or instead of) producing a resumable session: the same
   * run id is reset to a fresh session and sandbox inside its original attempt. Earlier requests stay in
   * the ledger for reconciliation; only a short failure trail is kept on the summary.
   * Called under the record's launch lock. Nothing is runnable until both snapshots are durable.
   */
  async rerunRun({ record, attempt, runId, bind }) {
    const data = await this.load(attempt.id, runId);
    const existing = attempt.jobId ? this.jobs.get(attempt.jobId) : null;
    const blocked = job => this.closing || this.disposed || this.removed.has(record.id) || job?.active.has(runId) || (job?.controller.signal.aborted && job.active.size);
    if (blocked(existing) || !RESUMABLE.has(data.summary.phase)) throw err('not-retryable', '此模型仍在运行、清理或已经排队，暂不能重试');
    const target = data.summary.target;
    const model = record.models.find(item => item.provider === target.providerId && item.id === target.modelId && (target.kind !== 'a6api' || item.a6api?.channelId === target.channelId));
    if (!model) throw err('invalid-model', '模型不属于该记录或渠道身份不唯一');
    if (target.kind === 'a6api' && !record.a6api?.slots.length) throw err('slot-missing', '原轮次没有可用的测试令牌');
    const domain = await this.ready;
    const rows = existing?.runs ?? [...domain.table('custom_runs').entries()].map(([, run]) => run).filter(run => run.attemptId === attempt.id && run.recordId === record.id);
    const job = existing ?? this.makeJob(`custom-${randomUUID()}`, record, attempt, rows);
    const index = job.runs.findIndex(item => item.id === runId);
    if (index < 0) throw err('not-found', '原轮次未找到此模型运行');
    if (blocked(job) || !RESUMABLE.has(job.runs[index].summary.phase)) throw err('not-retryable', '此模型当前不能重试');
    const previous = job.runs[index];
    // The sandbox directory is named after the run id, so the old one must go before a fresh one can exist.
    try { await removeSandbox({ root: previous.root || path.join(await this.dataRoot(), runId), expectedRunId: runId }); }
    catch { throw err('sandbox-cleanup-failed', '旧沙箱未能清理，未重新启动此模型'); }
    const now = Date.now();
    const failure = previous.summary.error ?? previous.summary.resumeError ?? null;
    const trail = { at: now, phase: previous.summary.phase, code: failure?.code ?? null, message: failure?.message ?? null, startedAt: previous.summary.startedAt, finishedAt: previous.summary.finishedAt, requestCount: previous.requests.length, executionIds: previous.requests.map(row => row.executionId).filter(Boolean).slice(-24) };
    const queued = copy(previous);
    delete queued.resumeQueued;
    Object.assign(queued, { jobId: job.id, root: null, events: [], requests: [], revision: queued.revision + 1 });
    queued.summary = {
      ...queued.summary, phase: 'queued', sessionId: null, sandboxState: 'preparing', eventCount: 0, startedAt: null, updatedAt: now, finishedAt: null,
      output: { state: 'none', relativePath: null, size: null, modifiedAt: null, validation: 'pending' }, usage: emptyUsage(), metrics: emptyMetrics(),
      error: null, resumeError: null, canContinue: false, continuations: 0, retries: (queued.summary.retries ?? 0) + 1, retryHistory: [...(queued.summary.retryHistory ?? []), trail].slice(-10),
    };
    const wasAborted = job.controller.signal.aborted;
    job.admitting = true;
    try {
      await this.save(queued);
      if (!wasAborted && job.controller.signal.aborted) throw err('task-cancelled', '本轮已停止，未重新启动此模型');
      await bind(job.id, job.runs.map((item, i) => publicRun(i === index ? queued : item)), job.revision + 1);
      job.runs[index] = queued;
      job.record = record;
      job.options = { ...job.options, ...record.options };
      if (wasAborted) job.controller = new AbortController();
      job.status = 'running'; job.finishedAt = null;
      this.jobs.set(job.id, job);
      if (job.controller.signal.aborted) await this.cancelQueued(job, queued).catch(() => {});
      this.touch(job);
    } catch (error) {
      // A saved queue entry is never dispatched if the attempt binding failed; keep the old failure visible.
      // The old sandbox is already gone, so the run can no longer be continued either.
      previous.root = null; previous.summary.sandboxState = 'unknown'; previous.summary.canContinue = false;
      await this.save(previous).catch(() => {});
      throw error;
    } finally {
      job.admitting = false;
      this.pump();
    }
    const accepted = publicRun(queued);
    this.activate(job.id);
    return accepted;
  }
  cancelQueued(job, data) {
    delete data.resumeQueued;
    data.summary.finishedAt = Date.now();
    this.update(job, data, 'cancelled');
    return this.save(data);
  }
  async cancelRun({ attemptId, runId, jobId }) {
    const data = await this.load(attemptId, runId);
    const job = this.jobs.get(jobId);
    if (!job || !job.runs.includes(data)) {
      if (END.has(data.summary.phase)) return publicRun(data);
      throw err('not-running', '此模型运行当前未由调度器管理');
    }
    const control = job.active.get(runId);
    if (control) control.controller.abort();
    else if (data.summary.phase === 'queued') await this.cancelQueued(job, data);
    this.pump();
    return publicRun(data);
  }
  cancel(id) {
    const job = this.jobs.get(id); if (!job || job.status !== 'running') return;
    job.controller.abort();
    for (const data of job.runs) if (data.summary.phase === 'queued') void this.cancelQueued(job, data).catch(() => {});
    if (job.bound && !this.removed.has(job.record.id)) this.settle(job);
    this.pump();
  }
  configure(id, options) {
    const job = this.jobs.get(id); if (!job) return;
    job.options = { ...job.options, ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)) };
    for (const [runId, control] of job.active) this.armTimeout(job, job.runs.find(data => data.id === runId), control);
    this.touch(job); this.pump();
  }
  async drain(id) { const job = this.jobs.get(id); if (job) await Promise.allSettled([...job.active.values()].map(item => item.promise)); }
  async load(attemptId, runId) {
    const domain = await this.ready;
    if (!domain.table('attempts').get(attemptId)) throw err('not-found', '测试轮次不存在');
    const data = [...this.jobs.values()].flatMap(job => job.runs).find(run => run.id === runId) ?? domain.table('custom_runs').get(runId);
    if (!data || data.attemptId !== attemptId || this.removed.has(data.recordId) || !domain.table('records').get(data.recordId)) throw err('not-found', '此模型运行不属于该轮次或已删除');
    return data;
  }
  applyLedgerBilling(data, run, requests, rows) {
    if (data.summary.target.kind !== 'a6api') return;
    for (const request of requests) {
      const row = rows.get(request.executionId); if (!row) continue;
      request.billingState = row.billingState === 'reconciled' ? 'settled'
        : row.billingState === 'observed' ? 'observed'
          : row.billingState === 'ambiguous' ? 'ambiguous'
            : ['not-sent', 'unattributed', 'unavailable', 'deferred'].includes(row.billingState) ? 'unknown' : 'pending';
      request.usage.inputTokens = known(row.inputTokens) ?? request.usage.inputTokens;
      request.usage.inputTotalTokens = known(request.usage.inputTotalTokens) ?? known(row.inputTokens);
      request.usage.outputTokens = known(row.outputTokens) ?? request.usage.outputTokens;
      request.usage.cacheReadTokens = known(row.cacheReadTokens) ?? request.usage.cacheReadTokens;
      const costCny = known(row.billing?.costCny ?? row.costCny);
      if (costCny !== null) { request.usage.cost = costCny; request.usage.currency = 'CNY'; }
    }
    for (const key of ['inputTokens', 'inputTotalTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']) run.usage[key] = sum(requests.map(request => known(request.usage[key])));
    run.usage.requestCount = requests.length;
    run.usage.currency = requests.length && requests.every(request => request.usage.currency === requests[0].usage.currency) ? requests[0].usage.currency : null;
    const charged = requests.filter(request => request.usage.cost !== null && request.usage.currency === 'CNY');
    run.usage.cost = charged.length ? charged.reduce((total, request) => total + request.usage.cost, 0) : null;
    run.usage.currency = charged.length ? 'CNY' : null;
    run.metrics.cacheRate = run.usage.cacheReadTokens !== null && run.usage.inputTotalTokens !== null && run.usage.inputTotalTokens > 0 ? Math.min(1, run.usage.cacheReadTokens / run.usage.inputTotalTokens) : null;
    run.usage.billingState = requests.some(request => request.billingState === 'ambiguous') ? 'ambiguous'
      : requests.length && requests.every(request => request.billingState === 'settled') ? 'settled'
        : requests.some(request => ['settled', 'observed'].includes(request.billingState)) ? 'partial'
          : requests.some(request => request.billingState === 'pending') ? 'pending' : 'unknown';
  }
  async projectAttempt(attemptId, summaries) {
    const domain = await this.ready;
    const resolved = (summaries ?? []).map(summary => ({ summary, data: [...this.jobs.values()].flatMap(job => job.runs).find(item => item.id === summary.id)
      ?? domain.table('custom_runs').get(summary.id) })).map(item => ({ ...item, data: item.data?.attemptId === attemptId ? item.data : null }));
    const hasA6 = resolved.some(({ data }) => data?.summary?.target?.kind === 'a6api');
    const rows = hasA6 && this.ledger ? new Map(((await this.ledger.view({ attemptId })).executions ?? []).map(item => [item.id, item])) : new Map();
    const projected = resolved.map(({ summary, data }) => {
      if (!data?.summary?.target) return copy(summary);
      const run = publicRun(data);
      this.applyLedgerBilling(data, run, copy(data.requests), rows);
      return run;
    });
    return { runs: projected, billingPending: projected.some(run => ['pending', 'partial'].includes(run.usage?.billingState)) };
  }
  async detail({ attemptId, runId }) {
    const data = await this.load(attemptId, runId);
    const requests = copy(data.requests);
    const run = publicRun(data);
    const revision = data.revision;
    const events = copy(data.events);
    if (data.summary.target.kind === 'a6api') {
      const ledger = await this.ledger.view({ attemptId });
      const rows = new Map((ledger.executions ?? []).map(item => [item.id, item]));
      this.applyLedgerBilling(data, run, requests, rows);
    }
    const job = this.jobs.get(data.jobId);
    run.cleanupPending = RESUMABLE.has(run.phase) && Boolean(job?.active.has(runId) || (job?.controller.signal.aborted && job.active.size));
    let files = [];
    run.canContinue = false;
    if (data.root) {
      try {
        const sandbox = await openSandbox({ root: data.root });
        files = await sandbox.files();
        if (RESUMABLE.has(run.phase) && !run.cleanupPending && !this.closing) {
          run.canContinue = await this.recoveryAvailable(data, sandbox.root);
        }
      } catch { /* Missing or unreadable local data cannot be resumed. */ }
    }
    return { run, events, requests: requests.slice(-REQUEST_CAP), files, revision, permissions: { allowed: ['sandbox.readRules', 'sandbox.readInput', 'sandbox.readFile', 'sandbox.listFiles', 'sandbox.writeFile', 'sandbox.statFile', 'sandbox.declareOutput'], denied: ['network', 'shell', 'browser', 'workspace', 'credentials', 'provider.configure'] }, metricBoundary: '请求数按 DSH 可观测模型调用计；提供商 SDK 内部 HTTP 重试可能无法单独观察。', eventsTruncated: run.eventCount > events.length, ...(requests.length > REQUEST_CAP ? { requestsTruncated: true } : {}) };
  }
  async read({ attemptId, runId, path: file }) {
    const data = await this.load(attemptId, runId); if (!data.root) throw err('sandbox-unavailable', '沙箱尚未就绪');
    return (await openSandbox({ root: data.root })).read(file);
  }
  async open({ attemptId, runId, mode = 'preview', application, title }) {
    const data = await this.load(attemptId, runId); if (!data.root) throw err('sandbox-unavailable', '沙箱尚未就绪');
    const sandbox = await openSandbox({ root: data.root });
    const output = await sandbox.output();
    if (output.state !== 'ready') throw err('output-invalid', '输出文件不存在或未通过验证');
    if (mode === 'webview') {
      const preview = await sandbox.preview();
      if (!preview) throw err('preview-unavailable', '此输出类型不支持 WebView 预览，请在文件中查看');
      const launched = await launchWebViewWindow({ html: preview.html, title });
      if (launched.opened) return { opened: true, path: output.relativePath };
      let opener; try { opener = this.ctx.get('sessionController'); } catch { opener = null; }
      if (opener?.openWorkspacePath && opener.canOpenWorkspacePath?.()) {
        const opened = await opener.openWorkspacePath({ path: launched.filePath });
        return { ...opened, path: output.relativePath };
      }
      return { opened: false, path: output.relativePath };
    }
    if (mode === 'vscode' || mode === 'reveal') {
      let opener; try { opener = this.ctx.get('sessionController'); } catch { opener = null; }
      if (!opener?.openWorkspacePath || !opener.canOpenWorkspacePath?.()) throw err('opener-unavailable', '当前运行时不是桌面版，无法在本机应用中打开文件');
      const filename = path.join(sandbox.root, output.relativePath);
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        if (mode === 'reveal') { const opened = await opener.openWorkspacePath({ path: filename, action: 'reveal' }, controller.signal); return { ...opened, path: output.relativePath }; }
        const apps = (await opener.workspacePathApplications({ path: filename }, controller.signal)).map(item => ({ id: String(item.id), name: String(item.name ?? item.id) }));
        const app = (application ? apps.find(item => item.id === application) : null) ?? apps.find(item => /visual studio code|^code$|vscode|vscodium|^code - insiders$/i.test(item.name));
        if (!app) return { opened: false, path: output.relativePath, application: null, applications: apps };
        const opened = await opener.openWorkspacePath({ path: filename, application: app.id }, controller.signal);
        return { ...opened, path: output.relativePath, application: app, applications: apps };
      } catch (error) {
        if (controller.signal.aborted) throw err('opener-timeout', '桌面应用 15 秒内没有响应');
        throw err('opener-failed', `桌面打开失败：${String(error?.message ?? error).slice(0, 300)}`);
      } finally { clearTimeout(timer); }
    }
    if (mode === 'browser') {
      let opener; try { opener = this.ctx.get('sessionController'); } catch { opener = null; }
      if (!opener?.openWorkspacePath || !opener.canOpenWorkspacePath?.()) throw err('opener-unavailable', '当前运行时不是桌面版，无法在本机浏览器中打开文件');
      const filename = path.join(sandbox.root, output.relativePath);
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const apps = (await opener.workspacePathApplications({ path: filename }, controller.signal)).map(item => ({ id: String(item.id), name: String(item.name ?? item.id) }));
        const browser = apps.find(item => /chrome|safari|firefox|edge|arc|brave|chromium|opera|vivaldi/i.test(item.name));
        const opened = await opener.openWorkspacePath({ path: filename, ...(browser ? { application: browser.id } : {}) }, controller.signal);
        return { ...opened, path: output.relativePath, application: browser ?? null, applications: apps };
      } catch (error) {
        if (controller.signal.aborted) throw err('opener-timeout', '桌面应用 15 秒内没有响应');
        throw err('opener-failed', `桌面打开失败：${String(error?.message ?? error).slice(0, 300)}`);
      } finally { clearTimeout(timer); }
    }
    const preview = await sandbox.preview();
    if (!preview) throw err('preview-unavailable', '此输出类型不支持 HTML 预览，请在文件中查看');
    return preview;
  }
  async removeRecord(recordId) {
    this.removed.add(recordId);
    try {
      const jobs = [...this.jobs.values()].filter(job => job.record.id === recordId);
      for (const job of jobs) this.cancel(job.id);
      await Promise.allSettled(jobs.map(job => this.drain(job.id)));
      await Promise.allSettled([...this.writes.values()]);
      const domain = await this.ready;
      const runs = [...domain.table('custom_runs').entries()].filter(([, run]) => run.recordId === recordId);
      if (runs.length) {
        const dataRoot = await this.dataRoot();
        for (const [id, run] of runs) {
          const runId = run.id || id;
          await removeSandbox({ root: run.root || path.join(dataRoot, runId), expectedRunId: runId });
        }
      }
      await domain.table('custom_runs').deleteMany(runs.map(([id]) => id));
      for (const job of jobs) this.jobs.delete(job.id);
    } catch (error) {
      this.removed.delete(recordId);
      throw error;
    }
  }
  stopScheduling() { this.closing = true; }
  async dispose() {
    this.stopScheduling();
    for (const job of this.jobs.values()) this.cancel(job.id);
    await Promise.allSettled([...this.jobs.keys()].map(id => this.drain(id)));
    await Promise.allSettled([...this.writes.values()]);
    for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear();
    this.disposed = true;
  }
}
