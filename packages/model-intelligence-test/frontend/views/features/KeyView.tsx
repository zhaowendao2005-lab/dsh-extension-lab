import React, { useEffect, useMemo, useStore } from '../../runtime';
import type { A6KeyChannel, ChannelTestEntry, Workbench } from '../../types';
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

function Badge({ children, tone }: { children: React.ReactNode; tone?: 'brand' | 'ok' | 'warn' | 'fail' | 'muted' }) {
  return <span className={`mit-key-badge${tone ? ` is-${tone}` : ''}`}>{children}</span>;
}

function TestRows({ store, entries, loading, error }: { store: Workbench; entries: ChannelTestEntry[]; loading: boolean; error?: string }) {
  if (loading) return <p className="mit-key-empty">正在读取测试记录…</p>;
  if (error) return <p className="mit-key-error">{error}</p>;
  if (!entries.length) return <p className="mit-key-empty">这个渠道还没有关联的测试记录。</p>;
  return <div className="mit-key-tests">
    <table className="mit-key-test-table">
      <thead><tr><th>时间</th><th>类型</th><th>测试记录</th><th>结果</th><th>操作</th></tr></thead>
      <tbody>{entries.map(entry => <tr key={`${entry.attemptId}:${entry.runId ?? 'fp'}`}>
        <td className="mit-key-time mit-tabular">{formatTime(entry.at)}</td>
        <td><Badge tone={entry.recordKind === 'fingerprint' ? 'brand' : 'muted'}>{entry.recordKind === 'fingerprint' ? '指纹测试' : '自定义测试'}</Badge></td>
        <td className="mit-key-record"><button type="button" className="mit-key-link" onClick={() => store.actions.openRecord(entry.recordId)}>{entry.recordName}</button><small>#{entry.attemptNumber} · {STATUS_LABEL[entry.status] ?? entry.status}</small></td>
        <td className="mit-key-result" title={resultOf(entry)}>{resultOf(entry)}</td>
        <td className="mit-key-actions">
          <button type="button" className="mit-text-button" onClick={() => store.actions.openRecord(entry.recordId)}>详情</button>
          {entry.recordKind === 'custom' && entry.runId && <button type="button" className="mit-text-button" onClick={() => store.actions.openChannelTest(entry)}>查看结果</button>}
        </td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export function KeyView({ store }: { store: Workbench }) {
  const operations = useStore(store.a6Insights, state => state.operations);
  const keyChannels = useStore(store.a6Insights, state => state.keyChannels);
  const channelTests = useStore(store.a6Insights, state => state.channelTests);
  const keyView = useStore(store.a6Insights, state => state.keyView);

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
          </div>
          {keyChannels.loading && !keyChannels.view && <p className="mit-key-empty">正在读取绑定的渠道…</p>}
          {keyChannels.error && <p className="mit-key-error">{keyChannels.error}</p>}
          {!keyChannels.loading && !keyChannels.error && channels.length === 0 && <p className="mit-key-empty">这个 Key 目前没有固定的模型或路由池。</p>}
          {channels.length > 0 && <div className="mit-kv-board">
            <div className="mit-kv-cols" aria-hidden="true">
              <span className="mit-kv-col-check"></span>
              <span>渠道</span>
              <span>绑定</span>
              <span>状态</span>
              <span className="mit-kv-col-right">测试记录</span>
            </div>
            <div className="mit-kv-groups">
              {channelsByModel.map(([model, list]) => {
                const keys = list.map(rowKey);
                const allSelected = keys.every(key => selectedSet.has(key));
                const pinned = list.filter(channel => channel.pinned).length;
                const effective = list.filter(channel => channel.routeEffective).length;
                return <section className="mit-kv-group" key={model}>
                  <header className="mit-kv-group-head">
                    <span className="mit-kv-col-check">
                      <input type="checkbox" aria-label={`选择 ${model} 的全部渠道`} checked={allSelected} onChange={event => store.actions.patchKeyView({selected: event.target.checked ? [...new Set([...keyView.selected, ...keys])] : keyView.selected.filter(key => !keys.includes(key))})}/>
                    </span>
                    <strong className="mit-kv-group-model">{model}</strong>
                    <span className="mit-kv-group-count">{list.length} 个渠道</span>
                    {pinned > 0 && <Badge tone="brand">{pinned} 个固定</Badge>}
                    {effective > 0 && <Badge tone="ok">{effective} 个路由生效</Badge>}
                  </header>
                  <div className="mit-kv-rows">
                    {list.map(channel => {
                      const key = rowKey(channel);
                      const open = keyView.expanded.includes(key);
                      const tests = channelTests[key];
                      return <div className={`mit-kv-item${open ? ' is-open' : ''}`} key={key}>
                        <div className="mit-kv-row">
                          <span className="mit-kv-col-check">
                            <input type="checkbox" aria-label={`选择 ${channel.model} 渠道 ${channel.channelId}`} checked={selectedSet.has(key)} onChange={() => toggleSelected(key)}/>
                          </span>
                          <span className="mit-kv-channel mit-tabular">#{channel.channelId}</span>
                          <div className="mit-kv-bindings">
                            {channel.pinned && <Badge tone="brand">固定</Badge>}
                            {channel.routed && <Badge tone="muted">路由{channel.poolSize > 1 ? `（池 ${channel.poolSize}）` : ''}</Badge>}
                            {channel.routeEffective && <Badge tone="ok">路由生效</Badge>}
                            {!channel.pinned && !channel.routed && <span className="mit-muted">—</span>}
                          </div>
                          <span className="mit-kv-status" title={channel.status || undefined}>{channel.status || '—'}</span>
                          <span className="mit-kv-col-right">
                            <button type="button" className="mit-kv-toggle" onClick={() => expandRow(channel)} aria-expanded={open}>{open ? '收起' : tests?.view ? `查看 ${tests.view.total} 条` : '查看'}<Icon name="chevron" size={12}/></button>
                          </span>
                        </div>
                        {open && <div className="mit-kv-expand"><TestRows store={store} entries={tests?.view?.entries ?? []} loading={Boolean(tests?.loading)} error={tests?.error}/></div>}
                      </div>;
                    })}
                  </div>
                </section>;
              })}
            </div>
          </div>}
        </>}
      </section>
    </div>
  </div>;
}
