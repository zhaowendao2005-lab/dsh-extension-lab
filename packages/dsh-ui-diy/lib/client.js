/**
 * dsh-ui-diy — client half (source template).
 *
 * Built by `scripts/build.mjs` into `lib/client.js` by replacing the
 * sole placeholder token with the JSON-encoded contents of `src/swiss.css`.
 *
 * Styling only: this plugin never touches the DOM tree, ARIA attributes or
 * keyboard handling of the dialogs it re-skins. It registers one
 * plugin-owned stylesheet through `ctx.effect`, exactly like
 * @deepseek-ai/dsh-client-ui-theme does for its tokens, so the sheet is added
 * on load and removed on unload/HMR.
 */
window.__ModuleLoader__.load({
  id: "dsh-ui-diy",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;

    const CSS = "/* ===========================================================================\n   dsh-ui-diy — Swiss modernist dialogs for DeepSeek Harness\n   ---------------------------------------------------------------------------\n   Scope\n     * Centered modal panels:  div[role=\"presentation\"] > div[role=\"dialog\"][aria-modal=\"true\"]\n       (settings + the generic Modal primitive + the archive manager dialog)\n     * The settings dialog specifically:  [data-shortcut-modal=\"settings\"]\n     * The archive manager panel:         .dsham_modalDialog\n\n   Swiss modernism 2.0 rules applied here:\n     strict grid · paper/ink only · hairline rules · square corners ·\n     one accent · typographic hierarchy · no decoration, no shadow, no blur.\n   The markup, ARIA attributes and keyboard behaviour are untouched: this sheet\n   only re-skins what the app already renders.\n   =========================================================================== */\n\n/* ---------------------------------------------------------------------------\n   1. Palette — paper, ink, hairline, a single pale-green accent.\n   --------------------------------------------------------------------------- */\n:root {\n  --swiss-font: \"Helvetica Neue\", Helvetica, Inter, \"PingFang SC\",\n    \"Hiragino Sans GB\", \"Microsoft YaHei\", Arial, sans-serif;\n\n  --swiss-paper: #faf9f6;\n  --swiss-paper-2: #f1f0ec;\n  --swiss-ink: #0a0a0b;\n  --swiss-ink-2: #5c5c57;\n  --swiss-hairline: #d8d6cf;\n  --swiss-accent: #9ccc65;\n  /* bars that sit on an inverted (ink) surface need to read against ink, not\n     against paper; in the dark theme the inverted cell is light, so the bar\n     turns deep green instead of pale */\n  --swiss-bar: #9ccc65;\n  --swiss-mask: rgba(10, 10, 11, 0.55);\n}\n\nbody[data-ds-dark-theme] {\n  --swiss-paper: #121213;\n  --swiss-paper-2: #1b1b1d;\n  --swiss-ink: #f4f3ef;\n  --swiss-ink-2: #a3a39c;\n  --swiss-hairline: #33332f;\n  --swiss-accent: #a5d6a7;\n  --swiss-bar: #4a7c22;\n  --swiss-mask: rgba(0, 0, 0, 0.66);\n}\n\n/* ---------------------------------------------------------------------------\n   2. Scrim — flat, dark, translucent. No background blur anywhere.\n   --------------------------------------------------------------------------- */\ndiv[role=\"presentation\"] {\n  --dsw-alias-bg-mask-1: var(--swiss-mask);\n  --dsw-mask-blur: none;\n}\n\ndiv[role=\"presentation\"] > div[aria-hidden=\"true\"] {\n  background: var(--swiss-mask) !important;\n  -webkit-backdrop-filter: none !important;\n  backdrop-filter: none !important;\n}\n\n/* ---------------------------------------------------------------------------\n   3. Scoped token layer.\n   Everything below the panel root inherits these; nothing outside the dialog\n   is affected. Radius tokens collapse to zero, which squares every primitive\n   that sizes its corners through --dsw-radius-*.\n   --------------------------------------------------------------------------- */\n[data-shortcut-modal=\"settings\"],\n.dsham_modalDialog,\ndiv[role=\"presentation\"] > div[role=\"dialog\"][aria-modal=\"true\"] {\n  /* geometry */\n  --dsw-radius-xs: 0px;\n  --dsw-radius-sm: 0px;\n  --dsw-radius-md: 0px;\n  --dsw-radius-lg: 0px;\n  --dsw-radius-xl: 0px;\n  --dsw-radius-panel: 0px;\n  --dsw-corner-shape: square;\n\n  /* type */\n  --dsw-font-family: var(--swiss-font);\n  --dsh-font-family-text-default: var(--swiss-font);\n\n  /* surfaces */\n  --dsw-alias-bg-base: var(--swiss-paper);\n  --dsw-alias-bg-layer-1: var(--swiss-paper);\n  --dsw-alias-bg-layer-2: var(--swiss-paper);\n  --dsw-alias-bg-layer-3: var(--swiss-paper-2);\n  --dsw-alias-bg-overlay: var(--swiss-paper);\n  --dsw-alias-bg-module-platform: var(--swiss-paper-2);\n  --dsw-alias-settings-card-fill: var(--swiss-paper-2);\n  --dsw-alias-settings-card-stroke: var(--swiss-hairline);\n\n  /* hairline rules */\n  --dsw-alias-border-l1: var(--swiss-hairline);\n  --dsw-alias-border-l2: var(--swiss-hairline);\n  --dsw-alias-border-l3: var(--swiss-hairline);\n  --dsw-alias-border-l4: var(--swiss-hairline);\n\n  /* type colour */\n  --dsw-alias-label-primary: var(--swiss-ink);\n  --dsw-alias-label-secondary: var(--swiss-ink-2);\n  --dsw-alias-label-tertiary: var(--swiss-ink-2);\n  --dsw-alias-label-dimmed: var(--swiss-ink-2);\n  --dsw-alias-label-primary-foreground: var(--swiss-paper);\n\n  /* interaction */\n  --dsw-alias-interactive-bg-hover: var(--swiss-paper-2);\n  --dsw-alias-interactive-bg-active: var(--swiss-hairline);\n  --dsw-specific-sidebar-nav-item-active: var(--swiss-ink);\n\n  /* brand collapses to ink: primary actions are black, not blue */\n  --dsw-alias-brand-primary: var(--swiss-ink);\n  --dsw-alias-brand-primary-new-color: var(--swiss-ink);\n  --dsw-alias-button-primary-fill: var(--swiss-ink);\n  --dsw-alias-button-primary-hover: var(--swiss-ink-2);\n  --dsw-alias-button-contrast-fill: var(--swiss-ink);\n  --dsh-button-outline-color: var(--swiss-ink);\n  --dsw-focus-ring-color: var(--swiss-ink);\n  --dsw-alias-switch-thumb: var(--swiss-ink-2);\n\n  /* chassis */\n  border-radius: 0 !important;\n  box-shadow: none !important;\n  border: 1px solid var(--swiss-hairline);\n  background: var(--swiss-paper) !important;\n  color: var(--swiss-ink);\n  font-family: var(--swiss-font);\n  -webkit-font-smoothing: antialiased;\n  corner-shape: square;\n}\n\n/* ---------------------------------------------------------------------------\n   4. Settings dialog — 80% of the application window.\n   The overlay gains the frame's top clearance so the panel centres in the\n   content area instead of the raw viewport (macOS desktop: 68px).\n   --------------------------------------------------------------------------- */\ndiv[role=\"presentation\"]:has(> [data-shortcut-modal=\"settings\"]) {\n  box-sizing: border-box;\n  padding-top: var(--dsh-frame-overlay-top, 0px);\n}\n\n[data-shortcut-modal=\"settings\"] {\n  box-sizing: border-box !important;\n  width: 80vw !important;\n  height: 80vh !important;\n  max-width: none !important;\n  max-height: none !important;\n  border-top: 3px solid var(--swiss-accent) !important;\n  display: grid;\n  grid-template-columns: 240px minmax(0, 1fr) !important;\n  grid-template-rows: auto minmax(0, 1fr) !important;\n  overflow: hidden;\n}\n\n/* masthead: one line of page furniture spanning the dialog */\n[data-shortcut-modal=\"settings\"] > div:first-child {\n  display: flex;\n  align-items: center;\n  box-sizing: border-box;\n  height: 64px;\n  padding: 0 24px !important;\n  border-bottom: 1px solid var(--swiss-hairline);\n  font-size: 13px !important;\n  font-weight: 600 !important;\n  line-height: 1 !important;\n  letter-spacing: 0.09em;\n  text-transform: uppercase;\n  color: var(--swiss-ink) !important;\n  overflow: hidden;\n  white-space: nowrap;\n}\n\n[data-shortcut-modal=\"settings\"] > div:first-child::before {\n  content: \"\";\n  flex: none;\n  width: 10px;\n  height: 10px;\n  margin-right: 12px;\n  background: var(--swiss-accent);\n}\n\n/* header (holds the close button; the slot may also contribute actions) */\n[data-shortcut-modal=\"settings\"] > nav + div {\n  display: flex;\n  align-items: center;\n  justify-content: flex-end;\n  gap: 8px;\n  box-sizing: border-box;\n  height: 64px;\n  padding: 0 16px 0 24px !important;\n  border-bottom: 1px solid var(--swiss-hairline);\n}\n\n/* only the close button is a direct child; slot actions keep their own size */\n[data-shortcut-modal=\"settings\"] > nav + div > button {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 32px;\n  height: 32px;\n  padding: 0;\n  border-radius: 0 !important;\n  border: 1px solid transparent !important;\n  color: var(--swiss-ink);\n}\n\n[data-shortcut-modal=\"settings\"] > nav + div > button:hover {\n  background: var(--swiss-paper-2) !important;\n  border-color: var(--swiss-hairline) !important;\n}\n\n[data-shortcut-modal=\"settings\"] > nav + div > button:focus-visible {\n  border-color: var(--swiss-ink) !important;\n}\n\n/* navigation rail: numbered, hairline-separated, inverted selected cell */\n[data-shortcut-modal=\"settings\"] > nav {\n  padding: 0 !important;\n  border-right: 1px solid var(--swiss-hairline);\n  overflow: hidden;\n}\n\n[data-shortcut-modal=\"settings\"] > nav > div {\n  display: flex;\n  flex-direction: column;\n  gap: 0 !important;\n  padding: 12px 0 0 !important;\n  counter-reset: swissnav;\n  overflow-y: auto;\n  scrollbar-width: thin;\n  scrollbar-color: var(--swiss-hairline) transparent;\n}\n\n[data-shortcut-modal=\"settings\"] > nav button {\n  counter-increment: swissnav;\n  display: flex;\n  flex: none;\n  align-items: center;\n  justify-content: flex-start;\n  gap: 12px;\n  width: 100%;\n  height: 44px;\n  padding: 0 16px 0 20px !important;\n  border-radius: 0 !important;\n  border-bottom: 1px solid var(--swiss-hairline);\n  background: transparent !important;\n  color: var(--swiss-ink-2) !important;\n  font-size: 12px !important;\n  font-weight: 500 !important;\n  letter-spacing: 0.02em;\n  text-transform: uppercase;\n  transition: background-color 0.15s ease, color 0.15s ease;\n}\n\n/* icons are decoration here: the numbered grid replaces them */\n[data-shortcut-modal=\"settings\"] > nav button > span:has(> svg) {\n  display: none !important;\n}\n\n[data-shortcut-modal=\"settings\"] > nav button::before {\n  content: counter(swissnav, decimal-leading-zero);\n  flex: none;\n  width: 20px;\n  font-size: 11px;\n  font-weight: 400;\n  letter-spacing: 0.04em;\n  font-variant-numeric: tabular-nums;\n  color: var(--swiss-ink-2);\n}\n\n[data-shortcut-modal=\"settings\"] > nav button:not([aria-current=\"true\"]):hover {\n  background: var(--swiss-paper-2) !important;\n  color: var(--swiss-ink) !important;\n}\n\n[data-shortcut-modal=\"settings\"] > nav button[aria-current=\"true\"] {\n  background: var(--swiss-ink) !important;\n  color: var(--swiss-paper) !important;\n  box-shadow: inset 4px 0 0 0 var(--swiss-bar);\n}\n\n[data-shortcut-modal=\"settings\"] > nav button[aria-current=\"true\"]::before {\n  color: var(--swiss-paper);\n  opacity: 0.65;\n}\n\n/* segmented control: the indicator sits behind the tabs, so the selected cell\n   is painted here instead of relying on the (now paper-coloured) indicator */\n[data-shortcut-modal=\"settings\"] [role=\"tablist\"] {\n  border: 1px solid var(--swiss-hairline);\n  background: transparent !important;\n  padding: 3px;\n}\n\n[data-shortcut-modal=\"settings\"] [role=\"tablist\"] [role=\"tab\"] {\n  color: var(--swiss-ink-2) !important;\n  font-size: 13px !important;\n  letter-spacing: 0.02em;\n}\n\n[data-shortcut-modal=\"settings\"] [role=\"tablist\"] [role=\"tab\"][aria-selected=\"true\"] {\n  background: var(--swiss-ink) !important;\n  color: var(--swiss-paper) !important;\n}\n\n/* content column */\n[data-shortcut-modal=\"settings\"] > nav + div + div {\n  padding: 32px 40px 48px !important;\n  overflow-y: auto;\n  background: var(--swiss-paper);\n  scrollbar-width: thin;\n  scrollbar-color: var(--swiss-hairline) transparent;\n}\n\n[data-shortcut-modal=\"settings\"] > nav + div + div > * {\n  box-sizing: border-box;\n  width: 100% !important;\n  max-width: none !important;\n}\n\n/* the slot may wrap the section in one more div; the app caps sections at\n   720px, so reach that level too and let the content column breathe */\n[data-shortcut-modal=\"settings\"] > nav + div + div > * > * {\n  box-sizing: border-box;\n  width: 100%;\n  max-width: none;\n}\n\n[data-shortcut-modal=\"settings\"] > nav + div + div :is(h1, h2, h3) {\n  font-weight: 600;\n  letter-spacing: -0.01em;\n}\n\n/* ---------------------------------------------------------------------------\n   5. Generic dialogs (confirmation cards, archive manager, future modals).\n   Shell only — their intrinsic width is preserved.\n   --------------------------------------------------------------------------- */\ndiv[role=\"presentation\"] > div[role=\"dialog\"][aria-modal=\"true\"]:not(\n    [data-shortcut-modal=\"settings\"]\n  ),\n.dsham_modalDialog {\n  border-top: 2px solid var(--swiss-accent) !important;\n}\n\n/* archive manager: also 80% of the window */\n.dsham_modalDialog {\n  width: 80vw !important;\n  max-width: none !important;\n  max-height: 80vh !important;\n}\n\n/* the two compact confirm cards of the archive manager stay compact */\n.dsham_sidebarCard {\n  border-radius: 0 !important;\n  box-shadow: none !important;\n  border: 1px solid var(--swiss-hairline) !important;\n  background: var(--swiss-paper) !important;\n  color: var(--swiss-ink) !important;\n}\n\n/* ---------------------------------------------------------------------------\n   6. Primitive corrections — literals the token layer cannot reach.\n   --------------------------------------------------------------------------- */\ndiv[role=\"presentation\"] [role=\"switch\"],\ndiv[role=\"presentation\"] [role=\"switch\"] *,\n.dsham_modalDialog [role=\"switch\"],\n.dsham_modalDialog [role=\"switch\"] *,\n[data-shortcut-modal=\"settings\"] [role=\"switch\"],\n[data-shortcut-modal=\"settings\"] [role=\"switch\"] * {\n  border-radius: 0 !important;\n  corner-shape: square !important;\n}\n\ndiv[role=\"presentation\"] input[type=\"checkbox\"],\ndiv[role=\"presentation\"] input[type=\"radio\"],\n.dsham_modalDialog input[type=\"checkbox\"],\n.dsham_modalDialog input[type=\"radio\"],\n[data-shortcut-modal=\"settings\"] input[type=\"checkbox\"],\n[data-shortcut-modal=\"settings\"] input[type=\"radio\"] {\n  accent-color: var(--swiss-ink);\n}\n\n/* ---------------------------------------------------------------------------\n   7. Touch-ups outside dialogs: menus and non-modal popovers are squared off\n   but keep the app's own palette so they still read as \"the app\", not as a\n   dialog.\n   --------------------------------------------------------------------------- */\n[role=\"menu\"],\n[role=\"menu\"] [role=\"menuitem\"],\ndiv[role=\"dialog\"]:not([aria-modal=\"true\"]) {\n  border-radius: 0 !important;\n}\n\n/* ---------------------------------------------------------------------------\n   8. Plugin market full-screen mode: its own rules ask for 100vw. Ours carry\n   !important, so hand the full-screen case back explicitly.\n   --------------------------------------------------------------------------- */\n[data-shortcut-modal=\"settings\"]:has([data-dsh-market-fullscreen=\"true\"]) {\n  width: 100vw !important;\n  height: 100vh !important;\n  border: 0 !important;\n}\n\n/* ---------------------------------------------------------------------------\n   9. Narrow windows. The app's own <=767px rules only apply to web sessions\n   (`html:not([data-windows-titlebar]):not([data-platform=\"darwin\"])`), so a\n   resized desktop window needs its own breakpoints.\n   --------------------------------------------------------------------------- */\n@media (max-width: 900px) {\n  /* full-bleed: no frame clearance, the panel owns the whole window */\n  div[role=\"presentation\"]:has(> [data-shortcut-modal=\"settings\"]) {\n    padding-top: 0;\n  }\n\n  [data-shortcut-modal=\"settings\"] {\n    width: 100vw !important;\n    height: 100vh !important;\n    border: 0 !important;\n    border-top: 3px solid var(--swiss-accent) !important;\n    grid-template-columns: 200px minmax(0, 1fr) !important;\n  }\n\n  [data-shortcut-modal=\"settings\"] > nav + div + div {\n    padding: 24px 20px 40px !important;\n  }\n}\n\n@media (max-width: 640px) {\n  /* single column: title + close share the top bar, the rail turns horizontal.\n     The app's own area names are hashed, so this breakpoint owns its own\n     template and places each child by name. */\n  [data-shortcut-modal=\"settings\"] {\n    grid-template-columns: minmax(0, 1fr) !important;\n    grid-template-rows: 64px auto minmax(0, 1fr) !important;\n    grid-template-areas: \"title\" \"nav\" \"options\" !important;\n  }\n\n  [data-shortcut-modal=\"settings\"] > div:first-child {\n    grid-area: title;\n    border-bottom: 0;\n    padding-right: 64px !important;\n  }\n\n  [data-shortcut-modal=\"settings\"] > nav {\n    grid-area: nav;\n    border-right: 0;\n    border-top: 1px solid var(--swiss-hairline);\n    border-bottom: 1px solid var(--swiss-hairline);\n    overflow-x: auto;\n    overflow-y: hidden;\n  }\n\n  [data-shortcut-modal=\"settings\"] > nav > div {\n    flex-direction: row;\n    padding: 0 !important;\n    overflow: visible;\n  }\n\n  [data-shortcut-modal=\"settings\"] > nav button {\n    width: auto;\n    border-bottom: 0;\n    border-right: 1px solid var(--swiss-hairline);\n    white-space: nowrap;\n    box-shadow: none !important;\n  }\n\n  [data-shortcut-modal=\"settings\"] > nav button[aria-current=\"true\"] {\n    box-shadow: inset 0 -3px 0 0 var(--swiss-bar) !important;\n  }\n\n  /* the header only carries the close button: float it over the title bar */\n  [data-shortcut-modal=\"settings\"] > nav + div {\n    grid-area: title;\n    align-self: start;\n    justify-self: end;\n    height: 64px;\n    padding: 0 16px !important;\n    border-bottom: 0;\n    background: transparent;\n  }\n\n  [data-shortcut-modal=\"settings\"] > nav + div + div {\n    grid-area: options;\n    padding: 20px 16px 40px !important;\n  }\n}\n\n/* ---------------------------------------------------------------------------\n   10. Accessibility.\n   --------------------------------------------------------------------------- */\n[data-shortcut-modal=\"settings\"] :focus-visible,\ndiv[role=\"presentation\"] > div[role=\"dialog\"][aria-modal=\"true\"] :focus-visible,\n.dsham_modalDialog :focus-visible {\n  outline: 2px solid var(--swiss-ink) !important;\n  outline-offset: 2px !important;\n}\n\n[data-shortcut-modal=\"settings\"] > nav button[aria-current=\"true\"]:focus-visible {\n  outline-color: var(--swiss-paper) !important;\n  outline-offset: -3px !important;\n}\n\n[data-shortcut-modal=\"settings\"] a,\ndiv[role=\"presentation\"] > div[role=\"dialog\"][aria-modal=\"true\"] a,\n.dsham_modalDialog a {\n  color: var(--swiss-ink);\n  text-decoration: underline;\n  text-decoration-thickness: 1px;\n  text-underline-offset: 2px;\n}\n\n@media (prefers-reduced-motion: reduce) {\n  [data-shortcut-modal=\"settings\"] *,\n  div[role=\"presentation\"] > div[role=\"dialog\"][aria-modal=\"true\"] *,\n  .dsham_modalDialog * {\n    transition-duration: 0s !important;\n    animation-duration: 0s !important;\n  }\n}\n\n.dsh-market {\n  color: var(--swiss-ink, #0a0a0b);\n  padding: 24px 28px;\n  min-height: 240px;\n}\n.dsh-market-header { display: flex; align-items: end; justify-content: space-between; gap: 20px; padding-bottom: 18px; border-bottom: 1px solid var(--swiss-hairline, #d8d6cf); }\n.dsh-market-header h2, .dsh-market-item h3 { margin: 0; font-size: 16px; font-weight: 600; }\n.dsh-market-header p, .dsh-market-item p { margin: 6px 0 0; font-size: 13px; line-height: 1.5; }\n.dsh-market-header input { width: min(280px, 45%); min-height: 36px; padding: 6px 10px; border: 1px solid var(--swiss-hairline, #d8d6cf); border-radius: 0; background: transparent; color: inherit; }\n.dsh-market-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr)); }\n.dsh-market-item { display: flex; align-items: center; justify-content: space-between; gap: 20px; min-width: 0; padding: 18px 0; border-bottom: 1px solid var(--swiss-hairline, #d8d6cf); }\n.dsh-market-copy { min-width: 0; }\n.dsh-market-item p { max-width: 58ch; opacity: .78; }\n.dsh-market-item code { display: inline-block; margin-top: 10px; font-size: 11px; opacity: .65; }\n.dsh-market-install { flex: 0 0 auto; min-height: 34px; padding: 0 14px; border: 1px solid currentColor; border-radius: 0; background: transparent; color: inherit; cursor: pointer; }\n.dsh-market-install:hover { background: var(--swiss-accent, #9ccc65); }\n.dsh-market-install:disabled { opacity: .5; cursor: not-allowed; }\n.dsh-market-message { padding: 24px 0; font-size: 13px; }\n@media (max-width: 640px) {\n  .dsh-market { padding: 18px 16px; }\n  .dsh-market-header { align-items: stretch; flex-direction: column; }\n  .dsh-market-header input { width: 100%; }\n}\n";
    const STYLE_ID = "dsh-ui-diy/swiss-dialogs.css";
    const PLUGIN = "dsh-ui-diy";
    const MARKET = {"mode":"production","catalogUrl":"https://raw.githubusercontent.com/zhaowendao2005-lab/dsh-extension-lab/main/marketplace.json"};
    const React = require("react");

    function MarketTab({ install }) {
      const [items, setItems] = React.useState(MARKET.extensions || []);
      const [status, setStatus] = React.useState(MARKET.mode === "development" ? "ready" : "loading");
      const [error, setError] = React.useState("");
      const [query, setQuery] = React.useState("");

      React.useEffect(() => {
        if (MARKET.mode === "development") return;
        let active = true;
        fetch(MARKET.catalogUrl, { cache: "no-store" })
          .then((response) => {
            if (!response.ok) throw new Error("目录请求失败 (" + response.status + ")");
            return response.json();
          })
          .then((catalog) => {
            if (!catalog || catalog.schemaVersion !== 1 || !Array.isArray(catalog.extensions)) {
              throw new Error("扩展清单格式无效");
            }
            const safeItems = catalog.extensions.map((item) => {
              if (!item || !/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(item.name) || !item.title || !item.version || !/^packages\/[a-z0-9._/-]+$/i.test(item.path) || item.path.includes("..")) {
                throw new Error("扩展清单包含无效条目");
              }
              const ref = item.ref || "main";
              if (typeof ref !== "string" || !/^[A-Za-z0-9._/-]+$/.test(ref) || ref.includes("..")) {
                throw new Error("扩展清单包含无效版本引用");
              }
              return { ...item, spec: "https://github.com/zhaowendao2005-lab/dsh-extension-lab.git#" + encodeURIComponent(ref) + "&path:" + item.path };
            });
            if (active) { setItems(safeItems); setStatus("ready"); }
          })
          .catch((reason) => {
            if (active) { setError(reason.message || "无法读取 GitHub 扩展清单"); setStatus("error"); }
          });
        return () => { active = false; };
      }, []);

      const visible = items.filter((item) =>
        (item.name + " " + item.title + " " + item.description).toLowerCase().includes(query.toLowerCase()),
      );
      const cards = visible.map((item) => React.createElement("article", { className: "dsh-market-item", key: item.name },
        React.createElement("div", { className: "dsh-market-copy" },
          React.createElement("h3", null, item.title),
          React.createElement("p", null, item.description),
          React.createElement("code", null, item.name + " · " + item.version),
        ),
        React.createElement("button", {
          type: "button",
          className: "dsh-market-install",
          onClick: () => install({ spec: item.spec, title: item.title, version: item.version }),
          disabled: typeof install !== "function",
        }, "安装"),
      ));

      return React.createElement("section", { className: "dsh-market" },
        React.createElement("header", { className: "dsh-market-header" },
          React.createElement("div", null,
            React.createElement("h2", null, "专属扩展"),
            React.createElement("p", null, MARKET.mode === "development" ? "开发源 · 本地链接" : "生产源 · GitHub"),
          ),
          React.createElement("input", {
            type: "search", value: query, placeholder: "搜索扩展", "aria-label": "搜索扩展",
            onChange: (event) => setQuery(event.target.value),
          }),
        ),
        status === "loading" ? React.createElement("p", { className: "dsh-market-message" }, "正在读取扩展清单…") : null,
        status === "error" ? React.createElement("p", { className: "dsh-market-message", role: "alert" }, error) : null,
        status === "ready" && cards.length ? React.createElement("div", { className: "dsh-market-list" }, cards) : null,
        status === "ready" && !cards.length ? React.createElement("p", { className: "dsh-market-message" }, items.length ? "没有匹配的扩展。" : "暂无已发布扩展。") : null,
      );
    }

    function apply(ctx) {
      ctx.effect(() => {
        const unregister = ctx.slots.inject("plugins.tab", () =>
          ctx.slots.register(
            { name: "plugins.tab", id: "dsh-extension-lab", label: "专属扩展", order: 40 },
            (owner) => React.createElement(MarketTab, owner),
          ),
        );
        return unregister;
      }, "dsh-ui-diy: private extension market");

      ctx.effect(() => {
        // Keep exactly one sheet even if a reload raced with HMR.
        for (const stale of document.querySelectorAll(
          `style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`,
        )) {
          stale.remove();
        }

        const tag = document.createElement("style");
        tag.dataset.plugin = PLUGIN;
        tag.dataset.pluginCss = STYLE_ID;
        tag.textContent = CSS;
        document.head.appendChild(tag);

        return () => {
          tag.remove();
        };
      }, "dsh-ui-diy: swiss dialog stylesheet");
    }

    module.exports.name = PLUGIN;
    module.exports.inject = [];
    module.exports.apply = apply;

    return module.exports;
  },
});
