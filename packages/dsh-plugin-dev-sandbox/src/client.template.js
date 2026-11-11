/**
 * dsh-plugin-dev-sandbox — client half (source template).
 *
 * Built by `scripts/build.mjs` into `lib/client.js`.
 *
 * Three surfaces, each registered defensively: a broken registration (an API a
 * future DSH release renamed) must not take the other two down with it.
 *   1. Plugins page → a "开发沙箱" tab describing the host-side sandbox API.
 *   2. Right sidebar → a `plugin-debug` tab type, openable from its add-tab menu.
 *   3. The tab body → sandbox paths and the host API cheat sheet.
 */
window.__ModuleLoader__.load({
  id: "dsh-plugin-dev-sandbox",
  factory: (require) => {
    const module = { exports: {} };
    const React = require("react");

    const PLUGIN = "dsh-plugin-dev-sandbox";
    const TAB_ID = PLUGIN + "/debug";
    const TAB_KIND = "plugin-debug";
    const STYLE_ID = PLUGIN + "/panel.css";

    const CSS = `
.dsh-sandbox { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }
.dsh-sandbox h2 { margin: 0; font-size: 14px; font-weight: 500; line-height: 22px; color: var(--dsw-alias-label-primary); }
.dsh-sandbox p { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
.dsh-sandbox dl { margin: 0; display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 16px; font-size: 13px; line-height: 20px; }
.dsh-sandbox dt { color: var(--dsw-alias-label-tertiary); }
.dsh-sandbox dd { margin: 0; color: var(--dsw-alias-label-primary); overflow-wrap: anywhere; }
.dsh-sandbox pre { margin: 0; padding: 12px; border: 1px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-3); font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-primary); overflow: auto; }
.dsh-sandbox ul { margin: 0; padding-left: 18px; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
`;

    /** Run one registration; log and keep going when a future DSH renames an API. */
    function safe(label, run) {
      try {
        return run();
      } catch (error) {
        console.warn(`[${PLUGIN}] ${label} unavailable:`, error);
        return undefined;
      }
    }

    function Paths() {
      return React.createElement(
        "dl",
        null,
        React.createElement("dt", null, "DSH_HOME"),
        React.createElement("dd", null, "<workspace>/.dsh_plugin_dev"),
        React.createElement("dt", null, "宿主编排"),
        React.createElement("dd", null, "ctx.pluginDev"),
        React.createElement("dt", null, "约束"),
        React.createElement("dd", null, "沙箱目录必须位于工作区内"),
      );
    }

    const API_SHEET = [
      'const info = await ctx.pluginDev.launch("exp-1")',
      "// → { id, pid, dshHome }",
      'ctx.pluginDev.status("exp-1")   // → { id, pid, running } | null',
      'ctx.pluginDev.stop("exp-1")     // → true | false',
      "ctx.pluginDev.home()            // → <workspace>/.dsh_plugin_dev",
    ].join("\n");

    function SandboxTab() {
      return React.createElement(
        "section",
        { className: "dsh-sandbox" },
        React.createElement("h2", null, "插件开发沙箱"),
        React.createElement(
          "p",
          null,
          "为插件开发提供一个与真实 profile 隔离的运行目录。宿主侧已提供 pluginDev 服务，",
          "每一次调试都把 DSH_HOME 指向工作区内的沙箱目录，插件 dispose 时自动回收子进程。",
        ),
        React.createElement(Paths),
        React.createElement("pre", null, API_SHEET),
        React.createElement(
          "p",
          null,
          "客户端这一侧目前只做说明与状态呈现：右侧边栏 Plugin Debug 标签页展示同一份信息。",
        ),
      );
    }

    function DebugPanel() {
      return React.createElement(
        "section",
        { className: "dsh-sandbox" },
        React.createElement("h2", null, "Plugin Debug"),
        React.createElement(Paths),
        React.createElement(
          "ul",
          null,
          React.createElement("li", null, "宿主服务：ctx.pluginDev"),
          React.createElement("li", null, "子进程环境：DSH_HOME=<workspace>/.dsh_plugin_dev"),
          React.createElement("li", null, "停止方式：ctx.pluginDev.stop(id) 或插件卸载"),
        ),
      );
    }

    function GuideEntry() {
      return React.createElement("span", null, "插件开发沙箱");
    }

    function apply(ctx) {
      safe("stylesheet", () =>
        ctx.effect(
          () => {
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
          },
          `${PLUGIN}: panel stylesheet`,
        ),
      );

      // 1. Plugins page tab — the same seat extension-lab-manager uses.
      safe("plugins.tab", () =>
        ctx.effect(
          () =>
            ctx.slots.inject("plugins.tab", () =>
              ctx.slots.register(
                { name: "plugins.tab", id: PLUGIN, label: "开发沙箱", order: 60 },
                SandboxTab,
              ),
            ),
          `${PLUGIN}: plugins tab`,
        ),
      );

      // 2. Right sidebar tab type + its add-tab guide entry.
      safe("sidebarRightTabs.register", () =>
        ctx.effect(
          () =>
            ctx.sidebarRightTabs.register({
              id: TAB_ID,
              kind: TAB_KIND,
              multiple: false,
              priority: "extension",
              title: () => "Plugin Debug",
              guide: [
                {
                  id: "open",
                  order: 50,
                  title: () => "Plugin Debug",
                  description: () => "插件开发沙箱",
                },
              ],
            }),
          `${PLUGIN}: right tab type`,
        ),
      );

      safe("sidebar.right.tab.guide.entry", () =>
        ctx.effect(
          () =>
            ctx.slots.inject("sidebar.right.tab.guide.entry", () =>
              ctx.slots.register({ name: "sidebar.right.tab.guide.entry", key: TAB_ID }, GuideEntry),
            ),
          `${PLUGIN}: right tab guide`,
        ),
      );

      safe("sidebar.right.pane.tab", () =>
        ctx.effect(
          () =>
            ctx.slots.inject("sidebar.right.pane.tab", () =>
              ctx.slots.register({ name: "sidebar.right.pane.tab", key: TAB_ID }, DebugPanel),
            ),
          `${PLUGIN}: right tab body`,
        ),
      );
    }

    module.exports.name = PLUGIN;
    module.exports.inject = ["slots"];
    module.exports.apply = apply;
    return module.exports;
  },
});
