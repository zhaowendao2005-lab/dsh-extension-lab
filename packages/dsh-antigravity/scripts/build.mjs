#!/usr/bin/env node
/**
 * Build and typecheck script for dsh-antigravity.
 * Produces deterministic ESM host bundle (`lib/index.js`) and DSH ModuleLoader
 * client bundle (`lib/client.js`).
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..');
const packagesRoot = path.resolve(pkgRoot, '..');
const libDir = path.join(pkgRoot, 'lib');

const isCheck = process.argv.includes('--check');
const isDev = process.argv.includes('--development');
const typecheckOnly = process.argv.includes('--typecheck');

const NODE_MODULES_SEARCH = [
  path.join(pkgRoot, 'node_modules'),
  path.join(packagesRoot, 'model-intelligence-test', 'node_modules'),
  path.join(packagesRoot, 'dsh-btw-side', 'node_modules'),
  path.join(packagesRoot, 'dsh-plugin-dev-sandbox', 'node_modules'),
  path.join(packagesRoot, '..', 'extracted_files', 'dsh', 'node_modules'),
];

function resolveTool(pkgName) {
  for (const nm of NODE_MODULES_SEARCH) {
    const candidate = path.join(nm, pkgName);
    if (existsSync(candidate)) {
      const req = createRequire(path.join(nm, '_resolver.js'));
      return req(candidate);
    }
  }
  throw new Error(`Cannot locate "${pkgName}" in local or sibling node_modules`);
}

function findPackageDir(pkgName) {
  for (const nm of NODE_MODULES_SEARCH) {
    const candidate = path.join(nm, pkgName);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

const OFFLINE_NODE_AMBIENT_DTS = `
declare var process: {
  env: Record<string, string | undefined>;
  platform: string;
  arch: string;
  pid: number;
};
declare class Buffer extends Uint8Array {
  static from(value: string | ArrayBuffer | ArrayLike<number>, encoding?: string): Buffer;
  static isBuffer(obj: unknown): obj is Buffer;
  static concat(list: readonly Uint8Array[]): Buffer;
  toString(encoding?: string): string;
}
declare namespace NodeJS {
  interface ProcessEnv { [key: string]: string | undefined; }
  interface Timeout { unref?(): void; }
  interface ErrnoException extends Error { code?: string; }
}
declare function setTimeout(handler: (...args: any[]) => void, timeout?: number): NodeJS.Timeout;
declare function clearTimeout(id?: NodeJS.Timeout): void;
declare module 'node:crypto' {
  export function createHash(alg: string): { update(data: string | Uint8Array): { digest(enc: 'hex' | 'base64'): string; digest(): Buffer } };
  export function randomBytes(size: number): Buffer;
  export function randomUUID(): string;
}
declare module 'node:http' {
  export interface IncomingMessage extends AsyncIterable<Buffer | Uint8Array | string> {
    url?: string;
    method?: string;
    headers: Record<string, string | string[] | undefined>;
  }
  export interface ServerResponse {
    writeHead(statusCode: number, headers?: Record<string, string>): this;
    end(chunk?: string | Uint8Array): this;
  }
  export interface Server {
    on(event: string, listener: (...args: any[]) => void): this;
    once(event: string, listener: (...args: any[]) => void): this;
    off(event: string, listener: (...args: any[]) => void): this;
    listen(port: number, host: string): this;
    close(): this;
    address(): { port: number } | string | null;
  }
  export function createServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Server;
  const httpDefault: { createServer: typeof createServer };
  export default httpDefault;
}
declare module 'node:fs/promises' {
  export function mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<string | undefined>;
  export function chmod(path: string, mode: number): Promise<void>;
  export function readFile(path: string, encoding: 'utf8'): Promise<string>;
  export function writeFile(path: string, data: string, options?: { encoding?: string; mode?: number }): Promise<void>;
  export function rename(oldPath: string, newPath: string): Promise<void>;
  export function unlink(path: string): Promise<void>;
}
declare module 'node:os' {
  export function homedir(): string;
}
declare module 'node:path' {
  export function join(...paths: string[]): string;
  export function resolve(...paths: string[]): string;
  export function dirname(p: string): string;
  export function basename(p: string): string;
  const pathDefault: { join: typeof join; resolve: typeof resolve; dirname: typeof dirname; basename: typeof basename };
  export default pathDefault;
}
`;

function runTypecheck() {
  const ts = resolveTool('typescript');
  const tsconfigPath = path.join(pkgRoot, 'tsconfig.json');
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(ts.formatDiagnostic(configFile.error, {
      getCanonicalFileName: (f) => f,
      getCurrentDirectory: () => pkgRoot,
      getNewLine: () => '\n',
    }));
  }

  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, pkgRoot);
  const paths = { ...(parsed.options.paths ?? {}) };

  const pkgSpecs = [
    ['@deepseek-ai/dsh-llm', 'lib/types/index.d.ts'],
    ['@deepseek-ai/dsh-brand', 'lib/index.d.ts'],
    ['@deepseek-ai/cordis', 'lib/index.d.ts'],
    ['@deepseek-ai/schemastery', 'lib/types/index.d.ts'],
    ['@deepseek-ai/dsh-attachment', 'lib/types/index.d.ts'],
    ['@types/react', 'index.d.ts'],
  ];

  for (const [spec, entry] of pkgSpecs) {
    const dir = findPackageDir(spec);
    if (dir && existsSync(path.join(dir, entry))) {
      paths[spec] = [path.join(dir, entry)];
    }
  }

  const reactTypesDir = findPackageDir('@types/react');
  if (reactTypesDir && existsSync(path.join(reactTypesDir, 'index.d.ts'))) {
    paths['react'] = [path.join(reactTypesDir, 'index.d.ts')];
  }

  const validTypeRoots = NODE_MODULES_SEARCH
    .map((nm) => path.join(nm, '@types'))
    .filter((d) => {
      if (!existsSync(d)) return false;
      // Ignore stripped `@types` trees (e.g. extracted binary dist) lacking actual `.d.ts` entrypoints.
      return (
        existsSync(path.join(d, 'node', 'index.d.ts')) ||
        existsSync(path.join(d, 'react', 'index.d.ts'))
      );
    });

  const hasNodeTypes = validTypeRoots.some((tr) =>
    existsSync(path.join(tr, 'node', 'index.d.ts')),
  );

  const options = {
    ...parsed.options,
    baseUrl: pkgRoot,
    paths,
    allowImportingTsExtensions: true,
    typeRoots: validTypeRoots,
    ...(hasNodeTypes
      ? {}
      : { types: reactTypesDir ? ['react'] : [] }),
  };

  const host = ts.createCompilerHost(options);
  const virtualNodePath = path.join(pkgRoot, '__offline_node_ambient.d.ts');
  const baseGetSourceFile = host.getSourceFile.bind(host);
  const baseFileExists = host.fileExists.bind(host);

  if (!hasNodeTypes) {
    host.fileExists = (fileName) =>
      fileName === virtualNodePath ? true : baseFileExists(fileName);
    host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
      if (fileName === virtualNodePath) {
        return ts.createSourceFile(fileName, OFFLINE_NODE_AMBIENT_DTS, languageVersion);
      }
      return baseGetSourceFile(fileName, languageVersion, onError, shouldCreate);
    };
  }

  // Remap missing `@deepseek-ai/*` or `react` module specifiers when building offline without local node_modules.
  const baseResolve = host.resolveModuleNameLiterals?.bind(host);
  const rootFiles = hasNodeTypes
    ? parsed.fileNames
    : [...parsed.fileNames, virtualNodePath];

  const program = ts.createProgram({
    rootNames: rootFiles,
    options,
    host: baseResolve
      ? {
          ...host,
          resolveModuleNameLiterals(literals, containingFile, redirectedRef, opts, sourceFile, reusedNames) {
            return baseResolve(literals, containingFile, redirectedRef, opts, sourceFile, reusedNames);
          },
        }
      : host,
  });

  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length > 0) {
    const formatted = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (f) => f,
      getCurrentDirectory: () => pkgRoot,
      getNewLine: () => '\n',
    });
    console.error(formatted);
    process.exit(1);
  }
}

async function bundleHost(esbuild) {
  const result = await esbuild.build({
    entryPoints: [path.join(pkgRoot, 'src/host/index.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    minify: false,
    sourcemap: false,
    external: ['node:*', '@deepseek-ai/*'],
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

async function bundleClient(esbuild) {
  const result = await esbuild.build({
    entryPoints: [path.join(pkgRoot, 'src/client/index.tsx')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    minify: !isDev,
    sourcemap: false,
    loader: { '.css': 'text' },
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

async function main() {
  runTypecheck();
  if (typecheckOnly) {
    console.log('dsh-antigravity: typecheck passed');
    return;
  }

  const esbuild = resolveTool('esbuild');
  const [hostCode, clientCode] = await Promise.all([
    bundleHost(esbuild),
    bundleClient(esbuild),
  ]);

  const hostOut = path.join(libDir, 'index.js');
  const clientOut = path.join(libDir, 'client.js');

  if (isCheck) {
    const [curHost, curClient] = await Promise.all([
      readFile(hostOut, 'utf8').catch(() => ''),
      readFile(clientOut, 'utf8').catch(() => ''),
    ]);
    if (curHost !== hostCode || curClient !== clientCode) {
      console.error('dsh-antigravity: lib artifacts are stale; run build');
      process.exit(1);
    }
    console.log(
      `dsh-antigravity: lib up to date (host=${hostCode.length}B, client=${clientCode.length}B)`,
    );
    return;
  }

  await mkdir(libDir, { recursive: true });
  await Promise.all([
    writeFile(hostOut, hostCode, 'utf8'),
    writeFile(clientOut, clientCode, 'utf8'),
  ]);
  console.log(
    `dsh-antigravity: built lib/index.js (${hostCode.length}B) & lib/client.js (${clientCode.length}B)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
