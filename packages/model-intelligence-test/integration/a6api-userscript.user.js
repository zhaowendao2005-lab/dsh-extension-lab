// ==UserScript==
// @name         a6api · 模型智能测试 v2
// @namespace    dsh.model-intelligence-test
// @version      2.0.0
// @description  独立选择渠道和测试令牌，通过已配对的本机 DSH bridge 安全执行站点路由命令；不读取或导出 API 密钥。
// @match        https://a6api.vip/*
// @match        https://www.a6api.vip/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @connect      localhost
// @connect      127.0.0.1
// ==/UserScript==

(async function boot() {
  'use strict';

  if (document.getElementById('mit-a6-v2-card')) return;
  const lifecycle = new AbortController();
  const cleanupHooks = [];
  let disposed = false;
  let uiReady = false;

  // Only these response fields enter the cache. Never observe key/reveal/copy endpoints,
  // React internals, authorization headers, or complete token objects.
  const SESSION_KEY = 'a6api_session_user_id';
  const PREFIX = 'mit-a6-v2:';
  const CONFIG_KEY = 'mit-a6-bridge-config-v2';
  const siteOrigin = location.origin;
  const pageId = crypto.randomUUID();
  const selectedModels = new Map(); // model + listing + channel + supplier, across pagination.
  const modelCache = new Map();
  const tokenCache = new Map();
  let selectedTokens = new Map();
  let visibleCounts = { models: 0, tokens: 0 };
  let accountId = sessionId();
  let epoch = 0;
  let connection = null;
  let config = null;
  let launch = null;
  let status = '先在设置中粘贴 DSH bridge 配置';
  let busy = false;
  let pollTimer;
  let scanTimer;
  let lastFallbackCheck = 0;
  const siteRequests = new Set();
  const bridgeRequests = new Set();
  const commandResults = new Map();
  const commandInFlight = new Map();
  const locks = new Set();
  let observedSession = sessionId();
  const MAX_COMMAND_MS = 25000;
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
    // A failed lease write MUST stop a pin before the network write.
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
  }
  function persistTokens() {
    saveStored(storageKey('tokens'), [...selectedTokens.values()].map(({ id, name }) => ({ id, name })));
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
    for (const name of ['items', 'models', 'channels', 'pins', 'tokens']) {
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
    for (const request of bridgeRequests) request?.abort?.();
    bridgeRequests.clear();
    clearTimeout(pollTimer);
    connection = null;
    launch = null;
    commandResults.clear();
    selectedModels.clear();
    modelCache.clear();
    tokenCache.clear();
    accountId = id;
    selectedTokens.clear();
    if (accountId) loadTokens();
    status = accountId ? `当前账号 #${accountId}，请连接 DSH` : '请先登录 a6api';
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
      acceptAccount(fromSession); // Removal/logout invalidates old commands immediately too.
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
      if (!disposed) { status = '无法确认登录账号，请登录后重试；本次命令将拒绝执行'; render(); }
      return false;
    } finally { clearTimeout(timer); siteRequests.delete(controller); }
  }
  function assertContext(ctx) {
    if (disposed) throw new Error('页面已关闭，命令已拒绝');
    const current = sessionId();
    if (current !== observedSession) { observedSession = current; acceptAccount(current); }
    else if (current && current !== accountId) acceptAccount(current);
    if (!accountId || ctx.accountId !== accountId || ctx.epoch !== epoch) throw new Error('账号已切换，命令已拒绝');
    if (ctx.connection && ctx.connection !== connection) throw new Error('配对连接已变更，命令已拒绝');
    if (Date.now() >= ctx.deadline) throw new Error('命令已超时，停止后续写入；请核对站点状态');
  }
  async function siteApi(path, ctx, method = 'GET', body) {
    assertContext(ctx);
    if (method !== 'GET' && (!ctx.command || !ctx.connection)) throw new Error('站点写入必须来自配对 bridge 命令');
    if (method !== 'GET' && ctx.command.operation !== 'restore' && !selectedTokens.has(ctx.command.tokenId)) throw new Error('测试令牌已取消选择，拒绝写入');
    if (!path.startsWith('/api/')) throw new Error('拒绝非站点 API');
    const controller = new AbortController();
    siteRequests.add(controller);
    const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(8000, ctx.deadline - Date.now())));
    try {
      if (method !== 'GET') ctx.writeStarted = true;
      const response = await originalFetch(path, {
        method, credentials: 'same-origin', signal: controller.signal, cache: 'no-store',
        headers: { accept: 'application/json', 'New-Api-User': ctx.accountId, ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await response.json();
      assertContext(ctx);
      // Deliberately do not relay server messages: a message could contain private data.
      if (!response.ok || data?.success === false) throw new Error(`站点 ${method} 请求失败 (HTTP ${response.status})`);
      return data?.data ?? data;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('站点请求超时或账号已切换；写入结果可能待确认');
      throw error;
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
    } catch { status = '响应缓存不可用，将使用可确认的表格信息'; }
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
  function rowToken(tr, headers) {
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
    if (name) {
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
    cell.style.cssText = 'width:74px;min-width:74px;box-sizing:border-box;text-align:center;vertical-align:middle;padding:8px 6px;';
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
      caption.textContent = kind === 'model' ? '测试渠道' : '测试令牌';
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
    for (const tr of rows) {
      if (tr.closest('table') !== table) continue;
      if (nativeCells(tr).length < 2 || nativeCells(tr).some(cell => cell.colSpan > 1)) continue;
      const row = accountId ? (kind === 'model' ? rowModel(tr) : rowToken(tr, headers)) : null;
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
      const input = cell.querySelector('input');
      const checked = !!row && (kind === 'model' ? selectedModels.has(modelKey(row)) : selectedTokens.has(row.id));
      if (input.checked !== checked) input.checked = checked;
      if (input.disabled !== !row) input.disabled = !row;
      const title = row ? (kind === 'model' ? `选择 ${row.model} / 渠道 #${row.channelId}` : `选择测试令牌 ${row.name} (#${row.id})`)
        : '无法确认行身份，请登录或通过站点翻页/刷新列表；不读取密钥';
      if (input.title !== title) input.title = title;
      if (input.getAttribute('aria-label') !== title) input.setAttribute('aria-label', title);
    }
    const pageCells = selectableCells(table, kind);
    const pageChecked = pageCells.filter(cell => cell.querySelector('input').checked).length;
    const headerInput = header?.querySelector(`th[data-mit-a6-cell="${kind}"] input`);
    if (headerInput) {
      headerInput.disabled = !accountId || !pageCells.length;
      headerInput.checked = !!pageCells.length && pageChecked === pageCells.length;
      headerInput.indeterminate = pageChecked > 0 && pageChecked < pageCells.length;
    }
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

  function localBridgeConfig(value) {
    if (!value || typeof value !== 'object') throw new Error('配置必须是包含 origin、capability 的 JSON');
    const url = new URL(value.origin);
    if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('bridge origin 必须是 localhost 或 127.0.0.1 的完整源地址');
    const capability = label(value.capability, 2048);
    if (!capability || /[\r\n]/.test(capability)) throw new Error('capability 无效');
    return { origin: url.origin, capability };
  }
  function bridgePost(path, body, auth, bridgeConfig = config) {
    if (disposed || !bridgeConfig) return Promise.reject(new Error('页面已关闭或尚未设置 DSH bridge 配置'));
    return new Promise((resolve, reject) => {
      let request;
      const finish = (fn, value) => { bridgeRequests.delete(request); fn(value); };
      request = GM_xmlhttpRequest({
        method: 'POST', url: `${bridgeConfig.origin}/mit-a6/bridge/${path}`, timeout: 12000, anonymous: true,
        headers: { 'Content-Type': 'application/json', ...auth }, data: JSON.stringify(body),
        onload(response) {
          if (response.status < 200 || response.status >= 300) { finish(reject, new Error(`DSH bridge 请求失败 (HTTP ${response.status})`)); return; }
          try {
            const data = JSON.parse(response.responseText);
            if (data?.error || data?.ok === false) throw new Error('DSH bridge 拒绝请求，请检查配对状态');
            finish(resolve, data);
          } catch { finish(reject, new Error('DSH bridge 返回无效响应或拒绝请求')); }
        },
        onerror: () => finish(reject, new Error('DSH bridge 无法连接，请启动 Host 并检查配置')),
        ontimeout: () => finish(reject, new Error('DSH bridge 请求超时')),
        onabort: () => finish(reject, new Error('DSH bridge 请求取消')),
      });
      bridgeRequests.add(request);
    });
  }
  async function connect() {
    if (busy) return;
    busy = true;
    try {
      if (!await checkAccount(true)) throw new Error('无法确认登录账号，命令已拒绝');
      if (!accountId) throw new Error('请先登录 a6api');
      if (!config) throw new Error('先粘贴 Host 面板复制的 bridge JSON');
      const ctx = { accountId, epoch, deadline: Date.now() + MAX_COMMAND_MS };
      const requestedConfig = config;
      const data = await bridgePost('connect', { accountId, siteOrigin, pageId, tokens: payloadTokens() }, { 'X-MIT-Capability': config.capability });
      assertContext(ctx);
      if (requestedConfig !== config) throw new Error('bridge 配置已变更，请重连');
      if (!label(data.connectionId) || !label(data.sessionToken, 4096)) throw new Error('bridge 缺少连接凭据');
      connection = { id: data.connectionId, session: data.sessionToken, accountId, epoch };
      launch = data.launch;
      commandResults.clear();
      status = 'DSH 已连接；勾选后点击「送到 DSH 测试」';
      clearTimeout(pollTimer);
      pollTimer = setTimeout(poll, 2000);
    } catch (error) { status = error.message; }
    finally { busy = false; render(); }
  }
  function openLaunch(value, webOnly = false) {
    if (!value) throw new Error('尚无 DSH 打开地址，请先连接');
    if (!webOnly && value.nativeUrl) {
      if (value.nativeUrl !== 'dsh://open') throw new Error('DSH 原生打开地址无效');
      location.assign(value.nativeUrl);
      return;
    }
    const url = new URL(value.webUrl);
    if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1'].includes(url.hostname) || url.username || url.password) throw new Error('DSH Web 地址必须在本机');
    GM_openInTab(url.href, { active: true, insert: true, setParent: true });
  }
  async function sendSelection() {
    if (busy) return;
    if (!connection) { status = '请先连接 DSH'; render(); return; }
    if (!selectedModels.size || !selectedTokens.size) { status = '请分别选择至少一个模型渠道和测试令牌'; render(); return; }
    busy = true;
    const paired = connection;
    const ctx = { accountId, epoch, connection: paired, deadline: Date.now() + MAX_COMMAND_MS };
    try {
      assertContext(ctx);
      const data = await bridgePost('selection', {
        connectionId: paired.id, accountId, models: [...selectedModels.values()], tokens: payloadTokens(),
      }, { 'X-MIT-Session': paired.session });
      assertContext(ctx);
      if (!label(data.selectionId)) throw new Error('DSH 未返回选择记录 ID');
      launch = data.launch;
      openLaunch(launch);
      status = '选择已发送并唤起 DSH，请在 DSH 确认测试；此按钮不启动付费推理';
    } catch (error) { status = error.message; }
    finally { busy = false; render(); }
  }

  function leaseRecords(id) {
    // Unlike UI preferences, a corrupt compensation log must never become an empty log.
    const raw = localStorage.getItem(storageKey('leases', id));
    if (!raw) return {};
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('补偿记录格式损坏');
    return data;
  }
  async function writeLease(id, leaseId, value) {
    // Different tokens can run in different tabs. Serialize journal writes separately
    // from token/model locks so read-modify-write cannot lose another token's lease.
    await navigator.locks.request(`mit-a6:journal:${siteOrigin}:${id}`, { mode: 'exclusive' }, () => {
      const all = leaseRecords(id);
      if (value) all[leaseId] = value; else delete all[leaseId];
      saveStored(storageKey('leases', id), all);
    });
  }
  function pinOf(value) {
    const token_id = positiveId(value?.token_id);
    const model_name = label(value?.model_name);
    const channel_id = positiveId(value?.channel_id ?? value?.pin_channel_id);
    if (!token_id || !model_name || !channel_id) return null;
    return { token_id, model_name, channel_id, fallback_to_smart_routing: value.fallback_to_smart_routing !== false };
  }
  async function currentPin(ctx, command) {
    const pins = listOf(await siteApi('/api/marketplace/pins', ctx)).map(pinOf).filter(Boolean)
      .filter(pin => pin.token_id === command.tokenId && pin.model_name === command.model);
    if (pins.length > 1) throw new Error('同一令牌模型存在多条固定记录，拒绝覆盖');
    return pins[0] || null;
  }
  function samePin(a, b) {
    return (!a && !b) || (!!a && !!b && a.token_id === b.token_id && a.model_name === b.model_name
      && a.channel_id === b.channel_id && a.fallback_to_smart_routing === b.fallback_to_smart_routing);
  }
  function targetPin(command) {
    return { token_id: command.tokenId, model_name: command.model, channel_id: command.channelId, fallback_to_smart_routing: false };
  }
  function readLease(value, command, id) {
    if (!value || value.leaseId !== command.leaseId || value.accountId !== id
      || value.tokenId !== command.tokenId || value.model !== command.model
      || !samePin(value.target, targetPin(command))) throw new Error('本地 lease 身份或目标不匹配');
    const previous = value.previous === null ? null : pinOf(value.previous);
    if (value.previous !== null && (!previous || previous.token_id !== command.tokenId
      || previous.model_name !== command.model || !samePin(previous, value.previous))) throw new Error('原固定补偿数据损坏，拒绝更改');
    return { ...value, target: targetPin(command), previous };
  }
  async function pinCommand(ctx, command) {
    const target = targetPin(command);
    const before = await currentPin(ctx, command);
    const all = leaseRecords(ctx.accountId);
    let lease = all[command.leaseId];
    if (Object.values(all).some(item => item.state !== 'restored' && item.leaseId !== command.leaseId && item.tokenId === command.tokenId && item.model === command.model)) {
      throw new Error('该令牌模型仍有未恢复 lease，拒绝覆盖');
    }
    if (lease) {
      lease = readLease(lease, command, ctx.accountId);
      if (lease.state === 'restored') throw new Error('此 lease 已恢复，拒绝重新固定');
      if (!samePin(lease.target, target) || lease.accountId !== ctx.accountId) throw new Error('lease 目标不匹配');
      if (samePin(before, target)) return { verified: true };
      if (!samePin(before, lease.previous)) throw new Error('固定配置已被外部修改，拒绝重试覆盖');
    } else {
      lease = {
        leaseId: command.leaseId, accountId: ctx.accountId, tokenId: command.tokenId, model: command.model,
        target, previous: before, state: 'prepared', savedAt: new Date().toISOString(),
      };
      await writeLease(ctx.accountId, command.leaseId, lease);
    }
    // Any ambiguous timeout retains the lease for a subsequent authenticated restore.
    await siteApi('/api/marketplace/pin', ctx, 'POST', target);
    const after = await currentPin(ctx, command);
    if (!samePin(after, target)) throw new Error('固定写入已返回，但回读与目标不一致；补偿记录已保留');
    await writeLease(ctx.accountId, command.leaseId, { ...lease, state: 'verified' });
    return { verified: true };
  }
  async function restoreCommand(ctx, command) {
    const stored = leaseRecords(ctx.accountId)[command.leaseId];
    if (!stored) throw new Error('未找到此 lease 补偿记录，不能确认已恢复');
    const lease = readLease(stored, command, ctx.accountId);
    const before = await currentPin(ctx, command);
    if (samePin(before, lease.previous)) {
      // Keep a small public tombstone: if ACK is lost, reconnect/reissued restore
      // can still prove its previous state without treating a missing log as success.
      await writeLease(ctx.accountId, command.leaseId, { ...lease, state: 'restored', restoredAt: Date.now() });
      return { restored: true, verified: true, skipped: true };
    }
    if (lease.state === 'restored' || !samePin(before, lease.target)) {
      // Preserve compensation data, and explicitly fail: never overwrite user changes.
      const error = new Error('用户或其他页面已修改固定配置，未覆盖；请人工核对补偿记录');
      error.result = { conflict: true, skipped: true };
      throw error;
    }
    if (lease.previous) await siteApi('/api/marketplace/pin', ctx, 'POST', lease.previous);
    else await siteApi('/api/marketplace/unpin', ctx, 'POST', {
      token_id: command.tokenId, model_name: command.model, channel_id: command.channelId,
    });
    const after = await currentPin(ctx, command);
    if (!samePin(after, lease.previous)) throw new Error('恢复请求已提交，但回读未确认；补偿记录保留');
    await writeLease(ctx.accountId, command.leaseId, { ...lease, state: 'restored', restoredAt: Date.now() });
    return { restored: true, verified: true };
  }
  async function subscription(ctx, command) {
    const query = new URLSearchParams({ p: '1', page_size: '100', token_id: String(command.tokenId), model_names: command.model });
    const body = await siteApi(`/api/subscriptions?${query}`, ctx);
    const rows = listOf(body).filter(row => Number(row.token_id) === command.tokenId && row.model_name === command.model && !row.deleted);
    if (rows.length > 1) throw new Error('同一令牌模型存在多条订阅，拒绝更改');
    if (Number(body?.total) > 100) throw new Error('订阅查询结果不完整，拒绝更改');
    return rows[0] || null;
  }
  function hasRoute(row, channelId) {
    return Array.isArray(row?.channels) && row.channels.some(item => !item.removed_at && Number(item.channel_id) === channelId);
  }
  async function routeCommand(ctx, command) {
    const before = await subscription(ctx, command);
    if (hasRoute(before, command.channelId)) return { verified: true, skipped: true };
    if (before) {
      const id = positiveId(before.id);
      if (!id) throw new Error('订阅 ID 无法确认');
      await siteApi(`/api/subscriptions/${id}/channels`, ctx, 'PATCH', { channel_id: command.channelId });
    } else {
      // Mirrors the site's manual "加入路由" helper; route never uses the pin API.
      await siteApi('/api/subscriptions', ctx, 'POST', {
        token_id: command.tokenId, model_name: command.model, channels: [{ channel_id: command.channelId }],
        caps: { input_price_micros: 0, output_price_micros: 0, cache_read_price_micros: 0, cache_write_price_micros: 0, per_request_price_micros: 0 },
        sort_strategy: 'price_asc',
      });
    }
    if (!hasRoute(await subscription(ctx, command), command.channelId)) throw new Error('路由写入已返回，但目标渠道回读未确认');
    return { verified: true };
  }
  function validateCommand(value) {
    if (!value || !['pin', 'restore', 'route'].includes(value.operation)) throw new Error('未知操作');
    const command = {
      id: label(value.id, 240), operation: value.operation, tokenId: positiveId(value.tokenId),
      model: label(value.model), channelId: positiveId(value.channelId), leaseId: label(value.leaseId, 240),
    };
    if (!command.id || !command.tokenId || !command.model || !command.channelId
      || (command.operation !== 'route' && (!command.leaseId || ['__proto__', 'constructor', 'prototype'].includes(command.leaseId)))) throw new Error('命令字段无效');
    if (command.operation !== 'restore' && !selectedTokens.has(command.tokenId)) throw new Error('此测试令牌已取消选择或不属于当前账号选择');
    return command;
  }
  async function executeCommand(paired, value) {
    const id = label(value?.id, 240);
    const cacheKey = `${paired.id}:${id}`;
    if (commandResults.has(cacheKey)) return commandResults.get(cacheKey);
    const identity = JSON.stringify([paired.id, paired.accountId, value?.operation, value?.leaseId,
      value?.tokenId, value?.model, value?.channelId]);
    let pending = commandInFlight.get(identity);
    if (!pending) {
      pending = performCommand(paired, value);
      commandInFlight.set(identity, pending);
      pending.finally(() => { if (commandInFlight.get(identity) === pending) commandInFlight.delete(identity); });
    }
    const ack = { ...await pending, commandId: id };
    if (id) commandResults.set(cacheKey, ack);
    return ack;
  }
  async function performCommand(paired, value) {
    const ctx = { accountId: paired.accountId, epoch: paired.epoch, connection: paired, deadline: Date.now() + MAX_COMMAND_MS };
    const id = label(value?.id, 240);
    const cacheKey = `${paired.id}:${id}`;
    if (commandResults.has(cacheKey)) return commandResults.get(cacheKey);
    let ack;
    let lockKey;
    let acquired = false;
    try {
      if (!await checkAccount(true)) throw new Error('无法确认登录账号，命令已拒绝');
      assertContext(ctx);
      const command = validateCommand(value);
      ctx.command = command;
      lockKey = JSON.stringify([ctx.accountId, command.tokenId, command.model]);
      if (locks.has(lockKey)) throw new Error('同一令牌模型正在操作，拒绝并发');
      locks.add(lockKey);
      acquired = true;
      const execute = () => command.operation === 'pin' ? pinCommand(ctx, command)
        : command.operation === 'restore' ? restoreCommand(ctx, command) : routeCommand(ctx, command);
      // Web Locks serializes same-token/model changes across tabs too. Fail closed where unavailable.
      if (!navigator.locks?.request) throw new Error('浏览器缺少跨页操作锁，无法安全执行站点写入');
      const result = await navigator.locks.request(`mit-a6:${siteOrigin}:${lockKey}`, { mode: 'exclusive', ifAvailable: true }, async lock => {
        if (!lock) throw new Error('其他页面正在操作同一令牌模型');
        assertContext(ctx);
        return execute();
      });
      ack = { commandId: id, ok: true, result };
    } catch (error) {
      let notApplied = false;
      if (value?.operation === 'pin' && !ctx.writeStarted && ctx.accountId === accountId && label(value?.leaseId)) {
        try { notApplied = !leaseRecords(ctx.accountId)[value.leaseId]; } catch { /* An unreadable journal cannot prove absence. */ }
      }
      ack = { commandId: id, ok: false, error: label(error.message, 400),
        ...(notApplied ? { result: { notApplied: true } } : error.result ? { result: error.result } : {}) };
    } finally { if (acquired) locks.delete(lockKey); }
    if (id) {
      commandResults.set(cacheKey, ack);
      if (commandResults.size > 500) commandResults.delete(commandResults.keys().next().value);
    }
    return ack;
  }
  async function poll() {
    const paired = connection;
    if (!paired) return;
    try {
      const ctx = { accountId: paired.accountId, epoch: paired.epoch, connection: paired, deadline: Date.now() + MAX_COMMAND_MS };
      assertContext(ctx);
      const data = await bridgePost('poll', { connectionId: paired.id, accountId: paired.accountId, tokens: payloadTokens() }, { 'X-MIT-Session': paired.session });
      assertContext(ctx);
      if (data.connected !== true) throw new Error('DSH 配对已断开，请重新连接');
      if (!Array.isArray(data.commands)) throw new Error('DSH 命令响应格式无效');
      // Serialize each token, but execute independent tokens concurrently so a
      // slow slot cannot consume another slot's Host command timeout.
      const groups = new Map();
      for (const value of data.commands.slice(0, 32)) {
        const key = positiveId(value?.tokenId);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(value);
      }
      const outcomes = await Promise.allSettled([...groups.values()].map(async values => {
        for (const value of values) {
          assertContext({ ...ctx, deadline: Date.now() + MAX_COMMAND_MS });
          const ack = await executeCommand(paired, value);
          if (connection !== paired || epoch !== paired.epoch) return;
          await bridgePost('ack', { connectionId: paired.id, accountId: paired.accountId, ...ack }, { 'X-MIT-Session': paired.session });
          if (connection !== paired) return;
          status = ack.ok ? `DSH 命令 ${value.operation} 已读回确认` : `DSH 命令未完成：${ack.error}`;
        }
      }));
      const failed = outcomes.find(outcome => outcome.status === 'rejected');
      if (failed) throw failed.reason;
    } catch (error) { if (connection === paired) status = error.message; }
    finally {
      render();
      if (connection === paired) pollTimer = setTimeout(poll, 2000);
    }
  }

  // Install before the SPA captures fetch in its API client. A document-idle hook can never
  // observe calls made through an earlier captured reference, even after clicking Refresh.
  observeSiteRequests();
  if (accountId) loadTokens();
  if (!document.body) await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  if (document.getElementById('mit-a6-v2-card')) return;

  // Independent UI styling, including all inputs/buttons, lives inside this shadow root.
  const host = document.createElement('div');
  host.id = 'mit-a6-v2-card';
  host.style.cssText = 'all:initial;position:fixed;top:16px;right:16px;z-index:2147483000;display:block;';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>
    :host{font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#172238;color-scheme:light}
    *{box-sizing:border-box} .card{font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;width:min(330px,calc(100vw - 16px));background:#f9fbff;color:#172238;border:1px solid #d3dced;border-radius:12px;box-shadow:0 8px 32px #19345326;overflow:hidden}
    .title{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#edf2fc;color:#172238;cursor:grab;touch-action:none;user-select:none;font-weight:650}
    .title:active{cursor:grabbing}.title span{flex:1}.body{padding:12px;max-height:calc(100vh - 100px);overflow:auto}
    p{margin:0 0 8px}small{color:#53627b;font-size:12px}button,textarea{font:inherit;color:#172238}button{border:1px solid #bdcbe2;border-radius:7px;background:#fff;padding:5px 9px;cursor:pointer}
    button:hover{background:#e9effc}button:focus-visible,textarea:focus-visible{outline:2px solid #345dcc;outline-offset:2px}button:disabled{opacity:.55;cursor:wait}
    .primary{background:#345dcc;border-color:#345dcc;color:white}.primary:hover{background:#294cac}.row{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.mini{padding:0;width:26px;height:24px;font-size:16px}
    textarea{display:block;resize:vertical;width:100%;min-height:92px;border:1px solid #bdcbe2;background:#fff;border-radius:7px;padding:7px;margin:8px 0}summary{cursor:pointer;color:#294cac}details{margin-top:10px}
    [hidden]{display:none!important}.status{white-space:pre-wrap;overflow-wrap:anywhere;color:#43536f;font-size:12px}.count{font-weight:600;white-space:pre-line}.hint{font-size:12px;color:#53627b}.leases{font-size:12px;color:#8b4e0e}
  </style><section class="card" aria-label="模型智能测试">
    <div class="title"><span>模型智能测试 · a6api</span><button class="mini" data-collapse type="button" aria-label="收起卡片">−</button></div>
    <div class="body">
      <p class="count" data-count></p><p class="hint">先到令牌页选择测试令牌，再到市场选渠道。若行被禁选，请通过站点翻页或刷新列表建立响应缓存；只保存令牌 ID 与名称。</p>
      <p class="hint">dsh://open 只唤起安装版；需连接同一 Host，否则用网页备用。测试需在 DSH 确认。</p>
      <div class="row"><button data-connect type="button">连接 DSH</button><button data-send class="primary" type="button">送到 DSH 测试</button></div>
      <div class="row"><button data-clear type="button">清空渠道选择</button><button data-web type="button" hidden>打开 DSH Web</button></div>
      <p class="status" data-status role="status" aria-live="polite"></p><p class="leases" data-leases hidden></p>
      <details><summary>连接设置</summary><small>粘贴 Host 面板复制的 JSON：{origin,capability}。连接凭据仅保存在油猴存储。</small>
        <textarea data-config spellcheck="false" aria-label="DSH bridge 配置 JSON" placeholder='{"origin":"http://127.0.0.1:端口","capability":"…"}'></textarea>
        <div class="row"><button data-save type="button">保存配置</button><button data-disconnect type="button">断开连接</button></div>
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
    const count = `账号 ${accountId ? `#${accountId}` : '未登录'}\n渠道：本页可选 ${visibleCounts.models}，累计已选 ${selectedModels.size}\n令牌：本页可选 ${visibleCounts.tokens}，累计已选 ${selectedTokens.size}`;
    if (ui('[data-count]').textContent !== count) ui('[data-count]').textContent = count;
    if (ui('[data-status]').textContent !== status) ui('[data-status]').textContent = status;
    ui('[data-connect]').disabled = busy;
    ui('[data-send]').disabled = busy || !connection;
    ui('[data-web]').hidden = !launch?.webUrl;
    let leaseCount = 0;
    let leaseWarning = '';
    try { leaseCount = accountId ? Object.values(leaseRecords(accountId)).filter(lease => lease.state !== 'restored').length : 0; }
    catch { leaseWarning = '固定补偿记录损坏或不可读，请先人工核对；脚本将拒绝覆盖配置。'; }
    const message = leaseWarning || (leaseCount ? `${leaseCount} 条未清理的固定补偿记录；等待已配对 DSH 发出恢复命令。请勿清除此站点存储。` : '');
    ui('[data-leases]').hidden = !message;
    if (ui('[data-leases]').textContent !== message) ui('[data-leases]').textContent = message;
    if (host.isConnected) { const rect = host.getBoundingClientRect(); clampPosition(rect.left, rect.top); }
  }
  ui('[data-collapse]').addEventListener('click', () => { layout.collapsed = !layout.collapsed; applyLayout(); saveLayout(); });
  ui('[data-connect]').addEventListener('click', connect);
  ui('[data-send]').addEventListener('click', sendSelection);
  ui('[data-web]').addEventListener('click', () => { try { openLaunch(launch, true); } catch (error) { status = error.message; render(); } });
  ui('[data-clear]').addEventListener('click', () => { selectedModels.clear(); scheduleScan(); render(); });
  ui('[data-disconnect]').addEventListener('click', () => {
    connection = null;
    clearTimeout(pollTimer);
    status = '已断开 DSH；尚未恢复的 lease 保留在当前账号补偿记录中';
    render();
  });
  ui('[data-save]').addEventListener('click', () => {
    try {
      const next = localBridgeConfig(JSON.parse(ui('[data-config]').value));
      GM_setValue(CONFIG_KEY, next);
      config = next;
      connection = null;
      launch = null;
      clearTimeout(pollTimer);
      ui('[data-config]').value = '';
      status = '配置已保存，请连接 DSH';
    } catch (error) { status = `配置保存失败：${error.message}`; }
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
    if (titleBar.hasPointerCapture(event.pointerId)) titleBar.releasePointerCapture(event.pointerId);
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
    if (event.storageArea === localStorage && event.key === storageKey('leases')) render();
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

  try {
    const saved = GM_getValue(CONFIG_KEY, null);
    if (saved) config = localBridgeConfig(saved);
  } catch { status = '已保存的 bridge 配置无效，请重新粘贴'; }
  uiReady = true;
  applyLayout();
  render();
  checkAccount(true);
  scheduleScan();
  // SessionStorage changes in this tab do not fire "storage". This bounded watchdog
  // detects account switches without running an observer busy loop.
  const watchdog = setInterval(() => { checkAccount(); }, 1000);
  listen(window, 'pagehide', event => {
    disposed = true;
    epoch += 1;
    connection = null;
    clearTimeout(pollTimer);
    clearTimeout(scanTimer);
    clearInterval(watchdog);
    observer.disconnect();
    lifecycle.abort();
    for (const controller of siteRequests) controller.abort();
    for (const request of bridgeRequests) request?.abort?.();
    for (const cleanup of cleanupHooks.reverse()) { try { cleanup(); } catch { /* Page is unloading. */ } }
    for (const cell of document.querySelectorAll('[data-mit-a6-cell]')) cell.remove();
    host.remove();
    // BFCache restores the old JS heap; rebuild exactly once with fresh account/session state.
    if (event.persisted) addEventListener('pageshow', resumed => { if (resumed.persisted) boot(); }, { once: true });
  }, { once: true });
})();
