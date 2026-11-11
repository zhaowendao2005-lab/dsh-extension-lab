#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalogFile = path.join(root, "marketplace.json");

function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: root, stdio: "inherit", ...options });
}

function capture(command, args) {
  return execFileSync(command, args, { cwd: root, encoding: "utf8" }).trim();
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function packageFile(name) {
  return path.join(root, "packages", name, "package.json");
}

function allowedPublishChanges() {
  const files = new Set(["marketplace.json"]);
  for (const name of packageNames) {
    files.add("packages/" + name + "/package.json");
    files.add("packages/" + name + "/lib/client.js");
    files.add("packages/" + name + "/lib/index.js");
    files.add("packages/" + name + "/scripts/build.mjs");
    files.add("packages/" + name + "/src/client.template.js");
    files.add("packages/" + name + "/README.md");
  }
  files.add("scripts/release.mjs");
  return files;
}

let packageNames = [];

async function loadRelease() {
  const catalog = await readJson(catalogFile);
  const entries = catalog.extensions;
  if (!Array.isArray(entries) || !entries.length) throw new Error("marketplace.json has no extensions");
  packageNames = entries.map((entry) => entry.name);
  const packages = [];
  for (const entry of entries) {
    const manifest = await readJson(packageFile(entry.name));
    if (entry.path !== "packages/" + entry.name) {
      throw new Error("marketplace path must be packages/" + entry.name);
    }
    if (manifest.name !== entry.name) {
      throw new Error("package name mismatch for " + entry.name);
    }
    if (entry.version !== manifest.version) {
      throw new Error("package.json and marketplace.json versions differ for " + entry.name);
    }
    packages.push({ manifest, entry });
  }
  return { catalog, packages };
}

function parseOptions(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--") continue;
    if (!args[i].startsWith("--")) throw new Error("unexpected argument: " + args[i]);
    const key = args[i].slice(2);
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error("missing value for --" + key);
    options[key] = value;
  }
  return options;
}

function requireMainBranch() {
  const branch = capture("git", ["branch", "--show-current"]);
  if (branch !== "main") throw new Error("release operations must run on main (current: " + branch + ")");
}

function statusPaths() {
  // Read raw output: trimming would eat the leading space of an unstaged
  // change (" M file"), shifting the path slice.
  const status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8",
  });
  return status.split("\n").filter(Boolean).map((line) => line.slice(3));
}

function requireCleanTree() {
  const paths = statusPaths();
  if (paths.length) throw new Error("working tree must be clean first:\n  " + paths.join("\n  "));
}

function requireOnlyReleaseFiles() {
  const allowed = allowedPublishChanges();
  const paths = statusPaths();
  const unexpected = paths.filter((file) => !allowed.has(file));
  if (unexpected.length) {
    throw new Error("publish refused; unrelated changes are present:\n  " + unexpected.join("\n  "));
  }
  return paths;
}

function tagExists(tag) {
  const local = spawnSync("git", ["show-ref", "--verify", "--quiet", "refs/tags/" + tag], { cwd: root });
  if (local.status === 0) return true;
  const remote = capture("git", ["ls-remote", "--tags", "origin", "refs/tags/" + tag]);
  return remote.length > 0;
}

function specFor(entry, tag) {
  const match = /^github:([^/#]+\/[^#]+)#([^&]+)&path:\/(.+)$/.exec(entry.spec || "");
  if (!match) throw new Error(entry.name + ": spec must be a github spec");
  return "github:" + match[1] + "#" + tag + "&path:/" + match[3];
}

function verifyRemoteRef(entry) {
  const match = /^github:([^/#]+\/[^#]+)#([^&]+)&path:\/(.+)$/.exec(entry.spec || "");
  if (!match || match[3] !== entry.path) {
    throw new Error(entry.name + ": spec must be a github spec matching its path");
  }
  const [, repository, ref] = match;
  validateTag(ref);
  const result = spawnSync(
    "git",
    ["ls-remote", "--exit-code", "https://github.com/" + repository + ".git", "refs/tags/" + ref],
    { cwd: root, stdio: "ignore", timeout: 15000 },
  );
  if (result.status !== 0) {
    throw new Error(entry.name + ": remote GitHub tag does not exist: " + ref);
  }
}

function validateTag(tag) {
  if (!/^version-[A-Za-z0-9][A-Za-z0-9._-]*$/.test(tag)) {
    throw new Error("tag must use the version-N format, for example version-2");
  }
}

function buildAndTest() {
  for (const name of packageNames) {
    run("pnpm", ["--dir", "packages/" + name, "run", "build"]);
  }
  run("pnpm", ["test"]);
}

async function check() {
  const { packages } = await loadRelease();
  for (const { manifest, entry } of packages) {
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) {
      throw new Error(manifest.name + ": version must be semantic");
    }
    if (!entry.ref) throw new Error(entry.name + ": marketplace entry must pin its release ref");
    validateTag(entry.ref);
    verifyRemoteRef(entry);
    console.log(manifest.name + " " + manifest.version + " -> " + entry.ref + " (" + entry.path + ")");
  }
}

async function prepare(args) {
  const options = parseOptions(args);
  const tag = options.tag;
  if (!tag) throw new Error("usage: pnpm run release:prepare -- --tag version-2");
  validateTag(tag);
  requireMainBranch();
  requireCleanTree();
  run("git", ["fetch", "origin", "main", "--quiet"]);
  const divergence = capture("git", ["rev-list", "--left-right", "--count", "origin/main...HEAD"]);
  if (divergence !== "0\t0") throw new Error("local main must match origin/main before preparing a release");
  if (tagExists(tag)) throw new Error("tag already exists: " + tag);

  const { catalog } = await loadRelease();
  for (const entry of catalog.extensions) {
    entry.ref = tag;
    entry.spec = specFor(entry, tag);
  }
  await writeFile(catalogFile, JSON.stringify(catalog, null, 2) + "\n");

  buildAndTest();
  console.log("Release prepared. Review the diff, then run: pnpm run release:publish -- --tag " + tag);
}

async function publish(args) {
  const options = parseOptions(args);
  const tag = options.tag;
  if (!tag) throw new Error("usage: pnpm run release:publish -- --tag version-2");
  validateTag(tag);
  requireMainBranch();
  const { packages } = await loadRelease();
  for (const { entry } of packages) {
    if (entry.ref !== tag) throw new Error("catalog ref must equal the requested tag: " + entry.name);
    if (entry.spec !== specFor(entry, tag)) {
      throw new Error("catalog spec must be pinned to the requested tag: " + entry.name);
    }
  }
  if (tagExists(tag)) throw new Error("tag already exists: " + tag);
  const changed = requireOnlyReleaseFiles();
  run("gh", ["auth", "status"]);
  run("pnpm", ["test"]);

  const names = packages.map(({ manifest }) => manifest.name + " " + manifest.version).join(", ");
  if (changed.length) {
    run("git", ["add", "--", ...allowedPublishChanges()]);
    run("git", ["commit", "-m", "Release " + names]);
  } else {
    console.log("release: catalog already pins " + tag + "; tagging the current commit");
  }
  run("git", ["tag", "-a", tag, "-m", names]);
  run("git", ["push", "origin", "main"]);
  run("git", ["push", "origin", tag]);
  run("gh", [
    "release", "create", tag,
    "--title", names,
    "--notes", "Release " + names + ". Marketplace entries are pinned to this tag.",
  ]);
}

const [action, ...args] = process.argv.slice(2);
try {
  if (action === "check") await check();
  else if (action === "prepare") await prepare(args);
  else if (action === "publish") await publish(args);
  else throw new Error("usage: node scripts/release.mjs <check|prepare|publish>");
} catch (error) {
  console.error("release: " + (error?.message || error));
  process.exitCode = 1;
}
