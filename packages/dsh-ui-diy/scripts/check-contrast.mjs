#!/usr/bin/env node
/**
 * Contrast gate for the Swiss palette.
 *
 * Reads the palette out of `src/swiss.css` (light `:root`, dark
 * `body[data-ds-dark-theme]`) and asserts WCAG ratios for the pairs the
 * dialogs actually use:
 *
 *   text  >= 4.5:1   ink on paper / paper on ink / secondary ink on paper
 *   ui    >= 3.0:1   the accent wherever it carries meaning; the pale
 *                    accent is a decorative tint on its native surface,
 *                    so that one pair only has to stay perceptible
 *
 * Exits non-zero on the first failing pair so the build can gate on it.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const css = await readFile(path.resolve(here, "../src/swiss.css"), "utf8");

function block(selector) {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`palette block not found: ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

function palette(text) {
  const out = {};
  for (const m of text.matchAll(/(--swiss-[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out[m[1].replace("--swiss-", "")] = m[2].toLowerCase();
  }
  return out;
}

const themes = {
  light: palette(block(":root {")),
  dark: palette(block("body[data-ds-dark-theme]")),
};

const TEXT = 4.5;
const UI = 3;

const PAIRS = [
  ["ink", "paper", TEXT, "primary text on panel"],
  ["ink-2", "paper", TEXT, "secondary text on panel"],
  ["ink", "paper-2", TEXT, "primary text on hover surface"],
  ["ink-2", "paper-2", TEXT, "secondary text on hover surface"],
  ["paper", "ink", TEXT, "inverted text on selected nav cell / primary button"],
  // The accent is a pale green: it reads strongly on the inverted ink cell in
  // the light theme and strongly on the dark panel in the dark theme, while on
  // its native surface it is deliberately a soft decorative tint.
  ["accent", "ink", UI, "accent marker on inverted nav cell", "light"],
  ["accent", "paper", 1.4, "accent tint on paper (decorative)", "light"],
  ["accent", "paper", UI, "accent rule on dark panel", "dark"],
  ["accent", "ink", 1.4, "accent tint on inverted cell (decorative)", "dark"],
  ["bar", "ink", UI, "active-nav bar on the inverted cell"],
];

function srgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex) {
  const [r, g, b] = srgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

let failures = 0;
for (const [theme, colors] of Object.entries(themes)) {
  for (const [fg, bg, min, label, only] of PAIRS) {
    if (only && only !== theme) continue;
    const a = colors[fg];
    const b = colors[bg];
    if (!a || !b) {
      console.error(`contrast: ${theme} — missing token ${!a ? fg : bg}`);
      failures += 1;
      continue;
    }
    const r = ratio(a, b);
    const ok = r >= min;
    if (!ok) failures += 1;
    console.log(
      `${ok ? "ok  " : "FAIL"} ${theme.padEnd(5)} ${label.padEnd(52)} ${r.toFixed(2)}:1 (>= ${min})`,
    );
  }
}

if (failures > 0) {
  console.error(`contrast: ${failures} failing pair(s)`);
  process.exit(1);
}
console.log("contrast: all pairs pass");
