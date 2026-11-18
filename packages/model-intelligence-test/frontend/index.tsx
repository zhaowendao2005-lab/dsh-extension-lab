import { createElement, setReact } from './runtime';
import type * as React from 'react';
import { REMOTE_METHOD_NAMES, remoteInfo } from '../shared/contract.js';
import { createWorkbench } from './stores/workbench.stores';
import { Panel } from './views/Panel';
import type { ModelIntelligenceTransport, Workbench } from './types';
import styles from './styles.css';

type RemoteEnvelope<T> = { ok: true; value: T } | { ok: false; error?: {message?: string} };
function unwrapRemote<T>(response: T | RemoteEnvelope<T>): T {
 if (response && typeof response === 'object' && 'ok' in response) {
  const envelope = response as RemoteEnvelope<T>;
  if (!envelope.ok) throw new Error(envelope.error?.message || '远程调用失败');
  if ('value' in envelope) return envelope.value;
   return response as T;
 }
 return response as T;
}
interface ClientContext {
  remote: { $mount(info: unknown): Promise<() => void> };
  get(name: 'remote.modelIntelligence'): Record<string, (request?: unknown) => Promise<unknown>>;
  effect(callback: () => (() => void), label?: string): unknown;
  inject(names: string[], callback: (context: ClientContext) => void): unknown;
  sidebarRight: { openTab(kind: string, options?: {params?: {selectionId?: string}}): void };
  sidebarRightTabs: { register(definition: {id: string; kind: string; multiple: boolean; priority: 'extension'; title: () => string; guide: {id: string; order: number; title: () => string; description: () => string}[]}): () => void };
  slots: { inject(name: string, callback: () => unknown): () => void; register(definition: Record<string, unknown>, component: unknown): unknown };
}
declare global { interface Window { __ModuleLoader__: {load(module: {id: string; factory(require: (id: string) => typeof React): unknown}): void} } }
const ID = 'model-intelligence-test';
/** Every Host method the client may call; derived from the wire contract so a new remote cannot be forgotten here. */
const METHODS: readonly (keyof ModelIntelligenceTransport)[] = REMOTE_METHOD_NAMES as unknown as readonly (keyof ModelIntelligenceTransport)[];
function transportOf(remote: Record<string, (request?: unknown) => Promise<unknown>>): ModelIntelligenceTransport {
 const entries = METHODS.map(name => [name, async (request?: unknown) => unwrapRemote(await (request === undefined ? remote[name]() : remote[name](request)))]);
 return Object.fromEntries(entries) as unknown as ModelIntelligenceTransport;
}
// The pane is narrow; a dedicated window renders the same panel full-viewport on the same GUI origin and port.
const fullscreen = (() => {
  try {
    return new URLSearchParams(window.location.search).get('mit') === 'fullscreen';
  } catch {
    return false;
  }
})();
const paneWindow = {
 fullscreen,
 open() {
  const url = new URL(window.location.href);
  url.searchParams.set('mit', 'fullscreen');
  window.open(url.toString(), '_blank', 'noopener');
 },
 close() {
  const url = new URL(window.location.href);
  url.searchParams.delete('mit');
  window.location.replace(url.toString());
 },
};
window.__ModuleLoader__.load({id: ID, factory(require) {
 setReact(require('react'));
 return {name: ID, inject: ['slots', 'remote', 'sidebarRightTabs', 'sidebarRight'], async apply(ctx: ClientContext) {
  const unmount = await ctx.remote.$mount(remoteInfo);
  ctx.effect(() => unmount, `${ID}.remote`);
  ctx.inject(['remote.modelIntelligence'], remoteCtx => {
   // Records and selections belong to the Host; one plugin-lifetime store polls even with the pane closed.
   let workbench: Workbench | undefined;
   const shared = (): Workbench => (workbench ??= createWorkbench('global', transportOf(remoteCtx.get('remote.modelIntelligence')), selectionId => remoteCtx.sidebarRight.openTab(ID, { params: { selectionId } }), paneWindow));
   remoteCtx.effect(() => {
    const style = document.createElement('style');
    style.dataset.plugin = ID; style.textContent = styles; document.head.appendChild(style);
    return () => style.remove();
   }, `${ID}.styles`);
   remoteCtx.effect(() => () => { workbench?.dispose(); workbench = undefined; }, `${ID}.stores`);
   remoteCtx.effect(() => remoteCtx.sidebarRightTabs.register({
    id: ID, kind: ID, multiple: false, priority: 'extension', title: () => '模型智能测试',
    guide: [{id: 'open', order: 35, title: () => '模型智能测试', description: () => 'lm-detector 真实模型指纹 · a6api 渠道测试 · 自定义 Agent 任务'}],
   }), `${ID}.tab`);
   remoteCtx.effect(() => remoteCtx.slots.inject('sidebar.right.pane.tab', () => remoteCtx.slots.register({
    name: 'sidebar.right.pane.tab', key: ID, inject: () => ({store: shared()}),
   }, Panel)), `${ID}.body`);
    shared();
  });
 }};
}});
