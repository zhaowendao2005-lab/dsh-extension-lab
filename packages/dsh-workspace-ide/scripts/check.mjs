#!/usr/bin/env node
/**
 * Static rules R1–R14 (see docs/build.md §3). No dependencies, stdlib only.
 * First failure exits non-zero; every message is `[Rn] path:line what`.
 */
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SCAN = ['frontend', 'backend', 'shared', 'scripts', 'integration'];
// `scripts/` is scanned by the path rules (R11/R12) but excluded from content rules:
// the checker's own regex sources would trip the colour rule.
const CHECKER = 'scripts/';
const TEXT_EXT = /\.(js|mjs|cjs|ts|tsx|jsx|css)$/;

async function walk(dir, out = []) {
  const full = path.join(root, dir);
  if (!existsSync(full)) return out;
  for (const entry of await readdir(full, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(rel, out);
    else if (TEXT_EXT.test(entry.name)) out.push(rel);
  }
  return out;
}

const files = (await Promise.all(SCAN.map((dir) => walk(dir)))).flat().sort();
const contents = new Map();
for (const file of files) contents.set(file, await readFile(path.join(root, file), 'utf8'));

let failed = 0;
function report(rule, file, line, message) {
  failed += 1;
  console.error(`[${rule}] ${file}:${line} ${message}`);
}
function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}
function eachMatch(rule, predicate, message) {
  for (const [file, text] of contents) {
    if (!predicate(file)) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].includes('check-ignore:')) continue;
      const hit = message(lines[i], file, i + 1);
      if (hit) report(rule, file, i + 1, hit);
    }
  }
}
const inFrontend = (file) => file.startsWith('frontend/');
const inViews = (file) => file.startsWith('frontend/views/');
const inBackend = (file) => file.startsWith('backend/');
const inShared = (file) => file.startsWith('shared/');

// R1 — no Harness client package imports (practices.md:35).
eachMatch('R1', inFrontend, (line) => (/from\s+['"]@deepseek-ai\//.test(line) || /import\(\s*['"]@deepseek-ai\//.test(line)
  ? 'imports a Harness client package' : null));

// R2 — browser code never reaches into the Host layer.
// `backend/contract.js` is an isomorphic descriptor (zod + typert metadata) that the
// client bundle legitimately imports; the shipped dev-sandbox does the same. Everything
// else under backend/ is Host-only.
eachMatch('R2', inFrontend, (line) => {
  const match = line.match(/from\s+['"]([^'"]*backend\/[^'"]*)['"]/);
  if (!match) return null;
  return /\/backend\/contract\.js$/.test(match[1]) ? null : 'imports backend code';
});

// R3 — no node builtins in browser code.
eachMatch('R3', inFrontend, (line) => {
  const match = line.match(/from\s+['"](node:[^'"]+|[a-z]+)['"]/);
  if (!match) return null;
  const spec = match[1];
  if (spec.startsWith('node:')) return 'imports a node builtin';
  return ['fs', 'path', 'child_process', 'os', 'crypto', 'util', 'stream', 'url', 'zlib'].includes(spec)
    ? `imports node builtin '${spec}'` : null;
});

// R4 — views never hold local state.
eachMatch('R4', inViews, (line) => (/\b(useState|useReducer)\b/.test(line) ? 'local state in views' : null));

// R5 — views never call IO directly.
eachMatch('R5', inViews, (line) => (/from\s+['"][^'"]*datasource/.test(line) ? 'view imports a datasource' : null));

// R6 — Host code never imports browser code.
eachMatch('R6', inBackend, (line) => (/from\s+['"][^'"]*frontend\//.test(line) ? 'backend imports frontend code' : null));

// R7 — no react on the Host side.
eachMatch('R7', inBackend, (line) => (/from\s+['"]react(-dom)?(\/[^'"]*)?['"]/.test(line) ? 'backend imports react' : null));

// R8 — no colour literals; theme tokens only.
// `color-mix(...)` over tokens is the sanctioned way to derive a shade (docs/ui-spec.md §3),
// and `white-space`/`blacklist` are not colours, so both stay out of the pattern.
const COLOUR = /(#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|\b(white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|cyan|magenta|lime|navy|teal|maroon|olive|silver)(?![\w-]))/;
eachMatch('R8', (file) => file !== '' && !file.endsWith('.md') && !file.startsWith(CHECKER), (line) => {
  // Token variable names legitimately contain `--dsw-alias-*`; strip them first.
  const stripped = line.replace(/--dsw-[a-z0-9-]+/g, '').replace(/--wid-[a-z0-9-]+/g, '');
  if (!COLOUR.test(stripped)) return null;
  if (/^\s*(\*|\/\/|\/\*)/.test(line)) return null; // prose in comments is fine
  return 'colour literal; use a --dsw-alias-* token';
});

// R9 — no worker/wasm: there is nowhere to serve them from.
for (const [file, text] of contents) {
  for (const [pattern, why] of [[/new\s+Worker\s*\(/, 'new Worker'], [/importScripts\s*\(/, 'importScripts'], [/\.wasm['"`]/, '.wasm asset']]) {
    const index = text.search(pattern);
    if (index >= 0) report('R9', file, lineOf(text, index), `${why} cannot be served from the plugin bundle`);
  }
}

// R10 — shared/ is data only.
for (const [file, text] of contents) {
  if (!inShared(file)) continue;
  for (const [index, line] of text.split('\n').entries()) {
    if (!/^\s*import\s/.test(line)) continue;
    if (/from\s+['"]zod['"]/.test(line)) continue;
    report('R10', file, index + 1, 'shared/ may only import zod');
  }
}

// R11 — spawning is centralised.
eachMatch('R11', inBackend, (line, file) => {
  if (file.endsWith('backend/git/exec.js') || file.endsWith('backend/terminal.js')) return null;
  return /from\s+['"](node:)?child_process['"]/.test(line) ? 'child_process outside its single exit' : null;
});

// R12 — dependency blacklist.
{
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  // Libraries that either blow the bundle budget, carry an unusable licence, or call
  // `require('react')`/`require('react-dom')` in a way that becomes an `__require()` in
  // our IIFE build — that throws "Dynamic require of react is not supported" at import.
  const banned = ['monaco-editor', '@gitgraph/core', '@gitgraph/react', 'gitgraph', '@uiw/react-codemirror',
    'diff2html', 'prismjs', 'highlight.js', 'shiki', 'elkjs', 'dagre', 'simple-git', 'isomorphic-git', 'node-pty',
    '@tanstack/react-virtual'];
  const all = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
  for (const name of banned) {
    if (name in all) report('R12', 'package.json', 1, `banned dependency '${name}'`);
  }
}

// R13 — language packs are an explicit whitelist.
eachMatch('R13', (file) => inFrontend(file) && !file.endsWith('frontend/editor/languages.js'), (line) => {
  if (!/from\s+['"]@codemirror\/lang-/.test(line) && !/import\(\s*['"]@codemirror\/lang-/.test(line)) return null;
  return '@codemirror/lang-* outside editor/languages.js';
});

// R14 — react is runtime-injected by the ModuleLoader, never imported.
eachMatch('R14', inFrontend, (line) => {
  const match = line.match(/from\s+['"](react(-dom)?(\/[^'"]*)?)['"]/);
  if (!match) return null;
  if (/from\s+['"]\.\/runtime/.test(line) || /from\s+['"]\.\.?\/.*runtime/.test(line)) return null;
  return `imports '${match[1]}' directly; use runtime.tsx (h/Fragment/hooks)`;
});

if (failed > 0) {
  console.error(`static check failed: ${failed} violation(s)`);
  process.exit(1);
}
console.log(`static check passed (${files.length} files)`);
