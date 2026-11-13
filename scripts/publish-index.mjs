#!/usr/bin/env node
/**
 * Update a single plugin entry in index.json (Format 1) and marketplace.json
 * without bumping global repo tags or touching sibling plugins.
 *
 * Usage:
 *   node scripts/publish-index.mjs <package-name-or-dir>
 *   node scripts/publish-index.mjs --validate
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const REPO_URL = 'https://github.com/zhaowendao2005-lab/dsh-extension-lab';
const INDEX_URL = 'https://raw.githubusercontent.com/zhaowendao2005-lab/dsh-extension-lab/main/index.json';
const INDEX_FILE = path.join(REPO_ROOT, 'index.json');
const MARKET_FILE = path.join(REPO_ROOT, 'marketplace.json');

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

async function validateIndex(doc) {
  const validatorPath = path.join(
    REPO_ROOT,
    'extracted_files/dsh/node_modules/@deepseek-ai/dsh-plugin-market-index/lib/index.js',
  );
  if (existsSync(validatorPath)) {
    const mod = await import(pathToFileURL(validatorPath).href);
    const parsed = mod.parseMarketIndex(doc, INDEX_URL);
    return { validator: '@deepseek-ai/dsh-plugin-market-index', count: parsed.plugins.length };
  }

  if (doc.format !== 1 || !Array.isArray(doc.plugins)) {
    throw new Error('index.json must use format: 1 and include plugins[]');
  }
  for (const plugin of doc.plugins) {
    if (!plugin.name || !Array.isArray(plugin.versions) || plugin.versions.length === 0) {
      throw new Error(`Invalid plugin entry: ${plugin?.name ?? 'unknown'}`);
    }
    for (const v of plugin.versions) {
      if (!v.version || !Number.isInteger(v.publishTimestamp) || !v.source?.type) {
        throw new Error(`Invalid version entry in ${plugin.name}: ${v?.version ?? 'unknown'}`);
      }
      if (v.source.type === 'git' && !/^[0-9a-f]{40}$/.test(v.source.commit || '')) {
        throw new Error(`Invalid git commit SHA in ${plugin.name}@${v.version}`);
      }
    }
  }
  return { validator: 'builtin', count: doc.plugins.length };
}

function getLatestPackageCommit(pkgRelDir) {
  const out = execFileSync(
    'git',
    ['log', '-1', '--format=%H %ct', '--', pkgRelDir],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  ).trim();
  if (!out) {
    throw new Error(`No committed history found for ${pkgRelDir}. Commit package changes first.`);
  }
  const [commit, tsRaw] = out.split(/\s+/);
  const publishTimestamp = Number(tsRaw);
  if (!/^[0-9a-f]{40}$/.test(commit) || !Number.isInteger(publishTimestamp)) {
    throw new Error(`Unexpected git log output for ${pkgRelDir}: ${out}`);
  }
  return { commit, publishTimestamp };
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node scripts/publish-index.mjs <package-name-or-dir> | --validate');
    process.exit(1);
  }

  const indexDoc = readJson(INDEX_FILE);
  if (arg === '--validate') {
    const res = await validateIndex(indexDoc);
    console.log(`index.json valid (${res.validator}, ${res.count} plugins)`);
    return;
  }

  const dirName = arg.replace(/^packages\//, '').replace(/\/+$/, '');
  const pkgRelDir = `packages/${dirName}`;
  const pkgJsonPath = path.join(REPO_ROOT, pkgRelDir, 'package.json');
  if (!existsSync(pkgJsonPath)) {
    throw new Error(`Package not found: ${pkgJsonPath}`);
  }

  const pkg = readJson(pkgJsonPath);
  const name = pkg.name;
  const version = pkg.version;
  const dshEngine = pkg.engines?.dsh;
  const { commit, publishTimestamp } = getLatestPackageCommit(pkgRelDir);

  let pluginEntry = indexDoc.plugins.find((p) => p.name === name);
  if (!pluginEntry) {
    pluginEntry = {
      name,
      title: { en: name, zh: name },
      description: { en: pkg.description || name, zh: pkg.description || name },
      author: 'zhaowendao2005',
      homepage: `${REPO_URL}/tree/main/${pkgRelDir}`,
      repository: { url: REPO_URL, directory: pkgRelDir },
      metadata: { category: 'tools', keywords: [], labels: [], sortKeys: {} },
      versions: [],
    };
    indexDoc.plugins.push(pluginEntry);
  }

  const versionRecord = {
    version,
    publishTimestamp,
    source: {
      type: 'git',
      url: REPO_URL,
      commit,
      path: pkgRelDir,
    },
    ...(dshEngine ? { engines: { dsh: dshEngine } } : {}),
  };

  const existingIdx = pluginEntry.versions.findIndex((v) => v.version === version);
  if (existingIdx >= 0) {
    pluginEntry.versions[existingIdx] = versionRecord;
  } else {
    pluginEntry.versions.unshift(versionRecord);
  }

  const res = await validateIndex(indexDoc);
  writeFileSync(INDEX_FILE, `${JSON.stringify(indexDoc, null, 2)}\n`);

  if (existsSync(MARKET_FILE)) {
    const market = readJson(MARKET_FILE);
    if (Array.isArray(market.extensions)) {
      const mEntry = market.extensions.find((e) => e.name === name);
      if (mEntry) {
        mEntry.version = version;
        delete mEntry.ref;
        writeFileSync(MARKET_FILE, `${JSON.stringify(market, null, 2)}\n`);
      }
    }
  }

  console.log(
    `Updated ${name}@${version} -> ${commit.slice(0, 7)} (validated via ${res.validator})`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
