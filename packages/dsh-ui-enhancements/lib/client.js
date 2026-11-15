"use strict";(()=>{var xe=(t=>typeof require<"u"?require:typeof Proxy<"u"?new Proxy(t,{get:(e,s)=>(typeof require<"u"?require:e)[s]}):t)(function(t){if(typeof require<"u")return require.apply(this,arguments);throw Error('Dynamic require of "'+t+'" is not supported')});var K={},F=null,r=K;function R(t,e){Object.assign(K,t),e&&(F=e)}function W(t){return F?F.createRoot(t):null}function A(t){return K.useSyncExternalStore(t.subscribe,t.getSnapshot,t.getSnapshot)}var k=xe("zod"),f="dsh-ui-enhancements",ye="uiEnhancements",G="uiEnhancements",x={enableSwissSettings:!0,enableSwissModals:!0,enableSwissPopovers:!0,enableSwissMarket:!0,enableModelPicker:!0,modelPickerShortcut:"Mod+Shift+M"};function I(t){let e=t!==null&&typeof t=="object"?t:{};return{enableSwissSettings:typeof e.enableSwissSettings=="boolean"?e.enableSwissSettings:x.enableSwissSettings,enableSwissModals:typeof e.enableSwissModals=="boolean"?e.enableSwissModals:x.enableSwissModals,enableSwissPopovers:typeof e.enableSwissPopovers=="boolean"?e.enableSwissPopovers:x.enableSwissPopovers,enableSwissMarket:typeof e.enableSwissMarket=="boolean"?e.enableSwissMarket:x.enableSwissMarket,enableModelPicker:typeof e.enableModelPicker=="boolean"?e.enableModelPicker:x.enableModelPicker,modelPickerShortcut:typeof e.modelPickerShortcut=="string"&&e.modelPickerShortcut.trim()!==""?e.modelPickerShortcut.trim():x.modelPickerShortcut}}var ke=(t,e)=>({mode:"strict",typeSymbol:`${f}#${t}`,create:e}),Se=ke("CatalogResult",()=>k.z.object({providers:k.z.array(k.z.object({id:k.z.string(),name:k.z.string(),error:k.z.string().optional(),models:k.z.array(k.z.object({id:k.z.string(),name:k.z.string(),description:k.z.string().optional()}))}))})),Ee=t=>`${f}#${G}/${t}`,Ce=[{id:Ee("catalog"),service:ye,namespace:G,method:"catalog",invocation:{kind:"direct"},parameters:[],result:Se}],q={package:f,descriptors:Ce};var X="dsh.ui-enhancements.config.v1",Me="ui-enhancements",Y="plugin-dev-";function V(){try{let t=globalThis.localStorage?.getItem(X);if(!t)return{};let e=JSON.parse(t);return e&&typeof e=="object"?e:{}}catch{return{}}}function Pe(t){try{globalThis.localStorage?.setItem(X,JSON.stringify(t))}catch{}}var _=class{snapshot;listeners=new Set;forms;mirror;controller;disposers=[];retryTimer;flashTimer;retries=0;disposed=!1;constructor(){this.snapshot={config:I({...x,...V()}),status:"local-only",writable:!0,overlay:!1,saving:!1}}getSnapshot=()=>this.snapshot;subscribe=e=>(this.listeners.add(e),()=>{this.listeners.delete(e)});connect(e){if(!(this.disposed||this.forms===e||!e)){this.forms=e;try{let s=e.describe();this.mirror=s,this.disposers.push(s.subscribe(()=>this.sync())),s.ensure?.(),this.sync()}catch{this.patch({status:"local-only",writable:!0})}}}async setField(e,s){let n=I({...this.snapshot.config,[e]:s});Pe(n),this.patch({config:n,saving:!0,flash:void 0,error:void 0});let o=this.controller;if(!(o!==void 0&&this.snapshot.status==="ready"&&this.snapshot.writable)){this.patch({saving:!1,flash:"local"}),this.clearFlashLater();return}try{await o.mutate([{op:"set",path:[e],value:s}])===!1?this.patch({saving:!1,flash:"local"}):this.patch({saving:!1,flash:"saved"})}catch(l){this.patch({saving:!1,flash:"local",error:l instanceof Error?l.message:String(l)})}this.clearFlashLater()}async resetAll(){for(let e of Object.keys(x))await this.setField(e,x[e])}dispose(){if(!this.disposed){this.disposed=!0,this.retryTimer!==void 0&&clearTimeout(this.retryTimer),this.flashTimer!==void 0&&clearTimeout(this.flashTimer);for(let e of this.disposers.splice(0))try{e()}catch{}try{this.controller?.dispose?.()}catch{}this.controller=void 0,this.listeners.clear()}}sync(){if(this.disposed||!this.mirror)return;let e;try{e=this.mirror.getSnapshot?.().view}catch{e=void 0}if(e===void 0){this.scheduleRetry();return}let s=Array.isArray(e.namespaces)?e.namespaces:[],n=s.find(c=>c.ns===f)??s.find(c=>c.ns===Me)??s.find(c=>String(c.ns).startsWith(Y));if(n===void 0){this.retries<6&&this.scheduleRetry();return}if((this.controller===void 0||this.snapshot.namespace!==n.ns)&&!this.bind(n.ns))return;let o=this.controller?.getSnapshot?.()??{};if(o.status!=="ready"){this.scheduleRetry();return}let a=String(n.ns).startsWith(Y),l=e.writable===!0&&o.writable!==!1&&!a,i=o.value&&typeof o.value=="object"?o.value:{},d=l?I(i):I({...i,...V()});this.patch({status:"ready",writable:l,overlay:a,namespace:n.ns,config:d})}bind(e){try{this.controller?.dispose?.()}catch{}this.controller=void 0;try{let s=this.forms?.get?.(e);return s?(this.controller=s,this.disposers.push(s.subscribe(()=>this.sync())),this.snapshot={...this.snapshot,namespace:e},!0):!1}catch{return!1}}scheduleRetry(){this.disposed||this.retryTimer!==void 0||this.retries>=6||(this.retries+=1,this.retryTimer=setTimeout(()=>{this.retryTimer=void 0,this.mirror?.load?.()},300))}clearFlashLater(){this.flashTimer!==void 0&&clearTimeout(this.flashTimer),this.flashTimer=setTimeout(()=>{this.flashTimer=void 0,this.snapshot.flash!==void 0&&this.patch({flash:void 0})},1800)}patch(e){if(!this.disposed){this.snapshot={...this.snapshot,...e};for(let s of[...this.listeners])try{s()}catch{}}}};var Z=`/* Shared Swiss modernist palette \u2014 light & dark */
:root {
  --swiss-font: "Helvetica Neue", Helvetica, Inter, "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", Arial, sans-serif;

  --swiss-paper: #faf9f6;
  --swiss-paper-2: #f1f0ec;
  --swiss-ink: #0a0a0b;
  --swiss-ink-2: #5c5c57;
  --swiss-hairline: #d8d6cf;
  --swiss-accent: #9ccc65;
  --swiss-bar: #9ccc65;
  --swiss-mask: rgba(10, 10, 11, 0.55);
}

body[data-ds-dark-theme] {
  --swiss-paper: #121213;
  --swiss-paper-2: #1b1b1d;
  --swiss-ink: #f4f3ef;
  --swiss-ink-2: #a3a39c;
  --swiss-hairline: #33332f;
  --swiss-accent: #a5d6a7;
  --swiss-bar: #4a7c22;
  --swiss-mask: rgba(0, 0, 0, 0.66);
}
`;var J=`/* Swiss Settings Dialog \u2014 80% viewport, numbered rail, hairline grid */
div[role="presentation"]:has(> [data-shortcut-modal="settings"]) {
  box-sizing: border-box;
  padding-top: var(--dsh-frame-overlay-top, 0px);
}

[data-shortcut-modal="settings"] {
  box-sizing: border-box !important;
  width: 80vw !important;
  height: 80vh !important;
  max-width: none !important;
  max-height: none !important;
  border-top: 3px solid var(--swiss-accent) !important;
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr) !important;
  grid-template-rows: auto minmax(0, 1fr) !important;
  overflow: hidden;
}

[data-shortcut-modal="settings"] > div:first-child {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  height: 64px;
  padding: 0 24px !important;
  border-bottom: 1px solid var(--swiss-hairline);
  font-size: 13px !important;
  font-weight: 600 !important;
  line-height: 1 !important;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--swiss-ink) !important;
  overflow: hidden;
  white-space: nowrap;
}

[data-shortcut-modal="settings"] > div:first-child::before {
  content: "";
  flex: none;
  width: 10px;
  height: 10px;
  margin-right: 12px;
  background: var(--swiss-accent);
}

[data-shortcut-modal="settings"] > nav + div {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  box-sizing: border-box;
  height: 64px;
  padding: 0 16px 0 24px !important;
  border-bottom: 1px solid var(--swiss-hairline);
}

[data-shortcut-modal="settings"] > nav + div > button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 0 !important;
  border: 1px solid transparent !important;
  color: var(--swiss-ink);
}

[data-shortcut-modal="settings"] > nav + div > button:hover {
  background: var(--swiss-paper-2) !important;
  border-color: var(--swiss-hairline) !important;
}

[data-shortcut-modal="settings"] > nav + div > button:focus-visible {
  border-color: var(--swiss-ink) !important;
}

[data-shortcut-modal="settings"] > nav {
  padding: 0 !important;
  border-right: 1px solid var(--swiss-hairline);
  overflow: hidden;
}

[data-shortcut-modal="settings"] > nav > div {
  display: flex;
  flex-direction: column;
  gap: 0 !important;
  padding: 12px 0 0 !important;
  counter-reset: swissnav;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--swiss-hairline) transparent;
}

[data-shortcut-modal="settings"] > nav button {
  counter-increment: swissnav;
  display: flex;
  flex: none;
  align-items: center;
  justify-content: flex-start;
  gap: 12px;
  width: 100%;
  height: 44px;
  padding: 0 16px 0 20px !important;
  border-radius: 0 !important;
  border-bottom: 1px solid var(--swiss-hairline);
  background: transparent !important;
  color: var(--swiss-ink-2) !important;
  font-size: 12px !important;
  font-weight: 500 !important;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  transition: background-color 0.15s ease, color 0.15s ease;
}

[data-shortcut-modal="settings"] > nav button > span:has(> svg) {
  display: none !important;
}

[data-shortcut-modal="settings"] > nav button::before {
  content: counter(swissnav, decimal-leading-zero);
  flex: none;
  width: 20px;
  font-size: 11px;
  font-weight: 400;
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
  color: var(--swiss-ink-2);
}

[data-shortcut-modal="settings"] > nav button:not([aria-current="true"]):hover {
  background: var(--swiss-paper-2) !important;
  color: var(--swiss-ink) !important;
}

[data-shortcut-modal="settings"] > nav button[aria-current="true"] {
  background: var(--swiss-ink) !important;
  color: var(--swiss-paper) !important;
  box-shadow: inset 4px 0 0 0 var(--swiss-bar);
}

[data-shortcut-modal="settings"] > nav button[aria-current="true"]::before {
  color: var(--swiss-paper);
  opacity: 0.65;
}

[data-shortcut-modal="settings"] [role="tablist"] {
  border: 1px solid var(--swiss-hairline);
  background: transparent !important;
  padding: 3px;
}

[data-shortcut-modal="settings"] [role="tablist"] [role="tab"] {
  color: var(--swiss-ink-2) !important;
  font-size: 13px !important;
  letter-spacing: 0.02em;
}

[data-shortcut-modal="settings"] [role="tablist"] [role="tab"][aria-selected="true"] {
  background: var(--swiss-ink) !important;
  color: var(--swiss-paper) !important;
}

[data-shortcut-modal="settings"] > nav + div + div {
  padding: 32px 40px 48px !important;
  overflow-y: auto;
  background: var(--swiss-paper);
  scrollbar-width: thin;
  scrollbar-color: var(--swiss-hairline) transparent;
}

[data-shortcut-modal="settings"] > nav + div + div > * {
  box-sizing: border-box;
  width: 100% !important;
  max-width: none !important;
}

[data-shortcut-modal="settings"] > nav + div + div > * > * {
  box-sizing: border-box;
  width: 100%;
  max-width: none;
}

[data-shortcut-modal="settings"] > nav + div + div :is(h1, h2, h3) {
  font-weight: 600;
  letter-spacing: -0.01em;
}

@media (max-width: 900px) {
  div[role="presentation"]:has(> [data-shortcut-modal="settings"]) {
    padding-top: 0;
  }

  [data-shortcut-modal="settings"] {
    width: 100vw !important;
    height: 100vh !important;
    border: 0 !important;
    border-top: 3px solid var(--swiss-accent) !important;
    grid-template-columns: 200px minmax(0, 1fr) !important;
  }

  [data-shortcut-modal="settings"] > nav + div + div {
    padding: 24px 20px 40px !important;
  }
}

@media (max-width: 640px) {
  [data-shortcut-modal="settings"] {
    grid-template-columns: minmax(0, 1fr) !important;
    grid-template-rows: 64px auto minmax(0, 1fr) !important;
    grid-template-areas: "title" "nav" "options" !important;
  }

  [data-shortcut-modal="settings"] > div:first-child {
    grid-area: title;
    border-bottom: 0;
    padding-right: 64px !important;
  }

  [data-shortcut-modal="settings"] > nav {
    grid-area: nav;
    border-right: 0;
    border-top: 1px solid var(--swiss-hairline);
    border-bottom: 1px solid var(--swiss-hairline);
    overflow-x: auto;
    overflow-y: hidden;
  }

  [data-shortcut-modal="settings"] > nav > div {
    flex-direction: row;
    padding: 0 !important;
    overflow: visible;
  }

  [data-shortcut-modal="settings"] > nav button {
    width: auto;
    border-bottom: 0;
    border-right: 1px solid var(--swiss-hairline);
    white-space: nowrap;
    box-shadow: none !important;
  }

  [data-shortcut-modal="settings"] > nav button[aria-current="true"] {
    box-shadow: inset 0 -3px 0 0 var(--swiss-bar) !important;
  }

  [data-shortcut-modal="settings"] > nav + div {
    grid-area: title;
    align-self: start;
    justify-self: end;
    height: 64px;
    padding: 0 16px !important;
    border-bottom: 0;
    background: transparent;
  }

  [data-shortcut-modal="settings"] > nav + div + div {
    grid-area: options;
    padding: 20px 16px 40px !important;
  }
}

[data-shortcut-modal="settings"] :focus-visible {
  outline: 2px solid var(--swiss-ink) !important;
  outline-offset: 2px !important;
}

[data-shortcut-modal="settings"] > nav button[aria-current="true"]:focus-visible {
  outline-color: var(--swiss-paper) !important;
  outline-offset: -3px !important;
}

[data-shortcut-modal="settings"] a {
  color: var(--swiss-ink);
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  [data-shortcut-modal="settings"] * {
    transition-duration: 0s !important;
    animation-duration: 0s !important;
  }
}
`;var Q=`/* Swiss Modals, Scrim, Archive Manager & Primitive Controls */
div[role="presentation"] {
  --dsw-alias-bg-mask-1: var(--swiss-mask);
  --dsw-mask-blur: none;
}

div[role="presentation"] > div[aria-hidden="true"] {
  background: var(--swiss-mask) !important;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
}

[data-shortcut-modal="settings"],
.dsham_modalDialog,
div[role="presentation"] > div[role="dialog"][aria-modal="true"] {
  --dsw-radius-xs: 0px;
  --dsw-radius-sm: 0px;
  --dsw-radius-md: 0px;
  --dsw-radius-lg: 0px;
  --dsw-radius-xl: 0px;
  --dsw-radius-panel: 0px;
  --dsw-corner-shape: square;

  --dsw-font-family: var(--swiss-font);
  --dsh-font-family-text-default: var(--swiss-font);

  --dsw-alias-bg-base: var(--swiss-paper);
  --dsw-alias-bg-layer-1: var(--swiss-paper);
  --dsw-alias-bg-layer-2: var(--swiss-paper);
  --dsw-alias-bg-layer-3: var(--swiss-paper-2);
  --dsw-alias-bg-overlay: var(--swiss-paper);
  --dsw-alias-bg-module-platform: var(--swiss-paper-2);
  --dsw-alias-settings-card-fill: var(--swiss-paper-2);
  --dsw-alias-settings-card-stroke: var(--swiss-hairline);

  --dsw-alias-border-l1: var(--swiss-hairline);
  --dsw-alias-border-l2: var(--swiss-hairline);
  --dsw-alias-border-l3: var(--swiss-hairline);
  --dsw-alias-border-l4: var(--swiss-hairline);

  --dsw-alias-label-primary: var(--swiss-ink);
  --dsw-alias-label-secondary: var(--swiss-ink-2);
  --dsw-alias-label-tertiary: var(--swiss-ink-2);
  --dsw-alias-label-dimmed: var(--swiss-ink-2);
  --dsw-alias-label-primary-foreground: var(--swiss-paper);

  --dsw-alias-interactive-bg-hover: var(--swiss-paper-2);
  --dsw-alias-interactive-bg-active: var(--swiss-hairline);
  --dsw-specific-sidebar-nav-item-active: var(--swiss-ink);

  --dsw-alias-brand-primary: var(--swiss-ink);
  --dsw-alias-brand-primary-new-color: var(--swiss-ink);
  --dsw-alias-button-primary-fill: var(--swiss-ink);
  --dsw-alias-button-primary-hover: var(--swiss-ink-2);
  --dsw-alias-button-contrast-fill: var(--swiss-ink);
  --dsh-button-outline-color: var(--swiss-ink);
  --dsw-focus-ring-color: var(--swiss-ink);
  --dsw-alias-switch-thumb: var(--swiss-ink-2);

  border-radius: 0 !important;
  box-shadow: none !important;
  border: 1px solid var(--swiss-hairline);
  background: var(--swiss-paper) !important;
  color: var(--swiss-ink);
  font-family: var(--swiss-font);
  -webkit-font-smoothing: antialiased;
  corner-shape: square;
}

div[role="presentation"] > div[role="dialog"][aria-modal="true"]:not(
    [data-shortcut-modal="settings"]
  ),
.dsham_modalDialog {
  border-top: 2px solid var(--swiss-accent) !important;
}

.dsham_modalDialog {
  width: 80vw !important;
  max-width: none !important;
  max-height: 80vh !important;
}

.dsham_sidebarCard {
  border-radius: 0 !important;
  box-shadow: none !important;
  border: 1px solid var(--swiss-hairline) !important;
  background: var(--swiss-paper) !important;
  color: var(--swiss-ink) !important;
}

div[role="presentation"] [role="switch"],
div[role="presentation"] [role="switch"] *,
.dsham_modalDialog [role="switch"],
.dsham_modalDialog [role="switch"] *,
[data-shortcut-modal="settings"] [role="switch"],
[data-shortcut-modal="settings"] [role="switch"] * {
  border-radius: 0 !important;
  corner-shape: square !important;
}

div[role="presentation"] input[type="checkbox"],
div[role="presentation"] input[type="radio"],
.dsham_modalDialog input[type="checkbox"],
.dsham_modalDialog input[type="radio"],
[data-shortcut-modal="settings"] input[type="checkbox"],
[data-shortcut-modal="settings"] input[type="radio"] {
  accent-color: var(--swiss-ink);
}

div[role="presentation"] > div[role="dialog"][aria-modal="true"] :focus-visible,
.dsham_modalDialog :focus-visible {
  outline: 2px solid var(--swiss-ink) !important;
  outline-offset: 2px !important;
}

div[role="presentation"] > div[role="dialog"][aria-modal="true"] a,
.dsham_modalDialog a {
  color: var(--swiss-ink);
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  div[role="presentation"] > div[role="dialog"][aria-modal="true"] *,
  .dsham_modalDialog * {
    transition-duration: 0s !important;
    animation-duration: 0s !important;
  }
}
`;var ee=`/* Squared Menus & Non-modal Popovers */
[role="menu"],
[role="menu"] [role="menuitem"],
div[role="dialog"]:not([aria-modal="true"]) {
  border-radius: 0 !important;
}
`;var te=`/* Swiss Plugin Market Styling */
[data-shortcut-modal="settings"]:has([data-dsh-market-fullscreen="true"]) {
  width: 100vw !important;
  height: 100vh !important;
  border: 0 !important;
}

.dsh-market {
  color: var(--swiss-ink, #0a0a0b);
  padding: 24px 28px;
  min-height: 240px;
}
.dsh-market-header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 20px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--swiss-hairline, #d8d6cf);
}
.dsh-market-header h2,
.dsh-market-item h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.dsh-market-header p,
.dsh-market-item p {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.5;
}
.dsh-market-header input {
  width: min(280px, 45%);
  min-height: 36px;
  padding: 6px 10px;
  border: 1px solid var(--swiss-hairline, #d8d6cf);
  border-radius: 0;
  background: transparent;
  color: inherit;
}
.dsh-market-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
}
.dsh-market-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  min-width: 0;
  padding: 18px 0;
  border-bottom: 1px solid var(--swiss-hairline, #d8d6cf);
}
.dsh-market-copy {
  min-width: 0;
}
.dsh-market-item p {
  max-width: 58ch;
  opacity: 0.78;
}
.dsh-market-item code {
  display: inline-block;
  margin-top: 10px;
  font-size: 11px;
  opacity: 0.65;
}
.dsh-market-install {
  flex: 0 0 auto;
  min-height: 34px;
  padding: 0 14px;
  border: 1px solid currentColor;
  border-radius: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.dsh-market-install:hover {
  background: var(--swiss-accent, #9ccc65);
}
.dsh-market-install:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.dsh-market-message {
  padding: 24px 0;
  font-size: 13px;
}
@media (max-width: 640px) {
  .dsh-market {
    padding: 18px 16px;
  }
  .dsh-market-header {
    align-items: stretch;
    flex-direction: column;
  }
  .dsh-market-header input {
    width: 100%;
  }
}
`;var se=`/* dsh-ui-enhancements \u2014 Settings Page & Model Picker Panel (Swiss modernist) */

.dsh-enh-settings {
  --enh-paper: var(--swiss-paper, var(--dsw-alias-bg-base, #faf9f6));
  --enh-paper-2: var(--swiss-paper-2, var(--dsw-alias-bg-layer-3, #f1f0ec));
  --enh-ink: var(--swiss-ink, var(--dsw-alias-label-primary, #0a0a0b));
  --enh-ink-2: var(--swiss-ink-2, var(--dsw-alias-label-secondary, #5c5c57));
  --enh-hairline: var(--swiss-hairline, var(--dsw-alias-border-l1, #d8d6cf));
  --enh-accent: var(--swiss-accent, #9ccc65);
  --enh-bar: var(--swiss-bar, #9ccc65);
  color: var(--enh-ink);
  font-family: var(--swiss-font, var(--dsw-font-family, sans-serif));
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.dsh-enh-settings-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--enh-hairline);
}

.dsh-enh-settings-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.dsh-enh-settings-desc {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--enh-ink-2);
  line-height: 1.5;
}

.dsh-enh-badge {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid var(--enh-hairline);
  background: var(--enh-paper-2);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--enh-ink-2);
}

.dsh-enh-badge-dot {
  width: 7px;
  height: 7px;
  background: var(--enh-bar);
}

.dsh-enh-group {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--enh-hairline);
  background: var(--enh-paper);
}

.dsh-enh-group-head {
  padding: 12px 16px;
  background: var(--enh-paper-2);
  border-bottom: 1px solid var(--enh-hairline);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--enh-ink-2);
}

.dsh-enh-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--enh-hairline);
}

.dsh-enh-row:last-child {
  border-bottom: 0;
}

.dsh-enh-row-copy {
  min-width: 0;
  flex: 1;
}

.dsh-enh-row-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--enh-ink);
}

.dsh-enh-row-desc {
  margin-top: 3px;
  font-size: 12px;
  color: var(--enh-ink-2);
  line-height: 1.45;
}

.dsh-enh-switch {
  flex: none;
  position: relative;
  display: inline-flex;
  align-items: center;
  width: 44px;
  height: 24px;
  padding: 2px;
  border: 1px solid var(--enh-ink);
  border-radius: 0;
  background: var(--enh-paper);
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.dsh-enh-switch[aria-checked="true"] {
  background: var(--enh-ink);
}

.dsh-enh-switch-thumb {
  width: 18px;
  height: 18px;
  background: var(--enh-ink);
  transition: transform 0.15s ease, background-color 0.15s ease;
}

.dsh-enh-switch[aria-checked="true"] .dsh-enh-switch-thumb {
  transform: translateX(20px);
  background: var(--enh-bar);
}

.dsh-enh-shortcut-controls {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.dsh-enh-shortcut-btn {
  min-width: 148px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--enh-hairline);
  border-radius: 0;
  background: var(--enh-paper-2);
  color: var(--enh-ink);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  font-weight: 500;
  text-align: center;
  cursor: pointer;
}

.dsh-enh-shortcut-btn:hover {
  border-color: var(--enh-ink);
}

.dsh-enh-shortcut-btn.is-recording {
  border-color: var(--enh-ink);
  background: var(--enh-ink);
  color: var(--enh-paper);
}

.dsh-enh-btn {
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--enh-hairline);
  border-radius: 0;
  background: transparent;
  color: var(--enh-ink-2);
  font-size: 12px;
  cursor: pointer;
}

.dsh-enh-btn:hover {
  border-color: var(--enh-ink);
  color: var(--enh-ink);
  background: var(--enh-paper-2);
}

.dsh-enh-flash {
  font-size: 12px;
  color: var(--enh-ink-2);
}

/* ---------------------------------------------------------------------------
   Model Picker Panel (Swiss modernist + model-intelligence-test FuzzySelect)
   --------------------------------------------------------------------------- */
.dsh-enh-mp-popover {
  --mp-paper: var(--swiss-paper, var(--dsw-alias-bg-base, #faf9f6));
  --mp-paper-2: var(--swiss-paper-2, var(--dsw-alias-bg-layer-3, #f1f0ec));
  --mp-ink: var(--swiss-ink, var(--dsw-alias-label-primary, #0a0a0b));
  --mp-ink-2: var(--swiss-ink-2, var(--dsw-alias-label-secondary, #5c5c57));
  --mp-hairline: var(--swiss-hairline, var(--dsw-alias-border-l1, #d8d6cf));
  --mp-accent: var(--swiss-accent, #9ccc65);
  --mp-bar: var(--swiss-bar, #9ccc65);

  position: fixed;
  z-index: 1200;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  background: var(--mp-paper);
  color: var(--mp-ink);
  font-family: var(--swiss-font, var(--dsw-font-family, sans-serif));
  font-size: 12px;
  line-height: 1.45;
  border: 1px solid var(--mp-hairline);
  border-top: 2px solid var(--mp-accent);
  border-radius: 0;
  box-shadow: none;
  max-height: min(420px, 60vh);
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
}

.dsh-enh-mp-popover * {
  box-sizing: border-box;
}

.dsh-enh-mp-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--mp-hairline);
  background: var(--mp-paper);
  color: var(--mp-ink-2);
}

.dsh-enh-mp-search input {
  flex: 1;
  min-width: 0;
  height: 24px;
  border: 0;
  outline: 0;
  padding: 0;
  background: transparent;
  color: var(--mp-ink);
  font: inherit;
  font-size: 12.5px;
}

.dsh-enh-mp-search input::placeholder {
  color: var(--mp-ink-2);
  opacity: 0.75;
}

.dsh-enh-mp-total {
  flex: none;
  font-size: 10.5px;
  letter-spacing: 0.06em;
  font-variant-numeric: tabular-nums;
  color: var(--mp-ink-2);
}

.dsh-enh-mp-refresh {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 0;
  background: transparent;
  color: var(--mp-ink-2);
  cursor: pointer;
}

.dsh-enh-mp-refresh:hover {
  background: var(--mp-paper-2);
  border-color: var(--mp-hairline);
  color: var(--mp-ink);
}

.dsh-enh-mp-main {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.dsh-enh-mp-sidebar {
  display: flex;
  flex-direction: column;
  width: 148px;
  flex: none;
  border-right: 1px solid var(--mp-hairline);
  background: var(--mp-paper-2);
  padding: 4px 0;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--mp-hairline) transparent;
}

.dsh-enh-mp-sidebar button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  width: 100%;
  text-align: left;
  padding: 7px 12px;
  border: 0;
  border-left: 3px solid transparent;
  border-radius: 0;
  background: transparent;
  color: var(--mp-ink-2);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.dsh-enh-mp-sidebar button:hover {
  background: var(--mp-paper);
  color: var(--mp-ink);
}

.dsh-enh-mp-sidebar button.is-active {
  border-left-color: var(--mp-bar);
  background: var(--mp-paper);
  color: var(--mp-ink);
  font-weight: 600;
}

.dsh-enh-mp-sidebar-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-enh-mp-sidebar-count {
  flex: none;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
}

.dsh-enh-mp-list {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 0;
  scrollbar-width: thin;
  scrollbar-color: var(--mp-hairline) transparent;
}

.dsh-enh-mp-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 34px;
  padding: 6px 12px;
  border: 0;
  border-bottom: 1px solid var(--mp-hairline);
  border-radius: 0;
  background: transparent;
  color: var(--mp-ink);
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.1s ease;
}

.dsh-enh-mp-option:hover,
.dsh-enh-mp-option.is-highlighted {
  background: var(--mp-paper-2);
}

.dsh-enh-mp-option.is-selected {
  background: var(--mp-paper-2);
  font-weight: 600;
}

.dsh-enh-mp-check {
  display: inline-grid;
  place-items: center;
  flex: none;
  width: 14px;
  height: 14px;
  border: 1px solid var(--mp-hairline);
  border-radius: 0;
  background: var(--mp-paper);
  color: var(--mp-paper);
}

.dsh-enh-mp-option.is-selected .dsh-enh-mp-check {
  border-color: var(--mp-ink);
  background: var(--mp-ink);
  color: var(--mp-bar);
}

.dsh-enh-mp-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-enh-mp-label mark {
  background: transparent;
  color: var(--mp-ink);
  font-weight: 700;
  text-decoration: underline;
  text-decoration-color: var(--mp-bar);
  text-decoration-thickness: 2px;
  text-underline-offset: 2px;
}

.dsh-enh-mp-hint {
  flex: none;
  max-width: 42%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: var(--mp-ink-2);
}

.dsh-enh-mp-empty,
.dsh-enh-mp-more {
  margin: 0;
  padding: 16px 14px;
  font-size: 12px;
  color: var(--mp-ink-2);
}

.dsh-enh-mp-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 12px;
  border-top: 1px solid var(--mp-hairline);
  background: var(--mp-paper-2);
  font-size: 11px;
  color: var(--mp-ink-2);
}

@media (max-width: 520px) {
  .dsh-enh-mp-sidebar {
    width: 110px;
  }
}
`;var Oe=[{id:"tokens",css:Z,enabled:()=>!0},{id:"plugin-ui",css:se,enabled:()=>!0},{id:"swiss-settings",css:J,enabled:t=>t.enableSwissSettings},{id:"swiss-modals",css:Q,enabled:t=>t.enableSwissModals},{id:"swiss-popovers",css:ee,enabled:t=>t.enableSwissPopovers},{id:"swiss-market",css:te,enabled:t=>t.enableSwissMarket}],O=class{mounted=new Map;constructor(){for(let e of document.querySelectorAll(`style[data-plugin="${f}"]`))e.remove()}apply(e){for(let s of Oe){let n=s.enabled(e),o=this.mounted.get(s.id);if(n&&!o){let a=document.createElement("style");a.dataset.plugin=f,a.dataset.feature=s.id,a.textContent=s.css,document.head.appendChild(a),this.mounted.set(s.id,a)}else!n&&o&&(o.remove(),this.mounted.delete(s.id))}}dispose(){for(let e of this.mounted.values())e.remove();this.mounted.clear()}};var C=typeof navigator<"u"&&/Mac|iPhone|iPad|iPod/i.test(navigator.platform||navigator.userAgent),De=new Set(["ShiftLeft","ShiftRight","ControlLeft","ControlRight","AltLeft","AltRight","MetaLeft","MetaRight"]);function ze(t){let e=t.trim().toUpperCase();if(/^[A-Z]$/.test(e))return`Key${e}`;if(/^[0-9]$/.test(e))return`Digit${e}`;let s=t.trim();return/^Key[A-Z]$/i.test(s)?`Key${s.slice(3).toUpperCase()}`:/^Digit[0-9]$/i.test(s)?`Digit${s.slice(5)}`:s.toLowerCase()==="space"?"Space":s.toLowerCase()==="slash"||s==="/"?"Slash":s.toLowerCase()==="backquote"||s==="`"?"Backquote":s}function re(t){return t.startsWith("Key")?t.slice(3):t.startsWith("Digit")?t.slice(5):t==="Space"?"Space":t==="Slash"?"/":t==="Backquote"?"`":t}function $(t){if(!t||typeof t!="string")return null;let e=t.split("+").map(d=>d.trim()).filter(Boolean);if(e.length===0)return null;let s=!1,n=!1,o=!1,a=!1,l=!1,i="";for(let d of e){let c=d.toLowerCase();c==="mod"||c==="primary"||c==="cmdorctrl"?s=!0:c==="ctrl"||c==="control"?n=!0:c==="meta"||c==="cmd"||c==="command"||c==="super"?o=!0:c==="alt"||c==="option"||c==="opt"?a=!0:c==="shift"?l=!0:i=ze(d)}return i?{mod:s,ctrl:n,meta:o,alt:a,shift:l,code:i}:null}function ne(t){if(De.has(t.code)||!t.code)return null;let e=[];return(C?t.metaKey:t.ctrlKey)&&e.push("Mod"),C&&t.ctrlKey&&e.push("Ctrl"),!C&&t.metaKey&&e.push("Meta"),t.altKey&&e.push("Alt"),t.shiftKey&&e.push("Shift"),e.push(re(t.code)),e.join("+")}function ie(t,e){let s=$(e);if(!s||t.code!==s.code)return!1;let n=s.meta||s.mod&&C,o=s.ctrl||s.mod&&!C;return t.metaKey===n&&t.ctrlKey===o&&t.altKey===s.alt&&t.shiftKey===s.shift}function oe(t){let e=$(t);if(!e)return null;let s=[];return e.mod&&s.push("primary"),e.ctrl&&s.push("ctrl"),e.meta&&s.push("meta"),e.alt&&s.push("alt"),e.shift&&s.push("shift"),{code:e.code,modifiers:s}}function ae(t){let e=$(t);if(!e)return t||"\u672A\u8BBE\u7F6E";let s=[];return e.mod&&s.push(C?"\u2318":"Ctrl"),e.ctrl&&s.push(C?"\u2303":"Ctrl"),e.meta&&s.push(C?"\u2318":"Win"),e.alt&&s.push(C?"\u2325":"Alt"),e.shift&&s.push(C?"\u21E7":"Shift"),s.push(re(e.code)),s.join(" + ")}var Ue=[{key:"enableSwissSettings",title:"\u8BBE\u7F6E\u5F39\u7A97\u4E3B\u9898",desc:"\u5C06\u8BBE\u7F6E\u5F39\u7A97\u6539\u9020\u4E3A 80% \u89C6\u53E3\u3001\u5E8F\u53F7\u5BFC\u822A\u680F\u3001\u65B9\u6B63\u6392\u7248\u4E0E Swiss \u914D\u8272\u3002"},{key:"enableSwissModals",title:"\u901A\u7528\u6A21\u6001\u6846\u4E0E\u5F52\u6863\u7BA1\u7406\u5668",desc:"\u4E3A\u786E\u8BA4\u5F39\u7A97\u3001\u5F52\u6863\u7BA1\u7406\u5668\u53CA\u5185\u90E8\u5F00\u5173/\u590D\u9009\u6846\u5E94\u7528\u76F4\u89D2\u65E0\u9634\u5F71\u6837\u5F0F\u3002"},{key:"enableSwissPopovers",title:"\u83DC\u5355\u4E0E\u6D6E\u5C42\u76F4\u89D2\u5316",desc:"\u79FB\u9664\u53F3\u952E\u83DC\u5355\u4E0E\u975E\u6A21\u6001\u5F39\u51FA\u5C42\u7684\u5706\u89D2\u3002"},{key:"enableSwissMarket",title:"\u63D2\u4EF6\u5E02\u573A\u4E3B\u9898\u9002\u914D",desc:"\u4E3A\u63D2\u4EF6\u5E02\u573A\u5217\u8868\u3001\u641C\u7D22\u680F\u4E0E\u5168\u5C4F\u6A21\u5F0F\u5E94\u7528 Swiss \u7F51\u683C\u98CE\u683C\u3002"}];function le(){return r.createElement("svg",{width:"16",height:"16",viewBox:"0 0 16 16",fill:"none",stroke:"currentColor",strokeWidth:"1.4","aria-hidden":"true"},r.createElement("rect",{x:"2",y:"2",width:"12",height:"12"}),r.createElement("line",{x1:"6",y1:"2",x2:"6",y2:"14"}),r.createElement("line",{x1:"6",y1:"7",x2:"14",y2:"7"}))}function de({store:t,onRecordingChange:e}){let s=A(t),n=s.config,[o,a]=r.useState(!1);r.useEffect(()=>(e?.(o),()=>e?.(!1)),[o,e]),r.useEffect(()=>{if(!o)return;let i=d=>{if(d.preventDefault(),d.stopPropagation(),d.key==="Escape"){a(!1);return}let c=ne(d);c&&(a(!1),t.setField("modelPickerShortcut",c))};return window.addEventListener("keydown",i,!0),()=>window.removeEventListener("keydown",i,!0)},[o,t]);let l=s.flash==="saved"?"\u5DF2\u70ED\u66F4\u65B0\u5E76\u4FDD\u5B58":s.flash==="local"?"\u5DF2\u70ED\u66F4\u65B0\uFF08\u672C\u5730\u5B58\u50A8\uFF09":s.flash==="failed"?"\u4FDD\u5B58\u5931\u8D25":null;return r.createElement("section",{className:"dsh-enh-settings"},r.createElement("header",{className:"dsh-enh-settings-header"},r.createElement("div",null,r.createElement("h2",{className:"dsh-enh-settings-title"},"Enhans \u754C\u9762\u4E0E\u4EA4\u4E92\u589E\u5F3A"),r.createElement("p",{className:"dsh-enh-settings-desc"},"\u6309\u529F\u80FD\u5757\u72EC\u7ACB\u5F00\u5173\uFF0C\u6240\u6709\u66F4\u6539\u5373\u65F6\u70ED\u66F4\u65B0\u751F\u6548\uFF0C\u65E0\u9700\u91CD\u542F\u6216\u5237\u65B0\u9875\u9762\u3002")),r.createElement("div",{className:"dsh-enh-badge",title:s.namespace?`Config: ${s.namespace}`:"Local"},r.createElement("span",{className:"dsh-enh-badge-dot","aria-hidden":"true"}),r.createElement("span",null,l??"\u70ED\u66F4\u65B0\u5C31\u7EEA"))),r.createElement("div",{className:"dsh-enh-group"},r.createElement("div",{className:"dsh-enh-group-head"},"01 \xB7 Swiss \u754C\u9762\u589E\u5F3A\u529F\u80FD\u5757"),Ue.map(i=>{let d=n[i.key];return r.createElement("div",{className:"dsh-enh-row",key:i.key},r.createElement("div",{className:"dsh-enh-row-copy"},r.createElement("div",{className:"dsh-enh-row-title"},i.title),r.createElement("div",{className:"dsh-enh-row-desc"},i.desc)),r.createElement("button",{type:"button",role:"switch","aria-checked":d,"aria-label":i.title,className:"dsh-enh-switch",onClick:()=>void t.setField(i.key,!d)},r.createElement("span",{className:"dsh-enh-switch-thumb","aria-hidden":"true"})))})),r.createElement("div",{className:"dsh-enh-group"},r.createElement("div",{className:"dsh-enh-group-head"},"02 \xB7 \u6A21\u578B\u9009\u62E9\u6539\u5584"),r.createElement("div",{className:"dsh-enh-row"},r.createElement("div",{className:"dsh-enh-row-copy"},r.createElement("div",{className:"dsh-enh-row-title"},"\u542F\u7528\u589E\u5F3A\u6A21\u578B\u9009\u62E9\u9762\u677F"),r.createElement("div",{className:"dsh-enh-row-desc"},"\u5728\u5F53\u524D\u8F93\u5165\u6846\u4E0A\u65B9\u5F39\u51FA\u7B49\u5BBD\u9009\u62E9\u9762\u677F\uFF0C\u652F\u6301\u5DE6\u4FA7\u63D0\u4F9B\u5546\u7B5B\u9009\u4E0E\u9876\u90E8\u6A21\u7CCA\u641C\u7D22\uFF08ds / cl / gm \u7B49\u522B\u540D\uFF09\u3002")),r.createElement("button",{type:"button",role:"switch","aria-checked":n.enableModelPicker,"aria-label":"\u542F\u7528\u589E\u5F3A\u6A21\u578B\u9009\u62E9\u9762\u677F",className:"dsh-enh-switch",onClick:()=>void t.setField("enableModelPicker",!n.enableModelPicker)},r.createElement("span",{className:"dsh-enh-switch-thumb","aria-hidden":"true"}))),r.createElement("div",{className:"dsh-enh-row"},r.createElement("div",{className:"dsh-enh-row-copy"},r.createElement("div",{className:"dsh-enh-row-title"},"\u6253\u5F00\u6A21\u578B\u9009\u62E9\u9762\u677F\u5FEB\u6377\u952E"),r.createElement("div",{className:"dsh-enh-row-desc"},"\u70B9\u51FB\u53F3\u4FA7\u6309\u94AE\u540E\u6309\u4E0B\u4EFB\u610F\u7EC4\u5408\u952E\u5373\u53EF\u5F55\u5236\uFF0C\u6309 Esc \u53D6\u6D88\u5F55\u5236\u3002")),r.createElement("div",{className:"dsh-enh-shortcut-controls"},r.createElement("button",{type:"button",className:`dsh-enh-shortcut-btn ${o?"is-recording":""}`,onClick:()=>a(i=>!i)},o?"\u8BF7\u6309\u4E0B\u5FEB\u6377\u952E\u2026":ae(n.modelPickerShortcut)),n.modelPickerShortcut!==x.modelPickerShortcut&&r.createElement("button",{type:"button",className:"dsh-enh-btn",onClick:()=>void t.setField("modelPickerShortcut",x.modelPickerShortcut)},"\u91CD\u7F6E\u9ED8\u8BA4")))))}var Fe={ds:"deepseek",oai:"openai",cl:"claude",gm:"gemini",qw:"qwen",kimi:"moonshot"},Ke=new Set(["-","_","/",".",":"," "]);function $e(t){return/\s/.test(t)}function pe(t){return t!==t.toUpperCase()&&t===t.toLowerCase()}function he(t){return t!==t.toLowerCase()&&t===t.toUpperCase()}function me(t){return t>="0"&&t<="9"}function ue(t){return pe(t)||he(t)}function ce(t){return ue(t)||me(t)||/[\u3400-\u9fff]/.test(t)}function Be(t,e){if(e===0)return 10;let s=t[e-1],n=t[e];return ce(n)?$e(s)?10:Ke.has(s)?9:ce(s)?pe(s)&&he(n)||ue(s)&&me(n)?7:0:8:0}function je(t,e){let s=t.length,n=e.length;if(!n)return{score:0,positions:[]};if(n>s)return null;let o=t.toLowerCase(),a=0;for(let h=0;h<s&&a<n;h+=1)o[h]===e[a]&&(a+=1);if(a<n)return null;let l=new Array(s);for(let h=0;h<s;h+=1)l[h]=Be(t,h);let i=-1/0,d=[],c=[];for(let h=0;h<n;h+=1){let E=new Float64Array(s).fill(i),T=new Int32Array(s).fill(-1),y=e[h];if(h===0)for(let w=0;w<s;w+=1)o[w]===y&&(E[w]=16+l[w]*2);else{let w=d[h-1],p=i,u=-1;for(let m=0;m<s;m+=1){let b=m-2;if(b>=0&&w[b]!==i&&w[b]+b>p&&(p=w[b]+b,u=b),o[m]!==y)continue;let N=i,U=-1;if(m>0&&w[m-1]!==i&&(N=w[m-1]+16+Math.max(l[m],4),U=m-1),u>=0){let H=p-m+-3- -2+16+l[m];H>N&&(N=H,U=u)}E[m]=N,T[m]=U}}d.push(E),c.push(T)}let g=d[n-1],M=-1,S=i;for(let h=0;h<s;h+=1)g[h]>S&&(S=g[h],M=h);if(M<0)return null;let v=new Array(n);for(let h=n-1,E=M;h>=0;h-=1)v[h]=E,E=c[h][E];let P=S/(n*26),D=v[n-1]-v[0]+1,z=n/D*.08,L=Math.min(.12,Math.max(0,s-n)*.003);return{score:Math.max(.001,P+z-L),positions:v}}function He(t,e){let s=t.toLowerCase(),n=new Set,o=[],a=0;for(let d of e){let c=-1;for(let g=0;g<s.length;g+=1)if(!n.has(g)&&s[g]===d){c=g;break}c>=0&&(n.add(c),o.push(c),a+=1)}let l=a/e.length;if(l<.75)return null;o.sort((d,c)=>d-c);let i=Math.min(.12,Math.max(0,s.length-e.length)*.003);return{score:Math.max(.001,(l-i)*.42),positions:o}}function Re(t,e){let s=je(t,e);return s||(e.length>=2?He(t,e):null)}function We(t){let e=[{token:t,factor:1}];for(let[s,n]of Object.entries(Fe))(t===s||t.startsWith(s)&&t.length>s.length)&&e.push({token:n+t.slice(s.length),factor:.96});return e}function Ge(t,e){let s=0,n=new Set;for(let o of e){let a=null;for(let l of We(o)){let i=Re(t,l.token);i&&(!a||i.score*l.factor>a.score)&&(a={score:i.score*l.factor,positions:i.positions})}if(!a)return null;s+=a.score;for(let l of a.positions)n.add(l)}return{score:s/e.length,positions:[...n].sort((o,a)=>o-a)}}function fe(t,e,s){let n=e.trim().toLowerCase().split(/\s+/).filter(Boolean);if(!n.length)return t.map(a=>({item:a,score:0,positions:[]}));let o=[];return t.forEach((a,l)=>{let i=Ge(s(a),n);i&&o.push({item:a,score:i.score,positions:i.positions,order:l})}),o.sort((a,l)=>l.score-a.score||a.order-l.order),o.map(({item:a,score:l,positions:i})=>({item:a,score:l,positions:i}))}function ge(t,e){let s=r.useRef(null),n=r.useRef(e);return n.current=e,r.useEffect(()=>{if(!t)return;let o=l=>{let i=s.current;i&&l.target instanceof Node&&!i.contains(l.target)&&n.current()},a=l=>{l.key==="Escape"&&(l.stopPropagation(),l.preventDefault(),n.current())};return document.addEventListener("pointerdown",o,!0),document.addEventListener("keydown",a,!0),()=>{document.removeEventListener("pointerdown",o,!0),document.removeEventListener("keydown",a,!0)}},[t]),s}var B=240;function qe({text:t,positions:e}){if(!e.length)return r.createElement(r.Fragment,null,t);let s=new Set(e),n=[];for(let o=0;o<t.length;o+=1){let a=s.has(o),l=n[n.length-1];l&&l.hit===a?l.text+=t[o]:n.push({text:t[o],hit:a})}return r.createElement(r.Fragment,null,n.map((o,a)=>o.hit?r.createElement("mark",{key:a},o.text):r.createElement("span",{key:a},o.text)))}function Ye(){let t=Array.from(document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')).filter(l=>{if(l.closest('[role="dialog"]'))return!1;let i=l.getBoundingClientRect();return i.width>120&&i.height>16}),e=document.activeElement,s=(e instanceof HTMLElement&&t.includes(e)?e:null)??t[t.length-1]??null;if(!s)return null;let n=s,o=s,a=s.getBoundingClientRect().width;for(let l=0;l<6&&n?.parentElement;l+=1){let i=n.parentElement;if(i===document.body||i.tagName==="MAIN")break;let d=i.getBoundingClientRect();if(d.width>=a&&d.width<=window.innerWidth*.92&&d.height<=360)o=i,n=i;else break}return o}function ve(t){if(!t){let s=Math.min(720,Math.max(320,window.innerWidth-48));return{left:Math.round((window.innerWidth-s)/2),width:s,bottom:84}}let e=t.getBoundingClientRect();return{left:Math.round(e.left),width:Math.round(e.width),bottom:Math.max(16,Math.round(window.innerHeight-e.top+8))}}function be({open:t,providers:e,loading:s,error:n,selectedKey:o,onClose:a,onRefresh:l,onSelect:i}){let[d,c]=r.useState(""),[g,M]=r.useState("all"),[S,v]=r.useState(0),[P,D]=r.useState(()=>ve(null)),z=ge(t,a),L=r.useRef(null);r.useEffect(()=>{if(!t)return;c(""),v(0);let p=Ye(),u=()=>D(ve(p));u();let m=p&&typeof ResizeObserver<"u"?new ResizeObserver(u):null;p&&m&&m.observe(p),window.addEventListener("resize",u),window.addEventListener("scroll",u,!0);let b=setTimeout(()=>L.current?.focus(),0);return()=>{clearTimeout(b),m?.disconnect(),window.removeEventListener("resize",u),window.removeEventListener("scroll",u,!0)}},[t]);let h=r.useMemo(()=>{let p=[];for(let u of e)for(let m of u.models){let b=`${u.id}:${m.id}`;p.push({value:b,providerId:u.id,providerName:u.name,modelId:m.id,label:m.name,hint:m.id!==m.name?m.id:u.name,searchText:`${m.name} ${m.id} ${u.name} ${u.id}`})}return p},[e]),E=r.useMemo(()=>g!=="all"?h.filter(p=>p.providerId===g):h,[h,g]),T=r.useMemo(()=>t?fe(E,d,p=>p.label):[],[t,E,d]),y=r.useMemo(()=>T.slice(0,B),[T]);if(r.useEffect(()=>{v(0)},[d,g,t]),!t)return null;let w=p=>{i(p),a()};return r.createElement("div",{ref:z,className:"dsh-enh-mp-popover",role:"dialog","aria-label":"\u6A21\u578B\u9009\u62E9\u9762\u677F",style:{left:`${P.left}px`,width:`${P.width}px`,bottom:`${P.bottom}px`}},r.createElement("label",{className:"dsh-enh-mp-search"},r.createElement("svg",{width:"14",height:"14",viewBox:"0 0 16 16",fill:"none",stroke:"currentColor",strokeWidth:"1.5","aria-hidden":"true"},r.createElement("circle",{cx:"7",cy:"7",r:"4.5"}),r.createElement("line",{x1:"10.5",y1:"10.5",x2:"14",y2:"14"})),r.createElement("input",{ref:L,value:d,placeholder:"\u6A21\u7CCA\u641C\u7D22\u6A21\u578B\uFF0C\u5982 ds v3 / cl sonnet / gm pro","aria-label":"\u6A21\u578B\u6A21\u7CCA\u641C\u7D22",onChange:p=>c(p.target.value),onKeyDown:p=>{p.key==="ArrowDown"?(p.preventDefault(),v(u=>y.length?(u+1)%y.length:0)):p.key==="ArrowUp"?(p.preventDefault(),v(u=>y.length?(u-1+y.length)%y.length:0)):p.key==="Enter"&&y[S]&&(p.preventDefault(),w(y[S].item))}}),r.createElement("span",{className:"dsh-enh-mp-total"},T.length),r.createElement("button",{type:"button",className:"dsh-enh-mp-refresh",title:"\u5237\u65B0\u6A21\u578B\u76EE\u5F55","aria-label":"\u5237\u65B0\u6A21\u578B\u76EE\u5F55",onClick:l},r.createElement("svg",{width:"13",height:"13",viewBox:"0 0 16 16",fill:"none",stroke:"currentColor",strokeWidth:"1.5","aria-hidden":"true"},r.createElement("path",{d:"M13.5 8a5.5 5.5 0 1 1-1.3-3.55"}),r.createElement("polyline",{points:"13.5 2.5 13.5 5.5 10.5 5.5"})))),r.createElement("div",{className:"dsh-enh-mp-main"},r.createElement("nav",{className:"dsh-enh-mp-sidebar","aria-label":"\u6A21\u578B\u63D0\u4F9B\u5546"},r.createElement("button",{type:"button",className:g==="all"?"is-active":"",onClick:()=>M("all")},r.createElement("span",{className:"dsh-enh-mp-sidebar-label"},"\u5168\u90E8"),r.createElement("span",{className:"dsh-enh-mp-sidebar-count"},h.length)),e.map(p=>r.createElement("button",{type:"button",key:p.id,className:g===p.id?"is-active":"",onClick:()=>M(p.id),title:p.error||p.name},r.createElement("span",{className:"dsh-enh-mp-sidebar-label"},p.name),r.createElement("span",{className:"dsh-enh-mp-sidebar-count"},p.models.length)))),r.createElement("div",{className:"dsh-enh-mp-list",role:"listbox","aria-label":"\u53EF\u7528\u6A21\u578B"},s&&h.length===0?r.createElement("p",{className:"dsh-enh-mp-empty"},"\u6B63\u5728\u52A0\u8F7D\u6A21\u578B\u76EE\u5F55\u2026"):n&&h.length===0?r.createElement("p",{className:"dsh-enh-mp-empty"},n):y.length===0?r.createElement("p",{className:"dsh-enh-mp-empty"},"\u6CA1\u6709\u5339\u914D\u7684\u6A21\u578B"):y.map(({item:p,positions:u},m)=>{let b=o===p.value,N=m===S;return r.createElement("button",{type:"button",role:"option","aria-selected":b,key:p.value,className:`dsh-enh-mp-option ${b?"is-selected":""} ${N?"is-highlighted":""}`,onMouseEnter:()=>v(m),onClick:()=>w(p)},r.createElement("span",{className:"dsh-enh-mp-check","aria-hidden":"true"},b&&r.createElement("svg",{width:"10",height:"10",viewBox:"0 0 12 12",fill:"none",stroke:"currentColor",strokeWidth:"2"},r.createElement("polyline",{points:"2.5 6 5 8.5 9.5 3.5"}))),r.createElement("span",{className:"dsh-enh-mp-label"},r.createElement(qe,{text:p.label,positions:u})),r.createElement("span",{className:"dsh-enh-mp-hint"},p.hint))}),T.length>B&&r.createElement("p",{className:"dsh-enh-mp-more"},"\u53E6\u6709 ",T.length-B," \u9879\uFF0C\u8BF7\u7EE7\u7EED\u8F93\u5165\u7F29\u5C0F\u8303\u56F4"))),r.createElement("div",{className:"dsh-enh-mp-footer"},r.createElement("span",null,"\u2191\u2193 \u9009\u62E9 \xB7 Enter \u786E\u8BA4 \xB7 Esc \u5173\u95ED"),r.createElement("span",null,g==="all"?"\u5168\u90E8\u63D0\u4F9B\u5546":e.find(p=>p.id===g)?.name??g)))}var we="ui-enhancements";function Ve(t){if(t!==null&&typeof t=="object"&&"ok"in t){let e=t;if(e.ok===!1)throw new Error(e.error?.message??e.error?.code??"remote call failed");return e.value}return t}function Xe(t,e){let s=t.get?.("sessions")??t.sessions;if(s)try{let o=s.list?.getSnapshot?.(),a=o?.activeId??o?.currentId??s.activeSessionId??s.currentSessionId;if(typeof s.setModel=="function"){s.setModel(a,{providerId:e.providerId,modelId:e.modelId});return}if(typeof s.selectModel=="function"){s.selectModel(e.providerId,e.modelId);return}if(typeof s.updateModel=="function"&&a){s.updateModel(a,e.providerId,e.modelId);return}}catch{}let n=t.get?.("models")??t.models;if(n)try{if(typeof n.select=="function"){n.select(e.providerId,e.modelId);return}if(typeof n.setCurrent=="function"){n.setCurrent({providerId:e.providerId,modelId:e.modelId});return}}catch{}window.dispatchEvent(new CustomEvent("dsh-ui-enhancements:model-selected",{detail:{providerId:e.providerId,providerName:e.providerName,modelId:e.modelId,modelName:e.label}}))}var j=class{state={open:!1,providers:[],loading:!1};listeners=new Set;remote=null;getSnapshot=()=>this.state;subscribe=e=>(this.listeners.add(e),()=>this.listeners.delete(e));attachRemote(e){this.remote=e}toggle(){this.state.open?this.close():this.open()}open(){this.patch({open:!0}),this.state.providers.length===0&&!this.state.loading&&this.refresh()}close(){this.state.open&&this.patch({open:!1})}select(e,s){this.patch({selectedKey:s.value}),Xe(e,s)}async refresh(){if(!this.remote||typeof this.remote.catalog!="function"){this.patch({loading:!1,error:"\u6A21\u578B\u76EE\u5F55\u670D\u52A1\u672A\u8FDE\u63A5\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002"});return}this.patch({loading:!0,error:void 0});try{let e=await this.remote.catalog(),s=Ve(e);this.patch({loading:!1,providers:Array.isArray(s?.providers)?s.providers:[],error:void 0})}catch(e){this.patch({loading:!1,error:e instanceof Error?e.message:"\u65E0\u6CD5\u8BFB\u53D6\u6A21\u578B\u76EE\u5F55"})}}patch(e){this.state={...this.state,...e};for(let s of[...this.listeners])try{s()}catch{}}};function Ze({ctx:t,configStore:e,picker:s}){let n=A(e),o=A(s);return n.config.enableModelPicker?r.createElement(be,{open:o.open,providers:o.providers,loading:o.loading,error:o.error,selectedKey:o.selectedKey,onClose:()=>s.close(),onRefresh:()=>void s.refresh(),onSelect:a=>s.select(t,a)}):null}window.__ModuleLoader__?.load({id:f,factory(t){return R(t("react"),t("react-dom/client")),{name:f,inject:{required:["slots"],optional:["remote","configForms","sessions","shortcuts"]},async apply(e){let s=new _,n=new O,o=new j;n.apply(s.getSnapshot().config),e.effect(()=>s.subscribe(()=>{let i=s.getSnapshot().config;n.apply(i),i.enableModelPicker||o.close()}),`${f}.styles-hot-update`),e.effect(()=>()=>n.dispose(),`${f}.styles-cleanup`),e.effect(()=>()=>s.dispose(),`${f}.config-cleanup`),e.inject(["configForms"],i=>{let d=i.get?.("configForms");d&&s.connect(d)});let a=e.get?.("remote")??e.remote;if(a&&typeof a.$mount=="function")try{let i=await a.$mount(q);e.effect(()=>i,`${f}.remote-mount`)}catch{}e.inject(["remote.uiEnhancements"],i=>{o.attachRemote(i.get("remote.uiEnhancements"))});let l=!1;e.effect(()=>e.slots.inject("settings.section",()=>e.slots.register({name:"settings.section",id:we,order:45,label:()=>"Enhans \u589E\u5F3A",inject:()=>({store:s,onRecordingChange:i=>{l=i}})},de)),`${f}.settings-section`),e.effect(()=>e.slots.inject("settings.section.icon",()=>e.slots.register({name:"settings.section.icon",id:we,order:45},le)),`${f}.settings-icon`),e.effect(()=>{let i=d=>{if(l)return;let c=s.getSnapshot().config;c.enableModelPicker&&ie(d,c.modelPickerShortcut)&&(d.preventDefault(),d.stopPropagation(),o.toggle())};return window.addEventListener("keydown",i,!0),()=>window.removeEventListener("keydown",i,!0)},`${f}.model-picker-keydown`),e.inject(["shortcuts"],i=>{let d=i.get?.("shortcuts");if(!d?.register||!d?.describeBinding)return;let c=null,g=()=>{if(c){try{c()}catch{}c=null}let S=s.getSnapshot().config;if(!S.enableModelPicker)return;let v=oe(S.modelPickerShortcut);if(v)try{let P=d.describeBinding(v);if(P.issue!==null||P.conflicts.length>0)return;c=d.register({id:`${f}.modelPicker`,label:()=>"Enhans\uFF1A\u6253\u5F00/\u5173\u95ED\u6A21\u578B\u9009\u62E9\u9762\u677F",aliases:["model picker","\u6A21\u578B\u9009\u62E9"],defaults:{"desktop:macos":v,"desktop:windows":v,"desktop:linux":v},regions:["page","editable"],modals:[],resolve:()=>({status:"handled",run:()=>o.toggle()})})}catch{}};g();let M=s.subscribe(g);i.effect(()=>()=>{M(),c?.()},`${f}.dsh-shortcut`)}),e.effect(()=>{let i=document.createElement("div");i.dataset.plugin=f,i.dataset.role="model-picker-root",document.body.appendChild(i);let d=W(i);return d?.render(r.createElement(Ze,{ctx:e,configStore:s,picker:o})),()=>{d?.unmount(),i.remove()}},`${f}.model-picker-root`)}}}});})();
//# sourceMappingURL=client.js.map
