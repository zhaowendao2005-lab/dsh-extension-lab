/**
 * dsh-plugin-dev-sandbox — client half.
 *
 * Session-aware UI:
 * Registers a dynamic panel in the right sidebar tab that only renders when
 * the current session is configured for development.
 */
window.__ModuleLoader__.load({
  id: "dsh-plugin-dev-sandbox",
  factory: (require) => {
    const module = { exports: {} };
    const React = require("react");
    const PLUGIN = "dsh-plugin-dev-sandbox";
    const TAB_ID = PLUGIN + "/debug";

    // 状态钩子：模拟对 Session 沙箱状态的感知
    // 在生产环境应通过 ctx.remote.pluginDev.forSession(sessionId).status() 轮询
    function useSandbox(ctx, sessionId) {
      const [status, setStatus] = React.useState(null);
      React.useEffect(() => {
        const check = async () => {
          const ctrl = await ctx.remote.pluginDev.forSession(sessionId);
          setStatus(await ctrl.status());
        };
        check();
        const interval = setInterval(check, 2000);
        return () => clearInterval(interval);
      }, [sessionId]);
      return status;
    }

    function DebugPanel({ sessionId }) {
      const status = useSandbox(undefined, sessionId); // 实际需通过 inject 获取 ctx

      return React.createElement("div", { className: "dsh-sandbox" },
        React.createElement("h2", null, "Session Sandbox"),
        React.createElement("p", null, "ID: " + sessionId),
        status 
          ? React.createElement("pre", null, "Running (PID: " + status.pid + ")")
          : React.createElement("button", { onClick: () => {} }, "启动沙箱")
      );
    }

    function apply(ctx) {
      // 注册右侧 Tab 定义
      ctx.sidebarRightTabs.register({
        id: TAB_ID,
        kind: "plugin-debug",
        multiple: false,
        priority: "extension",
        title: () => "Debug",
      });

      // 注册 Tab 实体：绑定到 session 的动态内容
      ctx.slots.inject("sidebar.right.pane.tab", () => 
        ctx.slots.register({
          name: "sidebar.right.pane.tab",
          key: TAB_ID,
          inject: (sessionId) => ({ sessionId })
        }, DebugPanel)
      );
    }

    module.exports.name = PLUGIN;
    module.exports.inject = ["slots", "sidebarRight", "sidebarRightTabs", "remote"];
    module.exports.apply = apply;
    return module.exports;
  }
});
