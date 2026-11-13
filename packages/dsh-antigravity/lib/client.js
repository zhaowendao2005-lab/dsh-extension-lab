"use strict";(()=>{var O={},a=O;function q(s){Object.assign(O,s)}var $=`/* DSH Antigravity Settings UI styles using DSH design tokens for light/dark parity. */

.dsha-root {
  display: flex;
  flex-direction: column;
  gap: 14px;
  font-family: var(--dsh-font-family-text, inherit);
  font-size: var(--dsh-content-font-size, var(--dsw-font-xs-13, 13px));
  color: var(--dsw-alias-label-primary, inherit);
}

.dsha-banner {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: var(--dsw-radius-md, 8px);
  border: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.28));
  background: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.06));
}

.dsha-banner-warn {
  border-color: rgba(217, 119, 6, 0.45);
  background: rgba(217, 119, 6, 0.09);
}

.dsha-banner-error {
  border-color: rgba(220, 38, 38, 0.45);
  background: rgba(220, 38, 38, 0.08);
  padding: 10px 12px;
  border-radius: var(--dsw-radius-sm, 6px);
  font-size: 12px;
}

.dsha-banner-title {
  font-weight: 600;
  margin-bottom: 3px;
}

.dsha-banner-desc {
  font-size: 12px;
  line-height: 1.45;
  color: var(--dsw-alias-label-secondary, rgba(127, 127, 127, 0.9));
}

.dsha-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.28));
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-2, transparent);
}

.dsha-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.dsha-card-title {
  font-size: 14px;
  font-weight: 600;
}

.dsha-card-desc {
  font-size: 12px;
  line-height: 1.4;
  margin-top: 2px;
  color: var(--dsw-alias-label-secondary, rgba(127, 127, 127, 0.9));
}

.dsha-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.dsha-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  padding: 0 12px;
  border-radius: var(--dsw-radius-sm, 6px);
  border: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.35));
  background: transparent;
  color: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}

.dsha-btn:hover:not(:disabled) {
  background: rgba(127, 127, 127, 0.12);
}

.dsha-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.dsha-btn-primary {
  border-color: var(--dsw-alias-accent-primary, #2563eb);
  background: var(--dsw-alias-accent-primary, #2563eb);
  color: #ffffff;
}

.dsha-btn-primary:hover:not(:disabled) {
  opacity: 0.9;
  background: var(--dsw-alias-accent-primary, #2563eb);
}

.dsha-btn-danger {
  color: #dc2626;
  border-color: rgba(220, 38, 38, 0.35);
}

.dsha-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dsha-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.22));
  border-radius: var(--dsw-radius-sm, 6px);
  flex-wrap: wrap;
}

.dsha-row-active {
  border-color: rgba(34, 197, 94, 0.55);
  background: rgba(34, 197, 94, 0.05);
}

.dsha-row-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1 1 220px;
}

.dsha-row-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
  flex-wrap: wrap;
}

.dsha-row-sub {
  font-size: 11px;
  color: var(--dsw-alias-label-secondary, rgba(127, 127, 127, 0.85));
}

.dsha-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  border: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.3));
}

.dsha-badge-green {
  color: #16a34a;
  border-color: rgba(22, 163, 74, 0.4);
  background: rgba(22, 163, 74, 0.08);
}

.dsha-badge-warn {
  color: #d97706;
  border-color: rgba(217, 119, 6, 0.45);
  background: rgba(217, 119, 6, 0.08);
}

.dsha-badge-red {
  color: #dc2626;
  border-color: rgba(220, 38, 38, 0.45);
  background: rgba(220, 38, 38, 0.08);
}

.dsha-badge-pro {
  color: #2563eb;
  border-color: rgba(37, 99, 235, 0.45);
  background: rgba(37, 99, 235, 0.08);
}

.dsha-badge-ultra {
  color: #9333ea;
  border-color: rgba(147, 51, 234, 0.45);
  background: rgba(147, 51, 234, 0.1);
}

.dsha-filter-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.dsha-btn-active {
  border-color: var(--dsw-alias-accent-primary, #2563eb);
  color: var(--dsw-alias-accent-primary, #2563eb);
  background: rgba(37, 99, 235, 0.08);
}

.dsha-oauth-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--dsw-radius-sm, 6px);
  border: 1px dashed var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.35));
}

.dsha-oauth-link {
  font-family: monospace;
  font-size: 11px;
  word-break: break-all;
  padding: 6px 8px;
  border-radius: 4px;
  background: rgba(127, 127, 127, 0.08);
}

.dsha-input-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.dsha-input {
  flex: 1 1 auto;
  min-width: 0;
  height: 30px;
  padding: 0 10px;
  border-radius: var(--dsw-radius-sm, 6px);
  border: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.35));
  background: transparent;
  color: inherit;
  font-size: 12px;
}

.dsha-quota-item {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 8px 10px;
  border-radius: var(--dsw-radius-sm, 6px);
  border: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.22));
}

.dsha-quota-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.dsha-bar-track {
  height: 6px;
  width: 100%;
  border-radius: 999px;
  background: rgba(127, 127, 127, 0.18);
  overflow: hidden;
}

.dsha-bar-fill {
  height: 100%;
  border-radius: 999px;
  background: #16a34a;
  transition: width 0.2s ease;
}

.dsha-bar-fill.is-daily {
  background: #16a34a;
}

.dsha-bar-fill.is-weekly {
  background: #2563eb;
}

.dsha-bar-fill.is-warn {
  background: #d97706;
}

.dsha-bar-fill.is-exhausted {
  background: #dc2626;
}

.dsha-metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
}

.dsha-metric {
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.2));
  border-radius: var(--dsw-radius-sm, 6px);
}

.dsha-metric-val {
  font-size: 15px;
  font-weight: 600;
}

.dsha-metric-key {
  font-size: 11px;
  color: var(--dsw-alias-label-secondary, rgba(127, 127, 127, 0.85));
}

.dsha-model-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.2));
  border-radius: var(--dsw-radius-sm, 6px);
  cursor: pointer;
}

.dsha-model-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.dsha-note {
  font-size: 11px;
  color: var(--dsw-alias-label-secondary, rgba(127, 127, 127, 0.85));
}
`;var w={antigravity:{sectionTitle:"Antigravity",channelNoticeTitle:"Direct Cloud Code Channel (Unofficial)",channelNoticeBody:"Uses Antigravity Hub User-Agent identity headers to connect directly to Google Cloud Code internal endpoints rather than the default DSH User-Agent. Requests consume your personal/workspace Google Code Assist quota.",cacheColdTitle:"Context Cache Rebuilt (Cold Cache)",cacheColdDesc:"Active account switched at {{time}} ({{reason}}). Your next turn may observe a temporary 0% prompt cache hit until the prefix warms on {{account}}.",dismiss:"Dismiss",accountsTitle:"Google Accounts & Sticky Routing",accountsDesc:"Sticky per-session account affinity keeps KV prefix cache warm. Automatic switchovers occur only after 3 consecutive Auth/Quota/Rate-Limit failures or when pool quota drops to <= 5%.",addAccount:"Sign in with Google",addingAccount:"Waiting for OAuth...",cancelLogin:"Cancel",manualCallback:"Manual Callback URL / Code",manualCallbackPlaceholder:"Paste full http://127.0.0.1:.../oauth-callback?code=... URL if browser redirect cannot reach localhost",submitCode:"Complete Sign-in",openAuthUrl:"Open Google Sign-In",copyAuthUrl:"Copy Link",copied:"Copied",active:"Active",switchAccount:"Use Account",removeAccount:"Remove",needsReauth:"Re-auth required",cooldown:"Cooldown",noAccounts:"No Google accounts connected yet.",quotaTitle:"Quota Pools",quotaDesc:"Live quota aggregated from Cloud Code internal summary and available models.",refreshQuota:"Refresh Quota",runDoctor:"Run Diagnostics",runningDoctor:"Checking...",doctorTitle:"Connection Diagnostics",updatedAt:"Updated: {{time}}",quotaDegraded:"Quota lookup unavailable (fail-open; model calls still allowed): {{error}}",resetsAt:"Resets {{time}}",lowWarning:"Low (< 15%)",exhaustedBadge:"Exhausted (<= 5%)",statsTitle:"Recent Cache & Token Telemetry",statsDesc:"Disjoint input accounting (prompt minus cached tokens; self-computed totalTokens for DSH token meter).",turnsLabel:"Tracked Turns",hitRateLabel:"Aggregate Cache Hit",cacheReadLabel:"Cache Read Tokens",uncachedInputLabel:"Uncached Input",outputLabel:"Output + Thinking",noTelemetry:"No Antigravity turns recorded in this process yet.",modelsTitle:"Visible Models (Gemini-First)",modelsDesc:"Choose which Antigravity models appear in the DSH model picker.",catalogSourceUpstream:"Source: Live Account Catalog",catalogSourceCache:"Source: Cached Account Catalog",catalogSourceStatic:"Source: Static Fallback (Refresh Quota to sync)",selectAll:"Select All",resetDefaults:"Defaults",filterAll:"All",filterGemini4:"Gemini 4",filterPro:"Pro Available",filterUltra:"Ultra",tierUltraBadge:"Ultra",tierProBadge:"Pro / Ultra",tierAllBadge:"Free / Pro / Ultra",upstreamAvailable:"In Account Catalog",upstreamUnavailable:"Not in Account Catalog",contextLabel:"{{tokens}} context",switchReasonManual:"manual selection",switchReasonQuota:"quota <= 5% / exhausted",switchReasonStreak:"consecutive upstream failures",switchReasonUnavailable:"previous account unavailable"}};var x={antigravity:{sectionTitle:"Antigravity",channelNoticeTitle:"\u76F4\u8FDE Cloud Code \u5185\u90E8\u901A\u9053\uFF08\u975E\u5B98\u65B9\uFF09",channelNoticeBody:"\u672C\u63D2\u4EF6\u4F7F\u7528 Antigravity Hub \u6307\u7EB9\u5934\u76F4\u8FDE Google Cloud Code \u5185\u90E8\u7AEF\u70B9\uFF0C\u800C\u975E\u9ED8\u8BA4 DSH User-Agent\uFF1B\u8BF7\u6C42\u76F4\u63A5\u6D88\u8017\u4F60\u4E2A\u4EBA/\u5DE5\u4F5C\u533A Google Code Assist \u914D\u989D\u3002",cacheColdTitle:"\u7F13\u5B58\u5DF2\u91CD\u5EFA\uFF08\u51B7\u7F13\u5B58\uFF09",cacheColdDesc:"\u4F1A\u8BDD\u8DEF\u7531\u8D26\u53F7\u5DF2\u4E8E {{time}} \u5207\u6362\uFF08{{reason}}\uFF09\u3002\u5207\u5F80 {{account}} \u540E\u7684\u4E0B\u4E00\u8F6E\u5C06\u7ECF\u5386\u4E00\u6B21\u51B7\u7F13\u5B58\u91CD\u70ED\uFF08\u547D\u4E2D\u7387\u6682\u65F6\u56DE\u843D\uFF09\u3002",dismiss:"\u77E5\u9053\u4E86",accountsTitle:"Google \u8D26\u53F7\u4E0E\u7C98\u6027\u8DEF\u7531",accountsDesc:"\u6309\u4F1A\u8BDD\u4FDD\u6301\u8D26\u53F7\u7C98\u6027\u4EE5\u7EF4\u6301\u524D\u7F00 KV \u7F13\u5B58\u547D\u4E2D\u3002\u4EC5\u5728\u8FDE\u7EED 3 \u6B21 AUTH / QUOTA / RATE_LIMIT \u5931\u8D25\u3001\u914D\u989D <= 5% \u6216\u624B\u52A8\u5207\u6362\u65F6\u66F4\u6362\u8D26\u53F7\uFF0C\u7EDD\u4E0D\u8F6E\u8BE2\u5207\u6362\u3002",addAccount:"\u767B\u5F55 Google \u8D26\u53F7",addingAccount:"\u7B49\u5F85 OAuth \u6388\u6743...",cancelLogin:"\u53D6\u6D88\u767B\u5F55",manualCallback:"\u624B\u52A8\u7C98\u8D34\u56DE\u8C03\u94FE\u63A5 / \u6388\u6743\u7801",manualCallbackPlaceholder:"\u65E0\u684C\u9762\u73AF\u5883\u6216\u8FDC\u7A0B\u8FDE\u63A5\u65F6\uFF0C\u8BF7\u7C98\u8D34\u5B8C\u6574\u7684 http://127.0.0.1:.../oauth-callback?code=... \u94FE\u63A5",submitCode:"\u5B8C\u6210\u767B\u5F55",openAuthUrl:"\u6253\u5F00\u767B\u5F55\u9875",copyAuthUrl:"\u590D\u5236\u94FE\u63A5",copied:"\u5DF2\u590D\u5236",active:"\u5F53\u524D\u4F7F\u7528",switchAccount:"\u5207\u6362\u4E3A\u6B64\u8D26\u53F7",removeAccount:"\u79FB\u9664",needsReauth:"\u9700\u91CD\u65B0\u6388\u6743",cooldown:"\u51B7\u5374\u4E2D",noAccounts:"\u6682\u672A\u8FDE\u63A5 Google \u8D26\u53F7\u3002",quotaTitle:"\u5B9E\u65F6\u914D\u989D\u6C60",quotaDesc:"\u6765\u81EA loadCodeAssist \u4E0E retrieveUserQuotaSummary \u7684\u5206\u7EC4\u914D\u989D\u6458\u8981\u3002",refreshQuota:"\u5237\u65B0\u914D\u989D",runDoctor:"\u8FD0\u884C\u81EA\u68C0",runningDoctor:"\u68C0\u6D4B\u4E2D...",doctorTitle:"\u8FDE\u901A\u6027\u81EA\u68C0\u7ED3\u679C",updatedAt:"\u66F4\u65B0\u4E8E {{time}}",quotaDegraded:"\u914D\u989D\u67E5\u8BE2\u5931\u8D25\uFF08\u5DF2\u542F\u7528 fail-open\uFF0C\u4E0D\u963B\u585E\u6A21\u578B\u8C03\u7528\uFF09\uFF1A{{error}}",resetsAt:"\u91CD\u7F6E\u65F6\u95F4 {{time}}",lowWarning:"\u4F4E\u914D\u989D (< 15%)",exhaustedBadge:"\u5373\u5C06\u8017\u5C3D (<= 5%)",statsTitle:"\u8FD1\u671F\u7F13\u5B58\u4E0E Token \u7EDF\u8BA1",statsDesc:"\u4E25\u683C\u6309 DSH \u975E\u91CD\u53E0\u53E3\u5F84\u4E0A\u62A5\uFF08inputTokens = prompt - cached\uFF1B\u81EA\u7B97 totalTokens\uFF09\u3002",turnsLabel:"\u7EDF\u8BA1\u8F6E\u6570",hitRateLabel:"\u7D2F\u8BA1\u7F13\u5B58\u547D\u4E2D\u7387",cacheReadLabel:"\u7F13\u5B58\u547D\u4E2D Tokens",uncachedInputLabel:"\u65B0\u589E\u8F93\u5165 Tokens",outputLabel:"\u8F93\u51FA\u4E0E\u601D\u8003 Tokens",noTelemetry:"\u5F53\u524D\u8FDB\u7A0B\u5185\u5C1A\u65E0 Antigravity \u8C03\u7528\u8BB0\u5F55\u3002",modelsTitle:"\u53EF\u7528\u6A21\u578B\u5217\u8868\uFF08Gemini \u4F18\u5148\uFF09",modelsDesc:"\u52FE\u9009\u8981\u5728 DSH \u6A21\u578B\u9009\u62E9\u5668\u4E2D\u66B4\u9732\u7684\u6A21\u578B\u3002",catalogSourceUpstream:"\u6765\u6E90\uFF1A\u5F53\u524D\u8D26\u53F7\u5B9E\u65F6\u4E0A\u6E38\u76EE\u5F55",catalogSourceCache:"\u6765\u6E90\uFF1A\u6700\u8FD1\u4E00\u6B21\u8D26\u53F7\u7F13\u5B58\u76EE\u5F55",catalogSourceStatic:"\u6765\u6E90\uFF1A\u9759\u6001\u515C\u5E95\uFF08\u70B9\u5237\u65B0\u914D\u989D\u540E\u81EA\u52A8\u540C\u6B65\u8D26\u53F7\u771F\u5B9E\u76EE\u5F55\uFF09",selectAll:"\u5168\u9009",resetDefaults:"\u6062\u590D\u9ED8\u8BA4",filterAll:"\u5168\u90E8",filterGemini4:"Gemini 4",filterPro:"Pro \u53EF\u7528",filterUltra:"Ultra \u4E13\u5C5E",tierUltraBadge:"Ultra \u4E13\u5C5E",tierProBadge:"Pro / Ultra \u53EF\u7528",tierAllBadge:"\u5168\u5957\u9910\u53EF\u7528",upstreamAvailable:"\u5F53\u524D\u8D26\u53F7\u53EF\u7528",upstreamUnavailable:"\u672A\u5728\u5F53\u524D\u8D26\u53F7\u76EE\u5F55",contextLabel:"{{tokens}} \u4E0A\u4E0B\u6587",switchReasonManual:"\u624B\u52A8\u5207\u6362\u8D26\u53F7",switchReasonQuota:"\u914D\u989D <= 5% \u6216\u5DF2\u8017\u5C3D",switchReasonStreak:"\u8FDE\u7EED\u4E0A\u6E38\u5931\u8D25\u8FBE\u9608\u503C",switchReasonUnavailable:"\u539F\u8D26\u53F7\u4E0D\u53EF\u7528"}};function C(s){try{let i=s?.locale?.getSnapshot?.()?.active;if(typeof i=="string"&&i.length>0)return i;if(typeof s?.locale?.current=="string"&&s.locale.current.length>0)return s.locale.current;if(typeof navigator<"u"&&typeof navigator.language=="string")return navigator.language}catch{}return"en"}function Z(s){return/^zh/i.test(s)?x.antigravity:w.antigravity}function R(s){let i=Z(s);return(o,t)=>{let n=i[o]??w.antigravity[o]??o;if(t)for(let[c,u]of Object.entries(t))n=n.replaceAll(`{{${c}}}`,String(u));return n}}async function d(s,i){let o=await fetch(s,{...i,headers:{"Content-Type":"application/json",...i?.headers??{}}}),t=await o.json();if(!o.ok||!t.ok||t.value===void 0)throw new Error(t.error||`HTTP ${o.status}`);return t.value}function aa(s,i){switch(s){case"manual":return i("switchReasonManual");case"quota":return i("switchReasonQuota");case"streak":return i("switchReasonStreak");default:return i("switchReasonUnavailable")}}function T(s){return`${Math.round(s*100)}%`}function E(s){if(!s)return"";try{return new Date(s).toLocaleTimeString()}catch{return String(s)}}function ea(s){if(!s)return"";let i=Date.parse(s);if(!Number.isFinite(i))return s;let o=i-Date.now();if(o<=0)return"0m";let t=Math.floor(o/6e4),n=Math.floor(t/1440),c=Math.floor(t%1440/60),u=t%60;return n>0?`${n}d${c}h`:c>0?`${c}h${u}m`:`${u}m`}function j({ctx:s}){let[i,o]=a.useState(()=>C(s));a.useEffect(()=>{o(C(s));let e=s?.locale?.subscribe;if(typeof e=="function")try{let r=e.call(s.locale,()=>{o(C(s))});return typeof r=="function"?r:void 0}catch{return}},[s]);let t=a.useMemo(()=>R(i),[i]),[n,c]=a.useState(void 0),[u,G]=a.useState(void 0),[B,Q]=a.useState(!0),[l,N]=a.useState(!1),[D,L]=a.useState(!1),[U,h]=a.useState(void 0),[k,P]=a.useState(""),[F,M]=a.useState(!1),f=a.useCallback(async()=>{try{let e=await d("/antigravity/api/status");c(e),h(void 0)}catch(e){h(e instanceof Error?e.message:String(e))}finally{Q(!1)}},[]);a.useEffect(()=>{f()},[f]),a.useEffect(()=>{if(n?.login?.state!=="pending")return;let e=window.setInterval(()=>{f()},1200);return()=>window.clearInterval(e)},[n?.login?.state,f]);let g=async e=>{N(!0),h(void 0);try{let r=await e();c(r)}catch(r){h(r instanceof Error?r.message:String(r))}finally{N(!1)}},H=async()=>{N(!0),h(void 0);try{let e=await d("/antigravity/api/login",{method:"POST",body:"{}"});if(e.authUrl)try{window.open(e.authUrl,"_blank","noopener,noreferrer")}catch{}await f()}catch(e){h(e instanceof Error?e.message:String(e))}finally{N(!1)}},_=async()=>{k.trim()&&await g(async()=>{let e=await d("/antigravity/api/login/manual",{method:"POST",body:JSON.stringify({input:k.trim()})});return P(""),e})},W=async()=>{L(!0),h(void 0);try{let e=await d("/antigravity/api/doctor",{method:"POST",body:"{}"});G(e)}catch(e){h(e instanceof Error?e.message:String(e))}finally{L(!1)}},J=async e=>{if(!n)return;let r=new Set(n.models.enabledModelIds);r.has(e.id)?r.delete(e.id):r.add(e.id),await g(()=>d("/antigravity/api/models",{method:"POST",body:JSON.stringify({enabledModelIds:[...r]})}))},I=async e=>{if(!n)return;let r=e?n.models.options.map(y=>y.id):n.models.options.filter(y=>y.defaultEnabled).map(y=>y.id);await g(()=>d("/antigravity/api/models",{method:"POST",body:JSON.stringify({enabledModelIds:r})}))},K=async e=>{try{await navigator.clipboard.writeText(e),M(!0),window.setTimeout(()=>M(!1),1800)}catch{}};if(B&&!n)return a.createElement("div",{className:"dsha-root"},"Loading Antigravity...");let v=n?.login,A=n?.accounts??[],p=n?.quota,m=n?.telemetry,S=n?.coldNotice;return a.createElement("div",{className:"dsha-root"},a.createElement("div",{className:"dsha-banner"},a.createElement("div",null,a.createElement("div",{className:"dsha-banner-title"},t("channelNoticeTitle")),a.createElement("div",{className:"dsha-banner-desc"},t("channelNoticeBody")))),S&&a.createElement("div",{className:"dsha-banner dsha-banner-warn"},a.createElement("div",null,a.createElement("div",{className:"dsha-banner-title"},t("cacheColdTitle")),a.createElement("div",{className:"dsha-banner-desc"},t("cacheColdDesc",{time:E(S.at),reason:aa(S.reason,t),account:S.toEmail}))),a.createElement("button",{type:"button",className:"dsha-btn",disabled:l,onClick:()=>g(()=>d("/antigravity/api/dismiss-cold-notice",{method:"POST",body:"{}"}))},t("dismiss"))),U&&a.createElement("div",{className:"dsha-banner-error"},U),a.createElement("section",{className:"dsha-card"},a.createElement("div",{className:"dsha-card-head"},a.createElement("div",null,a.createElement("div",{className:"dsha-card-title"},t("accountsTitle")),a.createElement("div",{className:"dsha-card-desc"},t("accountsDesc"))),a.createElement("div",{className:"dsha-actions"},v?.state==="pending"?a.createElement("button",{type:"button",className:"dsha-btn",disabled:l,onClick:()=>g(()=>d("/antigravity/api/login/cancel",{method:"POST",body:"{}"}))},t("cancelLogin")):a.createElement("button",{type:"button",className:"dsha-btn dsha-btn-primary",disabled:l,onClick:H},t("addAccount")))),v?.state==="pending"&&v.authUrl&&a.createElement("div",{className:"dsha-oauth-box"},a.createElement("div",{className:"dsha-actions"},a.createElement("a",{href:v.authUrl,target:"_blank",rel:"noopener noreferrer",className:"dsha-btn dsha-btn-primary"},t("openAuthUrl")),a.createElement("button",{type:"button",className:"dsha-btn",onClick:()=>K(v.authUrl)},t(F?"copied":"copyAuthUrl"))),a.createElement("div",{className:"dsha-oauth-link"},v.authUrl),a.createElement("div",{className:"dsha-note"},t("manualCallback")),a.createElement("div",{className:"dsha-input-row"},a.createElement("input",{type:"text",className:"dsha-input",value:k,placeholder:t("manualCallbackPlaceholder"),onChange:e=>P(e.target.value)}),a.createElement("button",{type:"button",className:"dsha-btn",disabled:l||!k.trim(),onClick:_},t("submitCode")))),A.length===0?a.createElement("div",{className:"dsha-note"},t("noAccounts")):a.createElement("div",{className:"dsha-list"},A.map(e=>a.createElement("div",{key:e.id,className:`dsha-row ${e.isActive?"dsha-row-active":""}`},a.createElement("div",{className:"dsha-row-main"},a.createElement("div",{className:"dsha-row-title"},a.createElement("span",null,e.email),e.isActive&&a.createElement("span",{className:"dsha-badge dsha-badge-green"},t("active")),e.tierLabel&&a.createElement("span",{className:"dsha-badge"},e.tierLabel),e.needsReauth&&a.createElement("span",{className:"dsha-badge dsha-badge-red"},t("needsReauth")),e.cooldownUntil&&a.createElement("span",{className:"dsha-badge dsha-badge-warn"},t("cooldown")),e.lowestQuotaFraction!==void 0&&a.createElement("span",{className:`dsha-badge ${e.lowestQuotaFraction<=.05?"dsha-badge-red":e.lowestQuotaFraction<.15?"dsha-badge-warn":""}`},T(e.lowestQuotaFraction))),a.createElement("div",{className:"dsha-row-sub"},e.projectId?`project: ${e.projectId}`:"project pending",e.lastError?` \xB7 ${e.lastError}`:"")),a.createElement("div",{className:"dsha-actions"},!e.isActive&&a.createElement("button",{type:"button",className:"dsha-btn",disabled:l,onClick:()=>g(()=>d("/antigravity/api/accounts/switch",{method:"POST",body:JSON.stringify({accountId:e.id})}))},t("switchAccount")),a.createElement("button",{type:"button",className:"dsha-btn dsha-btn-danger",disabled:l,onClick:()=>g(()=>d("/antigravity/api/accounts/remove",{method:"POST",body:JSON.stringify({accountId:e.id})}))},t("removeAccount"))))))),a.createElement("section",{className:"dsha-card"},a.createElement("div",{className:"dsha-card-head"},a.createElement("div",null,a.createElement("div",{className:"dsha-card-title"},t("quotaTitle")),a.createElement("div",{className:"dsha-card-desc"},t("quotaDesc"))),a.createElement("div",{className:"dsha-actions"},a.createElement("button",{type:"button",className:"dsha-btn",disabled:l||A.length===0,onClick:()=>g(()=>d("/antigravity/api/quota",{method:"POST",body:"{}"}))},t("refreshQuota")),a.createElement("button",{type:"button",className:"dsha-btn",disabled:D||A.length===0,onClick:W},t(D?"runningDoctor":"runDoctor")))),p?.degraded&&p.error&&a.createElement("div",{className:"dsha-banner dsha-banner-warn"},a.createElement("div",{className:"dsha-banner-desc"},t("quotaDegraded",{error:p.error}))),p&&p.groups.length>0&&a.createElement("div",{className:"dsha-list"},p.groups.map(e=>{let r=Math.max(0,Math.min(100,Math.round(e.remainingFraction*100)));return a.createElement("div",{key:e.id,className:"dsha-quota-item"},a.createElement("div",{className:"dsha-quota-head"},a.createElement("div",{className:"dsha-row-title"},a.createElement("span",null,e.label),e.isExhausted?a.createElement("span",{className:"dsha-badge dsha-badge-red"},t("exhaustedBadge")):e.isLow?a.createElement("span",{className:"dsha-badge dsha-badge-warn"},t("lowWarning")):null),a.createElement("div",{className:"dsha-row-sub",title:e.resetTime??""},a.createElement("strong",null,r,"%"),e.resetTime?` \xB7 ${t("resetsAt",{time:ea(e.resetTime)})}`:"")),a.createElement("div",{className:"dsha-bar-track"},a.createElement("div",{className:`dsha-bar-fill ${e.windowType==="weekly"||/week|每周|周限|7d/i.test(e.label)?"is-weekly":"is-daily"}`,style:{width:`${r}%`}})))})),p&&a.createElement("div",{className:"dsha-note"},t("updatedAt",{time:E(p.fetchedAt)})),u&&a.createElement("div",{className:"dsha-oauth-box"},a.createElement("div",{className:"dsha-banner-title"},t("doctorTitle")),a.createElement("div",{className:"dsha-note"},u.userAgent),u.checks.map(e=>a.createElement("div",{key:e.name,className:"dsha-row-sub"},a.createElement("span",{className:`dsha-badge ${e.ok?"dsha-badge-green":"dsha-badge-red"}`},e.ok?"PASS":"FAIL")," ",a.createElement("strong",null,e.name),": ",e.detail,e.latencyMs!==void 0?` (${e.latencyMs}ms)`:"")))),a.createElement("section",{className:"dsha-card"},a.createElement("div",{className:"dsha-card-head"},a.createElement("div",null,a.createElement("div",{className:"dsha-card-title"},t("statsTitle")),a.createElement("div",{className:"dsha-card-desc"},t("statsDesc")))),!m||m.turnCount===0?a.createElement("div",{className:"dsha-note"},t("noTelemetry")):a.createElement("div",{className:"dsha-metrics-grid"},a.createElement("div",{className:"dsha-metric"},a.createElement("div",{className:"dsha-metric-val"},T(m.aggregateCacheHitRate)),a.createElement("div",{className:"dsha-metric-key"},t("hitRateLabel"))),a.createElement("div",{className:"dsha-metric"},a.createElement("div",{className:"dsha-metric-val"},m.turnCount),a.createElement("div",{className:"dsha-metric-key"},t("turnsLabel"))),a.createElement("div",{className:"dsha-metric"},a.createElement("div",{className:"dsha-metric-val"},m.totalCacheReadTokens.toLocaleString()),a.createElement("div",{className:"dsha-metric-key"},t("cacheReadLabel"))),a.createElement("div",{className:"dsha-metric"},a.createElement("div",{className:"dsha-metric-val"},m.totalUncachedInputTokens.toLocaleString()),a.createElement("div",{className:"dsha-metric-key"},t("uncachedInputLabel"))),a.createElement("div",{className:"dsha-metric"},a.createElement("div",{className:"dsha-metric-val"},m.totalOutputTokens.toLocaleString()),a.createElement("div",{className:"dsha-metric-key"},t("outputLabel"))))),n&&n.models.options.length>0&&a.createElement("section",{className:"dsha-card"},a.createElement("div",{className:"dsha-card-head"},a.createElement("div",null,a.createElement("div",{className:"dsha-card-title"},t("modelsTitle")),a.createElement("div",{className:"dsha-card-desc"},t("modelsDesc"))),a.createElement("div",{className:"dsha-actions"},a.createElement("button",{type:"button",className:"dsha-btn",disabled:l,onClick:()=>I(!0)},t("selectAll")),a.createElement("button",{type:"button",className:"dsha-btn",disabled:l,onClick:()=>I(!1)},t("resetDefaults")))),a.createElement("div",{className:"dsha-list"},n.models.options.map(e=>a.createElement("label",{key:e.id,className:"dsha-model-row"},a.createElement("div",{className:"dsha-model-left"},a.createElement("input",{type:"checkbox",checked:e.enabled,disabled:l,onChange:()=>J(e)}),a.createElement("div",null,a.createElement("div",{className:"dsha-row-title"},a.createElement("span",null,e.name),a.createElement("span",{className:"dsha-badge"},e.id),e.tierAccess==="ultra"?a.createElement("span",{className:"dsha-badge dsha-badge-ultra"},"Ultra"):e.tierAccess==="pro"?a.createElement("span",{className:"dsha-badge dsha-badge-pro"},"Pro"):null,e.remainingFraction!==void 0&&a.createElement("span",{className:`dsha-badge ${e.remainingFraction<=.05?"dsha-badge-red":e.remainingFraction<.15?"dsha-badge-warn":"dsha-badge-green"}`},T(e.remainingFraction))),a.createElement("div",{className:"dsha-row-sub"},e.description," \xB7"," ",t("contextLabel",{tokens:`${Math.round(e.contextWindow/1024)}K`})))))))))}var b="dsh-antigravity",z="antigravity",ta="antigravity";function sa(){let s=document.querySelector(`style[data-plugin="${b}"]`);s&&s.remove();let i=document.createElement("style");return i.dataset.plugin=b,i.textContent=$,document.head.appendChild(i),()=>i.remove()}function ia({size:s}){return a.createElement("svg",{width:s,height:s,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:1.7,strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":"true"},a.createElement("path",{d:"M12 3l8 16h-4l-4-8-4 8H4L12 3z"}),a.createElement("circle",{cx:12,cy:17,r:1.5,fill:"currentColor",stroke:"none"}))}window.__ModuleLoader__?.load({id:b,factory(s){return q(s("react")),{name:b,inject:["slots","locale"],apply(i){i.effect(()=>sa(),`${b}.styles`),i.effect(()=>{if(!(!i.locale||typeof i.locale.register!="function"))try{let o=i.locale.register(ta,{en:w.antigravity,zh:x.antigravity,"zh-CN":x.antigravity});return typeof o=="function"?o:void 0}catch{return}},`${b}.locale`),i.effect(()=>i.slots.inject("settings.section",()=>i.slots.register({name:"settings.section",id:z,order:40,label:()=>"Antigravity"},o=>a.createElement(j,{...o,ctx:i}))),`${b}.settings`),i.effect(()=>i.slots.inject("settings.section.icon",()=>i.slots.register({name:"settings.section.icon",id:z,order:40},ia)),`${b}.settings-icon`)}}}});})();
