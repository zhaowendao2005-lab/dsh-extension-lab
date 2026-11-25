import React, { useEffect, useMemo, useStore } from '../../runtime';
import type { A6ChannelPrice, A6KeyChannel, ChannelTestEntry, Workbench } from '../../types';
import { Icon } from '../../components/common';
import { channelTestKey } from '../../stores/a6insights.stores';

const rowKey = (channel: A6KeyChannel): string => channelTestKey(channel.model, channel.channelId);

function formatTime(value: number | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  const pad = (input: number): string => String(input).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function percent(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
}

function resultOf(entry: ChannelTestEntry): string {
  if (entry.fingerprint) {
    const name = entry.fingerprint.predictionName ?? '—';
    const decision = entry.fingerprint.decision === 'match' ? '符合' : entry.fingerprint.decision === 'mismatch' ? '不符合' : '无法判定';
    return `${name} · ${percent(entry.fingerprint.probability)} · ${decision}`;
  }
  if (entry.custom) {
    const parts = [entry.custom.phase ?? '—'];
    if (typeof entry.custom.cost === 'number') parts.push(`¥${entry.custom.cost.toFixed(4)}`);
    if (entry.custom.error) parts.push(entry.custom.error);
    return parts.join(' · ');
  }
  return '—';
}

const STATUS_LABEL: Record<string, string> = { queued: '排队中', running: '进行中', done: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断' };
const STATUS_TONE: Record<string, 'ok' | 'fail' | 'warn' | 'muted'> = { done: 'ok', failed: 'fail', cancelled: 'warn', interrupted: 'warn', running: 'warn', queued: 'muted' };

const PRICE_FIELDS: {label: string; field: 'input' | 'output' | 'cacheRead' | 'cacheWrite'}[] = [
  {label: '输入', field: 'input'}, {label: '输出', field: 'output'}, {label: '缓存命中', field: 'cacheRead'}, {label: '缓存写入', field: 'cacheWrite'},
];

/** Micros are the site's own scale for one million tokens; the panel shows CNY with the same exchange rate it shows elsewhere. */
function priceText(price: A6ChannelPrice | undefined, field: 'input' | 'output' | 'cacheRead' | 'cacheWrite', rate: number | null): string {
  if (!price) return '—';
  const cny = price.currency === 'CNY' ? 1 : rate;
  if (price.chargeType === 'per_request') {
    if (field !== 'input' || typeof price.perRequest !== 'number' || !Number.isFinite(price.perRequest) || price.perRequest < 0 || cny === null || cny <= 0) return '—';
    return `¥${String(Number((price.perRequest / 1_000_000 * cny).toFixed(4)))}/次`;
  }
  const value = price[field];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || cny === null || cny <= 0) return '—';
  return `¥${String(Number((value / 1_000_000 * cny).toFixed(4)))}`;
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: 'brand' | 'ok' | 'warn' | 'fail' | 'muted' }) {
  return <span className={`mit-key-badge${tone ? ` is-${tone}` : ''}`}>{children}</span>;
}

function TestRows({ store, entries, loading, error }: { store: Workbench; entries: ChannelTestEntry[]; loading: boolean; error?: string }) {
  if (loading) return <p className="mit-key-empty">正在读取测试记录…</p>;
  if (error) return <p className="mit-key-error">{error}</p>;
  if (!entries.length) return <p className="mit-key-empty">这个渠道还没有关联的测试记录。</p>;
  return <div className="mit-key-tests">
    <table className="mit-key-test-table">
      <colgroup>
        <col style={{ width: 132 }} />
        <col style={{ width: 92 }} />
        <col />
        <col style={{ width: 220 }} />
        <col style={{ width: 132 }} />
      </colgroup>
      <thead><tr><th scope="col">时间</th><th scope="col">类型</th><th scope="col">测试记录</th><th scope="col">结果</th><th scope="col" className="mit-key-test-actions-head">操作</th></tr></thead>
      <tbody>{entries.map(entry => <tr key={`${entry.attemptId}:${entry.runId ?? 'fp'}`}>
        <td className="mit-key-time mit-tabular">{formatTime(entry.at)}</td>
        <td><Badge tone={entry.recordKind === 'fingerprint' ? 'brand' : 'muted'}>{entry.recordKind === 'fingerprint' ? '指纹测试' : '自定义测试'}</Badge></td>
        <td className="mit-key-record"><button type="button" className="mit-key-link" onClick={() => store.actions.openRecord(entry.recordId)}>{entry.recordName}</button><small>#{entry.attemptNumber} · {STATUS_LABEL[entry.status] ?? entry.status}</small></td>
        <td className="mit-key-result" title={resultOf(entry)}>{resultOf(entry)}</td>
        <td className="mit-key-actions-cell"><div className="mit-key-test-actions">
          <button type="button" className="mit-text-button" onClick={() => store.actions.openRecord(entry.recordId)}>详情</button>
          {entry.recordKind === 'custom' && entry.runId && <button type="button" className="mit-text-button" onClick={() => store.actions.openChannelTest(entry)}>查看结果</button>}
        </div></td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export function KeyView({ store }: { store: Workbench }) {
  const operations = useStore(store.a6Insights, state => state.operations);
  const keyChannels = useStore(store.a6Insights, state => state.keyChannels);
  const channelTests = useStore(store.a6Insights, state => state.channelTests);
  const keyView = useStore(store.a6Insights, state => state.keyView);
  const keyPrices = useStore(store.a6Insights, state => state.keyPrices);

  useEffect(() => { if (!operations) store.actions.loadA6Operations(); }, [operations, store]);
  useEffect(() => {
    if (keyView.tokenId !== null || !operations) return;
    const first = operations.tokenId ?? operations.tokens[0]?.id ?? null;
    if (first !== null) store.actions.patchKeyView({tokenId: first});
  }, [operations, keyView.tokenId, store]);

  const tokens = operations?.tokens ?? [];
  const tokenId = keyView.tokenId;
  const channels = useMemo(() => {
    const view = keyChannels.view;
    const list = view && view.tokenId === tokenId ? view.channels : [];
    const needle = keyView.query.trim().toLowerCase();
    return needle ? list.filter(channel => channel.model.toLowerCase().includes(needle) || String(channel.channelId).includes(needle)) : list;
  }, [keyChannels.view, tokenId, keyView.query]);
  const token = tokens.find(item => item.id === tokenId) ?? null;
  const prices = keyPrices.tokenId === tokenId ? keyPrices.view?.prices ?? {} : {};
  const exchangeRate = keyPrices.tokenId === tokenId ? keyPrices.view?.exchangeRate ?? null : null;
  const pricesNote = keyPrices.tokenId !== tokenId ? undefined : keyPrices.loading ? '正在读取站点市场报价…' : keyPrices.view?.error ?? (keyPrices.view ? `站点市场挂牌价 · ${new Date(keyPrices.view.generatedAt).toLocaleString('zh-CN')}${keyPrices.view.exchangeRate ? ` · USD/CNY ${keyPrices.view.exchangeRate}` : ''} · 人民币/百万 Token，不等于实际扣费` : undefined);
  const selectedSet = new Set(keyView.selected);
  const channelsByModel = useMemo(() => {
    const groups = new Map<string, A6KeyChannel[]>();
    for (const channel of channels) {
      const list = groups.get(channel.model);
      if (list) list.push(channel);
      else groups.set(channel.model, [channel]);
    }
    return [...groups.entries()];
  }, [channels]);
  const expandRow = (channel: A6KeyChannel): void => {
    const key = rowKey(channel);
    const next = keyView.expanded.includes(key) ? keyView.expanded.filter(item => item !== key) : [...keyView.expanded, key];
    store.actions.patchKeyView({expanded: next});
    if (next.includes(key) && !channelTests[key]?.view && !channelTests[key]?.loading) store.actions.loadChannelTests(channel.model, channel.channelId);
  };
  const selectedRouted = channels.filter(channel => keyView.selected.includes(rowKey(channel)) && channel.routed);
  const removeRoutes = (): void => {
    if (!selectedRouted.length) return;
    store.actions.removeKeyRoutes(selectedRouted.map(channel => ({model: channel.model, channelId: channel.channelId})));
    store.actions.patchKeyView({selected: []});
  };
  const toggleSelected = (key: string): void => {
    store.actions.patchKeyView({selected: keyView.selected.includes(key) ? keyView.selected.filter(item => item !== key) : [...keyView.selected, key]});
  };

  return <div className="mit-feature-view mit-key-view">
    <header className="mit-feature-head mit-key-head">
      <div>
        <span className="mit-kicker">A6API</span>
        <h2>按 Key 查看</h2>
        <p className="mit-muted">选择一个 Key，查看它绑定的渠道与这些渠道在所有测试里的历史结果。</p>
      </div>
      <div className="mit-feature-actions">
        <button type="button" className="mit-ghost-button" disabled={tokenId === null || keyChannels.loading} onClick={() => tokenId !== null && store.actions.loadKeyChannels(tokenId, true)}><Icon name="refresh" size={14}/>刷新</button>
      </div>
    </header>
    <div className="mit-key-layout">
      <aside className="mit-key-list" aria-label="Key 列表">
        <label className="mit-key-search"><Icon name="search" size={13}/><input value={keyView.query} onChange={event => store.actions.patchKeyView({query: event.target.value})} placeholder="筛选 Key 或渠道…" aria-label="筛选 Key 或渠道"/></label>
        {operations === null ? <p className="mit-key-empty">正在读取账号 Key…</p> : tokens.length === 0 ? <p className="mit-key-empty">当前账号还没有 Key。</p> : <ul>
          {tokens.filter(item => !keyView.query.trim() || `${item.name ?? ''} ${item.id} ${item.maskedKey ?? ''}`.toLowerCase().includes(keyView.query.trim().toLowerCase())).map(item => <li key={item.id}>
            <button type="button" className={`mit-key-item${item.id === tokenId ? ' is-active' : ''}`} onClick={() => store.actions.patchKeyView({tokenId: item.id})} aria-pressed={item.id === tokenId}>
              <span className="mit-key-name">{item.name || `Key #${item.id}`}</span>
              <small>#{item.id}{item.maskedKey ? ` · ${item.maskedKey}` : ''}</small>
              {item.status !== undefined && item.status !== 1 && item.status !== '1' && <Badge tone="fail">不可用</Badge>}
            </button>
          </li>)}
        </ul>}
      </aside>
      <section className="mit-key-main">
        {tokenId === null ? <p className="mit-key-empty">从左侧选择一个 Key。</p> : <>
          <div className="mit-key-summary">
            <strong>Key #{tokenId}</strong>
            {token && <span className="mit-muted">{token.name || '未命名'}{token.maskedKey ? ` · ${token.maskedKey}` : ''}</span>}
            <span className="mit-key-count">{channels.length} 个渠道</span>
            {keyView.selected.length > 0 && <span className="mit-key-selected">已选 {keyView.selected.length} 个渠道</span>}
            {selectedRouted.length > 0 && <button type="button" className="mit-key-route-remove" disabled={keyChannels.loading} onClick={removeRoutes} title="把选中的渠道从模型路由池里移除">取消路由 · {selectedRouted.length}</button>}
            {channels.length > 0 && <span className="mit-key-hint">「固定」「路由」标记可直接点击取消</span>}
            {keyChannels.view?.testsError && <span className="mit-key-tests-error">测试记录统计不可用：{keyChannels.view.testsError}</span>}
          </div>
          {keyChannels.loading && !keyChannels.view && <p className="mit-key-empty">正在读取绑定的渠道…</p>}
          {keyChannels.error && <p className="mit-key-error">{keyChannels.error}</p>}
          {!keyChannels.loading && !keyChannels.error && channels.length === 0 && <p className="mit-key-empty">这个 Key 目前没有固定的模型或路由池。</p>}
          {channels.length > 0 && <div className="mit-key-table-scroll">
            <table className="mit-key-table">
              <colgroup>
                <col style={{ width: 38 }} />
                <col style={{ width: 110 }} />
                <col />
                <col style={{ width: 150 }} />
                <col style={{ width: 240 }} />
                <col style={{ width: 300 }} />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" className="mit-key-check"><span className="mit-custom-sr-only">选择</span></th>
                  <th scope="col">渠道</th>
                  <th scope="col">绑定</th>
                  <th scope="col">状态</th>
                  <th scope="col" className="mit-key-price-head" title={pricesNote}>
                    <span className="mit-key-price-title">渠道价格</span>
                    <span className="mit-key-price-labels">{PRICE_FIELDS.map(item => <span key={item.field}>{item.label}</span>)}</span>
                  </th>
                  <th scope="col">测试记录</th>
                </tr>
              </thead>
              <tbody>
                {channelsByModel.map(([model, list]) => {
                  const keys = list.map(rowKey);
                  const allSelected = keys.every(key => selectedSet.has(key));
                  const pinned = list.filter(channel => channel.pinned).length;
                  const effective = list.filter(channel => channel.routeEffective).length;
                  const recorded = list.reduce((total, channel) => total + (keyChannels.view?.tests?.[rowKey(channel)]?.total ?? 0), 0);
                  return <React.Fragment key={model}>
                    <tr className="mit-key-group-row">
                      <td className="mit-key-check"><input type="checkbox" aria-label={`选择 ${model} 的全部渠道`} checked={allSelected} onChange={event => store.actions.patchKeyView({selected: event.target.checked ? [...new Set([...keyView.selected, ...keys])] : keyView.selected.filter(key => !keys.includes(key))})}/></td>
                      <td colSpan={5}>
                        <div className="mit-key-group-head">
                          <strong className="mit-key-group-model">{model}</strong>
                          <span className="mit-key-group-count">{list.length} 个渠道</span>
                          {pinned > 0 && <Badge tone="brand">{pinned} 个固定</Badge>}
                          {effective > 0 && <Badge tone="ok">{effective} 个路由生效</Badge>}
                          {recorded > 0 && <Badge tone="muted">{recorded} 条测试记录</Badge>}
                        </div>
                      </td>
                    </tr>
                    {list.map(channel => {
                      const key = rowKey(channel);
                      const open = keyView.expanded.includes(key);
                      const tests = channelTests[key];
                      const summary = keyChannels.view?.tests?.[key];
                      const total = tests?.view?.total ?? summary?.total ?? null;
                      const latest = tests?.view?.entries[0] ?? summary?.latest ?? null;
                      return <React.Fragment key={key}>
                        <tr className={`mit-key-row${open ? ' is-open' : ''}`} onClick={() => expandRow(channel)}>
                          <td className="mit-key-check" onClick={event => event.stopPropagation()}><input type="checkbox" aria-label={`选择 ${channel.model} 渠道 ${channel.channelId}`} checked={selectedSet.has(key)} onChange={() => toggleSelected(key)}/></td>
                          <td className="mit-key-channel mit-tabular">#{channel.channelId}</td>
                          <td className="mit-key-bindings"><div className="mit-key-bindings-list">
                            {channel.pinned && <button type="button" className="mit-key-badge is-brand is-action" disabled={keyChannels.loading} title="点击取消固定" onClick={event => {event.stopPropagation(); store.actions.unpinKeyChannel({model: channel.model, channelId: channel.channelId});}}>固定</button>}
                            {channel.routed && <button type="button" className="mit-key-badge is-muted is-action" disabled={keyChannels.loading} title="点击取消路由" onClick={event => {event.stopPropagation(); store.actions.removeKeyRoutes([{model: channel.model, channelId: channel.channelId}]);}}>路由{channel.poolSize > 1 ? `（池 ${channel.poolSize}）` : ''}</button>}
                            {channel.routeEffective && <Badge tone="ok">路由生效</Badge>}
                            {!channel.pinned && !channel.routed && <span className="mit-muted">—</span>}
                          </div></td>
                          <td className="mit-key-status" title={channel.status || undefined}>{channel.status || '—'}</td>
                          <td className="mit-key-price" title={pricesNote}><div className="mit-key-price-grid">
                            {PRICE_FIELDS.map(item => <span key={item.field} className="mit-tabular">{priceText(prices[key], item.field, exchangeRate)}</span>)}
                          </div></td>
                          <td className="mit-key-open">
                            <div className="mit-key-tests-cell">
                              <div className="mit-key-latest">
                                {latest ? <>
                                  <Badge tone={STATUS_TONE[latest.status] ?? 'muted'}>{STATUS_LABEL[latest.status] ?? latest.status}</Badge>
                                  <span className="mit-key-latest-result" title={resultOf(latest)}>{resultOf(latest)}</span>
                                  <span className="mit-key-latest-time mit-tabular">{formatTime(latest.at)}</span>
                                </> : <span className="mit-muted">{total === null ? '尚未载入' : '暂无记录'}</span>}
                              </div>
                              <button type="button" className="mit-text-button" onClick={event => {event.stopPropagation(); expandRow(channel);}} aria-expanded={open}>{open ? '收起' : total === null ? '查看' : total ? `查看 ${total} 条` : '无记录'}<Icon name="chevron" size={12}/></button>
                            </div>
                          </td>
                        </tr>
                        {open && <tr className="mit-key-expand"><td colSpan={6}><TestRows store={store} entries={tests?.view?.entries ?? []} loading={Boolean(tests?.loading)} error={tests?.error}/></td></tr>}
                      </React.Fragment>;
                    })}
                  </React.Fragment>;
                })}
              </tbody>
            </table>
          </div>}
        </>}
      </section>
    </div>
  </div>;
}
