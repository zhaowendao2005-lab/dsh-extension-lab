import path from "node:path";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";

export function sandboxHome(workspaceRoot) {
  if (typeof workspaceRoot !== "string" || !workspaceRoot) throw new TypeError("workspaceRoot is required");
  return path.join(path.resolve(workspaceRoot), ".dsh_plugin_dev");
}

export function resolveSandboxHome(workspaceRoot, requested) {
  const root = path.resolve(workspaceRoot);
  const home = path.resolve(requested || sandboxHome(root));
  if (home !== root && !home.startsWith(root + path.sep)) {
    throw new Error("Invalid DSH_HOME: path must be inside the workspace");
  }
  return home;
}

export function createSandboxManager({ workspaceRoot, command = process.execPath } = {}) {
  const root = path.resolve(workspaceRoot || process.cwd());
  const children = new Map();
  return {
    home: () => sandboxHome(root),
    async launch(id = "default", requestedHome) {
      if (!id || typeof id !== "string") throw new TypeError("sandbox id is required");
      const home = resolveSandboxHome(root, requestedHome);
      await mkdir(home, { recursive: true });
      const child = spawn(command, ["-e", "setInterval(() => {}, 2 ** 30)"], {
        cwd: root,
        env: { ...process.env, DSH_HOME: home },
        stdio: "ignore",
      });
      child.unref();
      children.set(id, child);
      child.once("exit", () => children.delete(id));
      return { id, pid: child.pid, dshHome: home };
    },
    stop(id) {
      const child = children.get(id);
      if (!child) return false;
      children.delete(id);
      return child.kill();
    },
    status(id) {
      const child = children.get(id);
      return child ? { id, pid: child.pid, running: !child.killed } : null;
    },
    stopAll() {
      for (const id of children.keys()) this.stop(id);
    },
  };
}

export class SandboxHost {
  static inject = ["logger"];
  constructor(ctx, config = {}) {
    this.ctx = ctx;
    this.manager = createSandboxManager({ workspaceRoot: config.workspaceRoot || process.cwd() });
  }
  launch(id, requestedHome) { return this.manager.launch(id, requestedHome); }
  stop(id) { return this.manager.stop(id); }
}
