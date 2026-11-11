#!/usr/bin/env node
/**
 * Build the host and client halves into `lib/`.
 *
 * The host half is plain ESM split over several files in `src/` (index.js plus
 * its imports), so every `src/*.js` module except the client template is copied
 * verbatim. Copying only `index.js` would leave its `./host.js` import dangling
 * and the whole bundle would be skipped at boot with ERR_MODULE_NOT_FOUND.
 */
import { build } from 'esbuild';
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "src");
const outDir = path.join(root, "lib");
const CLIENT_TEMPLATE = "client.template.js";

const template = await readFile(path.join(srcDir, CLIENT_TEMPLATE), "utf8");
if (!template.includes("window.__ModuleLoader__.load")) {
  throw new Error("client template must use the DSH ModuleLoader");
}
const host = await readFile(path.join(srcDir, "index.js"), "utf8");
if (!host.includes("export function apply")) {
  throw new Error("host entrypoint must export apply");
}

await mkdir(outDir, { recursive: true });

const sources = (await readdir(srcDir)).filter((file) => file.endsWith(".js") && file !== CLIENT_TEMPLATE);
for (const file of sources) {
  const content = await readFile(path.join(srcDir, file), "utf8");
  if (!content.includes("export ")) throw new Error(`host module ${file} exports nothing`);
  await writeFile(path.join(outDir, file), content.endsWith("\n") ? content : content + "\n");
}
await build({ entryPoints: [path.join(srcDir, CLIENT_TEMPLATE)], outfile: path.join(outDir, 'client.js'), bundle: true, platform: 'browser', format: 'iife', target: 'es2022', minify: true });
// Minified dependency templates can retain EOL spaces; keep generated diffs clean.
const clientPath = path.join(outDir, 'client.js');
const clientBundle = await readFile(clientPath, 'utf8');
await writeFile(clientPath, clientBundle.replace(/[\t ]+$/gm, ''));

console.log(`built dsh-plugin-dev-sandbox (${sources.join(", ")} + client.js)`);
