import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm, symlink, link, chmod, unlink, stat } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { runInNewContext } from "node:vm";
import { createSandboxManager } from "../src/host.js";

const nodeSpec = (source) => ({ command: process.execPath, args: ["-e", source] });
const hold = nodeSpec("setInterval(() => {}, 1000)");

async function fixture(t, options = {}) {
  const tempRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), "dsh-sandbox-test-")));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const pluginPath = path.join(workspaceRoot, "packages", "alpha");
  await mkdir(pluginPath, { recursive: true });
  const manifest = { name: "test-alpha", type: "module", main: "./index.js", scripts: { build: "node build.js", watch: "node watch.js", test: "node --test" } };
  await writeFile(path.join(pluginPath, "package.json"), JSON.stringify(manifest));
  await writeFile(path.join(pluginPath, "index.js"), "export default {};\n");
  const managers = [];
  const makeManager = (extra = {}) => {
    const manager = createSandboxManager({ launchSpec: hold, commandSpec: hold, stopTimeoutMs: 150, ...options, ...extra });
    managers.push(manager);
    return manager;
  };
  const manager = makeManager();
  const input = { workspaceRoot, sessionId: "session-a" };
  const base = path.join(workspaceRoot, ".dsh", "plugin-dev", input.sessionId);
  t.after(async () => {
    await Promise.all(managers.map((item) => item.dispose()));
    const resolved = path.resolve(tempRoot);
    assert.equal(path.dirname(resolved), await realpath(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith("dsh-sandbox-test-"));
    await rm(resolved, { recursive: true, force: true });
  });
  return { tempRoot, workspaceRoot, pluginPath, manifest, manager, makeManager, input, base,
    bind: () => manager.bind({ ...input, pluginPath }) };
}

async function until(read, predicate, message = "condition was not reached") {
  const deadline = Date.now() + 4000;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (predicate(value)) return value;
    await delay(15);
  }
  assert.fail(`${message}: ${JSON.stringify(value)}`);
}

function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === "ESRCH") return false; throw error; }
}

async function stopped(pid) {
  await until(async () => alive(pid), (value) => !value, `process ${pid} still exists`);
}

function text(snapshot) { return snapshot.logs.map((entry) => entry.text).join(""); }

test("status is read-only; binding persists only a canonical plugin path per session", async (t) => {
  const f = await fixture(t);
  const initial = await f.manager.status(f.input);
  assert.equal(initial.binding, null);
  assert.deepEqual(initial.commands, []);
  assert.equal(initial.runtime.state, "stopped");
  assert.equal(initial.command.state, "idle");
  await assert.rejects(stat(path.join(f.workspaceRoot, ".dsh")), { code: "ENOENT" });
  const bound = await f.bind();
  assert.deepEqual(bound.binding, { sessionId: "session-a", pluginPath: f.pluginPath, name: "test-alpha" });
  assert.deepEqual(bound.commands, [
    { id: "build", title: "build", command: "node build.js" },
    { id: "watch", title: "watch", command: "node watch.js" },
    { id: "test", title: "test", command: "node --test" },
  ]);
  assert.equal(bound.runtime.dshHome, path.join(f.base, "runtime"));
  assert.deepEqual(JSON.parse(await readFile(path.join(f.base, "binding.json"), "utf8")), { pluginPath: f.pluginPath });
  const launched = await f.manager.launch(f.input);
  assert.equal(launched.runtime.state, "running");
  const restored = await f.makeManager().status(f.input);
  assert.deepEqual(restored.binding, bound.binding);
  assert.equal(restored.runtime.state, "stopped");
  assert.equal(restored.runtime.pid, null);
  assert.equal(restored.runtime.url, null);
});

test("manager requires an explicit absolute workspace and a safe session id", async (t) => {
  const f = await fixture(t);
  for (const workspaceRoot of [undefined, null, "", ".", "relative/project"]) {
    await assert.rejects(f.manager.status({ workspaceRoot, sessionId: "safe" }), /explicit absolute path/);
  }
  for (const sessionId of [undefined, null, "", ".", "..", "../escape", "a/b", "a\\b", "a.b", "-bad", "a\nb", "é", "a".repeat(129)]) {
    await assert.rejects(f.manager.status({ workspaceRoot: f.workspaceRoot, sessionId }), /Invalid sessionId/);
  }
  assert.equal((await f.manager.status({ workspaceRoot: f.workspaceRoot, sessionId: "A_01-test" })).binding, null);
});

test("independent sessions bind different packages and cannot stop or unbind one another", async (t) => {
  const f = await fixture(t);
  const secondPlugin = path.join(f.workspaceRoot, "packages", "beta");
  await mkdir(secondPlugin);
  await writeFile(path.join(secondPlugin, "package.json"), JSON.stringify({ name: "test-beta", main: "index.js", scripts: { lint: "eslint ." } }));
  await writeFile(path.join(secondPlugin, "index.js"), "module.exports = {};\n");
  const second = { ...f.input, sessionId: "session-b" };
  await f.bind();
  assert.equal((await f.manager.status(second)).binding, null);
  await assert.rejects(f.manager.launch(second), /No plugin is bound/);
  await f.manager.bind({ ...second, pluginPath: secondPlugin });
  const [a, b] = await Promise.all([f.manager.launch(f.input), f.manager.launch(second)]);
  assert.notEqual(a.runtime.pid, b.runtime.pid);
  assert.notEqual(a.runtime.dshHome, b.runtime.dshHome);
  await f.manager.unbind(f.input);
  await stopped(a.runtime.pid);
  assert.equal((await f.manager.status(f.input)).binding, null);
  const stillRunning = await f.manager.status(second);
  assert.equal(stillRunning.binding.pluginPath, secondPlugin);
  assert.equal(stillRunning.runtime.pid, b.runtime.pid);
  assert.ok(alive(b.runtime.pid));
});

test("the same session id in different workspaces is a different process owner", async (t) => {
  const f = await fixture(t);
  const g = await fixture(t);
  await f.bind();
  await f.manager.bind({ ...g.input, pluginPath: g.pluginPath });
  const a = await f.manager.launch(f.input);
  const b = await f.manager.launch(g.input);
  assert.notEqual(a.runtime.pid, b.runtime.pid);
  await f.manager.stop(g.input);
  await stopped(b.runtime.pid);
  assert.ok(alive(a.runtime.pid));
});

test("plugin validation rejects external real paths, escaped links, and invalid manifests", async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.tempRoot, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "package.json"), JSON.stringify({ name: "outside" }));
  await symlink(outside, path.join(f.workspaceRoot, "escape"));
  for (const pluginPath of [outside, "../outside", "escape"]) {
    await assert.rejects(f.manager.bind({ ...f.input, pluginPath }), /inside the workspace/);
  }
  for (const invalid of [null, [], {}, { name: "" }, { name: "bad", scripts: [] }, { name: "bad", scripts: { build: 1 } }]) {
    await writeFile(path.join(f.pluginPath, "package.json"), JSON.stringify(invalid));
    await assert.rejects(f.bind(), /Invalid package.json/);
  }
  await writeFile(path.join(f.pluginPath, "package.json"), "{");
  await assert.rejects(f.bind(), SyntaxError);
  await assert.rejects(f.manager.bind({ ...f.input, pluginPath: "" }), /pluginPath is required/);
});

test("relative plugin paths and internal links are canonicalized inside the workspace", async (t) => {
  const f = await fixture(t);
  await symlink(f.pluginPath, path.join(f.workspaceRoot, "local-link"));
  const bound = await f.manager.bind({ ...f.input, pluginPath: "local-link" });
  assert.equal(bound.binding.pluginPath, f.pluginPath);
});

test("all sandbox path components reject symlinks before any write", async (t) => {
  for (const relative of [".dsh", ".dsh/plugin-dev", ".dsh/plugin-dev/session-a", ".dsh/plugin-dev/session-a/runtime", ".dsh/plugin-dev/session-a/runtime/home"]) {
    await t.test(relative, async (t) => {
      const f = await fixture(t);
      const target = path.join(f.workspaceRoot, relative);
      const outside = path.join(f.tempRoot, "outside");
      await mkdir(outside);
      await mkdir(path.dirname(target), { recursive: true });
      await symlink(outside, target);
      await assert.rejects(f.bind(), /Unsafe sandbox directory/);
      await assert.rejects(stat(path.join(outside, "binding.json")), { code: "ENOENT" });
    });
  }
});

test("binding, overlay, and manifest reject symlink and hard-link write/read tricks", async (t) => {
  for (const name of ["binding.json", "overlay.yml"]) {
    for (const kind of ["symlink", "hardlink"]) {
      await t.test(`${name} ${kind}`, async (t) => {
        const f = await fixture(t);
        await mkdir(f.base, { recursive: true });
        const outside = path.join(f.tempRoot, "protected.json");
        await writeFile(outside, "do not touch");
        if (kind === "symlink") await symlink(outside, path.join(f.base, name));
        else await link(outside, path.join(f.base, name));
        await assert.rejects(f.bind(), /Unsafe file/);
        await assert.rejects(f.manager.unbind(f.input), /Unsafe file/);
        assert.equal(await readFile(outside, "utf8"), "do not touch");
      });
    }
  }
  await t.test("manifest symlink", async (t) => {
    const f = await fixture(t);
    const manifestPath = path.join(f.pluginPath, "package.json");
    const outside = path.join(f.tempRoot, "manifest.json");
    await writeFile(outside, JSON.stringify(f.manifest));
    assert.equal(path.resolve(manifestPath), path.join(f.pluginPath, "package.json"));
    await unlink(manifestPath);
    await symlink(outside, manifestPath);
    await assert.rejects(f.bind(), /Unsafe file/);
  });
});

test("a symlink introduced after binding is rechecked before launch", async (t) => {
  const f = await fixture(t);
  await f.bind();
  const overlayPath = path.join(f.base, "overlay.yml");
  const outside = path.join(f.tempRoot, "protected-overlay");
  await writeFile(outside, "original");
  await symlink(outside, overlayPath);
  await assert.rejects(f.manager.launch(f.input), /Unsafe file/);
  assert.equal(await readFile(outside, "utf8"), "original");
});

test("launch requires a current valid binding, not an in-memory stale copy", async (t) => {
  const f = await fixture(t);
  await f.bind();
  const bindingPath = path.join(f.base, "binding.json");
  assert.equal(path.resolve(bindingPath), path.join(f.base, "binding.json"));
  await unlink(bindingPath);
  await assert.rejects(f.manager.launch(f.input), /No plugin is bound/);
  await f.bind();
  await writeFile(bindingPath, JSON.stringify({ pluginPath: f.pluginPath, sessionId: "session-b" }));
  await assert.rejects(f.manager.status(f.input), /Invalid binding.json/);
});

test("launch makes a quoted file URL overlay from conditional exports without touching a parent profile", async (t) => {
  let captured;
  const f = await fixture(t, { launchSpec: (ctx) => { captured = ctx; return hold; } });
  await mkdir(path.join(f.pluginPath, "entry dir"));
  const entry = path.join(f.pluginPath, "entry dir", "plugin #1.js");
  await writeFile(entry, "export default {};\n");
  await writeFile(path.join(f.pluginPath, "package.json"), JSON.stringify({ ...f.manifest,
    exports: { ".": { node: { import: "./entry dir/plugin #1.js" }, default: "./index.js" } } }));
  const profile = path.join(f.tempRoot, "parent-profile");
  await mkdir(profile);
  await writeFile(path.join(profile, "config.yml"), "secret-parent-profile");
  await f.bind();
  const launched = await f.manager.launch(f.input);
  assert.equal(launched.runtime.state, "running");
  assert.equal(captured.runtimeHome, path.join(f.base, "runtime"));
  assert.equal(captured.pluginPath, f.pluginPath);
  const overlay = await readFile(captured.overlayPath, "utf8");
  assert.match(overlay, /- insert:/);
  assert.match(overlay, /id: "plugin-dev-session-a"/);
  assert.match(overlay, /file:\/\/.*entry%20dir\/plugin%20%231\.js/);
  assert.equal(await readFile(path.join(profile, "config.yml"), "utf8"), "secret-parent-profile");
});

test("missing or escaped plugin entry fails launch with useful state, no placeholder child", async (t) => {
  const f = await fixture(t);
  await f.bind();
  await writeFile(path.join(f.pluginPath, "package.json"), JSON.stringify({ ...f.manifest, main: "missing.js" }));
  const missing = await f.manager.launch(f.input);
  assert.equal(missing.runtime.state, "error");
  assert.equal(missing.runtime.pid, null);
  assert.match(missing.runtime.error, /ENOENT/);
  const outside = path.join(f.tempRoot, "outside.js");
  await writeFile(outside, "module.exports = {};\n");
  await symlink(outside, path.join(f.pluginPath, "escape.js"));
  await writeFile(path.join(f.pluginPath, "package.json"), JSON.stringify({ ...f.manifest, main: "escape.js" }));
  const escaped = await f.manager.launch(f.input);
  assert.equal(escaped.runtime.state, "error");
  assert.match(escaped.runtime.error, /inside its package/);
});

test("concurrent repeated launches and runs are idempotent; runtime and command may coexist", async (t) => {
  let launches = 0;
  let commands = 0;
  const f = await fixture(t, { launchSpec: () => { launches++; return hold; }, commandSpec: () => { commands++; return hold; } });
  await f.bind();
  const launchesResults = await Promise.all(Array.from({ length: 8 }, () => f.manager.launch(f.input)));
  assert.equal(launches, 1);
  assert.equal(new Set(launchesResults.map((result) => result.runtime.pid)).size, 1);
  const runs = await Promise.all(Array.from({ length: 8 }, () => f.manager.run({ ...f.input, commandId: "watch" })));
  assert.equal(commands, 1);
  assert.equal(new Set(runs.map((result) => result.command.pid)).size, 1);
  assert.notEqual(runs[0].command.pid, launchesResults[0].runtime.pid);
  await assert.rejects(f.manager.run({ ...f.input, commandId: "build" }), /different command is already running/);
  const result = await f.manager.stop(f.input);
  assert.equal(result.runtime.state, "stopped");
  assert.equal(result.command.state, "idle");
  await Promise.all([stopped(runs[0].command.pid), stopped(launchesResults[0].runtime.pid)]);
  assert.equal((await f.manager.stop(f.input)).runtime.pid, null);
});

test("script keys are validated against the freshly read manifest, never interpreted as shell", async (t) => {
  let captured;
  const f = await fixture(t, { commandSpec: (ctx) => { captured = ctx; return hold; } });
  await f.bind();
  for (const commandId of [undefined, "", "not-a-script", "build; touch /tmp/no", "--help", "toString", "__proto__"]) {
    await assert.rejects(f.manager.run({ ...f.input, commandId }), /exact package.json script key/);
  }
  await writeFile(path.join(f.pluginPath, "package.json"), JSON.stringify({ ...f.manifest, scripts: { "build:dev": "node scripts/dev.js", "--help": "evil" } }));
  assert.deepEqual((await f.manager.status(f.input)).commands, [{ id: "build:dev", title: "build:dev", command: "node scripts/dev.js" }]);
  const run = await f.manager.run({ ...f.input, commandId: "build:dev" });
  assert.equal(run.command.state, "running");
  assert.equal(captured.commandId, "build:dev");
});

test("runtime URLs are captured from split stdout and stderr but only for loopback hosts", async (t) => {
  const f = await fixture(t, { launchSpec: nodeSpec(`
    console.log('https://example.com:7777/ http://127.0.0.1.evil.test:80/ http://127.0.0.1@evil.test/ http://0.0.0.0:4000/');
    process.stderr.write('Web URL: http://127.0.');
    setTimeout(() => process.stderr.write('0.1:43219/sandbox\\n'), 25);
    setInterval(() => {}, 1000);
  `) });
  await f.bind();
  await f.manager.launch(f.input);
  const ready = await until(() => f.manager.status(f.input), (result) => result.runtime.url === "http://127.0.0.1:43219/sandbox");
  assert.ok(ready.logs.some((entry) => entry.source === "runtime" && entry.stream === "stderr"));
  assert.match(text(ready), /example.com/);
});

test("external, wildcard, credential-bearing, and zero-port runtime URLs are rejected", async (t) => {
  const f = await fixture(t, { launchSpec: nodeSpec(`console.log('http://evil.test:2222/ http://0.0.0.0:1234/ http://user@127.0.0.1:1234/ http://127.0.0.1:0/'); setInterval(() => {}, 1000);`) });
  await f.bind();
  await f.manager.launch(f.input);
  const result = await until(() => f.manager.status(f.input), (result) => text(result).includes("evil.test"));
  assert.equal(result.runtime.url, null);
});

test("spawn failures are captured without unhandled errors and can be stopped", async (t) => {
  const f = await fixture(t, { launchSpec: { command: "/definitely/missing/dsh-test-command", args: [] },
    commandSpec: { command: "/definitely/missing/dsh-test-command", args: [] } });
  await f.bind();
  const runtime = await f.manager.launch(f.input);
  assert.equal(runtime.runtime.state, "error");
  assert.equal(runtime.runtime.pid, null);
  assert.match(runtime.runtime.error, /ENOENT/);
  const command = await f.manager.run({ ...f.input, commandId: "build" });
  assert.equal(command.command.state, "error");
  assert.match(command.command.error, /ENOENT/);
  assert.ok(command.logs.some((entry) => entry.stream === "system"));
  assert.equal((await f.manager.stop(f.input)).runtime.state, "stopped");
});

test("natural exits record code and signal, clear running state, and allow relaunch", async (t) => {
  let launched = 0;
  const f = await fixture(t, { launchSpec: () => nodeSpec(`console.log('launch-${++launched}'); process.exit(${launched === 1 ? 7 : 0});`) });
  await f.bind();
  await f.manager.launch(f.input);
  const failure = await until(() => f.manager.status(f.input), (result) => result.runtime.state === "error");
  assert.equal(failure.runtime.exitCode, 7);
  assert.equal(failure.runtime.pid, null);
  assert.match(failure.runtime.error, /code 7/);
  await f.manager.launch(f.input);
  const success = await until(() => f.manager.status(f.input), (result) => result.runtime.state === "exited");
  assert.equal(success.runtime.exitCode, 0);
  assert.equal(success.runtime.error, null);
  assert.equal(success.runtime.url, null);
  assert.equal(launched, 2);
});

test("command stdout, stderr, cwd, exit status, and log metadata are observable", async (t) => {
  const f = await fixture(t, { commandSpec: nodeSpec("console.log('cwd=' + process.cwd()); console.error('build stderr'); process.exitCode = 3;") });
  await f.bind();
  await f.manager.run({ ...f.input, commandId: "build" });
  const result = await until(() => f.manager.status(f.input), (result) => result.command.state === "error");
  assert.equal(result.command.exitCode, 3);
  assert.equal(result.command.id, "build");
  assert.equal(result.command.pid, null);
  assert.ok(result.logs.some((line) => line.source === "command" && line.stream === "stdout" && line.text.includes(f.pluginPath)));
  assert.ok(result.logs.some((line) => line.source === "command" && line.stream === "stderr" && line.text.includes("build stderr")));
  assert.ok(result.logs.every((line) => !Number.isNaN(Date.parse(line.time))));
});

test("logs are bounded by UTF-8 bytes and entry count and snapshots do not expose mutable state", async (t) => {
  const f = await fixture(t, { maxLogBytes: 256, maxLogEntries: 3,
    commandSpec: nodeSpec("process.stdout.write('🙂'.repeat(10000)); process.stderr.write('last stderr');") });
  await f.bind();
  await f.manager.run({ ...f.input, commandId: "build" });
  const result = await until(() => f.manager.status(f.input), (result) => result.command.state === "exited");
  assert.ok(result.logs.length <= 3);
  assert.ok(result.logs.reduce((sum, line) => sum + Buffer.byteLength(line.text), 0) <= 256);
  result.binding.pluginPath = "changed";
  result.commands[0].id = "changed";
  result.runtime.state = "changed";
  if (result.logs[0]) result.logs[0].text = "changed";
  const again = await f.manager.status(f.input);
  assert.equal(again.binding.pluginPath, f.pluginPath);
  assert.equal(again.commands[0].id, "build");
  assert.equal(again.runtime.state, "stopped");
  assert.ok(!again.logs.some((line) => line.text === "changed"));
});

test("both process types receive scrubbed env and isolated homes, never parent DSH/profile credentials", async (t) => {
  const env = { ...process.env, DSH_HOME: "/parent/home", DSH_WEB_URL: "secret-url", DSH_PROFILE: "parent",
    OPENAI_API_KEY: "key-secret", PASSWORD: "password-secret", CLIENT_SECRET: "secret", SESSION_TOKEN: "token-secret",
    NODE_OPTIONS: "--require /does/not/exist.js", NODE_PATH: "/parent/modules", AWS_ACCESS_KEY_ID: "aws-secret",
    SSH_AUTH_SOCK: "/parent/ssh.sock", NPM_CONFIG_USERCONFIG: "/parent/.npmrc", KEEP_ME: "visible", HOME: "/parent/user" };
  const dump = nodeSpec("console.log(JSON.stringify(process.env));");
  const f = await fixture(t, { env, launchSpec: dump, commandSpec: dump });
  await f.bind();
  await f.manager.launch(f.input);
  await f.manager.run({ ...f.input, commandId: "build" });
  const result = await until(() => f.manager.status(f.input), (result) => result.runtime.state === "exited" && result.command.state === "exited");
  for (const source of ["runtime", "command"]) {
    const output = result.logs.filter((entry) => entry.source === source && entry.stream === "stdout").map((entry) => entry.text).join("");
    const childEnv = JSON.parse(output);
    assert.equal(childEnv.DSH_HOME, path.join(f.base, "runtime"));
    assert.equal(childEnv.HOME, path.join(f.base, "runtime", "home"));
    assert.equal(childEnv.XDG_CONFIG_HOME, path.join(f.base, "runtime", "config"));
    assert.equal(childEnv.KEEP_ME, "visible");
    for (const key of ["DSH_WEB_URL", "DSH_PROFILE", "OPENAI_API_KEY", "PASSWORD", "CLIENT_SECRET", "SESSION_TOKEN", "NODE_OPTIONS", "NODE_PATH", "AWS_ACCESS_KEY_ID", "SSH_AUTH_SOCK", "NPM_CONFIG_USERCONFIG"]) {
      assert.equal(childEnv[key], undefined, `${source} leaked ${key}`);
    }
  }
  assert.equal(env.DSH_HOME, "/parent/home");
  assert.equal(env.NODE_OPTIONS, "--require /does/not/exist.js");
});

test("production defaults invoke dsh with exact real CLI flags and pnpm with an argv script key", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t);
  const bin = path.join(f.tempRoot, "bin");
  await mkdir(bin);
  for (const command of ["dsh", "pnpm"]) {
    const shim = path.join(bin, command);
    await writeFile(shim, `#!${process.execPath}\nconsole.log(JSON.stringify({command:${JSON.stringify(command)},args:process.argv.slice(2),home:process.env.DSH_HOME}));\n`);
    await chmod(shim, 0o700);
  }
  const manager = f.makeManager({ launchSpec: undefined, commandSpec: undefined, env: { PATH: bin } });
  await manager.bind({ ...f.input, pluginPath: f.pluginPath });
  await manager.launch(f.input);
  await manager.run({ ...f.input, commandId: "build" });
  const result = await until(() => manager.status(f.input), (result) => result.runtime.state === "exited" && result.command.state === "exited");
  const output = (source) => JSON.parse(result.logs.filter((line) => line.source === source && line.stream === "stdout").map((line) => line.text).join(""));
  assert.deepEqual(output("runtime").args, ["web", "--patch", path.join(f.base, "overlay.yml"), "--host", "127.0.0.1", "--port", "0", "--no-open"]);
  assert.deepEqual(output("command").args, ["run", "build"]);
  assert.equal(output("runtime").command, "dsh");
  assert.equal(output("command").command, "pnpm");
});

test("rebind stops previous runtime and command; unbind persists deletion", async (t) => {
  const f = await fixture(t);
  await f.bind();
  const runtime = await f.manager.launch(f.input);
  const command = await f.manager.run({ ...f.input, commandId: "watch" });
  const rebound = await f.bind();
  assert.equal(rebound.runtime.state, "stopped");
  assert.equal(rebound.command.state, "idle");
  await Promise.all([stopped(runtime.runtime.pid), stopped(command.command.pid)]);
  assert.equal((await f.manager.unbind(f.input)).binding, null);
  assert.equal((await f.makeManager().status(f.input)).binding, null);
  await assert.rejects(stat(path.join(f.base, "binding.json")), { code: "ENOENT" });
});

test("stop terminates owned processes even when the manifest has become invalid", async (t) => {
  const f = await fixture(t);
  await f.bind();
  const launched = await f.manager.launch(f.input);
  await writeFile(path.join(f.pluginPath, "package.json"), "{");
  await assert.rejects(f.manager.stop(f.input), SyntaxError);
  await stopped(launched.runtime.pid);
  assert.equal((await f.manager.unbind(f.input)).binding, null);
});

test("dispose waits for queued starts, kills both child types, and is idempotent", async (t) => {
  let entered;
  const entering = new Promise((resolve) => { entered = resolve; });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const f = await fixture(t, { launchSpec: async () => { entered(); await gate; return hold; } });
  await f.bind();
  const command = await f.manager.run({ ...f.input, commandId: "watch" });
  const launching = f.manager.launch(f.input);
  await entering;
  const disposing = f.manager.dispose();
  release();
  const runtime = await launching;
  await disposing;
  await Promise.all([stopped(runtime.runtime.pid), stopped(command.command.pid)]);
  await f.manager.dispose();
  await assert.rejects(f.manager.status(f.input), /disposed/);
  await assert.rejects(f.bind(), /disposed/);
});

test("stop kills descendants in the detached process group, even after the leader exits", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t, { launchSpec: nodeSpec(`
    const {spawn} = require('node:child_process');
    const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], {stdio:'ignore'});
    child.unref(); console.log('descendant=' + child.pid);
    setTimeout(() => process.exit(0), 100);
  `) });
  await f.bind();
  await f.manager.launch(f.input);
  const result = await until(() => f.manager.status(f.input), (result) => result.runtime.state === "exited" && /descendant=\d+/.test(text(result)));
  const descendant = Number(text(result).match(/descendant=(\d+)/)[1]);
  assert.ok(alive(descendant));
  await f.manager.stop(f.input);
  await stopped(descendant);
});

test("editing a persisted binding cannot reuse another plugin's running processes", async (t) => {
  const f = await fixture(t);
  await f.bind();
  const previousRuntime = await f.manager.launch(f.input);
  const previousCommand = await f.manager.run({ ...f.input, commandId: "watch" });
  const secondPlugin = path.join(f.workspaceRoot, "beta");
  await mkdir(secondPlugin);
  await writeFile(path.join(secondPlugin, "package.json"), JSON.stringify({ name: "beta", main: "index.js", scripts: { watch: "node watch.js" } }));
  await writeFile(path.join(secondPlugin, "index.js"), "module.exports = {};\n");
  await writeFile(path.join(f.base, "binding.json"), JSON.stringify({ pluginPath: secondPlugin }));
  const nextRuntime = await f.manager.launch(f.input);
  const nextCommand = await f.manager.run({ ...f.input, commandId: "watch" });
  assert.equal(nextRuntime.binding.pluginPath, secondPlugin);
  assert.notEqual(nextRuntime.runtime.pid, previousRuntime.runtime.pid);
  assert.notEqual(nextCommand.command.pid, previousCommand.command.pid);
  await Promise.all([stopped(previousRuntime.runtime.pid), stopped(previousCommand.command.pid)]);
});

test("signal exits are recorded and an exited runtime never keeps its URL", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t, { launchSpec: nodeSpec("console.log('http://127.0.0.1:12345/'); setTimeout(() => process.kill(process.pid, 'SIGTERM'), 25);") });
  await f.bind();
  await f.manager.launch(f.input);
  const result = await until(() => f.manager.status(f.input), (result) => result.runtime.state === "error");
  assert.equal(result.runtime.signal, "SIGTERM");
  assert.equal(result.runtime.exitCode, null);
  assert.equal(result.runtime.url, null);
  assert.match(result.runtime.error, /signal SIGTERM/);
});

test("an invalid test spec never silently falls back to the production launcher", async (t) => {
  const f = await fixture(t, { launchSpec: () => undefined, commandSpec: () => null });
  await f.bind();
  assert.equal((await f.manager.launch(f.input)).runtime.state, "error");
  assert.equal((await f.manager.run({ ...f.input, commandId: "build" })).command.state, "error");
});

test("real DSH smoke: temporary overlay loads Host and exposes its client", { skip: process.env.DSH_SANDBOX_REAL_SMOKE !== "1" }, async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.pluginPath, "package.json"), JSON.stringify({
    name: "dsh-sandbox-smoke-fixture", version: "1.0.0", type: "module",
    exports: { ".": "./index.js", "./client": "./client.js" },
    dsh: { manifestVersion: 1, client: { platform: "web" } },
  }));
  await writeFile(path.join(f.pluginPath, "index.js"), 'export function apply(ctx) { console.log("SANDBOX_HOST_SMOKE_LOADED"); }\n');
  await writeFile(path.join(f.pluginPath, "client.js"), 'window.__ModuleLoader__.load({ id: "dsh-sandbox-smoke-fixture", factory: () => ({ apply() { globalThis.__SANDBOX_CLIENT_SMOKE_LOADED__ = true; } }) });\n');
  const manager = f.makeManager({ launchSpec: undefined, commandSpec: undefined, stopTimeoutMs: 1500 });
  await manager.bind({ ...f.input, pluginPath: f.pluginPath });
  await manager.launch(f.input);
  const ready = await until(() => manager.status(f.input), (result) => result.runtime.url || ["error", "exited"].includes(result.runtime.state));
  assert.equal(ready.runtime.state, "running", text(ready));
  assert.ok(ready.runtime.url, text(ready));
  assert.match(text(ready), /SANDBOX_HOST_SMOKE_LOADED/);
  const login = await fetch(ready.runtime.url, { redirect: "manual" });
  const cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const response = await fetch(new URL(login.headers.get("location") || "/", ready.runtime.url), { headers: { cookie } });
  const html = await response.text();
  assert.equal(response.status, 200, html);
  const bootJson = html.match(/globalThis\["__DSH_BOOT__"\] = ([\s\S]*?)<\/script>/)?.[1];
  assert.ok(bootJson, "real DSH must inject its boot payload");
  const entry = JSON.parse(bootJson).entries.find((item) => item.id === "dsh-sandbox-smoke-fixture");
  assert.ok(entry, "the overlay must expose the plugin's client entry in the real boot manifest");
  const clientResponse = await fetch(new URL(entry.url, ready.runtime.url), { headers: { cookie } });
  assert.equal(clientResponse.status, 200);
  const clientSource = await clientResponse.text();
  const registrations = [];
  const browser = { window: { __ModuleLoader__: { load: (registration) => registrations.push(registration) } } };
  runInNewContext(clientSource, browser, { timeout: 1000 });
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].id, "dsh-sandbox-smoke-fixture");
  await registrations[0].factory().apply({});
  assert.equal(browser.__SANDBOX_CLIENT_SMOKE_LOADED__, true);
  t.diagnostic(`Real sandbox: ${new URL(ready.runtime.url).origin}; Host loaded; page HTTP ${response.status}; client HTTP ${clientResponse.status}; client registration/apply verified`);
});

test("invalid explicit launcher specs are captured as runtime errors", async (t) => {
  const f = await fixture(t, { launchSpec: { command: process.execPath, args: "not-an-array" } });
  await f.bind();
  const result = await f.manager.launch(f.input);
  assert.equal(result.runtime.state, "error");
  assert.equal(result.runtime.pid, null);
  assert.match(result.runtime.error, /Launch spec must be/);
});
