/**
 * Selection intake: the one and only channel between the a6api page and this plugin.
 *
 * The userscript is a selector, not an agent — it reads the channels the user ticked in the market
 * table, posts them once, and is done. Nothing is pushed back to the page: pinning happens right
 * here in the Host, authenticated with the account's access token.
 *
 * Access is a static intake token the user pastes into the userscript once, plus a same-machine
 * Host check. That is deliberately weaker than the old pairing handshake, because this endpoint can
 * no longer mutate the account — it only records which channels to test.
 */
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { A6Error } from './errors.js';
import { marketOf } from '../../shared/market.js';

const PATH = '/mit-a6/select';
const SITE_ORIGINS = new Set(['https://a6api.vip', 'https://www.a6api.vip']);
const MAX_BODY = 256_000;
const MAX_MODELS = 64;
const MAX_SELECTIONS = 20;
const KEY = 'a6-intake';

const equal = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
const text = (value, max = 256) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const positive = (value, label) => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new A6Error('invalid-input', `${label}无效`);
  return value;
};

export function channelOf(item) {
  return {
    listingId: Number.isSafeInteger(item?.listingId) && item.listingId >= 0 ? item.listingId : 0,
    channelId: positive(item?.channelId, '渠道 ID'),
    supplierId: Number.isSafeInteger(item?.supplierId) && item.supplierId >= 0 ? item.supplierId : 0,
    model: text(item?.model) || (() => { throw new A6Error('invalid-input', '缺少模型名称'); })(),
    supplierName: text(item?.supplierName),
    channelName: text(item?.channelName),
    brand: text(item?.brand),
    ...(marketOf(item?.market) ? { market: marketOf(item.market) } : {}),
  };
}
export function channelKey(item) {
  return `${item.listingId}:${item.channelId}:${item.supplierId}:${item.model}`;
}

function modelsOf(input) {
  if (!Array.isArray(input) || !input.length || input.length > MAX_MODELS) throw new A6Error('invalid-input', '待测清单为空或数量无效');
  const seen = new Set();
  return input.map(channelOf).filter(item => {
    const key = channelKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function tokensOf(input) {
  if (!Array.isArray(input) || !input.length) throw new A6Error('invalid-input', '测试令牌列表为空或数量无效');
  const seen = new Set();
  return input.map(item => ({ id: positive(item?.id, '测试令牌 ID'), name: text(item?.name, 120) || `令牌 ${item.id}` }))
    .filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return true; });
}

export class A6Intake {
  constructor({ scriptUrl } = {}) {
    this.scriptUrl = scriptUrl;
    this.script = null;
    this.recent = null;
    this.token = '';
    this.selections = new Map();
    this.revision = 0;
    this.storage = null;
    this.ready = Promise.resolve();
  }

  attachStorage(storage) {
    this.storage = storage;
    this.ready = this.load();
  }

  async load() {
    if (!this.storage) return;
    const domain = await this.storage.managed();
    if (!domain) return;
    const table = domain.table('auth');
    const row = table.get(KEY);
    this.recent = table.get('a6-script-report')?.recent ?? null;
    if (row?.token) { this.token = row.token; return; }
    this.token = randomBytes(24).toString('base64url');
    await table.put(KEY, { siteId: KEY, token: this.token });
  }

  /** Regenerate the intake token; already-received selections stay usable. */
  async rotate() {
    await this.ready;
    this.token = randomBytes(24).toString('base64url');
    const domain = await this.storage?.managed();
    await domain?.table('auth').put(KEY, { siteId: KEY, token: this.token });
    return this.token;
  }

  list(revision) {
    if (Number.isInteger(revision) && revision === this.revision) return { unchanged: true, revision: this.revision };
    return { revision: this.revision, selections: [...this.selections.values()].slice(-MAX_SELECTIONS).reverse() };
  }

  selection(id) {
    const found = this.selections.get(id);
    if (!found) throw new A6Error('selection-missing', '选择已失效，请在网页重新勾选后发送');
    return found;
  }

  submit(input) {
    const siteOrigin = text(input?.siteOrigin, 120);
    if (!SITE_ORIGINS.has(siteOrigin)) throw new A6Error('wrong-site', '只接受 a6api 站点发来的选择');
    const accountId = text(input?.accountId, 40);
    if (!accountId) throw new A6Error('invalid-input', '缺少账号标识');
    if (input.kind !== undefined && !['fingerprint', 'custom'].includes(input.kind)) throw new A6Error('invalid-input', '测试类型无效');
    const selection = {
      kind: input.kind ?? 'fingerprint',
      id: randomBytes(9).toString('base64url'),
      siteOrigin, accountId,
      pageId: text(input?.pageId, 120),
      createdAt: Date.now(),
      models: modelsOf(input?.models),
      tokens: tokensOf(input?.tokens),
    };
    this.selections.set(selection.id, selection);
    while (this.selections.size > MAX_SELECTIONS) this.selections.delete(this.selections.keys().next().value);
    this.revision += 1;
    return { ok: true, selectionId: selection.id, revision: this.revision, models: selection.models.length, tokens: selection.tokens.length };
  }

  async scriptInfo() {
    await this.ready;
    if (!this.script) {
      const source = await readFile(this.scriptUrl, 'utf8');
      const version = /^\/\/\s*@version\s+(\S+)/m.exec(source)?.[1];
      if (!version || !source.includes('// ==/UserScript==')) throw new Error('包内油猴脚本元数据无效');
      this.script = { source, version };
    }
    return { version: this.script.version, protocolVersion: 1,
      installUrl: this.origin ? `${this.origin}/mit-a6/userscript/install.user.js` : '',
      updateUrl: this.origin ? `${this.origin}/mit-a6/userscript/update.meta.js` : '',
      ...(this.recent ? { recent: this.recent } : {}) };
  }

  async report(input) {
    const siteOrigin = text(input?.siteOrigin, 120);
    const accountId = text(input?.accountId, 40);
    const version = text(input?.scriptVersion, 40);
    if (!SITE_ORIGINS.has(siteOrigin) || !accountId || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) {
      throw new A6Error('invalid-input', '脚本报告格式无效');
    }
    const recent = { version, protocolVersion: Number.isSafeInteger(input?.protocolVersion) ? input.protocolVersion : null, seenAt: Date.now(), accountId };
    const domain = await this.storage?.managed();
    await domain?.table('auth').put('a6-script-report', { siteId: 'a6-script-report', recent });
    this.recent = recent;
    return { ok: true };
  }

  mount(webServer) {
    this.origin = webServer.getOrigin();
    const url = new URL(this.origin);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new A6Error('loopback-required', '选择导入口仅允许本机 DSH 服务');
    const disposers = [];
    try {
      disposers.push(webServer.register({ kind: 'exact', path: PATH, handler: (req, res) => this.handle(req, res) }));
      disposers.push(webServer.register({ kind: 'exact', path: '/mit-a6/report', handler: (req, res) => this.handle(req, res, true) }));
      for (const path of ['/mit-a6/userscript/install.user.js', '/mit-a6/userscript/update.meta.js']) {
        disposers.push(webServer.register({ kind: 'exact', path, handler: async (req, res) => {
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('X-Content-Type-Options', 'nosniff');
          if (!['GET', 'HEAD'].includes(req.method)) { res.statusCode = 405; res.setHeader('Allow', 'GET, HEAD'); res.end(); return; }
          try {
            const host = new URL(`http://${req.headers.host ?? ''}`).hostname;
            if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) { res.statusCode = 403; res.end(); return; }
            const info = await this.scriptInfo();
            const source = this.script.source.replace(/^\/\/\s*@(updateURL|downloadURL)\s+.*\r?\n/gm, '');
            const rendered = source.replace('// ==/UserScript==', `// @updateURL ${info.updateUrl}\n// @downloadURL ${info.installUrl}\n// ==/UserScript==`);
            const body = path.endsWith('.meta.js') ? rendered.slice(0, rendered.indexOf('// ==/UserScript==') + '// ==/UserScript=='.length) + '\n' : rendered;
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
            res.end(req.method === 'HEAD' ? undefined : body);
          } catch { res.statusCode = 503; res.end('Package userscript unavailable'); }
        } }));
      }
    } catch (error) { for (const dispose of disposers.reverse()) dispose(); throw error; }
    return () => { for (const dispose of disposers.reverse()) dispose(); };
  }

  async handle(req, res, reporting = false) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // The page is cross-origin, so preflight must pass before the POST is even attempted.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, x-mit-intake');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
    try {
      const host = new URL(`http://${req.headers.host ?? ''}`).hostname;
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) throw new A6Error('wrong-host', '非法 Host');
      if (req.method !== 'POST') throw new A6Error('method', '仅接受 POST');
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw new A6Error('invalid-input', '需要 JSON 请求');
      await this.ready;
      if (!equal(req.headers['x-mit-intake'], this.token)) throw new A6Error('not-paired', '导入口令不正确，请从 DSH 面板重新复制');
      let size = 0; const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) throw new A6Error('body-limit', '请求过大');
        chunks.push(chunk);
      }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (reporting) res.end(JSON.stringify(await this.report(input)));
      else {
        const result = this.submit(input);
        if (input?.scriptVersion) { try { await this.report(input); } catch { /* Optional reporting never rejects an accepted selection. */ } }
        res.end(JSON.stringify(result));
      }
    } catch (error) {
      res.statusCode = error?.code === 'not-paired' || error?.code === 'wrong-host' || error?.code === 'wrong-site' ? 403 : 400;
      res.end(JSON.stringify({ error: error instanceof A6Error ? error.message : '请求格式无效', code: error?.code ?? 'invalid-input' }));
    }
  }
}
