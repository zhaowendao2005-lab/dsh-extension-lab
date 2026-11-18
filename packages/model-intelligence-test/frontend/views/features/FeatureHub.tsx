import React,{ useStore } from '../../runtime';
import type { Workbench } from '../../types';
import { Icon } from '../../components/common';

/** Credential setup for a6api. Everything here runs on the Host; the browser only sends selections. */
export function FeatureHub({ store }: { store: Workbench }) {
  const records=useStore(store.evaluations,state => state.records);
  const a6=useStore(store.a6,state => state);
  const config=a6.config;
  const userscript=config?.userscript;
  const recentScript=userscript?.recent;
  const { accessToken, userId }=a6.form;
  const fullscreen=useStore(store.workbench,state => state.fullscreen);
  return <div className="mit-feature-hub">
    <div className="mit-feature-head"><p className="mit-kicker">FEATURES</p><h1>功能中心</h1><p className="mit-muted">真实模型指纹、自定义任务评测与 a6api 渠道测试。</p></div>
    <div className="mit-feature-actions"><button type="button" className="mit-button" onClick={fullscreen ? store.actions.closeFullscreen : store.actions.openFullscreen}><Icon name={fullscreen ? 'collapse' : 'expand'} size={14} />{fullscreen ? '退出全屏' : '打开全屏面板'}</button></div>
    <div className="mit-feature-grid">
      <button type="button" className="mit-feature-card" onClick={store.actions.openDraft}><span className="mit-feature-index">01</span><strong>模型智能测试</strong><span className="mit-muted">lm-detector 真实数字指纹，或自定义 Agent 任务评测。全局 {records.length} 条记录。</span><span className="mit-feature-action">打开工作台 <Icon name="chevron" size={12} /></span></button>
      <section className="mit-feature-card mit-a6-credentials" aria-label="a6api 接入">
        <span className="mit-feature-index">02</span><strong>a6api 接入</strong>
        <p className="mit-muted">填一次账户访问令牌：之后固定渠道、加入路由及换取采样令牌密钥均由 DSH 直接完成，网页只负责把渠道清单发过来。</p>
        <label className="mit-field">账户访问令牌<input type="password" autoComplete="off" spellCheck={false} value={accessToken} placeholder={config?.configured? `已配置 ${config.mask}（留空则沿用）`:'在 a6api 设置里生成后粘贴'} onChange={event => store.actions.patchA6Form({accessToken: event.currentTarget.value})} /></label>
        <label className="mit-field">用户 ID<input inputMode="numeric" value={userId} placeholder={config?.userId? `当前 ${config.userId}`:'a6api 个人设置里的数字 ID'} onChange={event => store.actions.patchA6Form({userId: event.currentTarget.value})} /></label>
        <button type="button" className="mit-button" disabled={a6.saving} onClick={store.actions.saveA6Config}>{a6.saving? '正在验证…':'保存并验证'}</button>
        {config?.configured&&<p className="mit-muted" role="status">已连接：账号 {config.userId} · 访问令牌 {config.mask}</p>}
        {a6.configError&&<p className="mit-error" role="alert">{a6.configError}</p>}
        {a6.configFeedback&&<p className="mit-muted" role="status">{a6.configFeedback}</p>}
        <div className="mit-a6-intake">
          <div className="mit-label-row"><strong>油猴接入</strong><button type="button" className="mit-text-button" disabled={a6.rotating} onClick={store.actions.rotateA6Intake}>{a6.rotating? '更换中…':'更换导入口令'}</button></div>
          <p className="mit-muted">包内脚本：{userscript? `v${userscript.version} · 协议 ${userscript.protocolVersion}`:'等待 Host 报告包内版本'}</p>
          <p className="mit-muted" role="status">{recentScript? `最近报告：v${recentScript.version} · 协议 ${recentScript.protocolVersion??'未知'} · 账号 ${recentScript.accountId||'未知'} · ${Number.isFinite(recentScript.seenAt)? new Date(recentScript.seenAt).toLocaleString('zh-CN'):'时间未知'}${userscript&&recentScript.version!==userscript.version? ' · 与当前包内版本不同':''}`:'尚未收到脚本报告；请在 a6api 页面运行脚本后再查看。'}</p>
          <button type="button" className="mit-text-button" disabled={a6.configLoading} onClick={store.actions.loadA6Config}>{a6.configLoading? '刷新中…':'刷新脚本状态'}</button>
          {userscript?.installUrl? <a className="mit-button" href={userscript.installUrl} target="_blank" rel="noreferrer">安装 / 更新包内油猴脚本</a>:<span className="mit-muted">等待 Host 提供脚本安装地址</span>}
          {userscript?.networkInstallUrl? <a className="mit-text-button" href={userscript.networkInstallUrl} target="_blank" rel="noreferrer">从 GitHub 安装（本机链接打不开时用这个）</a>:null}
          <p className="mit-muted">打开安装页后需在 Tampermonkey 中确认。本机安装链接随 DSH 端口变化；脚本的 @updateURL/@downloadURL 一律指向固定的 GitHub 地址，所以之后的重启不会再让自动更新失效。若本机链接只显示 Tampermonkey 的「SCRIPT INSTALLATION」中间页而不自动完成，改用上面的 GitHub 链接安装，或把包内 integration/a6api-userscript.user.js 拖进 Tampermonkey。</p>
          <p className="mit-muted">安装后点下面的连接链接，油猴会自己记住接入点并从地址栏抹掉口令；之后在 a6api 页面勾选渠道直接发送即可。</p>
          {config?.link? <a className="mit-button" href={config.link} target="_blank" rel="noreferrer">一键连接 a6api 页面</a> : <span className="mit-muted">等待 Host 报告接入点</span>}
          <details className="mit-a6-manual"><summary className="mit-muted">手动填写（可选）</summary>
            <code className="mit-a6-origin">{config?.origin? `${config.origin}/mit-a6/select`:'等待 Host 报告接入点'}</code>
            <div className="mit-a6-token-row"><code className="mit-a6-token-value">{config?.intakeToken||'——'}</code><button type="button" className="mit-button" disabled={a6.copying||!config?.intakeToken} onClick={store.actions.copyA6Intake}>{a6.copying? '复制中…':'复制导入口令'}</button></div>
          </details>
        </div>
      </section>
      <section className="mit-feature-card" aria-label="网页选择收件箱">
        <strong>已从 a6api 收到的选择</strong>
        <p className="mit-muted">网页发送后会自动打开专项页；若当时未开面板，也可以从这里重新打开。</p>
        {a6.error&&<p role="alert" className="mit-error">{a6.error}</p>}
        {a6.selections.length? a6.selections.slice(-10).reverse().map(selection => <button type="button" className="mit-text-button" key={selection.id} onClick={() => store.actions.openA6(selection.id)}>
          账号 {selection.accountId} · {selection.models.length} 项 · {selection.tokens.length} 令牌 · {new Date(selection.createdAt).toLocaleString('zh-CN')}
        </button>):<span className="mit-muted">暂无网页提交的选择，请在 a6api 页面用油猴卡片发送。</span>}
      </section>
    </div>
  </div>;
}
