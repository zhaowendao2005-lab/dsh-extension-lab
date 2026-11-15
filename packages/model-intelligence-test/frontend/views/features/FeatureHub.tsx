import React,{ useStore } from '../../runtime';
import type { Workbench } from '../../types';
import { Icon } from '../../components/common';

export function FeatureHub({ store }: { store: Workbench }) {
  const records=useStore(store.evaluations,state => state.records);
  const a6=useStore(store.a6,state => state);
  return <div className="mit-feature-hub">
    <div className="mit-feature-head"><p className="mit-kicker">FEATURES</p><h1>功能中心</h1><p className="mit-muted">真实模型指纹、自定义任务评测与网页连接工具。</p></div>
    <div className="mit-feature-grid">
      <button type="button" className="mit-feature-card" onClick={store.actions.openDraft}><span className="mit-feature-index">01</span><strong>模型智能测试</strong><span className="mit-muted">lm-detector 真实数字指纹，或自定义 Agent 任务评测。全局 {records.length} 条记录。</span><span className="mit-feature-action">打开工作台 <Icon name="chevron" size={12} /></span></button>
      <section className="mit-feature-card mit-a6-pairing" aria-label="连接 a6api 油猴">
        <span className="mit-feature-index">02</span><strong>连接 a6api 油猴</strong><p className="mit-muted">首次使用时复制连接配置到油猴脚本。完成配对后，在 a6api 网页选择渠道与 token，点击网页的创建操作；专项配置页会自动出现。</p>
        <button type="button" className="mit-button" disabled={a6.bridgeLoading} onClick={store.actions.loadA6Bridge}>{a6.bridgeLoading? '读取连接配置…':a6.bridge? '刷新连接状态':'显示连接配置'}</button>
        {a6.bridge&&<>
          <p className="mit-muted">{a6.bridge.connected? '网页桥已连接':'等待网页连接'} · {a6.bridge.nativeSupported? '支持客户端唤起':'使用网页连接'}</p>
          <textarea className="mit-a6-configuration" aria-label="a6api 油猴连接配置" readOnly rows={5} spellCheck={false} value={JSON.stringify(a6.bridge.configuration,null,2)} onFocus={event => event.currentTarget.select()} />
          <button type="button" className="mit-button" disabled={a6.copying} onClick={store.actions.copyA6Bridge}>{a6.copying? '复制中…':'复制连接配置'}</button>
          {a6.bridge.connections.length>0&&<ul className="mit-a6-connections">{a6.bridge.connections.map(connection => <li key={connection.id}><strong>{connection.online? '在线':'离线'}</strong><span>{connection.siteOrigin} · 账号 {connection.accountId}</span></li>)}</ul>}
        </>}
        {a6.bridgeError&&<p className="mit-error" role="alert">{a6.bridgeError}</p>}
        {a6.bridgeFeedback&&<p className="mit-muted" role="status">{a6.bridgeFeedback}</p>}
      </section>
      <section className="mit-feature-card" aria-label="网页选择收件箱">
        <strong>已从 a6api 收到的选择</strong>
        <p className="mit-muted">如果自动打开时尚未选择 DSH 会话，请先选一个会话，再打开已收到的清单。原生链接只唤起安装版；桌面端须连接相同 Host。</p>
        {a6.error&&<p role="alert" className="mit-error">{a6.error}</p>}
        {a6.selections.length? a6.selections.slice(-10).reverse().map(selection => <button type="button" className="mit-text-button" key={selection.id} onClick={() => store.actions.openA6(selection.id)}>
          账号 {selection.accountId} · {selection.models.length} 项 · {new Date(selection.createdAt).toLocaleString('zh-CN')}
        </button>):<span className="mit-muted">暂无网页提交的选择，请从油猴卡片点击「前往 DSH 测试」。</span>}
      </section>
    </div>
  </div>;
}
