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
    const MARKET = __MARKET_CONFIG__;
    const CSS = __MARKET_CSS__;
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
