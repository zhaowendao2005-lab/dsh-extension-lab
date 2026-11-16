// ==UserScript==
// @name         a6api · 模型智能测试 v3
// @namespace    dsh.model-intelligence-test
// @version      3.1.0
// @description  在市场与令牌表格中提供勾选列，把所选渠道与测试令牌一次性发送给本机 DSH；不执行站点写操作，不读取或导出 API 密钥。
// @match        https://a6api.vip/*
// @match        https://www.a6api.vip/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      localhost
// @connect      127.0.0.1
// ==/UserScript==

// 本脚本只负责选择与发送，不执行任何站点写操作：
// 既不修改站点固定(pin)/路由，也不把登录凭据交给 DSH。固定与恢复由 DSH 侧用
// 「系统访问令牌 + 用户 ID」直接调用站点 /api/* 完成。脚本只有三项职责：
// 1) 在表格里插入勾选列；2) 缓存列出 {id,name} 以便选择测试令牌；3) 把选择一次性 POST 给 DSH。
// 发送路径只有一次 HTTP 往返：没有轮询、没有重试、没有后台定时器；失败请用户再点一次。

(async function boot() {
  'use strict';

  if (document.getElementById('mit-a6-v3-card')) return;
  const lifecycle = new AbortController();
  const cleanupHooks = [];
  let disposed = false;
  let uiReady = false;

  // Only these response fields enter the cache. Never observe key/reveal/copy endpoints,
  // React internals, authorization headers, or complete token objects.
  const SESSION_KEY = 'a6api_session_user_id';
  const PREFIX = 'mit-a6-v3:';
  const CONFIG_KEY = 'mit-a6-config-v3';
  const SEND_TIMEOUT_MS = 12000;
  const siteOrigin = location.origin;
  const pageId = crypto.randomUUID(); // 本页稳定 id：同一页面内多次发送保持一致。
  const selectedModels = new Map(); // model + listing + channel + supplier, across pagination.
  const modelCache = new Map();
  const tokenCache = new Map();
  const siteRequests = new Set();
  let selectedTokens = new Map();
  // Whether the folded group of test tokens is open. Persisted per account: the fold is a view
  // preference, and a different a6api account has a different test-token list.
  let foldState = { expanded: false };
  let visibleCounts = { models: 0, tokens: 0 };
  let accountId = sessionId();
  let epoch = 0;
  let config = null;
  let status = '先在连接设置中填写 DSH 地址与导入口令';
  let busy = false;
  let scanTimer;
  let lastFallbackCheck = 0;
  let observedSession = sessionId();
  const originalFetch = window.fetch.bind(window);

  function positiveId(value) {
    const n = Number(value);
    return Number.isSafeInteger(n) && n > 0 ? n : 0;
  }
  function label(value, max = 240) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
  }
  function sessionId() {
    try { return String(positiveId(sessionStorage.getItem(SESSION_KEY)) || ''); }
    catch { return ''; }
  }
  function storageKey(kind, id = accountId) {
    return `${PREFIX}${kind}:${siteOrigin}:${id}`;
  }
  function readStored(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { status = '本地记录读取失败，请检查浏览器存储权限'; return fallback; }
  }
  function saveStored(key, value) {
    // Callers roll back the in-memory selection when this throws.
    localStorage.setItem(key, JSON.stringify(value));
  }
  function tokenOf(value) {
    const id = positiveId(value?.id);
    const name = label(value?.name);
    return id && name ? { id, name } : null;
  }
  function loadTokens() {
    const saved = readStored(storageKey('tokens'), []);
    selectedTokens = new Map((Array.isArray(saved) ? saved : []).map(tokenOf).filter(Boolean).map(t => [t.id, t]));
    // The saved selection is also the strongest identity hint: it lets a freshly loaded page recognise
    // its own test tokens before the site refetches the token list.
    for (const token of selectedTokens.values()) if (!tokenCache.has(token.id)) tokenCache.set(token.id, token);
  }
  function persistTokens() {
    saveStored(storageKey('tokens'), [...selectedTokens.values()].map(({ id, name }) => ({ id, name })));
  }
  function loadFold() {
    const saved = readStored(storageKey('fold'), null);
    foldState = { expanded: saved?.expanded === true };
  }
  function persistFold() {
    try { saveStored(storageKey('fold'), { expanded: foldState.expanded === true }); }
    catch { status = '折叠状态保存失败，本次仅在本页生效'; }
  }
  function modelOf(value) {
    const model = label(value?.model_name ?? value?.model);
    const channelId = positiveId(value?.channel_id ?? value?.channelId);
    const listingId = positiveId(value?.listing_id ?? value?.listingId ?? value?._id ?? value?.id);
    const supplierId = positiveId(value?.supplier_id ?? value?.supplierId);
    if (!model || !channelId || !listingId) return null;
    return {
      listingId, channelId, supplierId, model,
      brand: label(value.brand), channelName: label(value.channel_name ?? value.channelName),
      supplierName: label(value.supplier_name ?? value.supplierName),
    };
  }
  function modelKey(row) {
    return JSON.stringify([row.model, row.listingId, row.channelId, row.supplierId]);
  }
  function payloadTokens() { return [...selectedTokens.values()].map(({ id, name }) => ({ id, name })); }
  function listOf(body) {
    const data = body?.data ?? body;
    if (Array.isArray(data)) return data;
    for (const name of ['items', 'models', 'channels', 'tokens']) {
      if (Array.isArray(data?.[name])) return data[name];
    }
    throw new Error('站点返回的列表格式无法确认');
  }

  function acceptAccount(id) {
    id = String(positiveId(id) || '');
    if (id === accountId) return;
    epoch += 1;
    for (const controller of siteRequests) controller.abort();
    siteRequests.clear();
    selectedModels.clear();
    modelCache.clear();
    tokenCache.clear();
    accountId = id;
    selectedTokens.clear();
    foldState = { expanded: false };
    if (accountId) { loadTokens(); loadFold(); }
    status = accountId ? `当前账号 #${accountId}，勾选后发送` : '请先登录 a6api';
    scheduleScan();
    render();
  }
  let accountCheckPromise = null;
  function checkAccount(force = false) {
    if (accountCheckPromise) return accountCheckPromise;
    const pending = resolveAccount(force);
    accountCheckPromise = pending;
    pending.finally(() => { if (accountCheckPromise === pending) accountCheckPromise = null; });
    return pending;
  }
  async function resolveAccount(force) {
    if (disposed) return false;
    const fromSession = sessionId();
    if (fromSession !== observedSession) {
      observedSession = fromSession;
      acceptAccount(fromSession); // Removal/logout invalidates the previous page's caches immediately.
    }
    if (fromSession) { acceptAccount(fromSession); return true; }
    if (accountId && !force && Date.now() - lastFallbackCheck < 15000) return true;
    lastFallbackCheck = Date.now();
    const generation = epoch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    siteRequests.add(controller);
    try {
      const response = await originalFetch('/api/user/self', {
        credentials: 'same-origin', headers: { accept: 'application/json', ...(accountId ? { 'New-Api-User': accountId } : {}) }, signal: controller.signal,
      });
      const body = await response.json();
      if (generation !== epoch || disposed) return false;
      if (!response.ok || body?.success === false) { acceptAccount(''); return false; }
      acceptAccount(sessionId() || body?.data?.id || body?.id);
      return !!accountId;
    } catch {
      if (!disposed) { status = '无法确认登录账号，请登录后重试'; render(); }
      return false;
    } finally { clearTimeout(timer); siteRequests.delete(controller); }
  }

  // Observe only requests made by the site; do not crawl pages or enumerate tokens.
  function cacheKind(url, method) {
    try {
      const parsed = new URL(url, siteOrigin);
      if (parsed.origin !== siteOrigin || String(method || 'GET').toUpperCase() !== 'GET') return '';
      if (/^\/api\/marketplace\/(?:public\/)?channels(?:\/search)?\/?$/.test(parsed.pathname)) return 'model';
      if (/^\/api\/token(?:\/search)?\/?$/.test(parsed.pathname)) return 'token';
    } catch { /* Ignore non-site requests. */ }
    return '';
  }
  function cacheResponse(kind, body, generation) {
    if (disposed || generation !== epoch || !accountId) return;
    let rows;
    try { rows = listOf(body); } catch { return; }
    for (const value of rows) {
      const row = kind === 'model' ? modelOf(value) : tokenOf(value);
      if (!row) continue;
      const cache = kind === 'model' ? modelCache : tokenCache;
      cache.set(kind === 'model' ? modelKey(row) : row.id, row);
      if (cache.size > 5000) cache.delete(cache.keys().next().value);
    }
    scheduleScan();
  }
  function observeSiteRequests() {
    try {
      const page = typeof unsafeWindow === 'object' ? unsafeWindow : window;
      const fetchBefore = page.fetch;
      const fetchHook = function (input, init) {
        const generation = epoch;
        const kind = cacheKind(typeof input === 'string' ? input : (input?.url ?? input?.href), init?.method ?? input?.method);
        const pending = Reflect.apply(fetchBefore, this, arguments);
        if (kind) pending.then(response => {
          if (response.ok) response.clone().json().then(data => cacheResponse(kind, data, generation)).catch(() => {});
        }).catch(() => {});
        return pending;
      };
      page.fetch = fetchHook;
      cleanupHooks.push(() => { if (page.fetch === fetchHook) page.fetch = fetchBefore; });
      const proto = page.XMLHttpRequest?.prototype;
      if (proto) {
        const requests = new WeakMap();
        const openBefore = proto.open;
        const sendBefore = proto.send;
        const openHook = function (method, url) {
          requests.set(this, { kind: cacheKind(url, method), generation: epoch });
          return Reflect.apply(openBefore, this, arguments);
        };
        const sendHook = function () {
          const info = requests.get(this);
          if (info?.kind) this.addEventListener('load', () => {
            if (this.status < 200 || this.status >= 300) return;
            try {
              const data = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
              cacheResponse(info.kind, data, info.generation);
            } catch { /* Not a JSON response. */ }
          }, { once: true });
          return Reflect.apply(sendBefore, this, arguments);
        };
        proto.open = openHook;
        proto.send = sendHook;
        cleanupHooks.push(() => {
          if (proto.open === openHook) proto.open = openBefore;
          if (proto.send === sendHook) proto.send = sendBefore;
        });
      }
    } catch { status = '响应缓存不可用，将只使用表格中可确认的行身份'; }
  }

  function nativeCells(tr) {
    return [...tr.children].filter(cell => /^(TD|TH)$/.test(cell.tagName) && !cell.hasAttribute('data-mit-a6-cell'));
  }
  function cellText(cell) { return label(cell?.textContent, 400); }
  function rowModel(tr) {
    const listingId = positiveId(tr.dataset.marketRow ?? tr.dataset.listingId);
    const model = label(tr.querySelector('.model-name-text')?.textContent ?? tr.dataset.model);
    // Cache match must be unambiguous; listing alone is not a channel identity.
    const matches = [...modelCache.values()].filter(row => row.listingId === listingId && (!model || row.model === model));
    if (matches.length === 1) return matches[0];
    const text = nativeCells(tr).map(cellText).join(' ');
    const channelId = positiveId(tr.dataset.channelId) || positiveId((text.match(/渠道\s*[#＃]\s*(\d+)/) || [])[1]);
    const supplierId = positiveId(tr.dataset.supplierId)
      || positiveId(tr.querySelector('[data-supplier-id]')?.getAttribute('data-supplier-id'))
      || positiveId((text.match(/(?:供应商|商户)\s*(?:ID)?\s*[:#＃]\s*(\d+)/i) || [])[1]);
    if (!listingId || !model || !channelId) return null;
    return { listingId, model, channelId, supplierId, brand: '', channelName: '', supplierName: '' };
  }
  function headersOf(table) {
    const headerRow = table.tHead?.rows[table.tHead.rows.length - 1];
    return headerRow ? nativeCells(headerRow).map(cellText) : [];
  }
  /** The visible token name. Works even when the row carries no id the site exposes (production table). */
  function rowTokenName(tr, headers) {
    const nameIndex = headers.findIndex(text => /^(?:令牌名称|令牌名|名称|Token\s*Name|Name)$/i.test(text));
    const cell = nameIndex >= 0 ? nativeCells(tr)[nameIndex] : null;
    return label(tr.dataset.tokenName) || label(cell?.querySelector('.ct-name-main-title')?.textContent) || (cell ? cellText(cell) : '');
  }
  function rowToken(tr, headers, allowNameMatch = true) {
    const cells = nativeCells(tr);
    const idIndex = headers.findIndex(text => /^(?:令牌\s*)?ID$/i.test(text));
    const nameIndex = headers.findIndex(text => /^(?:令牌名称|令牌名|名称|Token\s*Name|Name)$/i.test(text));
    let id = positiveId(tr.dataset.tokenId);
    if (!id && idIndex >= 0) id = positiveId(cellText(cells[idIndex]).replace(/^#/, ''));
    if (!id) {
      const link = tr.querySelector('a[href*="tokenId="],a[href*="token_id="]');
      try { if (link) { const url = new URL(link.href); id = positiveId(url.searchParams.get('tokenId') ?? url.searchParams.get('token_id')); } } catch { /* No stable link identity. */ }
    }
    // Read only the named column, never all row text (which may contain a revealed key).
    const nameCell = nameIndex >= 0 ? cells[nameIndex] : null;
    const name = label(tr.dataset.tokenName) || label(nameCell?.querySelector('.ct-name-main-title')?.textContent)
      || (nameCell ? cellText(nameCell) : '');
    if (id && name) return { id, name };
    if (id && tokenCache.has(id)) return tokenCache.get(id);
    if (name && allowNameMatch) {
      const matches = [...tokenCache.values()].filter(token => token.name === name);
      if (matches.length === 1) return matches[0];
    }
    return null;
  }
  function isTokenTable(table, headers) {
    if (table.querySelector('tr.mp-channel-row')) return false;
    if (table.querySelector('tr[data-token-id]')) return true;
    const name = headers.some(text => /^(令牌名称|令牌名|Token\s*Name)$/i.test(text));
    const onTokenPage = /(?:token|tokens|access)/i.test(location.pathname + location.hash);
    const keyColumn = headers.some(text => /(?:密钥|API\s*Key|令牌值)/i.test(text));
    return name || (onTokenPage && keyColumn && headers.some(text => /^(名称|Name)$/i.test(text)));
  }
  function makeCell(tag, kind) {
    const cell = document.createElement(tag);
    cell.setAttribute('data-mit-a6-cell', kind);
    cell.style.cssText = 'width:74px;min-width:74px;box-sizing:border-box;text-align:center;vertical-align:middle;padding:8px 6px;'
      + 'border-left:2px dashed #345dcc;background:#f4f7ff;';
    if (tag === 'td') cell.title = '由「模型智能测试」插件注入，不影响站点数据';
    cell.addEventListener('click', event => event.stopPropagation());
    cell.addEventListener('pointerdown', event => event.stopPropagation());
    return cell;
  }
  function selectableCells(table, kind) {
    return [...table.querySelectorAll(`td[data-mit-a6-cell="${kind}"]`)]
      .filter(cell => cell.closest('table') === table && cell._mitEpoch === epoch && cell._mitRow);
  }
  function togglePage(table, kind, checked) {
    if (!accountId) return;
    const cells = selectableCells(table, kind);
    const previous = new Map(selectedTokens);
    for (const cell of cells) {
      const row = cell._mitRow;
      if (kind === 'model') {
        const key = modelKey(row);
        if (checked) selectedModels.set(key, row); else selectedModels.delete(key);
      } else if (checked) selectedTokens.set(row.id, row); else selectedTokens.delete(row.id);
    }
    if (kind === 'token') {
      try { persistTokens(); } catch { selectedTokens = previous; status = '本页令牌选择保存失败，选择未更改'; }
    }
    scheduleScan();
    render();
  }
  function decorateTable(table, kind) {
    const header = table.tHead?.rows[table.tHead.rows.length - 1];
    if (header && ![...header.children].some(cell => cell.getAttribute('data-mit-a6-cell') === kind)) {
      const cell = makeCell('th', kind);
      cell.scope = 'col';
      const caption = document.createElement('div');
      const badge = document.createElement('span');
      badge.textContent = '插件';
      badge.style.cssText = 'display:block;font-size:10px;font-weight:700;letter-spacing:.04em;color:#fff;background:#345dcc;border-radius:4px;padding:1px 0;margin:0 0 3px;';
      const name = document.createElement('span');
      name.textContent = kind === 'model' ? '测试渠道' : '测试令牌';
      name.style.cssText = 'display:block;font-size:11px;font-weight:600;color:#1f3a86;';
      caption.append(badge, name);
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.title = '选择本页可测项；仅勾选不会更改站点配置';
      input.setAttribute('aria-label', '选择本页可测项');
      input.style.cssText = 'appearance:auto;accent-color:#345dcc;width:16px;height:16px;margin:4px 0 0;cursor:pointer;';
      input.addEventListener('change', () => togglePage(table, kind, input.checked));
      cell.append(caption, input);
      header.insertBefore(cell, header.firstChild);
    }
    const headers = headersOf(table);
    const rows = kind === 'model' ? table.querySelectorAll('tr.mp-channel-row') : table.querySelectorAll('tbody > tr');
    const tokenNameCounts = new Map();
    if (kind === 'token') for (const tr of rows) {
      if (tr.closest('table') !== table || tr.closest('tbody[data-mit-a6-fold]')) continue;
      const name = rowTokenName(tr, headers);
      if (name) tokenNameCounts.set(name, (tokenNameCounts.get(name) || 0) + 1);
    }
    for (const tr of rows) {
      if (tr.closest('table') !== table) continue;
      if (nativeCells(tr).length < 2 || nativeCells(tr).some(cell => cell.colSpan > 1)) continue;
      const row = accountId ? (kind === 'model' ? rowModel(tr) : rowToken(tr, headers, tokenNameCounts.get(rowTokenName(tr, headers)) === 1)) : null;
      let cell = [...tr.children].find(item => item.getAttribute('data-mit-a6-cell') === kind);
      if (!cell) {
        cell = makeCell('td', kind);
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.style.cssText = 'appearance:auto;accent-color:#345dcc;width:16px;height:16px;margin:0;cursor:pointer;';
        input.addEventListener('change', () => {
          const value = cell._mitRow;
          if (!accountId || !value || cell._mitEpoch !== epoch) { scheduleScan(); return; }
          if (kind === 'model') {
            const key = modelKey(value);
            if (input.checked) selectedModels.set(key, value); else selectedModels.delete(key);
          } else {
            const previous = new Map(selectedTokens);
            if (input.checked) selectedTokens.set(value.id, value); else selectedTokens.delete(value.id);
            try { persistTokens(); } catch { selectedTokens = previous; status = '令牌选择保存失败，选择未更改'; }
          }
          render();
          scheduleScan();
        });
        cell.appendChild(input);
        tr.insertBefore(cell, tr.firstChild);
      }
      cell._mitRow = row;
      cell._mitEpoch = epoch;
      if (kind === 'token') {
        tr._mitTokenId = row ? row.id : undefined;
        tr._mitTokenName = row?.name ?? (accountId ? rowTokenName(tr, headers) : undefined);
      }
      const input = cell.querySelector('input');
      const checked = !!row && (kind === 'model' ? selectedModels.has(modelKey(row)) : selectedTokens.has(row.id));
      if (input.checked !== checked) input.checked = checked;
      if (input.disabled !== !row) input.disabled = !row;
      const title = row ? (kind === 'model' ? `选择 ${row.model} / 渠道 #${row.channelId}` : `选择测试令牌 ${row.name} (#${row.id})`)
        : '无法确认行身份，请登录或通过站点翻页/刷新列表；不读取密钥';
      if (input.title !== title) input.title = title;
      if (input.getAttribute('aria-label') !== title) input.setAttribute('aria-label', title);
    }
    applyFold(table, kind);
    const pageCells = selectableCells(table, kind);
    const pageChecked = pageCells.filter(cell => cell.querySelector('input').checked).length;
    const headerInput = header?.querySelector(`th[data-mit-a6-cell="${kind}"] input`);
    if (headerInput) {
      headerInput.disabled = !accountId || !pageCells.length;
      headerInput.checked = !!pageCells.length && pageChecked === pageCells.length;
      headerInput.indeterminate = pageChecked > 0 && pageChecked < pageCells.length;
    }
  }
  /**
   * Collapse every row that is a chosen test token into one summary line. Rows are hidden, never
   * moved or cloned: the site's own React tree keeps reconciling them, so paging, sorting and the
   * site's own checkboxes stay intact. The summary lives in its own tbody so it cannot disturb the
   * real tbody's child list.
   */
  function applyFold(table, kind) {
    if (kind !== 'token') return;
    const rows = [...table.querySelectorAll('tbody > tr')]
      .filter(tr => tr.closest('table') === table && !tr.closest('tbody[data-mit-a6-fold]'));
    const nameCounts = new Map();
    for (const token of tokenCache.values()) nameCounts.set(token.name, (nameCounts.get(token.name) || 0) + 1);
    const rowNameCounts = new Map();
    for (const tr of rows) if (tr._mitTokenName) rowNameCounts.set(tr._mitTokenName, (rowNameCounts.get(tr._mitTokenName) || 0) + 1);
    const names = new Set([...selectedTokens.values()].map(token => token.name));
    const isTest = tr => tr._mitTokenId
      ? selectedTokens.has(tr._mitTokenId)
      : !!tr._mitTokenName && names.has(tr._mitTokenName)
        && nameCounts.get(tr._mitTokenName) === 1 && rowNameCounts.get(tr._mitTokenName) === 1;
    const testRows = rows.filter(isTest);
    const group = table.querySelector('tbody[data-mit-a6-fold]');
    if (!testRows.length) {
      if (group) group.remove();
      for (const tr of rows) if (tr.hasAttribute('data-mit-a6-hidden')) { tr.style.display = ''; tr.removeAttribute('data-mit-a6-hidden'); }
      return;
    }
    const hidden = foldState.expanded !== true;
    for (const tr of rows) {
      const folded = hidden && isTest(tr);
      if (folded) { if (tr.style.display !== 'none') tr.style.display = 'none'; tr.setAttribute('data-mit-a6-hidden', '1'); }
      else if (tr.hasAttribute('data-mit-a6-hidden')) { tr.style.display = ''; tr.removeAttribute('data-mit-a6-hidden'); }
    }
    let host2 = group;
    if (!host2) {
      host2 = document.createElement('tbody');
      host2.setAttribute('data-mit-a6-fold', '1');
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = Math.max(1, table.tHead?.rows[table.tHead.rows.length - 1]?.children.length ?? 3);
      cell.style.cssText = 'padding:7px 10px;border-top:1px dashed #345dcc;border-bottom:1px dashed #345dcc;background:#eef3ff;';
      const line = document.createElement('div');
      line.style.cssText = 'display:flex;align-items:center;gap:8px;font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1f3a86;';
      const badge = document.createElement('span');
      badge.textContent = '插件';
      badge.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:.04em;color:#fff;background:#345dcc;border-radius:4px;padding:1px 5px;';
      const text = document.createElement('span');
      text.setAttribute('data-mit-a6-fold-text', '');
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.setAttribute('data-mit-a6-fold-toggle', '');
      toggle.style.cssText = 'border:1px solid #345dcc;background:#fff;color:#1f3a86;border-radius:6px;padding:2px 8px;font:inherit;font-size:12px;cursor:pointer;';
      toggle.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        foldState.expanded = foldState.expanded !== true;
        persistFold(); scan();
      });
      row.addEventListener('click', event => event.stopPropagation());
      line.append(badge, text, toggle);
      cell.appendChild(line);
      row.appendChild(cell);
      host2.appendChild(row);
      table.appendChild(host2);
    }
    const text = host2.querySelector('[data-mit-a6-fold-text]');
    const label = `${hidden ? '已折叠' : '已展开'} ${testRows.length} 个测试令牌`;
    if (text.textContent !== label) text.textContent = label;
    const toggle = host2.querySelector('[data-mit-a6-fold-toggle]');
    const action = hidden ? '展开' : '收起';
    if (toggle.textContent !== action) toggle.textContent = action;
  }
  function scan() {
    clearTimeout(scanTimer);
    scanTimer = null;
    // Disconnect during our own writes: no observer -> scan -> observer feedback loop.
    observer.disconnect();
    try {
      const marketTables = new Set([...document.querySelectorAll('tr.mp-channel-row')].map(tr => tr.closest('table')).filter(Boolean));
      for (const table of marketTables) decorateTable(table, 'model');
      for (const table of document.querySelectorAll('table')) {
        if (!marketTables.has(table) && isTokenTable(table, headersOf(table))) decorateTable(table, 'token');
      }
      const visibleModels = new Set();
      const visibleTokens = new Set();
      for (const cell of document.querySelectorAll('td[data-mit-a6-cell]')) {
        if (!cell._mitRow || cell._mitEpoch !== epoch) continue;
        if (cell.getAttribute('data-mit-a6-cell') === 'model') visibleModels.add(modelKey(cell._mitRow));
        else visibleTokens.add(cell._mitRow.id);
      }
      visibleCounts = { models: visibleModels.size, tokens: visibleTokens.size };
      render();
    } finally { observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-market-row', 'data-channel-id', 'data-supplier-id', 'data-token-id', 'data-token-name'] }); }
  }
  function scheduleScan() {
    if (disposed || scanTimer || !uiReady || !document.body) return;
    scanTimer = setTimeout(scan, 100);
  }
  const observer = new MutationObserver(records => {
    if (records.some(record => !host.contains(record.target))) scheduleScan();
  });

  // 连接设置只有两项：DSH 源地址与导入口令。二者仅保存在油猴存储，发送时一次性提交。
  function readConfig(value) {
    if (!value || typeof value !== 'object') throw new Error('连接设置必须是包含 DSH 地址与导入口令的对象');
    let url;
    try { url = new URL(label(value.origin, 2048)); } catch { throw new Error('DSH 地址无效，示例 http://127.0.0.1:51853'); }
    if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('DSH 地址只填本机源地址（协议 + 主机 + 端口），不要带路径、查询或账号信息');
    }
    const intake = label(value.intake, 2048);
    // Sent verbatim as a request header: keep it to visible ASCII so XHR cannot reject it.
    if (!intake || /[^\x21-\x7e]/.test(intake)) throw new Error('导入口令为空或包含空格/非 ASCII 字符');
    return { origin: url.origin, intake };
  }
  function postSelection(body, target) {
    // Exactly one HTTP round trip. No retry and no polling: the user sends again on failure.
    return new Promise((resolve, reject) => {
      const fail = (text, data) => reject(new Error(data?.code ? `${text}（${label(data.code, 80)}）` : text));
      GM_xmlhttpRequest({
        method: 'POST', url: `${target.origin}/mit-a6/select`, timeout: SEND_TIMEOUT_MS, anonymous: true,
        headers: { 'content-type': 'application/json', 'x-mit-intake': target.intake },
        data: JSON.stringify(body),
        onload(response) {
          let data = null;
          try { data = JSON.parse(response.responseText); } catch { data = null; }
          const detail = data?.error ? `：${label(data.error, 300)}` : '';
          if (response.status < 200 || response.status >= 300) { fail(`DSH 返回 HTTP ${response.status}${detail}`, data); return; }
          const selectionId = label(data?.selectionId, 200);
          if (data?.ok !== true || !selectionId) { fail(`DSH 未接受这次选择${detail || '：响应缺少 selectionId'}`, data); return; }
          resolve({ selectionId });
        },
        onerror: () => reject(new Error(`无法连接 DSH，请确认 ${target.origin} 可访问且 Host 已启动`)),
        ontimeout: () => reject(new Error(`DSH 请求超时（${SEND_TIMEOUT_MS / 1000} 秒），未自动重试，请再点一次发送`)),
        onabort: () => reject(new Error('DSH 请求已取消')),
      });
    });
  }
  async function send() {
    if (busy) return;
    if (!config) { status = '先在连接设置中填写 DSH 地址与导入口令'; render(); return; }
    if (!accountId) { status = '请先登录 a6api'; render(); return; }
    if (!selectedModels.size || !selectedTokens.size) { status = '请分别选择至少一个渠道和测试令牌'; render(); return; }
    busy = true;
    render();
    const target = config;
    const generation = epoch;
    const body = {
      siteOrigin, accountId, pageId,
      models: [...selectedModels.values()].map(row => ({
        listingId: row.listingId, channelId: row.channelId, supplierId: row.supplierId, model: row.model,
        supplierName: row.supplierName, channelName: row.channelName, brand: row.brand,
      })),
      tokens: payloadTokens(),
    };
    try {
      const data = await postSelection(body, target);
      if (disposed) return;
      if (generation !== epoch) { status = '发送期间账号已切换，DSH 结果未经本页确认，请核对'; return; }
      status = `已发送 ${body.models.length + body.tokens.length} 项，等待 DSH 开始测试（渠道 ${body.models.length} / 令牌 ${body.tokens.length}）· selectionId ${data.selectionId.slice(0, 8)}`;
    } catch (error) { if (!disposed) status = error.message; }
    finally { busy = false; render(); }
  }

  // Install before the SPA captures fetch in its API client. A document-idle hook can never
  // observe calls made through an earlier captured reference, even after clicking Refresh.
  observeSiteRequests();
  if (accountId) { loadTokens(); loadFold(); }
  if (!document.body) await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  if (document.getElementById('mit-a6-v3-card')) return;

  // Independent UI styling, including all inputs/buttons, lives inside this shadow root.
  const host = document.createElement('div');
  host.id = 'mit-a6-v3-card';
  host.style.cssText = 'all:initial;position:fixed;top:16px;right:16px;z-index:2147483000;display:block;';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>
    :host{font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#172238;color-scheme:light}
    *{box-sizing:border-box} .card{font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;width:min(330px,calc(100vw - 16px));background:#f9fbff;color:#172238;border:1px solid #d3dced;border-radius:12px;box-shadow:0 8px 32px #19345326;overflow:hidden}
    .title{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#edf2fc;color:#172238;cursor:grab;touch-action:none;user-select:none;font-weight:650}
    .title:active{cursor:grabbing}.title span{flex:1}.body{padding:12px;max-height:calc(100vh - 100px);overflow:auto}
    p{margin:0 0 8px}small{color:#53627b;font-size:12px}button,input{font:inherit;color:#172238}
    button{border:1px solid #bdcbe2;border-radius:7px;background:#fff;padding:5px 9px;cursor:pointer}
    button:hover{background:#e9effc}button:focus-visible,input:focus-visible{outline:2px solid #345dcc;outline-offset:2px}button:disabled{opacity:.55;cursor:wait}
    .primary{background:#345dcc;border-color:#345dcc;color:white}.primary:hover{background:#294cac}.row{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.mini{padding:0;width:26px;height:24px;font-size:16px}
    input{display:block;width:100%;border:1px solid #bdcbe2;background:#fff;border-radius:7px;padding:6px 8px;margin:6px 0}summary{cursor:pointer;color:#294cac}details{margin-top:10px}
    [hidden]{display:none!important}.status{white-space:pre-wrap;overflow-wrap:anywhere;color:#43536f;font-size:12px}.count{font-weight:600;white-space:pre-line}.hint{font-size:12px;color:#53627b}
  </style><section class="card" aria-label="模型智能测试">
    <div class="title"><span>模型智能测试 · a6api</span><button class="mini" data-collapse type="button" aria-label="收起卡片">−</button></div>
    <div class="body">
      <p class="count" data-count></p>
      <p class="hint">先到令牌页选择测试令牌，再到市场选渠道。若行被禁选，请通过站点翻页或刷新列表建立响应缓存；只保存令牌 ID 与名称。</p>
      <div class="row"><button data-send class="primary" type="button">发送到 DSH 测试</button><button data-clear type="button">清空渠道选择</button></div>
      <div class="row"><button data-fold type="button">折叠测试令牌</button></div>
      <p class="status" data-status role="status" aria-live="polite"></p>
      <details><summary>连接设置</summary>
        <small>DSH 地址填本机源地址；导入口令由 DSH 生成。两项仅保存在油猴存储，发送时一次性提交，不做轮询或重试。</small>
        <input data-origin type="text" spellcheck="false" autocomplete="off" aria-label="DSH 地址" placeholder="http://127.0.0.1:51853">
        <input data-intake type="password" spellcheck="false" autocomplete="off" aria-label="导入口令" placeholder="导入口令">
        <div class="row"><button data-save type="button">保存连接设置</button></div>
        <p class="hint" data-target></p>
      </details>
    </div>
  </section>`;
  document.body.appendChild(host);
  const ui = selector => shadow.querySelector(selector);
  const layoutKey = storageKey('layout', 'browser');
  let layout = readStored(layoutKey, {});
  if (!layout || typeof layout !== 'object') layout = {};
  function clampPosition(x, y) {
    const rect = host.getBoundingClientRect();
    const margin = 8;
    host.style.right = 'auto';
    host.style.left = `${Math.max(margin, Math.min(Number(x) || margin, Math.max(margin, innerWidth - rect.width - margin)))}px`;
    host.style.top = `${Math.max(margin, Math.min(Number(y) || margin, Math.max(margin, innerHeight - rect.height - margin)))}px`;
  }
  function saveLayout() {
    const rect = host.getBoundingClientRect();
    layout = { x: rect.left, y: rect.top, collapsed: !!layout.collapsed };
    try { saveStored(layoutKey, layout); } catch { status = '卡片位置保存失败'; render(); }
  }
  function applyLayout() {
    ui('.body').hidden = !!layout.collapsed;
    ui('[data-collapse]').textContent = layout.collapsed ? '+' : '−';
    ui('[data-collapse]').setAttribute('aria-label', layout.collapsed ? '展开卡片' : '收起卡片');
    const rect = host.getBoundingClientRect();
    clampPosition(Number.isFinite(layout.x) ? layout.x : innerWidth - rect.width - 16, Number.isFinite(layout.y) ? layout.y : 16);
  }
  function render() {
    if (!uiReady) return;
    const count = `账号 ${accountId ? `#${accountId}` : '未登录'}\n渠道：本页可选 ${visibleCounts.models}，累计已选 ${selectedModels.size}\n令牌：本页可选 ${visibleCounts.tokens}，累计已选 ${selectedTokens.size}`;
    if (ui('[data-count]').textContent !== count) ui('[data-count]').textContent = count;
    if (ui('[data-status]').textContent !== status) ui('[data-status]').textContent = status;
    ui('[data-send]').disabled = busy;
    ui('[data-clear]').disabled = busy;
    ui('[data-fold]').disabled = busy || !selectedTokens.size;
    const foldLabel = foldState.expanded ? '收起测试令牌' : '展开测试令牌';
    if (ui('[data-fold]').textContent !== foldLabel) ui('[data-fold]').textContent = foldLabel;
    ui('[data-save]').disabled = busy;
    const target = config ? `将发送到 ${config.origin}/mit-a6/select` : '尚未保存连接设置，发送按钮不会发出请求';
    if (ui('[data-target]').textContent !== target) ui('[data-target]').textContent = target;
    if (host.isConnected) { const rect = host.getBoundingClientRect(); clampPosition(rect.left, rect.top); }
  }
  ui('[data-collapse]').addEventListener('click', () => { layout.collapsed = !layout.collapsed; applyLayout(); saveLayout(); });
  ui('[data-send]').addEventListener('click', send);
  ui('[data-fold]').addEventListener('click', () => {
    foldState.expanded = foldState.expanded !== true;
    persistFold();
    scheduleScan();
    render();
  });
  ui('[data-clear]').addEventListener('click', () => { selectedModels.clear(); scheduleScan(); render(); });
  ui('[data-save]').addEventListener('click', () => {
    try {
      const next = readConfig({ origin: ui('[data-origin]').value, intake: ui('[data-intake]').value });
      GM_setValue(CONFIG_KEY, next);
      config = next;
      ui('[data-origin]').value = next.origin;
      ui('[data-intake]').value = next.intake;
      status = `连接设置已保存：${next.origin}`;
    } catch (error) { status = `连接设置保存失败：${error.message}`; }
    render();
  });
  let drag = null;
  const titleBar = ui('.title');
  titleBar.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button')) return;
    const rect = host.getBoundingClientRect();
    drag = { pointerId: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    titleBar.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  titleBar.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    clampPosition(event.clientX - drag.dx, event.clientY - drag.dy);
  });
  const endDrag = event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag = null;
    // The browser implicitly drops pointer capture on pointerup/pointercancel.
    saveLayout();
  };
  titleBar.addEventListener('pointerup', endDrag);
  titleBar.addEventListener('pointercancel', endDrag);
  titleBar.addEventListener('lostpointercapture', endDrag);
  function listen(target, type, handler, options = {}) {
    target.addEventListener(type, handler, { ...options, signal: lifecycle.signal });
  }
  listen(window, 'resize', () => { const rect = host.getBoundingClientRect(); clampPosition(rect.left, rect.top); saveLayout(); });
  listen(ui('details'), 'toggle', () => { const rect = host.getBoundingClientRect(); clampPosition(rect.left, rect.top); saveLayout(); });
  listen(window, 'storage', event => {
    if (event.key === SESSION_KEY) { checkAccount(true); return; }
    if (event.storageArea === localStorage && event.key === storageKey('tokens')) { loadTokens(); scheduleScan(); render(); }
    if (event.storageArea === localStorage && event.key === storageKey('fold')) { loadFold(); scheduleScan(); render(); }
    if (event.key === layoutKey) {
      const next = readStored(layoutKey, {});
      layout = next && typeof next === 'object' ? next : {};
      applyLayout();
    }
  });
  listen(window, 'api-session', () => checkAccount(true));
  listen(window, 'focus', () => { checkAccount(true); scheduleScan(); });
  listen(window, 'popstate', scheduleScan);
  listen(window, 'hashchange', scheduleScan);
  listen(document, 'visibilitychange', () => { if (!document.hidden) { checkAccount(true); scheduleScan(); } });

  // 一次性连接：DSH 面板给出 https://a6api.vip/#mit-a6=<base64>，读一次即存并立刻从地址栏抹掉，
  // 免得导入口令留在历史记录或被复制分享出去。
  try {
    const linked = /[#&]mit-a6=([^&]+)/.exec(location.hash);
    if (linked) {
      const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(linked[1].replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0))));
      const next = readConfig({ origin: payload.origin, intake: payload.intake });
      GM_setValue(CONFIG_KEY, next);
      config = next;
      history.replaceState(history.state, '', `${location.pathname}${location.search}#/market`);
      status = `已通过 DSH 一键连接：${next.origin}`;
    }
  } catch { status = '连接链接无效或已过期，请手动填写 DSH 地址与导入口令'; }
  try {
    const saved = GM_getValue(CONFIG_KEY, null);
    if (saved) config = readConfig(saved);
  } catch { status = '已保存的连接设置无效，请重新填写'; }
  if (config) {
    ui('[data-origin]').value = config.origin;
    ui('[data-intake]').value = config.intake;
    status = `连接设置就绪：${config.origin}；勾选后点击「发送到 DSH 测试」`;
  }
  uiReady = true;
  applyLayout();
  render();
  checkAccount(true);
  scheduleScan();
  // SessionStorage changes in this tab do not fire "storage". This bounded watchdog detects
  // account switches; it never talks to DSH, and sending stays a single user-initiated request.
  const watchdog = setInterval(() => { checkAccount(); }, 1000);
  listen(window, 'pagehide', event => {
    disposed = true;
    epoch += 1;
    clearTimeout(scanTimer);
    clearInterval(watchdog);
    observer.disconnect();
    lifecycle.abort();
    for (const controller of siteRequests) controller.abort();
    for (const cleanup of cleanupHooks.reverse()) { try { cleanup(); } catch { /* Page is unloading. */ } }
    for (const cell of document.querySelectorAll('[data-mit-a6-cell]')) cell.remove();
    for (const tr of document.querySelectorAll('tr[data-mit-a6-hidden]')) { tr.style.display = ''; tr.removeAttribute('data-mit-a6-hidden'); }
    for (const node of document.querySelectorAll('tbody[data-mit-a6-fold]')) node.remove();
    host.remove();
    // BFCache restores the old JS heap; rebuild exactly once with fresh account/session state.
    if (event.persisted) addEventListener('pageshow', resumed => { if (resumed.persisted) boot(); }, { once: true });
  }, { once: true });
})();
