import React,{ useStore } from '../../runtime';
import type { Workbench } from '../../types';
import { a6ChannelKey } from '../../stores/a6api.stores';
import { Empty,Icon } from '../../components/common';
import {MarketPrice,MarketCache} from '../a6/MarketSnapshot';

/** Opened from a selection the userscript pushed; the Host owns every a6api call from here on. */
export function A6SelectionView({store,selectionId}: {store: Workbench; selectionId: string}) {
  const state=useStore(store.a6,value => value);
  const selection=state.selections.find(item => item.id===selectionId);
  const draft=state.drafts[selectionId];
  if(!selection||!draft) return <Empty title="网页选择已不可用">请回到 a6api 页面勾选渠道并发送新的专项选择。</Empty>;
  const busy=draft.creating||Boolean(draft.pending);
  const count=draft.models.length;
  const slots=draft.tokens.length;
  // Host shares a pool of 18 sampling requests across all jobs.
  const maxRequests=Math.min(count,slots,6)*3;
  const canSubmit=count>0&&count<=64&&slots>0&&!busy;
  const target=draft.models.find(row => a6ChannelKey(row)===draft.targetChannel);
  const targetToken=selection.tokens.find(token => token.id===draft.targetTokenId);
  const base=`${store.sessionId}-a6-${selectionId}`;
  return <div className="mit-draft mit-a6-selection">
    <div className="mit-draft-fields">
      <header className="mit-title-row">
        <div><h2>a6api 专项指纹测试</h2><p className="mit-muted">来自 {selection.siteOrigin} · 账号 {selection.accountId} · {new Date(selection.createdAt).toLocaleString('zh-CN')}</p></div>
        <span className="mit-badge">a6api 专项</span>
      </header>
      {state.error&&<p className="mit-error" role="alert">{state.error}</p>}
      <label className="mit-field">测试名称<input value={draft.name} maxLength={120} disabled={busy} onChange={event => store.actions.patchA6(selectionId,{name: event.currentTarget.value})} /></label>
      <section className="mit-a6-section" aria-labelledby={`${base}-models`}>
        <div className="mit-label-row"><h3 id={`${base}-models`}>网页参测清单</h3><span className="mit-muted">{count} / 64 项</span></div>
        {count>64&&<p className="mit-error" role="alert">清单超过 64 项，请移除多余渠道后开始。</p>}
        <div className="mit-a6-channel-list">{draft.models.map(row => <div className="mit-a6-channel-row" key={a6ChannelKey(row)}>
          <div><strong>{row.model}</strong><span className="mit-muted">{row.supplierName||`供应商 #${row.supplierId}`} · {row.channelName||`渠道 #${row.channelId}`}{row.channelName? ` (#${row.channelId})`:''}{row.brand? ` · ${row.brand}`:''}</span></div>
          <div className="mit-a6-channel-market"><MarketPrice market={row.market} /><MarketCache market={row.market} /></div>
          <button type="button" className="mit-icon-button" disabled={busy} aria-label={`移除 ${row.model} 渠道 ${row.channelId}`} onClick={() => store.actions.removeA6Model(selectionId,a6ChannelKey(row))}><Icon name="close" size={14} /></button>
        </div>)}</div>
        {!count&&<p className="mit-muted">清单已清空。请从 a6api 网页发送新的选择。</p>}
      </section>
      <section className="mit-a6-section" aria-labelledby={`${base}-slots`}>
        <div className="mit-label-row"><h3 id={`${base}-slots`}>测试令牌与并发槽</h3><span className="mit-muted">{slots} 槽</span></div>
        <p className="mit-muted">每个勾选的令牌是一个并发槽位，同一时刻只会固定一个渠道。请使用专用测试令牌；若已有日常固定或本插件手动固定，先解除固定或改选其他令牌再开始。</p>
        <div className="mit-a6-slots">{selection.tokens.map(token => {
          const checked=draft.tokens.includes(token.id);
          const order=draft.tokens.indexOf(token.id);
          return <label className="mit-a6-slot is-inline" key={token.id}>
            <input type="checkbox" checked={checked} disabled={busy} onChange={() => store.actions.toggleA6Token(selectionId,token.id)} />
            <span className="mit-a6-slot-name"><strong>{token.name||`token #${token.id}`}</strong><small className="mit-muted">Token ID {token.id}{checked? ` · 槽位 ${order+1}`:''}</small></span>
          </label>;
        })}</div>
        {!selection.tokens.length&&<p className="mit-error">这次网页选择没有令牌，请回到网页重新选择。</p>}
        <label className="mit-field mit-a6-timeout">单请求最大时长（秒）<input type="number" min={1} step={30} value={draft.timeoutMs===undefined? '':draft.timeoutMs/1000} placeholder="使用 Host 默认时长" disabled={busy} onChange={event => store.actions.patchA6(selectionId,{timeoutMs: event.currentTarget.value===''? undefined:Number(event.currentTarget.value)*1000})} /></label>
      </section>
      <section className="mit-a6-section" aria-labelledby={`${base}-actions`}>
        <h3 id={`${base}-actions`}>快速渠道操作</h3>
        <p className="mit-muted">每次操作仅作用于下方明确选择的一个令牌和一个渠道；「固定」会让该项直接从固定关系起跑，「恢复」解除本轮手动固定。</p>
        <div className="mit-a6-targets">
          <label className="mit-field">目标令牌<select value={draft.targetTokenId??''} disabled={busy} onChange={event => store.actions.patchA6(selectionId,{targetTokenId: event.currentTarget.value===''? undefined:Number(event.currentTarget.value)})}><option value="">选择一个令牌</option>{selection.tokens.map(token => <option value={token.id} key={token.id}>{token.name||'token'} (#{token.id})</option>)}</select></label>
          <label className="mit-field">目标渠道<select value={draft.targetChannel??''} disabled={busy} onChange={event => store.actions.patchA6(selectionId,{targetChannel: event.currentTarget.value||undefined})}><option value="">选择一个渠道</option>{draft.models.map(row => <option key={a6ChannelKey(row)} value={a6ChannelKey(row)}>{row.model} · {row.supplierName||row.supplierId} · 渠道 #{row.channelId}</option>)}</select></label>
        </div>
        {target&&targetToken&&<p className="mit-muted">本次目标：{targetToken.name} (#{targetToken.id}) → {target.model} / 渠道 #{target.channelId}</p>}
        <div className="mit-a6-actions">{(['pin','restore'] as const).map(operation => <button type="button" className="mit-button" key={operation} disabled={busy||!target||!targetToken} onClick={() => store.actions.a6Action(selectionId,operation)}>{draft.pending===operation? '执行中…':({pin: '固定到该渠道',restore: '解除固定'})[operation]}</button>)}</div>
        {draft.result&&<pre className="mit-a6-operation-result" role="status">{draft.result}</pre>}
      </section>
      <div className="mit-info"><strong>真实请求：</strong>{count} 项 · {slots} 槽 · {count*3} 次计划请求 · 最多 {maxRequests} 路并发。同一模型的 3 条挑战同时请求，每个槽位完成一项后领取下一项。每次换项前 Host 会先固定渠道、核对生效后才发采样请求，测完立刻恢复原固定。已发出的请求会产生费用。</div>
    </div>
    <footer className="mit-draft-footer">
      <div aria-live="polite">{draft.error? <p className="mit-error" role="alert">{draft.error}</p>:<p className="mit-muted">{draft.feedback||`${count} 项 · ${slots} 槽 · ${count*3} 请求 · 最多 ${maxRequests} 并发（跨任务共用 18 路上限）`}</p>}</div>
      <button type="button" className="mit-button mit-primary" disabled={!canSubmit} onClick={() => store.actions.submitA6(selectionId)}><Icon name="play" />{draft.creating? '创建并启动中…':'开始专项指纹测试'}</button>
    </footer>
  </div>;
}
