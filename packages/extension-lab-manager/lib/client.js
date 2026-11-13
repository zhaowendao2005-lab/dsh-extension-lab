/**
 * extension-lab-manager — client half (source template).
 *
 * Built by `scripts/build.mjs` into `lib/client.js`.
 * Provides the 专属扩展 tab on the Plugins page, with per-card install state
 * derived from listBundles() and github: shorthand specs for correct host tracking.
 */
window.__ModuleLoader__.load({
  id: "extension-lab-manager",
  factory: (require) => {
    const module = { exports: {} };
    const React = require("react");
    const MARKET = {"mode":"production","catalogUrl":"https://raw.githubusercontent.com/zhaowendao2005-lab/dsh-extension-lab/main/marketplace.json"};
    const CSS = "/* extension-lab-manager custom tab styling */\n.dsh-market {\n  display: flex;\n  flex-direction: column;\n  gap: 24px;\n}\n\n.dsh-market-header {\n  display: flex;\n  justify-content: space-between;\n  align-items: flex-start;\n  gap: 16px;\n  flex-wrap: wrap;\n}\n\n.dsh-market-header > div {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n\n.dsh-market-header h2 {\n  margin: 0;\n  font-size: 14px;\n  font-weight: 500;\n  line-height: 22px;\n  color: var(--dsw-alias-label-primary);\n}\n\n.dsh-market-header p {\n  margin: 0;\n  font-size: 13px;\n  line-height: 20px;\n  color: var(--dsw-alias-label-secondary);\n}\n\n.dsh-market-header input[type=\"search\"] {\n  border: 0.5px solid var(--dsw-alias-border-l4);\n  border-radius: var(--dsw-radius-md);\n  background: var(--dsw-alias-bg-layer-3);\n  height: 32px;\n  font: inherit;\n  color: var(--dsw-alias-label-primary);\n  outline: none;\n  padding: 0 12px;\n  font-size: 13px;\n  width: 240px;\n}\n\n.dsh-market-header input[type=\"search\"]:focus {\n  border-color: var(--dsw-alias-state-business-primary);\n  box-shadow: inset 0 0 0 0.5px var(--dsw-alias-state-business-primary);\n}\n\n.dsh-market-message {\n  color: var(--dsw-alias-label-tertiary);\n  margin: 0;\n  font-size: 13px;\n  line-height: 20px;\n}\n\n.dsh-market-message[role=\"alert\"] {\n  color: var(--dsw-alias-state-error-primary);\n}\n\n.dsh-market-list {\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n  margin: 0;\n  padding: 0;\n  list-style: none;\n}\n\n.dsh-market-item {\n  border-radius: var(--dsw-radius-xl);\n  margin: 0 -8px;\n  min-width: 0;\n  display: flex;\n  align-items: center;\n  gap: 14px;\n  padding: 8px;\n}\n\n.dsh-market-copy {\n  display: flex;\n  flex-direction: column;\n  flex: 1;\n  gap: 4px;\n  min-width: 0;\n}\n\n.dsh-market-copy h3 {\n  margin: 0;\n  font-size: 14px;\n  font-weight: 500;\n  line-height: 20px;\n  color: var(--dsw-alias-label-primary);\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  overflow: hidden;\n}\n\n.dsh-market-copy p {\n  margin: 0;\n  font-size: 13px;\n  line-height: 18px;\n  color: var(--dsw-alias-label-tertiary);\n  display: -webkit-box;\n  -webkit-line-clamp: 1;\n  -webkit-box-orient: vertical;\n  overflow: hidden;\n}\n\n.dsh-market-copy code {\n  font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n  line-height: 18px;\n  overflow-wrap: anywhere;\n}\n\n.dsh-market-state {\n  color: var(--dsw-alias-label-secondary);\n  flex: none;\n  white-space: nowrap;\n  font-size: 12.5px;\n  line-height: 18px;\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n}\n\n.dsh-market-install {\n  border-radius: var(--dsw-radius-md);\n  height: 32px;\n  padding: 0 12px;\n  font-size: 13px;\n  line-height: 20px;\n  flex: none;\n}\n\n/*\n * The plugins page can place tab content inside a multi-column track (some host\n * builds render settings sections as a 2-up grid). Keep the catalog a single\n * full-width column so cards never share a row and copy never clips mid-word.\n */\n.dsh-market,\n.dsh-market-list {\n  display: flex !important;\n  flex-direction: column !important;\n  flex-wrap: nowrap !important;\n  grid-template-columns: minmax(0, 1fr) !important;\n  column-count: 1 !important;\n  width: 100%;\n}\n\n.dsh-market-item {\n  width: 100%;\n  grid-column: 1 / -1;\n}\n";
    const STYLE_ID = "extension-lab-manager/market.css";
    const PLUGIN = "extension-lab-manager";

    // ---------------------------------------------------------------------------
    // Spec generation — always use the github: shorthand so the host can match
    // the spec against the profile's recorded "github:..." dependency.
    // ---------------------------------------------------------------------------
    function toSpec(item) {
      if (
        !item ||
        !/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(item.name || "") ||
        !item.title ||
        !item.version ||
        !/^packages\/[a-z0-9._/-]+$/i.test(item.path || "") ||
        item.path.includes("..")
      ) {
        throw new Error("扩展清单包含无效条目");
      }
      // Explicit specs are authoritative. The catalog is fetched remotely, so reject
      // empty or whitespace-containing values before passing them to the Host.
      if (item.spec) {
        if (typeof item.spec !== "string" || !item.spec.trim() || /\s/.test(item.spec)) {
          throw new Error("扩展清单包含无效安装地址");
        }
        return item.spec;
      }
      const ref = item.ref || "main";
      if (typeof ref !== "string" || !/^[A-Za-z0-9._/-]+$/.test(ref) || ref.includes("..")) {
        throw new Error("扩展清单包含无效版本引用");
      }
      return "github:zhaowendao2005-lab/dsh-extension-lab#" + ref + "&path:/" + item.path;
    }

    // ---------------------------------------------------------------------------
    // State derivation — compare catalog entries against installed bundles.
    // ---------------------------------------------------------------------------
    function deriveState(item, bundles) {
      if (!bundles) return "loading";
      const bundle = bundles.find((b) => b.name === item.name);
      if (!bundle || !bundle.installed) return "installable";
      if (bundle.version && item.version && bundle.version !== item.version) return "updatable";
      return "installed";
    }

    const STATE_LABEL = {
      installed: "已安装",
      updatable: "待更新",
      installable: "可安装",
      loading: "…",
    };
    const STATE_BTN = {
      installed: "重新安装",
      updatable: "更新",
      installable: "安装",
      loading: "安装",
    };

    // ---------------------------------------------------------------------------
    // MarketTab component — receives install + listBundles from apply()
    // ---------------------------------------------------------------------------
    function MarketTab({ install, listBundles }) {
      const [items, setItems] = React.useState(MARKET.extensions || []);
      const [status, setStatus] = React.useState(
        MARKET.mode === "development" ? "ready" : "loading",
      );
      const [fetchError, setFetchError] = React.useState("");
      const [query, setQuery] = React.useState("");
      const [bundles, setBundles] = React.useState(null);

      function refreshBundles() {
        if (!listBundles) return;
        listBundles()
          .then((result) => {
            if (result.ok) setBundles(result.value);
          })
          .catch(() => {});
      }

      // Fetch catalog (production mode)
      React.useEffect(() => {
        if (MARKET.mode === "development") return;
        let active = true;
        fetch(MARKET.catalogUrl, { cache: "no-store" })
          .then((r) => {
            if (!r.ok) throw new Error("目录请求失败 (" + r.status + ")");
            return r.json();
          })
          .then((catalog) => {
            if (!catalog || catalog.schemaVersion !== 1 || !Array.isArray(catalog.extensions))
              throw new Error("扩展清单格式无效");
            if (active) {
              setItems(catalog.extensions);
              setStatus("ready");
            }
          })
          .catch((e) => {
            if (active) {
              setFetchError(e.message || "无法读取 GitHub 扩展清单");
              setStatus("error");
            }
          });
        return () => {
          active = false;
        };
      }, []);

      // Refresh bundle state whenever catalog first becomes ready, and on mount
      React.useEffect(() => {
        refreshBundles();
      }, [status]);

      const visible = items.filter((item) =>
        (item.name + " " + item.title + " " + (item.description || ""))
          .toLowerCase()
          .includes(query.toLowerCase()),
      );

      return React.createElement(
        "section",
        { className: "dsh-market" },
        React.createElement(
          "header",
          { className: "dsh-market-header" },
          React.createElement(
            "div",
            null,
            React.createElement("h2", null, "专属扩展"),
            React.createElement(
              "p",
              null,
              MARKET.mode === "development" ? "开发源 · 本地链接" : "生产源 · GitHub",
            ),
          ),
          React.createElement("input", {
            type: "search",
            value: query,
            placeholder: "搜索扩展",
            "aria-label": "搜索扩展",
            onChange: (e) => setQuery(e.target.value),
          }),
        ),
        status === "loading"
          ? React.createElement("p", { className: "dsh-market-message" }, "正在读取扩展清单…")
          : null,
        status === "error"
          ? React.createElement(
              "p",
              { className: "dsh-market-message", role: "alert" },
              fetchError,
            )
          : null,
        status === "ready"
          ? React.createElement(
              "div",
              { className: "dsh-market-list" },
              visible.map((item) => {
                const state = deriveState(item, bundles);
                const isInstalled = state === "installed";
                return React.createElement(
                  "article",
                  { className: "dsh-market-item", key: item.name },
                  React.createElement(
                    "div",
                    { className: "dsh-market-copy" },
                    React.createElement("h3", null, item.title),
                    item.description
                      ? React.createElement("p", null, item.description)
                      : null,
                    React.createElement("code", null, item.name + " · " + item.version),
                  ),
                  state !== "loading"
                    ? React.createElement(
                        "span",
                        { className: "dsh-market-state", "data-state": state },
                        STATE_LABEL[state],
                      )
                    : null,
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: "dsh-market-install",
                      "data-variant": isInstalled ? "outline" : "primary",
                      onClick: () => {
                        try {
                          install({ spec: toSpec(item), title: item.title, version: item.version });
                          // Re-check bundle state after the install wizard has time to settle
                          setTimeout(refreshBundles, 1500);
                          setTimeout(refreshBundles, 5000);
                        } catch (e) {
                          console.error("[extension-lab-manager]", e);
                        }
                      },
                      disabled: typeof install !== "function",
                    },
                    STATE_BTN[state] || "安装",
                  ),
                );
              }),
            )
          : null,
      );
    }

    // ---------------------------------------------------------------------------
    // Plugin apply
    // ---------------------------------------------------------------------------
    function apply(ctx) {
      // Inject stylesheet
      ctx.effect(() => {
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
        return () => tag.remove();
      }, "extension-lab-manager: market stylesheet");

      // Provide a stable function that fetches bundle state from within the
      // correct fiber so that remote.pluginManager is in scope.
      function listBundles() {
        return ctx.remote.pluginManager.listBundles();
      }

      // Register tab slot
      ctx.effect(
        () =>
          ctx.slots.inject("plugins.tab", () =>
            ctx.slots.register(
              { name: "plugins.tab", id: PLUGIN, label: "专属扩展", order: 40 },
              (owner) => React.createElement(MarketTab, { ...owner, listBundles }),
            ),
          ),
        "extension-lab-manager: extension market",
      );
    }

    module.exports.name = PLUGIN;
    module.exports.inject = ["slots", "remote", "remote.pluginManager"];
    module.exports.apply = apply;
    return module.exports;
  },
});
