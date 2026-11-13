import {getJson, RelayError} from './client.js';
import {siteOf} from './site.js';

// The public directory only returns the 24h / 7d success series and the cache-hit rate
// for small pages; 500-row pages silently drop those fields, so the snapshot has to page
// at 100. Requests stay sequential-ish to look like a normal browser, not a scraper.
const PAGE_SIZE = 100;
const TTL_MS = 10 * 60_000;
// The official page loads in 1–3 s, so the crawl runs wide and does not sleep between pages.
// Throttling (429 etc.) is NOT hidden behind silent retries: every failed page is recorded and
// surfaced; the user can re-fetch just the missing pages.
const PAGE_CONCURRENCY = 6;
const PUBLISH_EVERY = 6;
const DEFAULT_EXCHANGE_RATE = 6.7;

function micros(value) {
  return Number.isFinite(value) ? value / 1_000_000 : null;
}

function rate(value) {
  return Number.isFinite(value) ? value / 100 : null;
}

function compact(item) {
  const official = item.official_price ?? {};
  return {
    rowKey: `${item.listing_id}:${item.channel_id}:${item.supplier_id}`,
    listingId: item.listing_id,
    channelId: item.channel_id,
    supplierId: item.supplier_id,
    supplierName: item.supplier_name || item.supplier_nickname || `渠道 ${item.channel_id}`,
    channelName: item.channel_name ?? '',
    modelName: item.model_name ?? '',
    brand: item.brand ?? '',
    inputPrice: micros(item.input_price_micros),
    outputPrice: micros(item.output_price_micros),
    cacheReadPrice: micros(item.cache_read_price_micros),
    cacheWritePrice: micros(item.cache_write_price_micros),
    officialInputPrice: micros(official.input_price_micros),
    officialOutputPrice: micros(official.output_price_micros),
    successRate: rate(item.recent_success_rate),
    success24h: rate(item.success_rate_24h),
    success7d: rate(item.success_rate_7d),
    success7dState: item.sr_7d_state ?? '',
    ttftMs: Number.isFinite(item.p50_ttft_ms) ? item.p50_ttft_ms : null,
    recentP50Ms: Number.isFinite(item.recent_p50_ms) ? item.recent_p50_ms : null,
    throughput: Number.isFinite(item.throughput_tps) ? item.throughput_tps : null,
    cacheHitRate: rate(item.cache_hit_rate_24h),
    guaranteed: Boolean(item.authenticity_guaranteed),
    labels: Array.isArray(item.smart_routing_labels) ? item.smart_routing_labels : [],
    testEndpoint: item.test_endpoint ?? '',
    modelDetection: Boolean(item.model_detection_supported),
    listingAvailability: item.listing_availability ?? 0,
    lastSuccessAt: item.last_success_at ?? null,
    lastSampleAt: item.last_sample_at ?? null,
    priceDirection: item.price_change_direction ?? '',
    realtimeRatio: Number.isFinite(item.realtime_ratio_usd) ? item.realtime_ratio_usd : null,
    description: typeof item.description === 'string' ? item.description.slice(0, 240) : '',
    guaranteeBadge: item.authenticity_guarantee_badge_key ?? '',
    officialDirect: Boolean(item.official_direct ?? item.is_official_direct),
    success24hState: item.sr_24h_state ?? '',
    sampleCount: Number.isFinite(item.sample_count) ? item.sample_count : null,
    buckets: Array.isArray(item.success_buckets) ? item.success_buckets.slice(0, 12).map(bucket => rate(bucket?.success_rate)) : [],
    lastFailureAt: item.last_failure_at ?? null,
    lastFailureCode: item.last_failure_code ?? '',
    routeStatus: item.route_status ?? '',
    chargeType: item.charge_type ?? '',
    perRequestPrice: micros(item.per_request_price_micros),
  };
}

function bucketsOf(list) {
  return Array.isArray(list) ? list.map(bucket => ({
    at: Number.isFinite(bucket?.t) ? bucket.t * 1000 : null,
    requests: Number.isFinite(bucket?.s) ? bucket.s : 0,
    rate: rate(bucket?.r),
    latencyMs: Number.isFinite(bucket?.d) ? bucket.d : null,
    firstMs: Number.isFinite(bucket?.f) ? bucket.f : null,
    cacheRate: rate(bucket?.c),
  })) : [];
}

function sortRows(rows, sort) {
  const copy = rows.slice();
  const byNumber = (key, fallback) => (a, b) => {
    const left = a[key];
    const right = b[key];
    if (left === null && right === null) return fallback(a, b);
    if (left === null) return 1;
    if (right === null) return -1;
    return left - right || fallback(a, b);
  };
  const byNumberDesc = (key, fallback) => (a, b) => {
    const left = a[key];
    const right = b[key];
    if (left === null && right === null) return fallback(a, b);
    if (left === null) return 1;
    if (right === null) return -1;
    return right - left || fallback(a, b);
  };
  const tie = (a, b) => b.successRate - a.successRate || a.supplierName.localeCompare(b.supplierName, 'zh-CN');
  switch (sort) {
    case 'price_asc': return copy.sort(byNumber('inputPrice', tie));
    case 'price_desc': return copy.sort(byNumberDesc('inputPrice', tie));
    case 'success_desc': return copy.sort((a, b) => (b.successRate ?? -1) - (a.successRate ?? -1) || tie(a, b));
    case 'p50_asc': return copy.sort(byNumber('ttftMs', tie));
    default: return copy.sort(tie);
  }
}

/** Full anonymous snapshot of one relay site, fetched once and sliced on the Host. */
export class RelaySnapshot {
  constructor(site) {
    this.site = site;
    this.rows = [];
    this.total = 0;
    this.brands = [];
    this.models = [];
    this.fetchedAt = 0;
    this.state = 'idle';
    this.progress = 0;
    this.pages = 0;
    this.error = null;
    this.promise = null;
    this.partial = false;
    this.missingPages = 0;
    this.missing = [];
    this.map = new Map();
    this.exchangeRate = DEFAULT_EXCHANGE_RATE;
  }

  stale() {
    return this.state === 'ready' && Date.now() - this.fetchedAt > TTL_MS;
  }

  status() {
    return {state: this.state, progress: this.progress, pages: this.pages, total: this.total, fetchedAt: this.fetchedAt || null, stale: this.stale(), partial: this.partial, missingPages: this.missingPages, missing: this.missing.slice(0, 40), exchangeRate: this.exchangeRate, error: this.error};
  }

  facets() {
    return {brands: this.brands, models: this.models};
  }

  ensure(force = false) {
    if (this.promise) return this.promise;
    if (this.state === 'ready' && !force && !this.stale()) return Promise.resolve(this);
    this.promise = this.load(force).finally(() => { this.promise = null; });
    return this.promise;
  }

  /** Fetch pages [numbers]; resolves with the pages that failed (never retried silently). */
  async crawl(numbers, url, publish) {
    const failed = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < numbers.length) {
        const number = numbers[cursor++];
        try {
          const data = await getJson(url(number));
          for (const item of Array.isArray(data.items) ? data.items : []) {
            const row = compact(item);
            this.map.set(row.rowKey, row);
            const rate = Number(item.realtime_ratio_exchange_rate);
            if (Number.isFinite(rate) && rate > 0) this.exchangeRate = rate;
          }
        } catch (error) {
          failed.push({page: number, status: error?.status ?? 0, code: error?.code ?? 'relay-error', message: error instanceof RelayError ? error.message : '中转站请求失败'});
        }
        this.progress += 1;
        publish();
      }
    };
    await Promise.all(Array.from({length: Math.min(PAGE_CONCURRENCY, numbers.length)}, worker));
    return failed;
  }

  async load(force, onlyMissing = false) {
    const onLoaded = this.onLoaded;
    this.state = 'building';
    this.error = null;
    try {
      const url = number => `${this.site.webUrl}/api/marketplace/public/channels/search?page=${number}&page_size=${PAGE_SIZE}`;
      let pending;
      if (onlyMissing && this.missing.length) {
        pending = this.missing.map(item => item.page);
        this.progress = this.pages - pending.length;
      } else {
        this.map = new Map();
        this.missing = [];
        this.progress = 0;
        const hot = await getJson(`${this.site.webUrl}/api/marketplace/hot-models`).catch(() => null);
        if (hot) {
          const items = Array.isArray(hot.items) ? hot.items : [];
          const brandMap = new Map();
          for (const item of items) {
            const brand = item.brand || '其他';
            const entry = brandMap.get(brand) ?? {id: brand, name: brand, count: 0};
            entry.count += 1;
            brandMap.set(brand, entry);
          }
          this.brands = [...brandMap.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
          this.models = items.map(item => ({brand: item.brand || '其他', name: item.model_name, count: item.listing_count ?? 0})).filter(item => item.name);
        }
        // Page 1 is fetched alone: it carries `total`, which sizes the rest of the crawl. A failure
        // here is raised straight to the UI.
        const first = await getJson(url(1));
        this.total = Number(first.total) || 0;
        this.pages = Math.max(1, Math.ceil(this.total / PAGE_SIZE));
        for (const item of Array.isArray(first.items) ? first.items : []) {
          const row = compact(item);
          this.map.set(row.rowKey, row);
          const rate = Number(item.realtime_ratio_exchange_rate);
          if (Number.isFinite(rate) && rate > 0) this.exchangeRate = rate;
        }
        this.progress = 1;
        pending = Array.from({length: this.pages - 1}, (_, index) => index + 2);
      }
      let published = 0;
      const publish = () => {
        // Rows become queryable while the crawl is still running (the page fills progressively).
        if (++published % PUBLISH_EVERY === 0) this.rows = [...this.map.values()];
      };
      this.missing = await this.crawl(pending, url, publish);
      this.rows = [...this.map.values()];
      this.total = this.rows.length;
      this.partial = this.missing.length > 0;
      this.missingPages = this.missing.length;
      this.fetchedAt = Date.now();
      this.state = 'ready';
      this.progress = this.pages;
      this.error = this.partial ? this.describeMissing() : null;
      try { await onLoaded?.(this); } catch { /* cache write failures never break the live snapshot */ }
      return this;
    } catch (error) {
      this.rows = [...(this.map?.values() ?? [])];
      this.state = this.rows.length ? 'ready' : 'error';
      this.error = error instanceof RelayError ? error.message : '中转站快照生成失败，请稍后重试。';
      this.partial = this.rows.length > 0;
      if (error?.status) this.error = `${this.error}（HTTP ${error.status}）`;
      return this;
    }
  }

  /** "12 页被限流（HTTP 429）…" — raw cause, no softening. */
  describeMissing() {
    const byStatus = new Map();
    for (const item of this.missing) byStatus.set(item.status || item.code, (byStatus.get(item.status || item.code) ?? 0) + 1);
    const parts = [...byStatus.entries()].map(([key, count]) => `${count} 页 ${typeof key === 'number' ? `HTTP ${key}` : key}`);
    return `${this.missing.length}/${this.pages} 页读取失败：${parts.join('、')}。已展示其余 ${this.rows.length} 条渠道，可点击「补抓失败页」。`;
  }

  /** Re-fetch only the pages that failed last time. */
  retryMissing() {
    if (this.promise || !this.missing.length) return this.promise ?? Promise.resolve(this);
    this.promise = this.load(false, true).finally(() => { this.promise = null; });
    return this.promise;
  }

  /** Look up channel/model pairs: price + presence. `found:null` when the snapshot cannot answer yet. */
  resolve(refs) {
    const ready = this.rows.length > 0 && (this.state === 'ready' || this.progress >= this.pages);
    const index = new Map(this.rows.map(row => [`${row.channelId}|${row.modelName}`, row]));
    return refs.map(ref => {
      const row = index.get(`${ref.channelId}|${ref.model}`);
      return {
        channelId: ref.channelId, model: ref.model,
        found: row ? true : (ready && !this.partial ? false : null),
        rowKey: row?.rowKey ?? null, inputPrice: row?.inputPrice ?? null, outputPrice: row?.outputPrice ?? null,
        perRequestPrice: row?.perRequestPrice ?? null, chargeType: row?.chargeType ?? '',
      };
    });
  }

  query({brand, model, brands, models, fidelity = 'all', sort, offset = 0, limit = 200}) {
    const brandSet = new Set([...(Array.isArray(brands) ? brands : []), ...(brand ? [brand] : [])]);
    const modelSet = new Set([...(Array.isArray(models) ? models : []), ...(model ? [model] : [])]);
    const filtered = this.rows.filter(row => (!brandSet.size || brandSet.has(row.brand))
      && (!modelSet.size || modelSet.has(row.modelName))
      && (fidelity === 'guaranteed' ? row.guaranteed : fidelity === 'direct' ? row.officialDirect : true));
    const sorted = sortRows(filtered, sort);
    const start = Math.max(0, Math.min(offset, sorted.length));
    const end = Math.min(start + Math.max(1, Math.min(limit, 20000)), sorted.length);
    return {rows: sorted.slice(start, end), total: sorted.length, offset: start};
  }

  detail(rowKey) {
    return this.rows.find(row => row.rowKey === rowKey) ?? null;
  }

  /** Restore a persisted snapshot so the page opens instantly after a restart (then refresh if stale). */
  restore(cached) {
    if (!cached || !Array.isArray(cached.rows) || !cached.rows.length || this.rows.length) return;
    this.rows = cached.rows;
    this.map = new Map(cached.rows.map(row => [row.rowKey, row]));
    this.missing = Array.isArray(cached.missing) ? cached.missing : [];
    this.missingPages = this.missing.length;
    this.partial = this.missing.length > 0;
    if (Number(cached.exchangeRate) > 0) this.exchangeRate = Number(cached.exchangeRate);
    this.brands = Array.isArray(cached.brands) ? cached.brands : [];
    this.models = Array.isArray(cached.models) ? cached.models : [];
    this.total = this.rows.length;
    this.fetchedAt = Number(cached.fetchedAt) || 0;
    this.pages = Math.max(1, Math.ceil(this.total / PAGE_SIZE));
    this.progress = this.pages;
    this.state = 'ready';
  }
  serialize() {
    return {siteId: this.site.id, fetchedAt: this.fetchedAt, rows: this.rows, brands: this.brands, models: this.models, missing: this.missing, exchangeRate: this.exchangeRate};
  }

  /** On-demand 24h / 7d series: small pages return the bucket arrays the bulk pages omit. */
  async history(rowKey) {
    const row = this.detail(rowKey);
    if (!row) throw new RelayError('relay-not-found', '渠道不在当前快照中，请刷新后重试。');
    const query = new URLSearchParams({page: '1', page_size: '20', channel_id: String(row.channelId), model: row.modelName});
    const data = await getJson(`${this.site.webUrl}/api/marketplace/public/channels/search?${query}`);
    const items = Array.isArray(data.items) ? data.items : [];
    const item = items.find(entry => entry.listing_id === row.listingId) ?? items.find(entry => entry.channel_id === row.channelId) ?? null;
    if (!item) throw new RelayError('relay-not-found', '中转站没有返回该渠道的历史数据。');
    return {
      rowKey,
      success24h: rate(item.success_rate_24h), success7d: rate(item.success_rate_7d),
      state24h: item.sr_24h_state ?? '', state7d: item.sr_7d_state ?? '',
      hours: bucketsOf(item.b24), days: bucketsOf(item.b7d),
      lastSuccessAt: item.last_success_at ?? null, lastFailureAt: item.last_failure_at ?? null, lastFailureCode: item.last_failure_code ?? '',
      recent: Array.isArray(item.success_buckets) ? item.success_buckets.map(bucket => ({samples: bucket?.sample_count ?? 0, success: bucket?.success_count ?? 0, rate: rate(bucket?.success_rate)})) : [],
      fetchedAt: Date.now(),
    };
  }

  /** Anonymous live concurrency sample for one channel listing. */
  async concurrency(rowKey) {
    const row = this.detail(rowKey);
    if (!row) throw new RelayError('relay-not-found', '渠道不在当前快照中，请刷新后重试。');
    let response;
    try {
      response = await fetch(`${this.site.webUrl}/api/marketplace/public/channel-concurrency/query`, {
        method: 'POST', headers: {'content-type': 'application/json', accept: 'application/json'},
        body: JSON.stringify({listing_ids: [row.listingId]}), signal: AbortSignal.timeout(15_000),
      });
    } catch { throw new RelayError('relay-network', '无法连接中转站，请检查网络后重试。'); }
    if (!response.ok) throw new RelayError('relay-unavailable', `并发查询失败（HTTP ${response.status}）`);
    const body = await response.json().catch(() => null);
    const list = Array.isArray(body?.data) ? body.data : Array.isArray(body?.data?.items) ? body.data.items : [];
    const item = list.find(entry => entry?.listing_id === row.listingId || entry?.channel_id === row.channelId) ?? list[0] ?? null;
    if (!item) return {rowKey, active: null, limit: null, limitState: '', quality: '', sampledAt: Date.now()};
    return {
      rowKey, active: Number.isFinite(item.active) ? item.active : null,
      limit: Number.isFinite(item.limit?.value) ? item.limit.value : null, limitState: item.limit?.state ?? '',
      quality: typeof item.quality === 'string' ? item.quality : '', sampledAt: Number(item.sampled_at_ms) || Date.now(),
    };
  }

  /** Latest SVG self-test (login-only). Returns the SVG markup; the client renders it in a sandboxed image. */
  async svg(rowKey, headers) {
    const row = this.detail(rowKey);
    if (!row) throw new RelayError('relay-not-found', '渠道不在当前快照中，请刷新后重试。');
    if (!headers) throw new RelayError('auth-missing', 'SVG 检测需要登录态：请先在设置「API 适配站点」填写系统访问令牌与用户 ID');
    const query = new URLSearchParams({channel_id: String(row.channelId), model: row.modelName});
    let response;
    try {
      response = await fetch(`${this.site.webUrl}/api/marketplace/self-tests/pelican/latest?${query}`, {headers: {accept: 'application/json', ...headers}, signal: AbortSignal.timeout(20_000)});
    } catch { throw new RelayError('relay-network', '无法连接中转站，请检查网络后重试。'); }
    if (response.status === 401 || response.status === 403) throw new RelayError('auth-invalid', '登录态无效，请在设置中重新填写系统访问令牌');
    if (!response.ok) throw new RelayError('relay-unavailable', `SVG 检测读取失败（HTTP ${response.status}）`);
    const body = await response.json().catch(() => null);
    const data = body?.data ?? body;
    const item = data?.item;
    if (!item?.svg_base64) return {rowKey, svg: null, createdAt: null};
    let svg = '';
    try { svg = Buffer.from(String(item.svg_base64), 'base64').toString('utf8').slice(0, 400_000); } catch { svg = ''; }
    return {rowKey, svg: svg || null, createdAt: item.created_at ?? item.updated_at ?? null};
  }
}

const snapshots = new Map();

export function snapshotOf(siteId) {
  const site = siteOf(siteId);
  if (!site) throw new RelayError('relay-unknown-site', '没有找到该中转站站点。');
  let snapshot = snapshots.get(site.id);
  if (!snapshot) {
    snapshot = new RelaySnapshot(site);
    snapshots.set(site.id, snapshot);
  }
  return snapshot;
}

export function disposeSnapshots() {
  snapshots.clear();
}
