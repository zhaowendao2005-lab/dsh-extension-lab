import React,{ useEffect, useRef, useStore } from '../runtime';
import type { ReactNode } from 'react';
import type { Workbench } from '../types';
import { Icon } from '../components/common';
import { NoticeModal } from './workbench/NoticeModal';
import { DraftView } from './creation/DraftView';
import { RecordView } from './results/RecordView';
import { RunDetailPage } from './results/RunDetailPage';
import { CustomRunPage } from './custom/CustomRunPage';
import { FeatureHub } from './features/FeatureHub';
import { A6SelectionView } from './creation/A6SelectionView';
function TabBar({ store }: {
  store: Workbench;
}) {
  const state=useStore(store.workbench,value => value);
  return <header className="mit-tabs-header">
    <div className="mit-tabs" role="tablist" aria-label="模型测试工作区">
      {state.tabs.map(tab => <div className={`mit-tab ${state.activeTab===tab.id? 'is-active':''}`} key={tab.id}>
        <button type="button" role="tab" id={`${store.sessionId}-mit-tab-${tab.id}`} aria-selected={state.activeTab===tab.id} aria-controls={`${store.sessionId}-mit-active-panel`} tabIndex={state.activeTab===tab.id? 0:-1} onClick={() => store.actions.activateTab(tab.id)} onKeyDown={event => {
          const index=state.tabs.findIndex(item => item.id===tab.id); let next=index; if(event.key==='ArrowRight')
            next=(index+1)%state.tabs.length;
          else if(event.key==='ArrowLeft')
            next=(index-1+state.tabs.length)%state.tabs.length;
          else if(event.key==='Home')
            next=0;
          else if(event.key==='End')
            next=state.tabs.length-1;
          else
            return; event.preventDefault(); store.actions.activateTab(state.tabs[next].id); const row=event.currentTarget.parentElement?.parentElement; row?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
        }}>
          {tab.title}
        </button>
        <button type="button" className="mit-tab-close" aria-label={`关闭 ${tab.title} 标签页`} onClick={() => store.actions.closeTab(tab.id)}>
          <Icon name="close" size={12} />
        </button>
      </div>)}
    </div>
    <div className="mit-tabs-actions">
      <button type="button" className="mit-tab-add" aria-label={state.fullscreen ? '关闭全屏窗口' : '在全屏窗口中打开'} title={state.fullscreen ? '关闭全屏窗口' : '全屏（新窗口，同一端口）'} onClick={() => state.fullscreen ? store.actions.closeFullscreen() : store.actions.openFullscreen()}>
        <Icon name={state.fullscreen ? 'collapse' : 'expand'} size={14} />
      </button>
      <button type="button" className="mit-tab-add" aria-label="打开功能中心" title="功能中心" onClick={() => store.actions.openFeature('hub')}>
        <Icon name="plus" size={14} />
      </button>
    </div>
  </header>;
}
function RecordsSidebar({ store }: {
  store: Workbench;
}) {
  const collapsed=useStore(store.workbench,state => state.sidebarCollapsed);
  const activeRecord=useStore(store.workbench,state => state.tabs.find(tab => tab.id===state.activeTab)?.recordId);
  const records=useStore(store.evaluations,state => state.records);
  return <aside className={`mit-records-sidebar ${collapsed? 'is-collapsed':''}`} aria-label="测试记录">
    <div className="mit-sidebar-heading">
      <button type="button" className="mit-icon-button" aria-label={collapsed? '展开测试记录':'折叠测试记录'} aria-expanded={!collapsed} onClick={store.actions.toggleSidebar}>
        <Icon name="sidebar" />
      </button>
      {!collapsed&&<>
        <strong>测试记录
        </strong>
        <span className="mit-muted">
          {records.length}
        </span>
      </>}
    </div>
    <button type="button" className="mit-sidebar-create mit-text-button" title="新建测试" aria-label="新建测试标签页" onClick={store.actions.openDraft}>
      <Icon name="plus" />
      {!collapsed&&'新建测试'}
    </button>
    {!collapsed&&<>
      <div className="mit-record-list">
        {records.length===0&&<p className="mit-muted mit-sidebar-empty">暂无测试记录
          <br />新建测试后会显示在这里。
        </p>}
        {records.map(record => <div key={record.id} className={`mit-record-list-row ${activeRecord===record.id? 'is-selected':''}`}>
          <button type="button" className="mit-record-open" onClick={() => store.actions.openRecord(record.id)} aria-current={activeRecord===record.id? 'page':undefined}>
            <strong>
              {record.name}
            </strong>
            <span>
              {record.a6api? 'a6api 专项':record.kind==='fingerprint'? '指纹测试':'自定义 Agent'} ·
              {(record.models?.length||record.runIds.length)} 模型
              {(record.attempts?.length??0)>1? ` · ${record.attempts.length} 次请求`:''}
            </span>
            <small>
              {new Date(record.createdAt).toLocaleString('zh-CN',{ month: '2-digit',day: '2-digit',hour: '2-digit',minute: '2-digit' })}
            </small>
          </button>
          <button type="button" className="mit-record-delete mit-icon-button" aria-label={`删除测试 ${record.name}`} onClick={() => store.actions.deleteRecord(record.id)}>
            <Icon name="trash" size={14} />
          </button>
        </div>)}
      </div>
      <div className="mit-sidebar-footer">
        <p className="mit-muted">关闭标签不停止测试，也不删除记录。
        </p>
        <button type="button" className="mit-text-button" onClick={store.actions.resetRecords}>
          <Icon name="trash" size={14} />清空测试记录
        </button>
      </div>
    </>}
  </aside>;
}
/** Modal dialog puts the panel in the top layer, so a narrow host pane cannot clip it. */
function FullscreenShell({ active,children }: {
  active: boolean;
  children: ReactNode;
}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog=ref.current;
    if(!dialog)
      return;
    if(active&&!dialog.open)
      dialog.showModal();
    else if(!active&&dialog.open)
      dialog.close();
  },[active]);
  if(!active)
    return <>{children}</>;
  return <dialog ref={ref} className="mit-fullscreen-dialog" aria-label="模型智能测试全屏面板">
    {children}
  </dialog>;
}
export function Panel({ store }: {
  store: Workbench;
}) {
  const active=useStore(store.workbench,state => state.tabs.find(tab => tab.id===state.activeTab));
  const navigation=useStore(store.workbench,state => state.navigation[state.activeTab]);
  const activeRecord=useStore(store.evaluations,state => state.records.find(record => record.id===active?.recordId));
  let content=<DraftView store={store} />;
  if(active?.type==='record'&&active.recordId)
    content=navigation?.runId&&activeRecord?.kind==='custom'? <CustomRunPage key={`${active.recordId}:${navigation.runId}`} store={store} recordId={active.recordId} runId={navigation.runId} />:navigation?.runId? <RunDetailPage key={`${active.recordId}:${navigation.runId}`} store={store} recordId={active.recordId} runId={navigation.runId} />:<RecordView key={active.recordId} store={store} id={active.recordId} />;
  else if(active?.type==='feature')
    content=<FeatureHub store={store} />;
  else if(active?.type==='a6'&&active.selectionId)
    content=<A6SelectionView key={active.selectionId} store={store} selectionId={active.selectionId} />;
  const fullscreen=useStore(store.workbench,state => state.fullscreen);
  return <FullscreenShell active={fullscreen}>
    <div className={fullscreen? 'mit-workbench is-fullscreen flex min-w-0 flex-col':'mit-workbench flex min-w-0 flex-col'}>
    <TabBar store={store} />
    <div className="mit-workbench-body flex min-w-0">
      {active?.type!=='feature'&&<RecordsSidebar store={store} />}
      <main id={`${store.sessionId}-mit-active-panel`} className="mit-main min-w-0 flex-1" role="tabpanel" aria-labelledby={active? `${store.sessionId}-mit-tab-${active.id}`:undefined}>
        {content}
      </main>
    </div>
    <NoticeModal store={store} />
    </div>
  </FullscreenShell>;
}
