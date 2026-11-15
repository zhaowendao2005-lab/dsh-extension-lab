import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const pkgRoot = path.resolve(here, '..', '..');
const packagesRoot = path.resolve(pkgRoot, '..');

const NODE_MODULES_SEARCH = [
  path.join(pkgRoot, 'node_modules'),
  path.join(packagesRoot, 'model-intelligence-test', 'node_modules'),
  path.join(packagesRoot, 'dsh-btw-side', 'node_modules'),
  path.join(packagesRoot, 'dsh-plugin-dev-sandbox', 'node_modules'),
  path.resolve(packagesRoot, '..', 'extracted_files', 'dsh', 'node_modules'),
];

function findPackageDir(pkgName) {
  for (const nm of NODE_MODULES_SEARCH) {
    const candidate = path.join(nm, pkgName);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function loadEsbuild() {
  for (const nm of NODE_MODULES_SEARCH) {
    const candidate = path.join(nm, 'esbuild');
    if (existsSync(candidate)) {
      const req = createRequire(path.join(nm, '_resolver.js'));
      return req(candidate);
    }
  }
  throw new Error('Cannot locate esbuild in local or sibling node_modules');
}

function resolveDeepseekEntry(pkgName) {
  const dir = findPackageDir(pkgName);
  if (!dir) {
    throw new Error(`Cannot locate ${pkgName} in local or sibling node_modules`);
  }
  if (pkgName === '@deepseek-ai/schemastery') {
    const mjs = path.join(dir, 'lib', 'index.mjs');
    return pathToFileURL(mjs).href;
  }
  const js = path.join(dir, 'lib', 'index.js');
  if (existsSync(js)) return pathToFileURL(js).href;
  const mjs = path.join(dir, 'lib', 'index.mjs');
  return pathToFileURL(mjs).href;
}

const tempRoot = path.join(os.tmpdir(), `dsh-antigravity-test-${process.pid}`);
mkdirSync(tempRoot, { recursive: true });
process.once('exit', () => {
  try {
    rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup.
  }
});

let bundleSeq = 0;
const compiledCache = new Map();

/**
 * Compile a `src/host/*.ts` module (with `@deepseek-ai/*` resolved to real installed
 * packages in workspace `node_modules`) so Node ESM tests run identically offline
 * or under `pnpm install`.
 */
export async function importHostModule(relPath) {
  if (compiledCache.has(relPath)) {
    return compiledCache.get(relPath);
  }

  const esbuild = loadEsbuild();
  const entryPath = path.join(pkgRoot, relPath);
  const outFile = path.join(tempRoot, `${++bundleSeq}-${path.basename(relPath, '.ts')}.mjs`);

  const rewriteDeepseekPlugin = {
    name: 'rewrite-deepseek-externals',
    setup(build) {
      build.onResolve({ filter: /^@deepseek-ai\// }, (args) => ({
        path: resolveDeepseekEntry(args.path),
        external: true,
      }));
    },
  };

  await esbuild.build({
    entryPoints: [entryPath],
    bundle: true,
    outfile: outFile,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    sourcemap: 'inline',
    external: ['node:*'],
    plugins: [rewriteDeepseekPlugin],
    logLevel: 'silent',
  });

  const modPromise = import(pathToFileURL(outFile).href);
  compiledCache.set(relPath, modPromise);
  return modPromise;
}

export async function importDshLlm() {
  return import(resolveDeepseekEntry('@deepseek-ai/dsh-llm'));
}

export async function importDshPackage(pkgName) {
  const dir = findPackageDir(pkgName);
  if (!dir) {
    throw new Error(`Cannot locate ${pkgName} in workspace or extracted DSH node_modules`);
  }
  const indexJs = path.join(dir, 'lib', 'index.js');
  if (existsSync(indexJs)) return import(pathToFileURL(indexJs).href);
  const indexMjs = path.join(dir, 'lib', 'index.mjs');
  return import(pathToFileURL(indexMjs).href);
}

const extractedNodeModules = path.resolve(packagesRoot, '..', 'extracted_files', 'dsh', 'node_modules');
const extractedCache = new Map();

function resolveExtractedEntry(pkgName) {
  const dir = path.join(extractedNodeModules, pkgName);
  if (!existsSync(dir)) {
    throw new Error(`Cannot locate ${pkgName} in extracted DSH node_modules`);
  }
  if (pkgName === '@deepseek-ai/schemastery') {
    return pathToFileURL(path.join(dir, 'lib', 'index.mjs')).href;
  }
  const js = path.join(dir, 'lib', 'index.js');
  if (existsSync(js)) return pathToFileURL(js).href;
  return pathToFileURL(path.join(dir, 'lib', 'index.mjs')).href;
}

/**
 * Compile a `src/host/*.ts` module against `extracted_files/dsh/node_modules/@deepseek-ai/*`
 * so `LlmError`/`LlmAdapter`/`Context`/`Schema` share a single ESM instance with real DSH packages.
 */
export async function importHostModuleFromExtracted(relPath) {
  if (extractedCache.has(relPath)) {
    return extractedCache.get(relPath);
  }
  const esbuild = loadEsbuild();
  const entryPath = path.join(pkgRoot, relPath);
  const outFile = path.join(tempRoot, `extracted-${++bundleSeq}-${path.basename(relPath, '.ts')}.mjs`);

  const rewriteExtractedPlugin = {
    name: 'rewrite-extracted-deepseek-externals',
    setup(build) {
      build.onResolve({ filter: /^@deepseek-ai\// }, (args) => ({
        path: resolveExtractedEntry(args.path),
        external: true,
      }));
    },
  };

  await esbuild.build({
    entryPoints: [entryPath],
    bundle: true,
    outfile: outFile,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    sourcemap: 'inline',
    external: ['node:*'],
    plugins: [rewriteExtractedPlugin],
    logLevel: 'silent',
  });

  const modPromise = import(pathToFileURL(outFile).href);
  extractedCache.set(relPath, modPromise);
  return modPromise;
}

export async function importExtractedPackage(pkgName) {
  return import(resolveExtractedEntry(pkgName));
}
