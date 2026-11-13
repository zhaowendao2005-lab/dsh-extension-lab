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
