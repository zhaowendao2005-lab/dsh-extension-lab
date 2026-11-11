/**
 * dsh-plugin-dev-sandbox — host half.
 *
 * Provides a session-aware `pluginDev` service.
 * Every sandbox is isolated under `<workspace>/.dsh/<sessionId>/`.
 */
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";

export function getSessionSandboxRoot(workspaceRoot, sessionId) {
  return path.join(path.resolve(workspaceRoot), ".dsh", sessionId);
}

export function createSandboxManager({ workspaceRoot }) {
  const root = path.resolve(workspaceRoot);
  const instances = new Map();

  return {
    async getController(sessionId) {
      const sessionRoot = getSessionSandboxRoot(root, sessionId);
      const runtime = path.join(sessionRoot, "runtime");
      
      return {
        home: runtime,
        async launch(command = process.execPath) {
          await mkdir(runtime, { recursive: true });
          const child = spawn(command, ["-e", "setInterval(() => {}, 2 ** 30)"], {
            cwd: root,
            env: { ...process.env, DSH_HOME: runtime },
            stdio: "ignore",
          });
          child.unref();
          instances.set(sessionId, child);
          return { pid: child.pid, runtime };
        },
        stop() {
          const child = instances.get(sessionId);
          if (child) {
            child.kill();
            instances.delete(sessionId);
            return true;
          }
          return false;
        },
        status() {
          const child = instances.get(sessionId);
          return child ? { pid: child.pid, running: !child.killed } : null;
        }
      };
    },
    stopAll() {
      for (const child of instances.values()) child.kill();
      instances.clear();
    }
  };
}

export function apply(ctx, config = {}) {
  const workspaceRoot = config.workspaceRoot || process.cwd();
  const manager = createSandboxManager({ workspaceRoot });

  ctx.provide("pluginDev", {
    forSession: (sessionId) => manager.getController(sessionId),
  });

  ctx.on("dispose", () => manager.stopAll());
}
