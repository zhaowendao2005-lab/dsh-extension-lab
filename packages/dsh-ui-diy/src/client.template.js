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

    const CSS = __SWISS_CSS__;
    const STYLE_ID = "dsh-ui-diy/swiss-dialogs.css";
    const PLUGIN = "dsh-ui-diy";
    const MARKET = __MARKET_CONFIG__;
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
              return { ...item, spec: "git+https://github.com/zhaowendao2005-lab/dsh-extension-lab.git#" + ref + "&path:/" + item.path };
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
    module.exports.inject = ["slots"];
    module.exports.apply = apply;

    return module.exports;
  },
});
