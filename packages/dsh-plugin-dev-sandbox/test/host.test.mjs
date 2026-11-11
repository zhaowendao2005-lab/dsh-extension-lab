import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { sandboxHome, resolveSandboxHome, createSandboxManager } from "../src/host.js";

test("sandboxHome is workspace-scoped", () => {
  assert.equal(sandboxHome("/tmp/project"), path.join("/tmp/project", ".dsh_plugin_dev"));
  assert.equal(resolveSandboxHome("/tmp/project", undefined), path.join("/tmp/project", ".dsh_plugin_dev"));
});

test("resolveSandboxHome rejects paths outside workspace", () => {
  assert.throws(() => resolveSandboxHome("/tmp/project", "/tmp/other"), /inside the workspace/);
});

test("manager launches a child with isolated DSH_HOME and stops it", async () => {
  const manager = createSandboxManager({ workspaceRoot: "/tmp/project" });
  const result = await manager.launch("test", "/tmp/project/.dsh_plugin_dev");
  assert.equal(result.dshHome, "/tmp/project/.dsh_plugin_dev");
  assert.ok(Number.isInteger(result.pid));
  assert.equal(manager.status("test").running, true);
  assert.equal(manager.stop("test"), true);
});
