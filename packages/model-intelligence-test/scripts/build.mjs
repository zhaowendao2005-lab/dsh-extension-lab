import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import esbuild from 'esbuild';
import ts from 'typescript';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import tailwindConfig from '../tailwind.config.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

// Static architecture diagnostics are part of compilation, not behavioral tests.
async function sources(directory) {
 const entries = await readdir(directory, {withFileTypes: true});
 return (await Promise.all(entries.map(entry => entry.isDirectory() ? sources(path.join(directory, entry.name)) : /\.[jt]sx?$/.test(entry.name) ? [path.join(directory, entry.name)] : []))).flat();
}
async function architecture() {
 const violations = [];
 for (const file of await sources(path.join(root, 'frontend'))) {
  const relative = path.relative(root, file).replaceAll('\\', '/');
  const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const view = /^frontend\/(views|components)\//.test(relative);
  const store = relative.endsWith('.stores.ts');
  function visit(node) {
   if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
    const spec = node.moduleSpecifier.text;
     if (store && spec.includes('.datasource') && path.basename(spec).replace('.datasource', '') !== path.basename(file).replace('.stores.ts', '')) violations.push(`${relative}: store imports another domain datasource: ${spec}`);
     if (/^frontend\/components\//.test(relative) && /(\/stores\/|\/views\/)/.test(spec)) violations.push(`${relative}: controlled component imports page/store: ${spec}`);
    if (spec.includes('backend')) violations.push(`${relative}: browser imports backend: ${spec}`);
    if (spec === 'react' && !node.importClause?.isTypeOnly) violations.push(`${relative}: React must come from runtime`);
    if (view && /(service|datasource|\.mock|backend)/.test(spec)) violations.push(`${relative}: view bypasses store: ${spec}`);
    if (store && /(\/service\/|\.mock)/.test(spec)) violations.push(`${relative}: store bypasses datasource: ${spec}`);
   }
   if (view && ts.isIdentifier(node) && ['useState','useReducer','fetch','localStorage','sessionStorage','XMLHttpRequest','WebSocket','setInterval','setTimeout'].includes(node.text)) violations.push(`${relative}: forbidden view state/IO ${node.text}`);
   ts.forEachChild(node, visit);
  }
  visit(source);
 }
 if (violations.length) throw new Error(violations.join('\n'));
}
await architecture();
const compiler = spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--project', path.join(root,'tsconfig.json')], {stdio: 'inherit'});
if (compiler.status !== 0) process.exit(compiler.status ?? 1);
await mkdir(path.join(root, 'lib'), {recursive: true});
const css = await postcss([tailwindcss(tailwindConfig)]).process('@tailwind utilities;\n' + await readFile(path.join(root, 'frontend/styles.css'), 'utf8'), {from: path.join(root,'frontend/styles.css')});
await writeFile(path.join(root,'lib/styles.css'), css.css);
const cssPlugin = {name:'scoped-tailwind-text', setup(build) { build.onLoad({filter:/styles\.css$/}, () => ({contents:css.css, loader:'text'})); }};
const common = {bundle:true, target:'es2022', sourcemap:true, logLevel:'info'};
await esbuild.build({...common, entryPoints:['backend/index.js'], outfile:'lib/index.js', platform:'node', format:'esm', packages:'external'});
await esbuild.build({...common, entryPoints:['frontend/index.tsx'], outfile:'lib/client.js', platform:'browser', format:'iife', minify:true, plugins:[cssPlugin], define:{'process.env.NODE_ENV':'"production"'}});
console.log('Built Host, Client and scoped Tailwind CSS. No tests executed.');
