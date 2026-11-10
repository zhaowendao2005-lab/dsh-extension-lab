#!/usr/bin/env node
/**
 * preview.mjs — build a faithful, offline preview of the DSH Web GUI dialogs.
 *
 * It extracts the real CSS modules from the installed client bundles, copies the
 * web frontend stylesheet verbatim, and writes a static page that reproduces the
 * dialog DOM (same class names, same ARIA attributes, same child order) so that
 * src/swiss.css can be checked visually without starting the app.
 *
 * Outputs (all owned by this script):
 *   preview/vendor/web-index.css
 *   preview/vendor/theme-base.css
 *   preview/vendor/theme-platform.css
 *   preview/vendor/settings-general.css
 *   preview/vendor/models.css
 *   preview/vendor/market.css
 *   preview/vendor/archive.css
 *   preview/index.html
 *
 * Query parameters understood by the generated page:
 *   ?theme=light|dark          default light
 *   ?dialog=settings|archive|confirm|menu   default settings
 *   ?platform=darwin|web       default darwin
 *   ?frame=titlebar            Windows-style titlebar frame (38px)
 *   ?overlayTop=<css length>   raw override of --dsh-frame-overlay-top
 */

import fs, {
  existsSync,
  rmSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const PREVIEW_DIR = path.join(ROOT, "preview");
const VENDOR_DIR = path.join(PREVIEW_DIR, "vendor");
const INDEX_HTML = path.join(PREVIEW_DIR, "index.html");

const ASAR =
  process.env.DSH_ASAR ??
  "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar";
const PROFILE_MODULES = path.join(
  process.env.DSH_PROFILE_DIR ??
    path.join(
      process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh"),
      "profiles",
      process.env.DSH_PROFILE ?? "desktop",
    ),
  "node_modules",
);

/**
 * Sources are either plain files (profile plugins, this repo's CSS) or asar
 * specs: "asar:<needle>" / "asar:<needle>|<extension>", resolved against the
 * installed app archive so a fresh checkout always previews the *installed*
 * component CSS, not a stale extraction.
 */
const SOURCES = {
  theme: "asar:dsh-client-ui-theme/lib/client.js",
  settingsGeneral: "asar:dsh-client-ui-settings-general/lib/client.js",
  settingsModels: "asar:dsh-client-ui-settings-models/lib/client.js",
  webIndex: "asar:dsh-web-frontend/dist/assets/index-|.css",
  webFonts: [
    "montserrat-light-Cvd2VjE_.woff2",
    "montserrat-medium-B4OyO9CN.woff2",
    "montserrat-regular-DYep38cA.woff2",
  ].map((name) => `asar:${name}`),
  market: path.join(PROFILE_MODULES, "dshmarket/client/client.js"),
  archive: path.join(
    PROFILE_MODULES,
    "@michengai/dsh-archive-manager/lib/client.js",
  ),
  swiss: path.join(ROOT, "src/swiss.css"),
};

let asarIndex = null;

/** Flatten the asar header into [{ path, offset, size }] (header only, no data). */
function asarEntries() {
  if (asarIndex) return asarIndex;
  if (!existsSync(ASAR)) {
    throw new Error(
      `app.asar not found: ${ASAR} (set DSH_ASAR to the installed archive)`,
    );
  }
  const fd = fs.openSync(ASAR, "r");
  try {
    const head = Buffer.alloc(32);
    fs.readSync(fd, head, 0, 32, 0);
    const headerSize = head.readUInt32LE(4);
    const raw = Buffer.alloc(headerSize);
    fs.readSync(fd, raw, 0, headerSize, 8);
    const text = raw.toString("utf8");
    const header = JSON.parse(
      text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1),
    );
    const entries = [];
    const walk = (node, prefix) => {
      for (const [name, child] of Object.entries(node.files ?? {})) {
        const entryPath = `${prefix}/${name}`;
        if (child.files) walk(child, entryPath);
        else
          entries.push({
            path: entryPath,
            offset: Number(child.offset),
            size: child.size,
          });
      }
    };
    walk(header, "");
    asarIndex = entries;
  } finally {
    fs.closeSync(fd);
  }
  return asarIndex;
}

function matchAsar(spec) {
  const [needle, extension] = spec.slice("asar:".length).split("|");
  return asarEntries().filter(
    (entry) =>
      entry.path.includes(needle) && (!extension || entry.path.endsWith(extension)),
  );
}

function readAsar(entry) {
  const fd = fs.openSync(ASAR, "r");
  try {
    const head = Buffer.alloc(32);
    fs.readSync(fd, head, 0, 32, 0);
    const headerSize = head.readUInt32LE(4);
    const buffer = Buffer.alloc(entry.size);
    fs.readSync(fd, buffer, 0, entry.size, 8 + headerSize + entry.offset);
    return buffer;
  } finally {
    fs.closeSync(fd);
  }
}

function sourceExists(spec) {
  return spec.startsWith("asar:")
    ? matchAsar(spec).length > 0
    : existsSync(spec);
}

function sourceLabel(spec) {
  return spec.startsWith("asar:") ? `app.asar ${spec.slice(5)}` : spec;
}

const REQUIRED = [
  ["theme bundle", SOURCES.theme],
  ["settings-general bundle", SOURCES.settingsGeneral],
  ["web frontend index CSS", SOURCES.webIndex],
  ["market bundle", SOURCES.market],
  ["archive bundle", SOURCES.archive],
  ["src/swiss.css", SOURCES.swiss],
];

const warnings = [];
function warn(message) {
  warnings.push(message);
  console.warn(`  ! ${message}`);
}

function readSource(spec) {
  if (!spec.startsWith("asar:")) return readFileSync(spec, "utf8");
  const [entry] = matchAsar(spec).sort((a, b) => b.size - a.size);
  if (!entry) throw new Error(`no app.asar entry matches ${spec}`);
  return readAsar(entry).toString("utf8");
}

/** Parse a JavaScript string/template literal into its value. */
function parseLiteral(literal, label) {
  try {
    if (literal.startsWith('"')) return JSON.parse(literal);
    if (literal.startsWith("'")) {
      const body = literal.slice(1, -1);
      return body.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
    }
    if (literal.startsWith("`")) {
      return literal
        .slice(1, -1)
        .replace(/\\`/g, "`")
        .replace(/\\\\/g, "\\");
    }
  } catch (error) {
    warn(`could not parse ${label}: ${error.message}`);
  }
  return null;
}

/**
 * Extract `const css$N = "..."` / `const css = "..."` modules.
 * Returns [{ name, css }] ordered by the numeric suffix.
 */
function extractConstCss(source, label) {
  const modules = [];
  const re = /const\s+(css(?:\$\d+)?)\s*=\s*("(?:[^"\\]|\\.)*")\s*;/g;
  for (const match of source.matchAll(re)) {
    const css = parseLiteral(match[2], `${label} ${match[1]}`);
    if (css != null) modules.push({ name: match[1], css });
  }
  modules.sort((a, b) => {
    const na = Number(a.name.replace(/\D/g, "")) || 0;
    const nb = Number(b.name.replace(/\D/g, "")) || 0;
    return na - nb;
  });
  return modules;
}

/** Extract theme modules stored as `var <snake>_css_default = "...";`. */
function extractThemeModules(source) {
  const modules = new Map();
  const re = /var\s+([A-Za-z0-9_]+)_css_default\s*=\s*("(?:[^"\\]|\\.)*")\s*;/g;
  for (const match of source.matchAll(re)) {
    const css = parseLiteral(match[2], `theme ${match[1]}`);
    if (css != null) modules.set(match[1], css);
  }
  return modules;
}

/**
 * Extract `F("plugin/Name.css", "...")` style injections. Supports both the
 * double-quoted JSON form and the backtick template-literal form.
 */
function extractInjectedCss(source, label) {
  const modules = [];
  const re =
    /F\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*,\s*("(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)\s*\)/g;
  for (const match of source.matchAll(re)) {
    const name = parseLiteral(match[1], `${label} file name`);
    const css = parseLiteral(match[2], `${label} ${name || "?"}`);
    if (name && css != null) modules.push({ name, css });
  }
  modules.sort((a, b) => a.name.localeCompare(b.name));
  return modules;
}

function block(title, css) {
  return `/* --- ${title} --- */\n${css.trim()}\n`;
}

function joinBlocks(blocks) {
  return `${blocks.join("\n")}\n`;
}

function writeVendor(name, css) {
  const file = path.join(VENDOR_DIR, name);
  writeFileSync(file, css, "utf8");
  return { file, bytes: statSync(file).size };
}

/** Wrap the id-less settings nav icons. */
function icon(paths) {
  return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

const NAV_ITEMS = [
  ["通用", '<path d="M2.5 4.5h11M2.5 11.5h11"/><circle cx="6" cy="4.5" r="1.6"/><circle cx="10.5" cy="11.5" r="1.6"/>'],
  ["外观", '<circle cx="8" cy="8" r="3"/><path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M2.9 2.9l1.1 1.1M12 12l1.1 1.1M13.1 2.9 12 4M4 12l-1.1 1.1"/>'],
  ["模型", '<path d="M8 1.8l5.4 3-5.4 3-5.4-3 5.4-3z"/><path d="M2.6 8l5.4 3 5.4-3M2.6 11.2l5.4 3 5.4-3"/>'],
  ["工具", '<path d="M9.8 2.2a3.4 3.4 0 00-4 4.4l-3.4 3.4a1.4 1.4 0 002 2l3.4-3.4a3.4 3.4 0 004.4-4l-2 2-1.6-.4-.4-1.6 2-2z"/>'],
  ["快捷键", '<rect x="1.6" y="4" width="12.8" height="8" rx="1.2"/><path d="M4 6.5h.01M6.5 6.5h.01M9 6.5h.01M11.5 6.5h.01M4 9.2h.01M11.5 9.2h.01M6 9.8h4"/>'],
  ["关于", '<circle cx="8" cy="8" r="6.2"/><path d="M8 7.2v3.6M8 5.2h.01"/>'],
];

const ACTIVE_NAV = 2; // 模型

const CLOSE_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg>';

function settingsDialog() {
  const nav = NAV_ITEMS.map(([label, paths], index) => {
    const active = index === ACTIVE_NAV;
    return `<button type="button" class="_77Pn0W_navCell${active ? " _77Pn0W_active" : ""}"${
      active ? ' aria-current="true"' : ""
    }>
            <span class="_77Pn0W_navIcon" aria-hidden="true">${icon(paths)}</span>
            <span class="_77Pn0W_navLabel">${label}</span>
          </button>`;
  }).join("\n          ");

  return `<div class="_77Pn0W_overlay" role="presentation">
      <div class="_77Pn0W_mask" aria-hidden="true"></div>
      <div class="_77Pn0W_panel" data-shortcut-modal="settings" role="dialog" aria-modal="true" tabindex="-1" aria-labelledby="preview-settings-title">
        <div class="_77Pn0W_navTitle" id="preview-settings-title" tabindex="-1">设置</div>

        <nav class="_77Pn0W_nav" aria-label="设置">
          <div class="_77Pn0W_navList">
          ${nav}
          </div>
        </nav>

        <div class="_77Pn0W_header">
          <div class="_77Pn0W_actions"></div>
          <button type="button" class="_77Pn0W_close" aria-label="关闭设置">
            ${CLOSE_ICON}
            <span class="_77Pn0W_hiddenLabel">关闭设置</span>
          </button>
        </div>

        <div class="_77Pn0W_options">
          <div class="tUAPGa_section">
            <h2 class="tUAPGa_title">模型</h2>
            <p class="tUAPGa_intro">配置模型提供方与默认模型。更改会立即生效。</p>
            <ul class="tUAPGa_rows">
              <li class="tUAPGa_rowCard">
                <div class="tUAPGa_rowHead">
                  <span class="tUAPGa_rowIdentity">
                    <span class="tUAPGa_rowName">DeepSeek</span>
                    <span class="tUAPGa_rowTag">官方</span>
                    <span class="tUAPGa_accountStatus"><span class="tUAPGa_credentialDot tUAPGa_credentialDotConfigured" aria-hidden="true"></span>已连接</span>
                  </span>
                  <span class="tUAPGa_rowActions">
                    <button type="button" class="tUAPGa_secondaryButton">编辑</button>
                    <button type="button" class="tUAPGa_dangerButton">移除</button>
                  </span>
                </div>
              </li>

              <li class="tUAPGa_rowCard">
                <div class="_field_181ew_3">
                  <div class="_head_181ew_14">
                    <div class="_labelGroup_181ew_29">
                      <label class="_label_181ew_20" for="preview-api-key">OpenAI 兼容 · API 密钥</label>
                      <span class="tUAPGa_rowTag">自定义</span>
                    </div>
                    <button type="button" role="switch" aria-checked="true" aria-label="启用 OpenAI 兼容" class="_switch_1ik0f_5"><span class="_thumb_1ik0f_33"></span></button>
                  </div>
                  <input id="preview-api-key" class="_input_181ew_115" type="password" value="sk-preview-000000000000" autocomplete="off">
                </div>
                <label class="_checkbox_1wz3s_1"><input type="checkbox" checked><span>设为默认模型</span></label>
              </li>

              <li class="tUAPGa_rowCard">
                <div class="tUAPGa_rowHead">
                  <span class="tUAPGa_rowIdentity"><span class="tUAPGa_rowName">推理强度</span></span>
                  <span class="tUAPGa_rowActions"><span class="tUAPGa_rowTag">中</span></span>
                </div>
                <div class="_tabs_1lga9_1" role="tablist" data-size="sm" aria-label="推理强度" style="grid-template-columns:repeat(3,minmax(0,1fr))">
                  <span class="_indicator_1lga9_11" aria-hidden="true" style="width:calc((100% - 8px) / 3);transform:translateX(100%)"></span>
                  <button type="button" role="tab" aria-selected="false" class="_tab_1lga9_1">低</button>
                  <button type="button" role="tab" aria-selected="true" class="_tab_1lga9_1">中</button>
                  <button type="button" role="tab" aria-selected="false" class="_tab_1lga9_1">高</button>
                </div>
              </li>

              <li class="tUAPGa_rowCard">
                <div class="tUAPGa_rowHead">
                  <span class="tUAPGa_rowIdentity"><span class="tUAPGa_rowName">模型操作</span></span>
                  <span class="tUAPGa_rowActions">
                    <button type="button" class="tUAPGa_secondaryButton" aria-haspopup="menu" aria-expanded="true">操作</button>
                  </span>
                </div>
                <div class="preview-menu-slot">
                  <div class="_surface_1w4el_1 _menu_3oazc_581" role="menu" data-menu-material="translucent" aria-label="模型操作" style="position:absolute;top:0;left:0;min-width:220px;--dsh-menu-anchor:--dsh-settings-menu">
                    <div class="_material_1w4el_21" aria-hidden="true"></div>
                    <button type="button" role="menuitem" class="_menuItem_3oazc_595">设为默认</button>
                    <button type="button" role="menuitem" class="_menuItem_3oazc_595">复制模型 ID</button>
                  </div>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>`;
}

function archiveDialog() {
  const rows = [
    ["重构对话框样式", "8 条消息 · 最后活动 2026-11-10"],
    ["Swiss 栅格调研", "21 条消息 · 最后活动 2026-11-08"],
    ["发布前检查清单", "5 条消息 · 最后活动 2026-11-02"],
  ]
    .map(
      ([title, meta]) => `      <label class="preview-archive-row _checkbox_1wz3s_1">
        <input type="checkbox" checked>
        <span class="preview-archive-meta"><strong>${title}</strong><small>${meta}</small></span>
      </label>`,
    )
    .join("\n");

  return `<div class="dsham_modalRoot" role="presentation">
      <div class="dsham_modalMask" aria-hidden="true"></div>
      <div class="dsham_modalDialog" role="dialog" aria-modal="true" tabindex="-1" aria-label="归档会话" style="width:560px">
        <div class="dsham_modalHeader">
          <h2 title="归档会话">归档会话</h2>
          <button type="button" class="dsham_modalClose" aria-label="关闭">${CLOSE_ICON}</button>
        </div>
        <p>归档的会话仍保留在本机，可随时恢复或彻底删除。</p>
        <div class="dsham_modalBody">
          <input class="_input_181ew_115" type="search" placeholder="搜索已归档的会话…" aria-label="搜索归档会话">
          <label class="_checkbox_1wz3s_1"><input type="checkbox"><span>重启后自动归档超过 30 天的会话</span></label>
          <div class="preview-archive-list">
${rows}
          </div>
        </div>
        <div class="dsham_modalFooter">
          <button type="button" class="tUAPGa_secondaryButton">取消</button>
          <button type="button" class="tUAPGa_primaryButton">归档 3 个会话</button>
        </div>
      </div>
    </div>`;
}

function confirmDialog() {
  return `<div class="_root_14mp3_6" role="presentation">
      <div class="_mask_14mp3_18" aria-hidden="true"></div>
      <div class="_dialog_14mp3_33" role="dialog" aria-modal="true" tabindex="-1" aria-labelledby="preview-confirm-title" aria-describedby="preview-confirm-desc">
        <div class="_content_14mp3_63">
          <div class="_header_14mp3_71">
            <h2 class="_title_14mp3_79" id="preview-confirm-title">删除这个会话？</h2>
            <button type="button" class="_close_14mp3_87" aria-label="关闭">${CLOSE_ICON}</button>
          </div>
          <p class="_description_14mp3_108" id="preview-confirm-desc">删除后无法恢复。</p>
          <div class="_body_14mp3_117">
            <p>会话“重构对话框样式”及其 8 条消息将被永久删除，归档副本也会一并移除。</p>
            <label class="_checkbox_1wz3s_1"><input type="checkbox" checked><span>同时删除已导出的附件</span></label>
          </div>
        </div>
        <div class="_footer_14mp3_125">
          <button type="button" class="_button_1ulci_2 _md_1ulci_23 _outline_1ulci_56">取消</button>
          <button type="button" class="_button_1ulci_2 _md_1ulci_23 _primary_1ulci_36">删除</button>
        </div>
      </div>
    </div>`;
}

function menuDialog() {
  const items = ["新建会话", "重命名会话", "归档会话", "导出为 Markdown", "删除会话"]
    .map(
      (label) =>
        `            <button type="button" role="menuitem" class="_menuItem_3oazc_595">${label}</button>`,
    )
    .join("\n");
  return `<div class="preview-menu-stage">
      <div class="_surface_1w4el_1 _menu_3oazc_581" role="menu" data-menu-material="translucent" aria-label="会话操作" style="top:calc(50% - 74px);left:calc(50% - 120px);min-width:240px;--dsh-menu-anchor:--dsh-page-menu">
        <div class="_material_1w4el_21" aria-hidden="true"></div>
${items}
      </div>
      <div class="_backing_1w4el_2" aria-hidden="true" data-menu-backing data-menu-phase="enter" style="--dsh-menu-anchor:--dsh-page-menu"></div>
    </div>`;
}

const PAGE_CSS = `
    /* preview-only: the app surface behind the dialog, so the scrim is visible */
    html, body { margin: 0; height: 100%; }
    html { --dsh-hairline-width: 0.5px; }
    html[data-platform="darwin"] {
      --dsh-frame-top-clearance: 48px;
      --dsh-frame-overlay-top: calc(48px + 20px);
    }
    html[data-windows-titlebar] {
      --dsh-windows-titlebar-height: 38px;
      --dsh-frame-top-clearance: var(--dsh-windows-titlebar-height);
      --dsh-frame-chrome-top: var(--dsh-windows-titlebar-height);
      --dsh-frame-overlay-top: calc(var(--dsh-windows-titlebar-height) + 20px);
    }
    body {
      overflow: hidden;
      font-family: var(--dsh-font-family-text-default, var(--dsw-font-family, ui-sans-serif, system-ui, sans-serif));
      color: var(--dsw-alias-label-primary, #111);
      background: var(--dsw-alias-bg-base, #fff);
      -webkit-font-smoothing: antialiased;
    }
    .preview-app {
      position: fixed; inset: 0;
      display: grid;
      grid-template-columns: 240px minmax(0, 1fr);
      grid-template-rows: 48px minmax(0, 1fr);
      background: var(--dsw-alias-bg-base, #fff);
      color: var(--dsw-alias-label-primary, #111);
    }
    .preview-titlebar {
      grid-column: 1 / -1;
      display: flex; align-items: center; gap: 7px;
      padding: 0 16px;
      border-bottom: 1px solid var(--dsw-alias-border-l1, #ddd);
      background: var(--dsw-alias-bg-layer-1, #f7f7f7);
    }
    .preview-dot { width: 11px; height: 11px; border-radius: 50%; background: var(--dsw-alias-border-l3, #c9c9c4); }
    .preview-dot:nth-child(1) { background: #ff5f57; }
    .preview-dot:nth-child(2) { background: #febc2e; }
    .preview-dot:nth-child(3) { background: #28c840; }
    .preview-appname { margin-left: 8px; font-size: 12px; color: var(--dsw-alias-label-tertiary, #888); }
    .preview-sidebar {
      padding: 12px 10px;
      border-right: 1px solid var(--dsw-alias-border-l1, #ddd);
      background: var(--dsw-alias-bg-layer-1, #fafafa);
      display: flex; flex-direction: column; gap: 4px;
      font-size: 13px;
    }
    .preview-new {
      height: 32px; display: flex; align-items: center; padding: 0 10px;
      border: 1px solid var(--dsw-alias-border-l2, #ddd);
      color: var(--dsw-alias-label-primary, #111);
    }
    .preview-side-item { padding: 7px 10px; color: var(--dsw-alias-label-secondary, #555); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .preview-side-item.is-active { background: var(--dsw-alias-bg-layer-3, #eee); color: var(--dsw-alias-label-primary, #111); }
    .preview-main { padding: 40px 56px; overflow: hidden; }
    .preview-main h1 { margin: 0 0 8px; font-size: 24px; font-weight: 600; letter-spacing: -0.01em; }
    .preview-main p { margin: 0 0 14px; max-width: 620px; color: var(--dsw-alias-label-secondary, #555); font-size: 14px; line-height: 1.7; }
    .preview-bubble {
      max-width: 620px; margin-top: 22px; padding: 14px 16px;
      border: 1px solid var(--dsw-alias-border-l1, #ddd);
      background: var(--dsw-alias-bg-layer-2, #fff);
      color: var(--dsw-alias-label-primary, #111);
      font-size: 13px; line-height: 1.7;
    }
    .preview-menu-slot { position: relative; height: 76px; }
    .preview-archive-list { display: flex; flex-direction: column; gap: 2px; }
    .preview-archive-row {
      display: flex !important; align-items: flex-start !important; gap: 10px !important;
      padding: 9px 2px;
      border-top: 1px solid var(--dsw-alias-border-l1, #ddd);
    }
    .preview-archive-meta { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .preview-archive-meta strong { font-size: 13px; font-weight: 500; line-height: 20px; color: var(--dsw-alias-label-primary, #111); }
    .preview-archive-meta small { font-size: 12px; line-height: 17px; color: var(--dsw-alias-label-tertiary, #888); }
    ._input_181ew_115[type="search"] { width: 100%; box-sizing: border-box; }
    @media (max-width: 720px) {
      .preview-app { grid-template-columns: minmax(0, 1fr); }
      .preview-sidebar { display: none; }
      .preview-main { padding: 24px 20px; }
    }
`;

function buildHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>DSH dialog preview</title>
<link rel="stylesheet" href="vendor/web-index.css">
<link rel="stylesheet" href="vendor/theme-base.css">
<link rel="stylesheet" href="vendor/theme-platform.css">
<link rel="stylesheet" href="vendor/settings-general.css">
<link rel="stylesheet" href="vendor/models.css">
<link rel="stylesheet" href="vendor/market.css">
<link rel="stylesheet" href="vendor/archive.css">
<style>${PAGE_CSS}</style>
<link rel="stylesheet" href="../src/swiss.css">
</head>
<body>
  <div class="preview-app" aria-hidden="true">
    <div class="preview-titlebar">
      <span class="preview-dot"></span><span class="preview-dot"></span><span class="preview-dot"></span>
      <span class="preview-appname">DeepSeek Harness</span>
    </div>
    <aside class="preview-sidebar">
      <div class="preview-new">＋ 新建会话</div>
      <div class="preview-side-item is-active">重构对话框样式</div>
      <div class="preview-side-item">Swiss 栅格调研</div>
      <div class="preview-side-item">发布前检查清单</div>
      <div class="preview-side-item">归档与回收站</div>
      <div class="preview-side-item">模型配置笔记</div>
    </aside>
    <main class="preview-main">
      <h1>重构对话框样式</h1>
      <p>这个页面只用于本地视觉检查：它复刻了应用的真实对话框 DOM 与样式表，所有交互保持静态。</p>
      <p>背景是应用界面的占位内容，用来确认遮罩层、标题栏留白和对话框边界的实际观感。</p>
      <p>切换查询参数即可查看浅色 / 深色、不同对话框以及桌面与紧凑窗口下的形态。</p>
      <div class="preview-bubble">Swiss modernist restyle · 2px hairline rules · paper and ink · a single red accent.</div>
    </main>
  </div>

  <div id="dialog-host"></div>

  <template id="tpl-settings">${settingsDialog()}</template>
  <template id="tpl-archive">${archiveDialog()}</template>
  <template id="tpl-confirm">${confirmDialog()}</template>
  <template id="tpl-menu">${menuDialog()}</template>

  <script>
    (() => {
      const params = new URLSearchParams(location.search);
      const html = document.documentElement;
      const body = document.body;

      const theme = params.get("theme") === "dark" ? "dark" : "light";
      html.style.colorScheme = theme;
      if (theme === "dark") {
        html.setAttribute("data-ds-dark-theme", "");
        body.setAttribute("data-ds-dark-theme", "");
      }

      const platform = params.get("platform") === "web" ? "web" : "darwin";
      if (platform === "darwin") html.setAttribute("data-platform", "darwin");

      if (params.get("frame") === "titlebar") {
        html.setAttribute("data-windows-titlebar", "");
      }

      const overlayTop = params.get("overlayTop");
      if (overlayTop) html.style.setProperty("--dsh-frame-overlay-top", overlayTop);

      const requested = params.get("dialog");
      const dialog = ["settings", "archive", "confirm", "menu"].includes(requested)
        ? requested
        : "settings";
      body.setAttribute("data-preview-theme", theme);
      body.setAttribute("data-preview-dialog", dialog);
      body.setAttribute("data-preview-platform", platform);

      const template = document.getElementById("tpl-" + dialog);
      if (template) {
        document.getElementById("dialog-host").appendChild(template.content.cloneNode(true));
      }
      document.title = "DSH " + dialog + " · " + theme;
    })();
  </script>
</body>
</html>
`;
}

function main() {
  const missing = REQUIRED.filter(([, spec]) => !sourceExists(spec));
  if (missing.length > 0) {
    for (const [label, spec] of missing) {
      console.error(`missing required source (${label}): ${sourceLabel(spec)}`);
    }
    process.exit(1);
  }

  mkdirSync(VENDOR_DIR, { recursive: true });
  const FONT_DIR = path.join(VENDOR_DIR, "fonts");
  rmSync(FONT_DIR, { recursive: true, force: true });
  mkdirSync(FONT_DIR, { recursive: true });
  for (const font of SOURCES.webFonts) {
    if (sourceExists(font)) {
      const [entry] = matchAsar(font).sort((a, b) => b.size - a.size);
      writeFileSync(path.join(FONT_DIR, path.basename(entry.path)), readAsar(entry));
    } else {
      warn(`web font not found in app.asar (fallback text will be used): ${font}`);
    }
  }

  // ---- extract ----------------------------------------------------------
  const theme = extractThemeModules(readSource(SOURCES.theme));
  const requiredThemeModules = ["base", "design_platform"];
  for (const name of requiredThemeModules) {
    if (!theme.has(name)) {
      console.error(`missing theme module "${name}" in ${SOURCES.theme}`);
      process.exit(1);
    }
  }

  const settingsModules = extractConstCss(
    readSource(SOURCES.settingsGeneral),
    "settings-general",
  );
  if (settingsModules.length === 0) {
    console.error(`no CSS modules found in ${SOURCES.settingsGeneral}`);
    process.exit(1);
  }

  const modelModules = sourceExists(SOURCES.settingsModels)
    ? extractConstCss(readSource(SOURCES.settingsModels), "settings-models")
    : [];
  if (!sourceExists(SOURCES.settingsModels)) {
    warn(`optional settings-models bundle not found: ${sourceLabel(SOURCES.settingsModels)}`);
  }

  const marketModules = extractConstCss(readSource(SOURCES.market), "market");
  if (marketModules.length === 0) {
    warn(`no inline CSS modules found in ${SOURCES.market}`);
  }

  const archiveModules = extractInjectedCss(readSource(SOURCES.archive), "archive");
  if (archiveModules.length === 0) {
    console.error(`no F("...css", "...") modules found in ${SOURCES.archive}`);
    process.exit(1);
  }

  // ---- vendor sheets ----------------------------------------------------
  const outputs = [];

  outputs.push(
    ["web-index.css", writeVendor("web-index.css", readSource(SOURCES.webIndex))],
  );

  const themeBase = joinBlocks([
    block("theme/base", theme.get("base") || ""),
    block("theme/gradient-shadow-text", theme.get("gradient_shadow_text") || ""),
    block("theme/onboarding", theme.get("onboarding") || ""),
    block("theme/scrollbar", theme.get("scrollbar") || ""),
    block("theme/shiki", theme.get("shiki") || ""),
  ]);
  outputs.push(["theme-base.css", writeVendor("theme-base.css", themeBase)]);

  const themePlatform = joinBlocks([
    block("theme/design-platform", theme.get("design_platform") || ""),
    block("theme/corner-shape", theme.get("corner_shape") || ""),
    block("theme/focus", theme.get("focus") || ""),
  ]);
  outputs.push(["theme-platform.css", writeVendor("theme-platform.css", themePlatform)]);

  const settingsCss = joinBlocks(
    settingsModules.map((module, index) =>
      block(`settings-general/${module.name || index}`, module.css),
    ),
  );
  outputs.push([
    "settings-general.css",
    writeVendor("settings-general.css", settingsCss),
  ]);

  const modelsCss =
    modelModules.length > 0
      ? joinBlocks(
          modelModules.map((module, index) =>
            block(`settings-models/${module.name || index}`, module.css),
          ),
        )
      : "/* settings-models bundle unavailable in this checkout */\n";
  outputs.push(["models.css", writeVendor("models.css", modelsCss)]);

  const marketCss =
    marketModules.length > 0
      ? joinBlocks(
          marketModules.map((module, index) =>
            block(`market/${module.name || index}`, module.css),
          ),
        )
      : "/* market CSS module unavailable */\n";
  outputs.push(["market.css", writeVendor("market.css", marketCss)]);

  const archiveCss = joinBlocks(
    archiveModules.map((module) => block(`archive/${module.name}`, module.css)),
  );
  outputs.push(["archive.css", writeVendor("archive.css", archiveCss)]);

  writeFileSync(INDEX_HTML, buildHtml(), "utf8");

  // ---- report -----------------------------------------------------------
  console.log(
    `preview: ${outputs.length} vendor sheets + index.html (settings/archive/confirm/menu, light+dark, darwin/web, titlebar) from real bundles`,
  );
  for (const [name, info] of outputs) {
    console.log(`  ${name.padEnd(24)} ${String(info.bytes).padStart(8)} B`);
  }
  console.log(
    `  ${"index.html".padEnd(24)} ${String(statSync(INDEX_HTML).size).padStart(8)} B`,
  );
  if (warnings.length > 0) {
    console.log(`  warnings: ${warnings.length}`);
  }
}

main();
