#!/usr/bin/env node
/**
 * Build pipeline (see docs/build.md §2). Order is load-bearing:
 * static check → clean → source-shape assertions → copy backend → bundle client
 * → strip trailing whitespace → language whitelist → gzip budget → summary.
 *
 * `--check` verifies that lib/ is current without producing anything.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lib = path.join(root, 'lib');
const checkOnly = process.argv.includes('--check');

const STYLE_ID = 'dsh-workspace-ide';
const GZIP_BUDGET = 1_220_000;
const LANG_ALLOW = new Set([
  'lang-javascript', 'lang-json', 'lang-html', 'lang-css', 'lang-markdown', 'lang-python',
  'lang-rust', 'lang-go', 'lang-java', 'lang-cpp', 'lang-xml', 'lang-yaml', 'lang-sql', 'lang-php',
]);
const FORBID_MSG = 'unexpected language/grammar bundled';
const FORBIDDEN_INPUT = /(monaco-editor|@gitgraph\/|gitgraph\/|elkjs|dagre)/;

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}

function assertSourceShape(text, file) {
  if (!text.includes('export function apply')) fail(`${file} must export apply`);
}

// --- step 0 / --check body -------------------------------------------------
if (checkOnly) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/check.mjs')], { stdio: 'inherit' });
  if (result.status !== 0) fail('static check failed');

  const clientPath = path.join(lib, 'client.js');
  if (!existsSync(clientPath)) fail('lib/client.js is missing; run pnpm build');
  const clientMtime = (await stat(clientPath)).mtimeMs;
  const sources = [
    ...(await walk(path.join(root, 'frontend'))),
    ...(await walk(path.join(root, 'shared'))),
    ...(await walk(path.join(root, 'backend'))),
  ];
  for (const file of sources) {
    const { mtimeMs } = await stat(file);
    if (mtimeMs > clientMtime) fail(`lib/client.js is stale; run pnpm build (${path.relative(root, file)} changed)`);
  }
  console.log(`ok: lib/client.js is current (${(await stat(clientPath)).size} bytes)`);
  process.exit(0);
}

// --- step 0: static check --------------------------------------------------
{
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/check.mjs')], { stdio: 'inherit' });
  if (result.status !== 0) fail('static check failed');
}

// --- step 1: clean ---------------------------------------------------------
await rm(lib, { recursive: true, force: true });
await mkdir(lib, { recursive: true });

// --- step 2: source shape --------------------------------------------------
{
  const entry = await readFile(path.join(root, 'frontend/index.js'), 'utf8');
  if (!entry.includes('window.__ModuleLoader__.load')) {
    fail('frontend/index.js must register through the DSH ModuleLoader');
  }
  assertSourceShape(await readFile(path.join(root, 'backend/index.js'), 'utf8'), 'backend/index.js');
}

// --- step 3: copy backend verbatim ----------------------------------------
const backendFiles = (await walk(path.join(root, 'backend'))).filter((file) => file.endsWith('.js'));
for (const file of backendFiles) {
  let text = await readFile(file, 'utf8');
  if (!text.includes('export ')) fail(`backend module ${path.relative(root, file)} exports nothing`);
  if (!text.endsWith('\n')) text += '\n';
  const target = path.join(lib, path.relative(path.join(root, 'backend'), file));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, text);
}
{
  let text = await readFile(path.join(root, 'shared/contract.js'), 'utf8');
  if (!text.endsWith('\n')) text += '\n';
  await mkdir(path.join(lib, 'shared'), { recursive: true });
  await writeFile(path.join(lib, 'shared/contract.js'), text);
  const errors = await readFile(path.join(root, 'shared/errors.js'), 'utf8');
  await writeFile(path.join(lib, 'shared/errors.js'), errors.endsWith('\n') ? errors : `${errors}\n`);
}

// --- step 4: bundle client -------------------------------------------------
const esbuild = await import('esbuild');
const result = await esbuild.build({
  entryPoints: [path.join(root, 'frontend/index.js')],
  outfile: path.join(lib, 'client.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  // Classic JSX emit: `jsx: 'automatic'` would import react/jsx-runtime, which with
  // `external` becomes a bare `require()` at bundle top level — the host only hands
  // `require` to the ModuleLoader factory, so that throws before apply() runs.
  jsx: 'transform',
  jsxFactory: 'h',
  jsxFragment: 'Fragment',
  minify: true,
  sourcemap: false,
  loader: { '.css': 'text', '.jsx': 'jsx' },
  inject: [path.join(root, 'frontend/jsx-shim.js')],
  external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'],
  define: { 'process.env.NODE_ENV': '"production"' },
  metafile: true,
  logLevel: 'silent',
});

// --- step 5: strip trailing whitespace ------------------------------------
{
  const code = await readFile(path.join(lib, 'client.js'), 'utf8');
  await writeFile(path.join(lib, 'client.js'), code.replace(/[\t ]+$/gm, ''));
}

// --- step 6: language / dependency whitelist ------------------------------
for (const input of Object.keys(result.metafile.inputs)) {
  const match = input.match(/@codemirror\/(lang-[a-z]+)/);
  if (match && !LANG_ALLOW.has(match[1])) fail(`${FORBID_MSG}: @codemirror/${match[1]}`);
  if (FORBIDDEN_INPUT.test(input)) fail(`${FORBID_MSG}: ${input}`);
}

// --- step 7: gzip budget --------------------------------------------------
const code = await readFile(path.join(lib, 'client.js'));
const gzip = gzipSync(code, { level: 9 }).length;
if (gzip > GZIP_BUDGET) fail(`client bundle exceeds 1.2 MB gzip (actual ${gzip})`);

// --- step 8: summary ------------------------------------------------------
const top = Object.entries(result.metafile.outputs[path.relative(process.cwd(), path.join(lib, 'client.js'))]?.inputs ?? {})
  .sort((a, b) => b[1].bytesInOutput - a[1].bytesInOutput)
  .slice(0, 10)
  .map(([file, info]) => `  ${(info.bytesInOutput / 1024).toFixed(1)} kB  ${file}`);
console.log(`backend: ${backendFiles.map((file) => path.relative(root, file)).join(', ')}`);
console.log(`client: ${code.length} bytes raw, ${gzip} bytes gzip (budget ${GZIP_BUDGET})`);
console.log(`heaviest inputs:\n${top.join('\n')}`);
console.log(`style id: ${STYLE_ID}`);
