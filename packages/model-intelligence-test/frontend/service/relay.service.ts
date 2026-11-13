import type { RelayResolved, TagMap, ManagedRoute, ModelIntelligenceTransport, ProviderWriteResult, PartitionItemInput, PartitionsView, RelayApi, RelayAuthStatus, RelayConcurrency, RelayFidelity, RelayHistory, RelayRow, RelayRowsView, RelaySite, RelaySnapshotView, RelaySort, RelayStatus, RelaySvg } from '../types';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validateStatus(value: unknown): RelayStatus {
  if (!isObject(value)) throw new Error('中转站状态格式无效');
  const state = value.state;
  if (state !== 'idle' && state !== 'building' && state !== 'ready' && state !== 'error') throw new Error('中转站状态格式无效');
  if (typeof value.progress !== 'number' || typeof value.pages !== 'number' || typeof value.total !== 'number') throw new Error('中转站状态格式无效');
  const missing = Array.isArray(value.missing) ? (value.missing as unknown[]).filter(isObject).map(item => ({page: Number(item.page) || 0, status: Number(item.status) || 0, code: String(item.code ?? ''), message: String(item.message ?? '')})) : [];
  return {
    state,
    partial: Boolean(value.partial),
    missingPages: typeof value.missingPages === 'number' ? value.missingPages : missing.length,
    missing,
    exchangeRate: typeof value.exchangeRate === 'number' && value.exchangeRate > 0 ? value.exchangeRate : undefined,
    progress: value.progress,
    pages: value.pages,
    total: value.total,
    fetchedAt: typeof value.fetchedAt === 'number' ? value.fetchedAt : null,
    stale: Boolean(value.stale),
    error: typeof value.error === 'string' ? value.error : null,
  };
}

export async function readSites(transport: ModelIntelligenceTransport): Promise<{sites: RelaySite[]; sorts: RelaySort[]}> {
  const value = await transport.relaySites();
  if (!isObject(value) || !Array.isArray(value.sites) || !Array.isArray(value.sorts)) throw new Error('中转站站点目录格式无效');
  return {sites: value.sites as RelaySite[], sorts: value.sorts as RelaySort[]};
}

export async function readSnapshot(transport: ModelIntelligenceTransport, siteId: string, force = false): Promise<RelaySnapshotView> {
  const value = await transport.relaySnapshot({siteId, ...(force ? {force: true} : {})});
  if (!isObject(value) || !isObject(value.site) || !Array.isArray(value.brands) || !Array.isArray(value.models) || !Array.isArray(value.sorts)) throw new Error('中转站快照格式无效');
  return {
    site: value.site as RelaySite,
    status: validateStatus(value.status),
    brands: value.brands as RelaySnapshotView['brands'],
    models: value.models as RelaySnapshotView['models'],
    sorts: value.sorts as RelaySort[],
  };
}

export async function readRows(transport: ModelIntelligenceTransport, request: {siteId: string; brands?: string[]; models?: string[]; fidelity?: RelayFidelity; sort: string; offset: number; limit: number}): Promise<RelayRowsView> {
  const value = await transport.relayRows(request);
  if (!isObject(value) || !Array.isArray(value.rows)) throw new Error('中转站渠道列表格式无效');
  return {
    status: validateStatus(value.status),
    rows: value.rows as RelayRow[],
    total: typeof value.total === 'number' ? value.total : 0,
    offset: typeof value.offset === 'number' ? value.offset : 0,
  };
}

export async function readRow(transport: ModelIntelligenceTransport, siteId: string, rowKey: string): Promise<{row: RelayRow; status: RelayStatus}> {
  const value = await transport.relayRow({siteId, rowKey});
  if (!isObject(value) || !isObject(value.row)) throw new Error('中转站渠道详情格式无效');
  return {row: value.row as RelayRow, status: validateStatus(value.status)};
}

export async function readHistory(transport: ModelIntelligenceTransport, siteId: string, rowKey: string): Promise<RelayHistory> {
  const value = await transport.relayHistory({siteId, rowKey});
  if (!isObject(value) || !Array.isArray(value.hours) || !Array.isArray(value.days)) throw new Error('渠道成功率历史格式无效');
  return value;
}
export async function readConcurrency(transport: ModelIntelligenceTransport, siteId: string, rowKey: string): Promise<RelayConcurrency> {
  const value = await transport.relayConcurrency({siteId, rowKey});
  if (!isObject(value)) throw new Error('渠道并发数据格式无效');
  return value;
}
export async function readSvg(transport: ModelIntelligenceTransport, siteId: string, rowKey: string): Promise<RelaySvg> {
  const value = await transport.relaySvg({siteId, rowKey});
  if (!isObject(value) || (value.svg !== null && typeof value.svg !== 'string')) throw new Error('SVG 检测结果格式无效');
  return value;
}

function partitionsOf(value: unknown): PartitionsView {
  if (!isObject(value) || !Array.isArray(value.partitions)) throw new Error('分区数据格式无效');
  return value as unknown as PartitionsView;
}
export async function listPartitions(transport: ModelIntelligenceTransport): Promise<PartitionsView> { return partitionsOf(await transport.partitionsList()); }
export async function savePartition(transport: ModelIntelligenceTransport, request: {id?: string; name: string}): Promise<PartitionsView> { return partitionsOf(await transport.partitionSave(request)); }
export async function deletePartition(transport: ModelIntelligenceTransport, partitionId: string): Promise<PartitionsView> { return partitionsOf(await transport.partitionDelete({partitionId})); }
export async function updatePartitionItem(transport: ModelIntelligenceTransport, request: PartitionItemInput): Promise<PartitionsView> { return partitionsOf(await transport.partitionItem(request)); }

function authOf(value: unknown): RelayAuthStatus {
  if (!isObject(value) || !isObject(value.apiKey) || !isObject(value.accessToken) || !Array.isArray(value.providers)) throw new Error('中转站凭据状态格式无效');
  return value as unknown as RelayAuthStatus;
}
export async function readAuth(transport: ModelIntelligenceTransport, siteId: string): Promise<RelayAuthStatus> { return authOf(await transport.relayAuthStatus({siteId})); }
export async function writeAuth(transport: ModelIntelligenceTransport, request: {siteId: string; apiKey?: string | null; accessToken?: string | null; userId?: string | null}): Promise<RelayAuthStatus> { return authOf(await transport.relayAuthSet(request)); }
export async function verifyAuth(transport: ModelIntelligenceTransport, siteId: string): Promise<RelayAuthStatus> { return authOf(await transport.relayAuthVerify({siteId})); }
function providerWriteOf(value: unknown): ProviderWriteResult {
  if (!isObject(value) || !Array.isArray(value.providers)) throw new Error('提供商写入结果格式无效');
  return {
    providers: value.providers as ManagedRoute[],
    applied: value.applied === true,
    reason: typeof value.reason === 'string' ? value.reason : undefined,
    snippet: typeof value.snippet === 'string' ? value.snippet : '',
    cleared: typeof value.cleared === 'number' ? value.cleared : undefined,
  };
}
export async function setProviderModel(transport: ModelIntelligenceTransport, request: {siteId: string; format: RelayApi; model: string; name?: string; remove?: boolean; channelId?: number; image?: boolean; reasoning?: boolean; contextWindow?: number}): Promise<ProviderWriteResult> {
  return providerWriteOf(await transport.relayProviderModel(request));
}
export async function clearProviders(transport: ModelIntelligenceTransport, siteId: string): Promise<ProviderWriteResult> {
  return providerWriteOf(await transport.relayProvidersClear({siteId}));
}
export async function readManagedRoutes(transport: ModelIntelligenceTransport): Promise<string[]> {
  const value = await transport.relayManagedRoutes();
  return isObject(value) && Array.isArray(value.routes) ? value.routes.filter((item): item is string => typeof item === 'string') : [];
}

export async function resolveChannels(transport: ModelIntelligenceTransport, siteId: string, refs: {channelId: number; model: string}[]): Promise<{status: RelayStatus; items: RelayResolved[]}> {
  const value = await transport.relayResolve({siteId, refs});
  if (!isObject(value) || !Array.isArray(value.items)) throw new Error('渠道查询结果格式无效');
  return {status: validateStatus(value.status), items: value.items as RelayResolved[]};
}
export async function retryMissingPages(transport: ModelIntelligenceTransport, siteId: string): Promise<RelayStatus> {
  const value = await transport.relayRetryMissing({siteId});
  if (!isObject(value)) throw new Error('补抓结果格式无效');
  return validateStatus(value.status);
}
function tagsOf(value: unknown): TagMap {
  if (!isObject(value) || !isObject(value.tags)) throw new Error('标签数据格式无效');
  const map: TagMap = {};
  for (const [key, list] of Object.entries(value.tags)) if (Array.isArray(list)) map[key] = list.filter((tag): tag is string => typeof tag === 'string');
  return map;
}
export async function readTags(transport: ModelIntelligenceTransport): Promise<TagMap> { return tagsOf(await transport.tagsList()); }
export async function writeTags(transport: ModelIntelligenceTransport, target: string, tags: string[]): Promise<TagMap> { return tagsOf(await transport.tagsSet({target, tags})); }
