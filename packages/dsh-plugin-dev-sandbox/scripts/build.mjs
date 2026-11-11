#!/usr/bin/env node
/**
 * Build both halves into `lib/`.
 *
 * backend/: plain ESM copied verbatim (lib/index.js is the Host entry). Copying only
 * the entry would leave its relative imports dangling and DSH would skip the whole
 * bundle with ERR_MODULE_NOT_FOUND.
 * frontend/: ES modules bundled by esbuild into one browser IIFE (lib/client.js),
 * because ModuleLoader executes a single file per client module.
 */
import { build } from 'esbuild';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = path.join(root, 'backend');
const frontendDir = path.join(root, 'frontend');
const outDir = path.join(root, 'lib');

const clientEntry = await readFile(path.join(frontendDir, 'index.js'), 'utf8');
if (!clientEntry.includes('window.__ModuleLoader__.load')) {
  throw new Error('frontend/index.js must register through the DSH ModuleLoader');
}
const hostEntry = await readFile(path.join(backendDir, 'index.js'), 'utf8');
if (!hostEntry.includes('export function apply')) {
  throw new Error('backend/index.js must export apply');
}

await mkdir(outDir, { recursive: true });

// Host half: one flat lib/ file per backend module.
const backendFiles = (await readdir(backendDir)).filter((file) => file.endsWith('.js'));
for (const file of backendFiles) {
  const content = await readFile(path.join(backendDir, file), 'utf8');
  if (!content.includes('export ')) throw new Error(`backend module ${file} exports nothing`);
  await writeFile(path.join(outDir, file), content.endsWith('\n') ? content : `${content}\n`);
}

// Browser half: one bundled IIFE.
await build({
  entryPoints: [path.join(frontendDir, 'index.js')],
  outfile: path.join(outDir, 'client.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  minify: true,
  // xterm ships its stylesheet next to the JS; the panel injects that text into
  // its own <style> tag, so the bundle stays a single file.
  loader: { '.css': 'text' },
});

// Minified dependency templates can retain EOL spaces; keep generated diffs clean.
const clientPath = path.join(outDir, 'client.js');
const clientBundle = await readFile(clientPath, 'utf8');
await writeFile(clientPath, clientBundle.replace(/[\t ]+$/gm, ''));

console.log(`built dsh-plugin-dev-sandbox (backend: ${backendFiles.join(', ')}; frontend: index.js -> client.js)`);
