#!/usr/bin/env node
/** Build the host (`lib/index.js`) and client (`lib/client.js`) bundles. */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const btwNodeModules = path.resolve(root, '../dsh-btw-side/node_modules')
const localNodeModules = path.join(root, 'node_modules')

const require = createRequire(import.meta.url)

function resolveTool(specifier) {
  return require.resolve(specifier, { paths: [localNodeModules, btwNodeModules] })
}

const { build } = require(resolveTool('esbuild'))
const tscPath = resolveTool('typescript/bin/tsc')

const checkOnly = process.argv.includes('--check')
const isDev = process.argv.includes('--development')

const typecheck = spawnSync(
  process.execPath,
  [tscPath, '--project', path.join(root, 'tsconfig.json')],
  { stdio: 'inherit', cwd: root },
)
if (typecheck.status !== 0) process.exit(typecheck.status ?? 1)

const hostResult = await build({
  absWorkingDir: root,
  entryPoints: ['src/host/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  write: !checkOnly,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  // `packages: 'external'` only covers imports that still look like package
  // specifiers; tsconfig `paths` rewrites these to file paths first, so they
  // must be named explicitly or esbuild inlines their CJS builds and the ESM
  // bundle dies on a `require()` shim at load time.
  external: ['@deepseek-ai/cordis', '@deepseek-ai/schemastery', '@deepseek-ai/dsh-typert-protocol'],
  target: 'es2022',
  sourcemap: true,
  nodePaths: [localNodeModules, btwNodeModules],
  logLevel: checkOnly ? 'silent' : 'info',
})

const clientResult = await build({
  absWorkingDir: root,
  entryPoints: ['src/client/index.tsx'],
  outfile: 'lib/client.js',
  bundle: true,
  write: !checkOnly,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  minify: !isDev,
  sourcemap: true,
  external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'zod'],
  loader: { '.css': 'text' },
  define: {
    'process.env.NODE_ENV': isDev ? '"development"' : '"production"',
  },
  nodePaths: [localNodeModules, btwNodeModules],
  logLevel: checkOnly ? 'silent' : 'info',
})

if (checkOnly) {
  const outputs = [...(hostResult.outputFiles ?? []), ...(clientResult.outputFiles ?? [])]
  for (const out of outputs) {
    if (out.path.endsWith('.map')) continue
    const disk = await readFile(out.path, 'utf8').catch(() => '')
    if (disk !== out.text) {
      console.error(`build: ${path.relative(root, out.path)} is stale; run npm run build`)
      process.exit(1)
    }
  }
  console.log('build: lib/index.js and lib/client.js up to date')
  process.exit(0)
}

await mkdir(path.join(root, 'lib'), { recursive: true })
console.log('build: completed lib/index.js and lib/client.js')
