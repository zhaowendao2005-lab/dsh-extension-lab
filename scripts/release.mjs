#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = path.join(root, "packages/dsh-ui-diy");
const packageFile = path.join(packageDir, "package.json");
const catalogFile = path.join(root, "marketplace.json");
const allowedPublishChanges = new Set([
  "marketplace.json",
  "packages/dsh-ui-diy/package.json",
  "packages/dsh-ui-diy/lib/client.js",
]);

function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: root, stdio: "inherit", ...options });
}

function capture(command, args) {
  return execFileSync(command, args, { cwd: root, encoding: "utf8" }).trim();
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function loadRelease() {
  const manifest = await readJson(packageFile);
  const catalog = await readJson(catalogFile);
  const entry = catalog.extensions?.find((item) => item.name === manifest.name);
  if (!entry) throw new Error("marketplace.json has no entry for " + manifest.name);
  if (entry.path !== "packages/" + manifest.name) {
    throw new Error("marketplace path must be packages/" + manifest.name);
  }
  if (entry.version !== manifest.version) {
    throw new Error("package.json and marketplace.json versions differ");
  }
  return { manifest, catalog, entry };
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
  const status = capture("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
  return status ? status.split("\n").map((line) => line.slice(3)) : [];
}

function requireCleanTree() {
  const paths = statusPaths();
  if (paths.length) throw new Error("working tree must be clean first:\n  " + paths.join("\n  "));
}

function requireOnlyReleaseFiles() {
  const paths = statusPaths();
  const unexpected = paths.filter((file) => !allowedPublishChanges.has(file));
  if (unexpected.length) {
    throw new Error("publish refused; unrelated changes are present:\n  " + unexpected.join("\n  "));
  }
  if (!paths.length) throw new Error("no prepared release changes found");
}

function tagExists(tag) {
  const local = spawnSync("git", ["show-ref", "--verify", "--quiet", "refs/tags/" + tag], { cwd: root });
  if (local.status === 0) return true;
  const remote = capture("git", ["ls-remote", "--tags", "origin", "refs/tags/" + tag]);
  return remote.length > 0;
}

function validateTag(tag) {
  if (!/^version-[A-Za-z0-9][A-Za-z0-9._-]*$/.test(tag)) {
    throw new Error("tag must use the version-N format, for example version-2");
  }
}

async function check() {
  const { manifest, entry } = await loadRelease();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) {
    throw new Error("package version must be a semantic version");
  }
  if (!entry.ref) throw new Error("marketplace entry must pin its release ref");
  validateTag(entry.ref);
  console.log(manifest.name + " " + manifest.version + " -> " + entry.ref + " (" + entry.path + ")");
}

async function prepare(args) {
  const options = parseOptions(args);
  const version = options.version;
  const tag = options.tag;
  if (!version || !tag) throw new Error("usage: pnpm run release:prepare -- --version 2.0.0 --tag version-2");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error("--version must be semantic, for example 2.0.0");
  validateTag(tag);
  requireMainBranch();
  requireCleanTree();
  run("git", ["fetch", "origin", "main", "--quiet"]);
  const divergence = capture("git", ["rev-list", "--left-right", "--count", "origin/main...HEAD"]);
  if (divergence !== "0\t0") throw new Error("local main must match origin/main before preparing a release");
  if (tagExists(tag)) throw new Error("tag already exists: " + tag);

  const manifest = await readJson(packageFile);
  const catalog = await readJson(catalogFile);
  const entry = catalog.extensions?.find((item) => item.name === manifest.name);
  if (!entry) throw new Error("marketplace.json has no entry for " + manifest.name);
  if (entry.path !== "packages/" + manifest.name) throw new Error("unexpected marketplace package path");
  manifest.version = version;
  entry.version = version;
  entry.ref = tag;
  await writeFile(packageFile, JSON.stringify(manifest, null, 2) + "\n");
  await writeFile(catalogFile, JSON.stringify(catalog, null, 2) + "\n");

  run("pnpm", ["--dir", "packages/dsh-ui-diy", "run", "build"]);
  run("pnpm", ["--dir", "packages/dsh-ui-diy", "test"]);
  console.log("Release prepared. Review the diff, then run: pnpm run release:publish -- --tag " + tag);
}

async function publish(args) {
  const options = parseOptions(args);
  const tag = options.tag;
  if (!tag) throw new Error("usage: pnpm run release:publish -- --tag version-2");
  validateTag(tag);
  requireMainBranch();
  const { manifest, entry } = await loadRelease();
  if (entry.ref !== tag) throw new Error("catalog ref must equal the requested tag");
  if (tagExists(tag)) throw new Error("tag already exists: " + tag);
  requireOnlyReleaseFiles();
  run("gh", ["auth", "status"]);
  run("pnpm", ["--dir", "packages/dsh-ui-diy", "test"]);

  run("git", ["add", "--", ...allowedPublishChanges]);
  run("git", ["commit", "-m", "Release dsh-ui-diy " + manifest.version]);
  run("git", ["tag", "-a", tag, "-m", "dsh-ui-diy " + manifest.version]);
  run("git", ["push", "origin", "main"]);
  run("git", ["push", "origin", tag]);
  run("gh", [
    "release", "create", tag,
    "--title", "dsh-ui-diy " + manifest.version,
    "--notes", "Release dsh-ui-diy " + manifest.version + " from packages/dsh-ui-diy. The marketplace entry is pinned to this tag.",
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
