#!/usr/bin/env node
/**
 * Structural gate — verifies the DOM hooks `src/swiss.css` selects on still
 * exist in the installed app and in the third-party plugins we skin.
 *
 * The stylesheet deliberately avoids hashed class names; it only relies on:
 *
 *   div[role="presentation"] > div[role="dialog"][aria-modal="true"]
 *     → the shared Modal primitive and the settings dialog shell
 *   [data-shortcut-modal="settings"]
 *     → the settings dialog (the only dialog with a registered shortcut id)
 *   [data-composer-input]
 *     → the conversation editor, where focus returns after the model picker
 *   .dsham_modalDialog / .dsham_sidebarCard
 *     → @michengai/dsh-archive-manager
 *   [data-dsh-market-fullscreen="true"]
 *     → dshmarket full-screen mode (exempted from the 80% rule)
 *
 * Paths can be overridden with DSH_APP_ASAR and DSH_PROFILE_DIR.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function resolveDefaultAsar() {
  if (process.platform === "win32") {
    const candidates = [
      path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "Programs", "DeepSeek Harness", "resources", "app.asar"),
      path.join(process.env.ProgramFiles ?? "C:\\Program Files", "DeepSeek Harness", "resources", "app.asar"),
    ];
    return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
  }
  return "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar";
}

const ASAR = process.env.DSH_APP_ASAR ?? resolveDefaultAsar();
const PROFILE =
  process.env.DSH_PROFILE_DIR ?? path.join(process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh"), "profiles", "desktop");

const CHECKS = [
  {
    hook: '[data-shortcut-modal="settings"]',
    file: ASAR,
    needle: "data-shortcut-modal",
    required: true,
  },
  {
    hook: 'div[role="presentation"] > div[role="dialog"][aria-modal="true"]',
    file: ASAR,
    needle: '"presentation"',
    also: ["aria-modal"],
    required: true,
  },
  {
    hook: "[data-composer-input]",
    file: ASAR,
    needle: "data-composer-input",
    required: true,
  },
  {
    hook: '.dsham_modalDialog',
    file: path.join(
      PROFILE,
      "node_modules/@michengai/dsh-archive-manager/lib/client.js",
    ),
    needle: "dsham_modalDialog",
    required: true,
  },
  {
    hook: '[data-dsh-market-fullscreen="true"]',
    file: path.join(PROFILE, "node_modules/dshmarket/client/client.js"),
    needle: "data-dsh-market-fullscreen",
    required: false,
  },
];

let failures = 0;
const cache = new Map();

async function load(file) {
  if (!cache.has(file)) cache.set(file, await readFile(file));
  return cache.get(file);
}

for (const check of CHECKS) {
  const label = path.basename(check.file);
  if (!existsSync(check.file)) {
    console.log(`${check.required ? "FAIL" : "skip"} ${check.hook} — missing ${check.file}`);
    if (check.required) failures += 1;
    continue;
  }
  const bytes = await load(check.file);
  const haystack = bytes.toString("latin1");
  const hit = haystack.includes(check.needle);
  const alsoHit = (check.also ?? []).every((n) => haystack.includes(n));
  const ok = hit && alsoHit;
  if (!ok) failures += 1;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${check.hook}\n       ${label} ${hit ? "has" : "lacks"} ${JSON.stringify(
      check.needle,
    )}${check.also ? ` (also: ${check.also.join(", ")})` : ""}`,
  );
}

if (failures > 0) {
  console.error(`selectors: ${failures} hook(s) missing — swiss.css would go stale`);
  process.exit(1);
}
console.log("selectors: all structural hooks present");
