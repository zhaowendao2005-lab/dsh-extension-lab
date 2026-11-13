import { createElement, setReact } from './runtime';
import type * as React from 'react';
import { remoteInfo } from '../shared/contract.js';
import { createWorkbench } from './stores/workbench.stores';
import { Panel } from './views/Panel';
import { RelaySettingsSection } from './views/settings/RelaySettings';
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
  get(name: 'remote.modelIntelligence'): Record<string, (request?: unknown) => Promise<unknown>>;
  effect(callback: () => (() => void), label?: string): unknown;
  inject(names: string[], callback: (context: ClientContext) => void): unknown;
  sidebarRightTabs: { register(definition: {id: string; kind: string; multiple: boolean; priority: 'extension'; title: () => string; guide: {id: string; order: number; title: () => string; description: () => string}[]}): () => void };
  slots: { inject(name: string, callback: () => unknown): () => void; register(definition: Record<string, unknown>, component: unknown): unknown };
}
declare global { interface Window { __ModuleLoader__: {load(module: {id: string; factory(require: (id: string) => typeof React): unknown}): void} } }
const ID = 'model-intelligence-test';
const SETTINGS_ID = 'model-intelligence-relay';
/** Every Host method the client may call; each response is unwrapped from the Typert envelope. */
const METHODS = [
 'catalog', 'recordsList', 'recordCreate', 'recordRerun', 'recordDelete', 'recordsClear', 'attemptView', 'attemptCancel', 'attemptConfigure', 'attemptRetry', 'customSave',
 'partitionsList', 'partitionSave', 'partitionDelete', 'partitionItem', 'relayAuthStatus', 'relayAuthSet', 'relayAuthVerify', 'relayProviderModel', 'relayProvidersClear', 'relayManagedRoutes',
 'relaySites', 'relaySnapshot', 'relayRows', 'relayRow', 'relayHistory', 'relayConcurrency', 'relaySvg', 'relayResolve', 'relayRetryMissing', 'tagsList', 'tagsSet',
] as const satisfies readonly (keyof ModelIntelligenceTransport)[];
function transportOf(remote: Record<string, (request?: unknown) => Promise<unknown>>): ModelIntelligenceTransport {
 const entries = METHODS.map(name => [name, async (request?: unknown) => unwrapRemote(await (request === undefined ? remote[name]() : remote[name](request)))]);
 return Object.fromEntries(entries) as unknown as ModelIntelligenceTransport;
}
function SettingsIcon({size}: {size: number}) {
 return createElement('svg', {width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true},
  createElement('path', {d: 'M4 7h16M4 12h10M4 17h6'}), createElement('circle', {cx: 18, cy: 15, r: 3}));
}
window.__ModuleLoader__.load({id: ID, factory(require) {
 setReact(require('react'));
 return {name: ID, inject: ['slots', 'remote', 'sidebarRightTabs'], async apply(ctx: ClientContext) {
  const unmount = await ctx.remote.$mount(remoteInfo);
  ctx.effect(() => unmount, `${ID}.remote`);
  ctx.inject(['remote.modelIntelligence'], remoteCtx => {
   // Records, partitions and relay data are global (Host-persisted), so every session shares one workbench.
   let workbench: Workbench | undefined;
   const shared = (): Workbench => (workbench ??= createWorkbench('global', transportOf(remoteCtx.get('remote.modelIntelligence'))));
   remoteCtx.effect(() => {
    const style = document.createElement('style');
    style.dataset.plugin = ID; style.textContent = styles; document.head.appendChild(style);
    return () => style.remove();
   }, `${ID}.styles`);
   remoteCtx.effect(() => () => { workbench?.dispose(); workbench = undefined; }, `${ID}.stores`);
   remoteCtx.effect(() => remoteCtx.sidebarRightTabs.register({
    id: ID, kind: ID, multiple: false, priority: 'extension', title: () => '模型智能测试',
    guide: [{id: 'open', order: 35, title: () => '模型智能测试', description: () => 'lm-detector 真实模型指纹 · 中转站渠道 · 自定义任务评测（模拟）'}],
   }), `${ID}.tab`);
   remoteCtx.effect(() => remoteCtx.slots.inject('sidebar.right.pane.tab', () => remoteCtx.slots.register({
    name: 'sidebar.right.pane.tab', key: ID, inject: () => ({store: shared()}),
   }, Panel)), `${ID}.body`);
   remoteCtx.effect(() => remoteCtx.slots.inject('settings.section', () => remoteCtx.slots.register({
    name: 'settings.section', id: SETTINGS_ID, order: 60, label: () => 'API 适配站点', inject: () => ({store: shared()}),
   }, RelaySettingsSection)), `${ID}.settings`);
   remoteCtx.effect(() => remoteCtx.slots.inject('settings.section.icon', () => remoteCtx.slots.register({
    name: 'settings.section.icon', id: SETTINGS_ID, order: 60,
   }, SettingsIcon)), `${ID}.settings-icon`);
  });
 }};
}});
