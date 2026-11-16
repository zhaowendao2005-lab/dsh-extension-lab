import React,{useStore} from '../../runtime';
import type {A6ProviderToken,A6Target,Evaluation,Run,Workbench} from '../../types';
import {MATCH_LABELS} from './ProviderManager';

const targetValue = (target: A6Target): string => JSON.stringify([target.tokenId,target.providerId ?? '']);
function tokenState(token: A6ProviderToken): string {
  if (typeof token.expiredTime === 'number' && token.expiredTime > 0 && token.expiredTime * 1000 <= Date.now()) return '已过期';
  if (token.status !== undefined && token.status !== 1 && token.status !== '1') return '不可用';
  return '';
}
export function ResultTarget({store,record,run}: {store: Workbench;record: Evaluation;run: Run}) {
  const view = useStore(store.a6Insights,state => state.providers);
  const loading = useStore(store.a6Insights,state => state.loading);
  const error = useStore(store.a6Insights,state => state.error);
  const query = useStore(store.a6Insights,state => state.targetQueries[run.model.id] ?? '');
  const feedback = useStore(store.a6Insights,state => state.results[run.model.id]);
  const config = useStore(store.a6,state => state.config);
  const channel = run.model.a6api;
  if (!channel || !record.a6api) return null;
  const accountCurrent = Boolean(config?.configured && config.userId === record.a6api.accountId);
  const accountMatches = Boolean(config?.configured && view?.accountId && view.accountId === record.a6api.accountId && config.userId === record.a6api.accountId);
  const saved = accountMatches ? view?.targets[run.model.id] : undefined;
  const search = query.trim().toLowerCase();
  const selectedIds = new Set(view?.selectedProviderIds ?? []);
  const providers = view?.providers.filter(provider => selectedIds.has(provider.id)) ?? [];
  const choices = providers.filter(provider => provider.state === 'exact').flatMap(provider => provider.tokenIds.flatMap(tokenId => {
    const token = view?.tokens.find(item => item.id === tokenId);
    return token ? [{target:{tokenId,providerId:provider.id},token,label:`${provider.name} · ${token.name || `令牌 #${token.id}`} #${token.id} ${token.maskedKey ?? ''}`}] : [];
  }));
  const matchedIds = new Set(choices.map(choice => choice.token.id));
  const unlinked = view?.tokens.filter(token => !matchedIds.has(token.id)).map(token => ({target:{tokenId:token.id} as A6Target,token,label:`${token.name || '未命名令牌'} #${token.id} ${token.maskedKey ?? ''}`})) ?? [];
  const all = [...choices,...unlinked];
  const savedChoice = saved ? all.find(choice => targetValue(choice.target) === targetValue(saved)) : undefined;
  const usable = accountMatches && savedChoice && !tokenState(savedChoice.token) && (!saved?.providerId || providers.some(provider => provider.id === saved.providerId && provider.state === 'exact' && provider.tokenIds.includes(saved.tokenId)));
  const shown = (items: typeof all) => items.filter(choice => choice === savedChoice || !search || choice.label.toLowerCase().includes(search));
  const renderChoice = (choice: typeof all[number]) => <option key={targetValue(choice.target)} value={targetValue(choice.target)} disabled={Boolean(tokenState(choice.token))}>{choice.label}{tokenState(choice.token) ? ` · ${tokenState(choice.token)}` : ''}</option>;
  const pending = Boolean(feedback?.pending);
  const restoreTokenId = saved?.tokenId;
  const restoreAllowed = accountCurrent && restoreTokenId !== undefined;
  return <div className="mit-a6-target" aria-busy={pending || loading}>
    <input type="search" aria-label={`${run.model.id} 使用目标搜索`} placeholder="搜索提供商、令牌或掩码" value={query} disabled={!accountMatches || pending} onChange={event => store.actions.setA6TargetQuery(run.model.id,event.currentTarget.value)} />
    <select aria-label={`${run.model.id} 使用目标`} value={saved ? targetValue(saved) : ''} disabled={!accountMatches || pending} onChange={event => {
      const choice = all.find(item => targetValue(item.target) === event.currentTarget.value);
      if (choice) store.actions.saveA6Target(record.id,run.model.id,choice.target);
    }}>
      <option value="" disabled>选择使用目标</option>
      {saved && !savedChoice && <option value={targetValue(saved)} disabled>已保存目标失效 · 令牌 #{saved.tokenId}</option>}
      <optgroup label="已匹配的提供商（优先）">{shown(choices).map(renderChoice)}</optgroup>
      <optgroup label="其他站点令牌（未关联所选提供商）">{shown(unlinked).map(renderChoice)}</optgroup>
    </select>
    <select aria-label={`${run.model.id} 渠道操作`} value="" disabled={!accountCurrent || pending} onChange={event => {
      const operation = event.currentTarget.value;
      if (operation === 'restore' && restoreAllowed && restoreTokenId !== undefined) store.actions.a6ResultAction({recordId:record.id,model:run.model.id,channelId:channel.channelId,tokenId:restoreTokenId,operation});
      else if (saved && usable && (operation === 'pin' || operation === 'route')) store.actions.a6ResultAction({recordId:record.id,model:run.model.id,channelId:channel.channelId,...saved,operation});
    }}>
      <option value="" disabled>{pending ? ({save:'正在保存目标…',pin:'正在固定…',route:'正在加入路由…',restore:'正在解除固定…'}[feedback?.pending ?? 'save']) : '操作此渠道…'}</option>
      <option value="pin" disabled={!usable}>固定此渠道（关闭智能兜底）</option><option value="route" disabled={!usable}>加入此渠道路由</option><option value="restore" disabled={!restoreAllowed}>恢复此记录 / 渠道的原固定</option>
    </select>
    {!accountMatches && <small className="mit-error">{!config?.configured ? '请先配置并验证账号' : view?.accountId ? '当前账号与此记录不符' : loading ? '正在读取账号与匹配状态…' : '账号匹配状态不可用'}</small>}
    {accountMatches && !all.length && <small className="mit-muted">没有可用令牌；请在上方管理提供商并刷新。</small>}
    {accountMatches && providers.some(provider => provider.state !== 'exact') && <small className="mit-muted">{providers.filter(provider => provider.state !== 'exact').map(provider => `${provider.name}：${MATCH_LABELS[provider.state]}`).join('；')}</small>}
    {saved && accountMatches && !usable && <small className="mit-error">已保存目标失效或不可用，请重新选择。</small>}
    {search && !all.some(choice => choice.label.toLowerCase().includes(search)) && <small className="mit-muted">未找到匹配目标；已保存的目标仍保留显示。</small>}
    {(feedback?.error || error || view?.error) && <small className="mit-error" role="alert">{feedback?.error || error || view?.error}</small>}
    {feedback?.message && <small role="status">{feedback.message}</small>}
    <small className="mit-muted">选择仅保存目标；恢复由 Host 查此记录 / 渠道的原租约，原令牌可能与当前目标不同。</small>
  </div>;
}
