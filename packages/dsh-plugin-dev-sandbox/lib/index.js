/**
 * dsh-plugin-dev-sandbox — host half.
 *
 * Provides the `pluginDev` service: workspace-scoped, DSH_HOME-isolated child
 * processes that a plugin author can start/stop while developing. Every child
 * is killed when the plugin is disposed, so a broken dev plugin cannot leave
 * orphan processes behind.
 */
import { createSandboxManager } from "./host.js";

export const name = "dsh-plugin-dev-sandbox";

export function apply(ctx, config = {}) {
  const workspaceRoot = config.workspaceRoot || process.cwd();
  const manager = createSandboxManager({ workspaceRoot });

  ctx.provide("pluginDev", {
    home: () => manager.home(),
    launch: (id, home) => manager.launch(id, home),
    stop: (id) => manager.stop(id),
    status: (id) => manager.status(id),
    stopAll: () => manager.stopAll(),
  });

  ctx.on("dispose", () => manager.stopAll());
}
