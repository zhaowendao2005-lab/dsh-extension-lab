import { setReact } from './runtime';
import type * as React from 'react';
import { remoteInfo } from '../shared/contract.js';
import { createWorkbench } from './stores/workbench.stores';
import { Panel } from './views/Panel';
import type { ModelIntelligenceTransport, Workbench } from './types';
import styles from './styles.css';

type RemoteEnvelope<T> = { ok: true; value: T } | { ok: false; error?: {message?: string} };
function unwrapRemote<T>(response: T | RemoteEnvelope<T>): T {
 if (response && typeof response === 'object' && 'ok' in response) {
  const envelope = response as RemoteEnvelope<T>;
  if (!envelope.ok) throw new Error(envelope.error?.message || '远程调用失败');
  return envelope.value;
 }
 return response as T;
}
interface ClientContext {
  remote: { $mount(info: unknown): Promise<() => void> };
  get(name: 'remote.modelIntelligence'): ModelIntelligenceTransport;
  effect(callback: () => (() => void), label?: string): unknown;
  inject(names: string[], callback: (context: ClientContext) => void): unknown;
  sidebarRightTabs: { register(definition: {id: string; kind: string; multiple: boolean; priority: 'extension'; title: () => string; guide: {id: string; order: number; title: () => string; description: () => string}[]}): () => void };
  slots: { inject(name: string, callback: () => unknown): () => void; register(definition: {name: string; key: string; inject: (sessionId: string) => {store: Workbench}}, component: typeof Panel): unknown };
}
declare global { interface Window { __ModuleLoader__: {load(module: {id: string; factory(require: (id: string) => typeof React): unknown}): void} } }
const ID = 'model-intelligence-test';
window.__ModuleLoader__.load({id: ID, factory(require) {
 setReact(require('react'));
 return {name: ID, inject: ['slots', 'remote', 'sidebarRightTabs'], async apply(ctx: ClientContext) {
  const unmount = await ctx.remote.$mount(remoteInfo);
  ctx.effect(() => unmount, `${ID}.remote`);
  ctx.inject(['remote.modelIntelligence'], remoteCtx => {
   const transport = remoteCtx.get('remote.modelIntelligence');
   const stores = new Map<string, Workbench>();
   const storeFor = (sessionId: string) => {
    let store = stores.get(sessionId);
    if (!store) { store = createWorkbench(sessionId, {
     catalog: async () => unwrapRemote(await transport.catalog()),
     fingerprintStart: async request => unwrapRemote(await transport.fingerprintStart(request)),
     fingerprintConfigure: async request => unwrapRemote(await transport.fingerprintConfigure(request)),
     fingerprintRetry: async request => unwrapRemote(await transport.fingerprintRetry(request)),
     fingerprintStatus: async request => unwrapRemote(await transport.fingerprintStatus(request)),
     fingerprintCancel: async request => unwrapRemote(await transport.fingerprintCancel(request)),
    }); stores.set(sessionId, store); }
    return store;
   };
   remoteCtx.effect(() => {
    const style = document.createElement('style');
    style.dataset.plugin = ID; style.textContent = styles; document.head.appendChild(style);
    return () => style.remove();
   }, `${ID}.styles`);
   remoteCtx.effect(() => () => { for (const store of stores.values()) store.dispose(); stores.clear(); }, `${ID}.stores`);
   remoteCtx.effect(() => remoteCtx.sidebarRightTabs.register({
    id: ID, kind: ID, multiple: false, priority: 'extension', title: () => '模型智能测试',
    guide: [{id: 'open', order: 35, title: () => '模型智能测试', description: () => 'lm-detector 真实模型指纹 · 自定义任务评测（模拟）'}],
   }), `${ID}.tab`);
   remoteCtx.effect(() => remoteCtx.slots.inject('sidebar.right.pane.tab', () => remoteCtx.slots.register({
    name: 'sidebar.right.pane.tab', key: ID, inject: sessionId => ({store: storeFor(sessionId)}),
   }, Panel)), `${ID}.body`);
  });
 }};
}});
