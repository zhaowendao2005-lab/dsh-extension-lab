#!/usr/bin/env node
/**
 * Render the preview matrix with headless Chromium and validate the PNGs.
 *
 * Usage: node scripts/shots.mjs
 *
 * Every shot is taken at deviceScaleFactor 2, so a 1440x900 viewport must
 * produce a 2880x1800 PNG. The swiss restyle animates background-color on a
 * few elements, hence the fonts.ready + 400 ms + two rAF settle before the
 * screenshot; without it dark shots catch mid-transition greys.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(
  "/Users/qihoo/.local/lib/node_modules/@playwright/cli/node_modules/playwright",
);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PREVIEW = path.join(ROOT, "preview", "index.html");
const OUT = path.join(ROOT, "preview", "out");
const INDEX_URL = pathToFileURL(PREVIEW).href;

const MIN_BYTES = 20 * 1024;
const SCALE = 2;

/** viewport, theme, dialog, extra query, file stem */
const MATRIX = [];
for (const [width, height] of [
  [1440, 900],
  [1280, 800],
  [1920, 1080],
  [390, 844],
]) {
  for (const theme of ["light", "dark"]) {
    MATRIX.push({
      width,
      height,
      query: `?dialog=settings&theme=${theme}`,
      name: `settings-${width}x${height}-${theme}.png`,
    });
  }
}
for (const [dialog, suffix, extra] of [
  ["archive", "archive", ""],
  ["confirm", "confirm", ""],
  ["menu", "menu", ""],
  ["settings", "titlebar", "&frame=titlebar"],
]) {
  MATRIX.push({
    width: 1440,
    height: 900,
    query: `?dialog=${dialog}&theme=light${extra}`,
    name: `${suffix}-1440x900-light.png`,
  });
}
MATRIX.push({
  width: 390,
  height: 844,
  query: "?dialog=settings&theme=light&platform=web",
  name: "compact-390x844-light.png",
});

const GEOMETRY = `(() => {
  const kind = document.body.getAttribute("data-preview-dialog") || "settings";
  const selectors = {
    settings: '[data-shortcut-modal="settings"]',
    confirm: "._dialog_14mp3_33",
    archive: ".dsham_modalDialog",
    menu: '[role="menu"]',
  };
  const read = (node) => {
    if (!node) return null;
    const box = node.getBoundingClientRect();
    const cs = getComputedStyle(node);
    return {
      width: Math.round(box.width * 100) / 100,
      height: Math.round(box.height * 100) / 100,
      radius: cs.borderTopLeftRadius,
      shadow: cs.boxShadow,
      borderTopWidth: cs.borderTopWidth,
    };
  };
  const mask = document.querySelector(
    "._77Pn0W_mask, ._mask_14mp3_18, .dsham_modalMask",
  );
  return {
    kind,
    viewport: [innerWidth, innerHeight],
    dialog: read(document.querySelector(selectors[kind])),
    maskBlur: mask ? getComputedStyle(mask).backdropFilter : "none",
  };
})()`;

/** The shell contract: 80% panels, square corners, no drop shadow, flat scrim. */
function geometryFailures(metrics) {
  const dialog = metrics.dialog;
  if (!dialog) return [`no ${metrics.kind} dialog in the DOM`];
  const [vw, vh] = metrics.viewport;
  const failures = [];
  if (dialog.radius !== "0px") failures.push(`${metrics.kind} radius ${dialog.radius}`);
  if (dialog.shadow !== "none") failures.push(`${metrics.kind} shadow ${dialog.shadow}`);
  if (metrics.maskBlur !== "none") failures.push(`mask blur ${metrics.maskBlur}`);
  if (metrics.kind === "settings") {
    const compact = vw <= 900;
    const wantWidth = compact ? vw : vw * 0.8;
    const wantHeight = compact ? vh : vh * 0.8;
    if (Math.abs(dialog.width - wantWidth) > 1.5) {
      failures.push(`panel width ${dialog.width}, expected ${wantWidth}`);
    }
    if (Math.abs(dialog.height - wantHeight) > 1.5) {
      failures.push(`panel height ${dialog.height}, expected ${wantHeight}`);
    }
    if (dialog.borderTopWidth !== "3px") {
      failures.push(`accent rule ${dialog.borderTopWidth}, expected 3px`);
    }
  }
  if (metrics.kind === "confirm" && dialog.width > 520) {
    failures.push(`confirm dialog grew to ${dialog.width}px`);
  }
  if (metrics.kind === "archive") {
    if (Math.abs(dialog.width - vw * 0.8) > 1.5) {
      failures.push(`archive width ${dialog.width}, expected ${vw * 0.8}`);
    }
    if (dialog.height > vh * 0.8 + 1.5) {
      failures.push(`archive height ${dialog.height} exceeds 80vh`);
    }
  }
  return failures;
}

function ensurePreview() {
  const run = spawnSync(process.execPath, [path.join(HERE, "preview.mjs")], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (run.error) {
    console.error(`shots: could not spawn preview.mjs: ${run.error.message}`);
    process.exit(1);
  }
  if (run.status !== 0) {
    console.error(`shots: preview.mjs exited ${run.status}`);
    process.exit(run.status ?? 1);
  }
}

function pngSize(buffer) {
  if (buffer.length < 24) return null;
  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") return null;
  if (buffer.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(400);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

async function main() {
  ensurePreview();
  if (!fs.existsSync(PREVIEW)) {
    console.error(`shots: missing ${path.relative(ROOT, PREVIEW)}`);
    process.exit(1);
  }

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const results = [];

  try {
    for (const shot of MATRIX) {
      const file = path.join(OUT, shot.name);
      const expected = { width: shot.width * SCALE, height: shot.height * SCALE };
      const context = await browser.newContext({
        viewport: { width: shot.width, height: shot.height },
        deviceScaleFactor: SCALE,
      });
      const page = await context.newPage();
      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") pageErrors.push(message.text());
      });

      let metrics = null;
      try {
        await page.goto(INDEX_URL + shot.query, { waitUntil: "load" });
        await settle(page);
        metrics = await page.evaluate(GEOMETRY);
        await page.screenshot({ path: file, fullPage: false });
      } finally {
        await context.close();
      }

      const failures = metrics ? geometryFailures(metrics) : ["no metrics"];
      let bytes = 0;
      let size = null;
      if (!fs.existsSync(file)) {
        failures.push("missing file");
      } else {
        const buffer = fs.readFileSync(file);
        bytes = buffer.length;
        size = pngSize(buffer);
        if (bytes <= MIN_BYTES) failures.push(`only ${bytes} bytes (min ${MIN_BYTES})`);
        if (!size) {
          failures.push("not a readable PNG");
        } else if (size.width !== expected.width || size.height !== expected.height) {
          failures.push(`got ${size.width}x${size.height}, expected ${expected.width}x${expected.height}`);
        }
      }
      if (pageErrors.length > 0) failures.push(...pageErrors.map((error) => `page: ${error}`));

      results.push({
        name: shot.name,
        bytes,
        size,
        failures,
      });
      console.log(
        `${shot.name.padEnd(32)} ${String(bytes).padStart(8)} B  ${
          size ? `${size.width}x${size.height}` : "?"
        }  ${failures.length === 0 ? "ok" : "FAIL"}`,
      );
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const failed = results.filter((result) => result.failures.length > 0);
  console.log("");
  console.log(`shots: ${results.length - failed.length}/${results.length} valid in preview/out`);
  for (const result of failed) {
    console.error(`  FAIL ${result.name}: ${result.failures.join("; ")}`);
  }

  console.log("");
  console.log("PNG outputs:");
  for (const result of results) {
    console.log(`  preview/out/${result.name}  ${result.bytes} B`);
  }

  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("shots: fatal", error);
  process.exit(1);
});
