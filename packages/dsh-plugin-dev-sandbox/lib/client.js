/** dsh-plugin-dev-sandbox client bundle. */
window.__ModuleLoader__.load({
  id: "dsh-plugin-dev-sandbox",
  factory: (require) => {
    const module = { exports: {} };
    const React = require("react");
    const ID = "dsh-plugin-dev-sandbox";
    const RIGHT_ID = ID + "/debug";

    function CodePanel() {
      return React.createElement("section", { className: "dsh-plugin-dev-code" },
        React.createElement("h2", null, "Plugin Code"),
        React.createElement("p", null, "Workspace plugin files"),
        React.createElement("code", null, ".dsh_plugin_dev"));
    }

    function DebugGuide({ openTerminal }) {
      return React.createElement("section", { className: "dsh-plugin-dev-debug" },
        React.createElement("h2", null, "Plugin Debug"),
        React.createElement("button", { type: "button", onClick: openTerminal }, "Open shell"),
        React.createElement("ul", null,
          React.createElement("li", null, "Load plugin"),
          React.createElement("li", null, "Reload plugin"),
          React.createElement("li", null, "Inspect commands")));
    }

    function apply(ctx) {
      ctx.effect(() => ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
        name: "sidebar.panellist", id: ID, label: "Plugin Sandbox", order: 100
      }, () => React.createElement("span", null, "Plugin Sandbox"))), "plugin-dev-sandbox.sidebar");

      ctx.effect(() => ctx.slots.inject("main", () => ctx.slots.register({
        name: "main", id: ID, label: "Plugin Code", order: 100
      }, () => React.createElement(CodePanel))), "plugin-dev-sandbox.code");

      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: RIGHT_ID, kind: "plugin-debug", multiple: false, priority: "user",
        title: () => "Plugin Debug",
        guide: [{ id: "debug", order: 10, title: () => "Plugin Debug" }]
      }), "plugin-dev-sandbox.right-tab");

      ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
        name: "sidebar.right.pane.tab", key: RIGHT_ID,
        inject: (sessionId) => ({
          openTerminal: () => {
            const key = "plugin-dev-shell";
            const contentId = "plugin-dev-shell-content";
            return ctx.webTerminals.view(sessionId, key, contentId, ID + "/terminal");
          }
        })
      }, DebugGuide)), "plugin-dev-sandbox.right-pane");

      ctx.effect(() => ctx.sidebarRight.registerCloseHandler("plugin-debug", (sessionId, tab) => {
        if (tab && tab.contentId) ctx.webTerminals.close(sessionId, tab.id, tab.contentId, ID + "/terminal");
      }), "plugin-dev-sandbox.close");
    }

    module.exports.name = ID;
    module.exports.inject = ["slots", "sidebarRight", "sidebarRightTabs", "webTerminals"];
    module.exports.apply = apply;
    return module.exports;
  }
});
