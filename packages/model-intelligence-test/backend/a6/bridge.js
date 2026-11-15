import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const PREFIX = '/mit-a6/bridge/';
const SITE_ORIGINS = new Set(['https://a6api.vip', 'https://www.a6api.vip']);
const MAX_BODY = 256_000;
const ONLINE_MS = 15_000;
const COMMAND_MS = 45_000;
const clone = value => JSON.parse(JSON.stringify(value));
const secret = () => randomBytes(32).toString('base64url');
const equal = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
export class A6Error extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function positive(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new A6Error('invalid-input', `${label}无效`);
  return value;
}
function text(value, max = 256) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new A6Error('invalid-input', '字段为空或超长');
  return value.trim();
}
export function channelOf(item) {
  return {
    listingId: Number.isSafeInteger(item?.listingId) && item.listingId >= 0 ? item.listingId : 0,
    channelId: positive(item?.channelId, '渠道 ID'),
    supplierId: Number.isSafeInteger(item?.supplierId) && item.supplierId >= 0 ? item.supplierId : 0,
    model: text(item?.model),
    ...Object.fromEntries(['supplierName', 'channelName', 'brand'].map(key => [key, typeof item?.[key] === 'string' ? item[key].slice(0, 256) : ''])),
  };
}
export function channelKey(item) { return `${item.listingId}:${item.channelId}:${item.supplierId}:${item.model}`; }
function tokensOf(input) {
  if (!Array.isArray(input) || input.length > 32) throw new A6Error('invalid-input', '测试令牌列表无效');
  const seen = new Set();
  return input.map(item => ({ id: positive(item?.id, '测试令牌 ID'), name: String(item?.name ?? '').slice(0, 120) }))
    .filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return true; });
}

/** The browser connection is deliberately narrow: a paired page may submit selections and receive
 * only owner-created pin/route/restore commands. It cannot invoke Remote, read credentials or start
 * inference. Every connection is bound to one site account and one page. */
export class A6Bridge {
  constructor({ origin = '', nativeUrl = 'dsh://open', clock = Date.now } = {}) {
    this.origin = origin.replace(/\/$/, '');
    this.nativeUrl = nativeUrl;
    this.now = clock;
    this.capability = secret();
    this.connections = new Map();
    this.selections = new Map();
    this.commands = new Map();
    this.revision = 1;
    this.disposed = false;
    this.ready = Promise.resolve();
    this.recovered = new Map();
    this.notApplied = new Set();
  }
  attachStorage(storage) {
    this.ready = storage.managed().then(domain => {
      if (!domain) throw new A6Error('storage-unavailable', 'a6api 配置存储不可用');
      this.leaseTable = domain.table('auth');
      for (const [key, value] of this.leaseTable.entries()) if (key.startsWith('lease:') && value.meta && value.command) this.recovered.set(key, value);
    });
    this.ready.catch(() => {});
  }
  recover(connection) {
    for (const [key, lease] of this.recovered) {
      if (lease.meta.accountId !== connection.accountId || lease.meta.siteOrigin !== connection.siteOrigin || lease.recovering) continue;
      lease.recovering = true;
      void this.execute({ ...lease.meta, connectionId: connection.id }, lease.command).then(result => {
        if (!result.conflict && (result.restored || result.skipped)) this.recovered.delete(key);
      }).catch(() => {}).finally(() => { lease.recovering = false; });
    }
  }
  info() {
    return {
      configuration: { origin: this.origin, capability: this.capability },
      nativeSupported: Boolean(this.nativeUrl),
      connected: [...this.connections.values()].some(connection => this.online(connection)),
      connections: [...this.connections.values()].map(connection => ({ id: connection.id, accountId: connection.accountId, siteOrigin: connection.siteOrigin, online: this.online(connection) })),
    };
  }
  online(connection) { return connection && this.now() - connection.lastSeen < ONLINE_MS; }
  launch(selectionId = '') {
    const url = new URL(this.origin || 'http://127.0.0.1');
    if (selectionId) url.hash = `mit-a6-selection=${encodeURIComponent(selectionId)}`;
    return { nativeUrl: this.nativeUrl, webUrl: url.href };
  }
  connect(input) {
    if (!SITE_ORIGINS.has(input?.siteOrigin)) throw new A6Error('wrong-origin', '仅支持 a6api 官网');
    const accountId = text(String(input?.accountId ?? ''), 32);
    if (!/^\d+$/.test(accountId)) throw new A6Error('invalid-account', 'a6api 账号 ID 无效');
    const pageId = text(input?.pageId, 128);
    // Reconnecting a page rotates its session. Old connections cannot execute new commands.
    for (const old of this.connections.values()) if (old.pageId === pageId) this.dropConnection(old.id);
    if (this.connections.size >= 32) throw new A6Error('connection-limit', '连接页面过多，请关闭不用的页面后重试');
    const connection = { id: randomUUID(), accountId, pageId, siteOrigin: input.siteOrigin, sessionToken: secret(), tokens: tokensOf(input.tokens ?? []), lastSeen: this.now() };
    this.connections.set(connection.id, connection);
    this.revision++;
    this.recover(connection);
    return { connectionId: connection.id, sessionToken: connection.sessionToken, launch: this.launch() };
  }
  authenticate(input, sessionToken) {
    const connection = this.connections.get(input?.connectionId);
    if (!connection || !equal(connection.sessionToken, sessionToken) || String(input?.accountId) !== connection.accountId) throw new A6Error('not-paired', '页面未配对或账号已变更，请重新连接');
    connection.lastSeen = this.now();
    return connection;
  }
  submit(connection, input) {
    if (!Array.isArray(input.models) || !input.models.length || input.models.length > 64) throw new A6Error('invalid-selection', '每次请选择 1–64 个待测项');
    const models = [...new Map(input.models.map(channelOf).map(item => [channelKey(item), item])).values()];
    const tokens = tokensOf(input.tokens ?? connection.tokens);
    if (!tokens.length) throw new A6Error('no-test-token', '请先到令牌管理页选择用于测试的令牌');
    connection.tokens = tokens;
    if (this.selections.size >= 100) this.selections.delete(this.selections.keys().next().value);
    const selection = { id: randomUUID(), connectionId: connection.id, accountId: connection.accountId, siteOrigin: connection.siteOrigin, createdAt: this.now(), models, tokens };
    this.selections.set(selection.id, selection);
    this.revision++;
    return { selectionId: selection.id, launch: this.launch(selection.id) };
  }
  list(revision) {
    if (revision === this.revision) return { revision, unchanged: true };
    return { revision: this.revision, selections: [...this.selections.values()].map(clone) };
  }
  selection(id) {
    const selection = this.selections.get(id);
    if (!selection) throw new A6Error('selection-expired', '网页选择已过期，请回 a6api 重新点击「前往 DSH 测试」');
    return clone(selection);
  }
  connectionFor(meta) {
    const exact = this.connections.get(meta.connectionId);
    if (this.online(exact) && exact.accountId === meta.accountId && exact.siteOrigin === meta.siteOrigin) return exact;
    // A page reload may obtain a new connection; never cross account or site boundaries.
    const live = [...this.connections.values()].find(connection => this.online(connection) && connection.accountId === meta.accountId && connection.siteOrigin === meta.siteOrigin);
    if (!live) throw new A6Error('page-offline', 'a6api 页面未连接或账号已切换；请保持原账号页面打开并重新连接');
    return live;
  }
  assertReady(meta, slots) {
    if ([...this.recovered.values()].some(lease => lease.meta.accountId === meta.accountId && lease.meta.siteOrigin === meta.siteOrigin)) throw new A6Error('recovering', '上次测试固定关系正在恢复，请稍后再开始');
    const connection = this.connectionFor(meta);
    for (const slot of slots) if (!connection.tokens.some(token => token.id === slot.tokenId)) throw new A6Error('token-not-selected', '测试令牌已取消选择，请回网页重新确认');
    return connection;
  }
  poll(connection, input = {}) {
    if (Array.isArray(input.tokens)) connection.tokens = tokensOf(input.tokens);
    this.recover(connection);
    return { connected: true, commands: [...this.commands.values()].filter(entry => entry.connectionId === connection.id).map(entry => clone(entry.command)) };
  }
  async ack(connection, input) {
    const entry = this.commands.get(input.commandId);
    if (!entry || entry.connectionId !== connection.id) return { ok: true, ignored: true };
    this.commands.delete(input.commandId);
    clearTimeout(entry.timer);
    if (input.ok === true) {
      // Only public control results cross the bridge; never echo arbitrary page response bodies.
      const result = input.result && typeof input.result === 'object' ? {
        verified: input.result.verified === true,
        restored: input.result.restored === true,
        skipped: input.result.skipped === true,
        conflict: input.result.conflict === true,
      } : {};
      if (entry.command.operation === 'restore' && !result.conflict && (result.restored || result.skipped)) {
        await this.leaseTable?.delete(`lease:${entry.command.leaseId}`);
      }
      entry.resolve(result);
    } else {
      if (entry.command.operation === 'pin' && input.result?.notApplied === true) {
        this.notApplied.add(entry.command.leaseId);
        await this.leaseTable?.delete(`lease:${entry.command.leaseId}`);
      }
      entry.reject(new A6Error('site-operation-failed', typeof input.error === 'string' ? input.error.slice(0, 400).replace(/\bsk-[\w-]+/g, '[redacted]') : 'a6api 站点操作失败'));
    }
    return { ok: true };
  }
  async waitReady(meta, slots, signal) {
    while (!signal.aborted && !this.disposed) {
      try { return this.assertReady(meta, slots); }
      catch (error) {
        if (!['page-offline', 'recovering'].includes(error.code)) throw error;
        await new Promise(resolve => {
          const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
          const timer = setTimeout(done, 1000);
          signal.addEventListener('abort', done, { once: true });
        });
      }
    }
    throw new A6Error('cancelled', '已取消');
  }
  async execute(meta, command, { timeoutMs = COMMAND_MS } = {}) {
    try {
      if (this.disposed) throw new A6Error('disposed', '插件已卸载');
      await this.ready;
      if (command.operation === 'restore' && this.notApplied.delete(command.leaseId)) return { skipped: true, restored: true };
      const connection = command.operation === 'restore' ? this.connectionFor(meta) : this.assertReady(meta, [{ tokenId: command.tokenId }]);
      if (command.operation === 'pin' && this.leaseTable) {
        const lease = { siteId: `lease:${command.leaseId}`, meta, command: { ...command, operation: 'restore' } };
        await this.leaseTable.put(lease.siteId, lease);
      }
      const id = randomUUID();
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.commands.delete(id);
          reject(new A6Error('site-timeout', '等待油猴执行操作超时；请检查 a6api 页面连接与固定状态'));
        }, timeoutMs);
        this.commands.set(id, { connectionId: connection.id, command: { ...command, id }, resolve, reject, timer });
      });
    } catch (error) {
      if (command.operation === 'restore' && this.leaseTable) {
        const key = `lease:${command.leaseId}`;
        const lease = this.leaseTable.get(key);
        if (lease) this.recovered.set(key, lease);
      }
      throw error;
    }
  }
  dropConnection(id) {
    this.connections.delete(id);
    for (const [commandId, entry] of this.commands) if (entry.connectionId === id) {
      clearTimeout(entry.timer); this.commands.delete(commandId);
      entry.reject(new A6Error('page-offline', 'a6api 页面已重连或切换账号'));
    }
  }
  mount(webServer) {
    this.origin = webServer.getOrigin();
    const url = new URL(this.origin);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new A6Error('loopback-required', 'a6api 桥接仅允许本机 DSH 服务');
    return webServer.register({ kind: 'prefix', path: PREFIX, handler: (req, res) => this.handle(req, res) });
  }
  async handle(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const host = new URL(`http://${req.headers.host ?? ''}`).hostname;
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) throw new A6Error('wrong-host', '非法 Host');
      if (req.headers.origin && !SITE_ORIGINS.has(req.headers.origin) && req.headers.origin !== this.origin) throw new A6Error('wrong-origin', '非法来源');
      if (req.method !== 'POST') { res.statusCode = 405; res.end(JSON.stringify({ error: '仅接受 POST' })); return; }
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw new A6Error('invalid-input', '需要 JSON 请求');
      let size = 0; const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) throw new A6Error('body-limit', '请求过大');
        chunks.push(chunk);
      }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const action = new URL(req.url, this.origin).pathname.slice(PREFIX.length);
      let result;
      if (action === 'connect') {
        if (!equal(req.headers['x-mit-capability'], this.capability)) throw new A6Error('not-paired', '连接口令不正确，请从 DSH 重新复制连接配置');
        await this.ready;
        result = this.connect(input);
      } else {
        const connection = this.authenticate(input, req.headers['x-mit-session']);
        if (action === 'selection') result = this.submit(connection, input);
        else if (action === 'poll') result = this.poll(connection, input);
        else if (action === 'ack') result = await this.ack(connection, input);
        else throw new A6Error('not-found', '接口不存在');
      }
      res.end(JSON.stringify(result));
    } catch (error) {
      res.statusCode = error?.code === 'not-paired' || error?.code === 'wrong-origin' || error?.code === 'wrong-host' ? 403 : 400;
      res.end(JSON.stringify({ error: error instanceof A6Error ? error.message : '桥接请求格式无效', code: error?.code ?? 'invalid-input' }));
    }
  }
  dispose() {
    this.disposed = true;
    for (const entry of this.commands.values()) { clearTimeout(entry.timer); entry.reject(new A6Error('disposed', '插件已卸载')); }
    this.commands.clear(); this.connections.clear(); this.selections.clear();
  }
}
