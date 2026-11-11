import { createSandboxManager } from "./host.js";

export const name = "dsh-plugin-dev-sandbox";
export const Config = {
  pluginPath: { type: "string", default: ".dsh_plugin_dev" }
};

export function apply(ctx, config = {}) {
  const workspaceRoot = config.workspaceRoot || process.cwd();
  const manager = createSandboxManager({ workspaceRoot });
  ctx.provide("pluginDev", {
    home: () => manager.home(),
    launch: (id, home) => manager.launch(id, home),
    stop: (id) => manager.stop(id),
    status: (id) => manager.status(id),
  });
  ctx.on("dispose", () => manager.stopAll());
}
