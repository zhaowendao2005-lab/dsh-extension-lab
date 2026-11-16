#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKET_FILE = path.join(ROOT, 'marketplace.json');
const REPO_URL = 'https://github.com/zhaowendao2005-lab/dsh-extension-lab';

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  if (result.error) fail(`${command} failed: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} failed${result.stderr ? `:\n${result.stderr.trim()}` : ''}`);
  }
  return (result.stdout || '').trim();
}

function parseArgs(argv) {
  const opts = { dryRun: false, yes: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--init-marketplace') opts.initMarketplace = true;
    else if (arg === '--package' || arg === '-p') opts.package = argv[++i];
    else if (arg === '--version' || arg === '-v') opts.version = argv[++i];
    else if (arg === '--message' || arg === '-m') opts.message = argv[++i];
    else if (arg === '--market-message') opts.marketMessage = argv[++i];
    else if (arg === '--yes' || arg === '-y') opts.yes = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else fail(`Unknown argument: ${arg}`);
  }
  if (!opts.help && !opts.package) fail('Missing required --package <name-or-directory>');
  if (opts.version && !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(opts.version)) {
    fail(`Invalid version: ${opts.version}`);
  }
  return opts;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function getGitStatus() {
  const result = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: ROOT, encoding: 'utf8' });
  if (result.error) fail(`git failed: ${result.error.message}`);
  if (result.status !== 0) fail(`git status failed${result.stderr ? `:\n${result.stderr.trim()}` : ''}`);
  return result.stdout || '';
}

function changedPaths(status) {
  // Do not trim: a leading " M" line means the first character of the output is significant.
  return status.split('\n').filter(Boolean).map((line) => {
    const path = line.slice(3);
    const arrow = path.indexOf(' -> ');
    return arrow === -1 ? path : path.slice(arrow + 4);
  });
}

function isInsidePackage(file, packagePath) {
  return file === packagePath || file.startsWith(`${packagePath}/`);
}

function ensureUniqueVersion(packageEntry, version) {
  if (packageEntry?.versions?.some((item) => item.version === version)) {
    fail(`${packageEntry.name}@${version} already exists in marketplace.json`);
  }
}

function getNextVersion(current, requested) {
  if (requested) return requested;
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current || '');
  if (!match) fail(`Cannot auto-increment non-stable version ${current}; pass --version explicitly`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function readMarketplaceEntryTemplate(packagePath, pkg, { required }) {
  const file = path.join(ROOT, packagePath, 'marketplace-entry.json');
  if (!required && !existsSync(file)) return undefined;
  const template = readJson(file);
  const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const localized = (value) => object(value) && typeof value.en === 'string' && value.en.trim() && Object.values(value).every((item) => typeof item === 'string' && item.trim());
  const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim());
  if (!object(template) || Object.keys(template).sort().join(',') !== 'description,metadata,title' || !localized(template.title) || !localized(template.description)) fail('Initial marketplace template must contain only localized title, description, and metadata');
  const metadata = template.metadata;
  if (!object(metadata) || Object.keys(metadata).sort().join(',') !== 'keywords,labels,sortKeys' || !strings(metadata.keywords) || !strings(metadata.labels) || !object(metadata.sortKeys) || !Object.values(metadata.sortKeys).every((value) => typeof value === 'number' && Number.isFinite(value))) fail('Initial marketplace metadata must contain keywords[], labels[], and numeric sortKeys{}');
  return { name: pkg.name, ...template, versions: [] };
}

function readInitialMarketplaceEntry(packagePath, pkg) {
  return readMarketplaceEntryTemplate(packagePath, pkg, { required: true });
}

function readPublishedMarketplaceEntry(packagePath, pkg) {
  return readMarketplaceEntryTemplate(packagePath, pkg, { required: false });
}

function applyEntryTemplate(entry, template) {
  if (!template) return entry;
  entry.title = structuredClone(template.title);
  entry.description = structuredClone(template.description);
  entry.metadata = structuredClone(template.metadata);
  return entry;
}

function validateMarketplace(doc) {
  if (doc.format !== 1 || !Array.isArray(doc.plugins)) fail('marketplace.json must use Format 1 with plugins[]');
  for (const entry of doc.plugins) {
    if (!entry.name || !Array.isArray(entry.versions) || !entry.versions.length) {
      fail(`Invalid marketplace plugin entry: ${entry?.name ?? '(unknown)'}`);
    }
  }
}

function validateGitState(packagePath, dryRun) {
  const branch = run('git', ['branch', '--show-current']);
  if (branch !== 'main') fail(`Release must run on main; current branch is ${branch || '(detached HEAD)'}`);
  const upstream = run('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (!upstream) fail('Current branch has no upstream');
  const staged = run('git', ['diff', '--cached', '--name-only']);
  if (staged) fail(`Index contains staged changes; commit or unstage them before release:\n${staged}`);
  const status = getGitStatus();
  const changed = changedPaths(status);
  const dirtyPackageFiles = changed.filter((file) => isInsidePackage(file, packagePath));
  const dirtyMarketplace = changed.filter((file) => file === 'marketplace.json');
  if (dirtyMarketplace.length) {
    fail('marketplace.json has pre-existing changes; commit or discard them before release');
  }
  if (dirtyPackageFiles.length) {
    console.log(`Target package changes to include in release commit:\n${dirtyPackageFiles.map((f) => `  ${f}`).join('\n')}`);
  }
  const ahead = Number(run('git', ['rev-list', '--count', `${upstream}..HEAD`]) || 0);
  const behind = Number(run('git', ['rev-list', '--count', `HEAD..${upstream}`]) || 0);
  if (behind > 0) fail(`Local main is behind ${upstream}; pull/reconcile before release`);
  if (ahead > 0) console.log(`Note: main is ${ahead} commit(s) ahead of ${upstream}; these will be included in the push.`);
  return { status, dirtyPackageFiles, upstream };
}

function verifyStagedPaths(expected, label) {
  const paths = run('git', ['diff', '--cached', '--name-only']).split('\n').filter(Boolean).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(paths) !== JSON.stringify(wanted)) {
    fail(`${label} staged paths differ from expected. Expected: ${wanted.join(', ')}; found: ${paths.join(', ') || '(none)'}`);
  }
}

function verifyMarketplaceChange(before, after, packageName, packagePath, version, packageCommit, timestamp, pkg, initialEntry, template) {
  const oldEntries = before.plugins;
  const newEntries = after.plugins;
  if (JSON.stringify(oldEntries.filter((item) => item.name !== packageName)) !== JSON.stringify(newEntries.filter((item) => item.name !== packageName))) {
    fail('Marketplace edit changed entries outside the target package');
  }
  const oldTarget = oldEntries.find((item) => item.name === packageName);
  const newTarget = newEntries.find((item) => item.name === packageName);
  if (!newTarget || (!oldTarget && !initialEntry)) fail('Marketplace target entry is missing');
  const expectedTarget = applyEntryTemplate(structuredClone(oldTarget || initialEntry), template);
  expectedTarget.versions.unshift({
    version,
    publishTimestamp: timestamp,
    source: { type: 'git', url: REPO_URL, commit: packageCommit, path: packagePath },
    ...(pkg.engines?.dsh ? { engines: { dsh: pkg.engines.dsh } } : {}),
  });
  if (JSON.stringify(expectedTarget) !== JSON.stringify(newTarget)) {
    fail('Marketplace edit contains unexpected changes to the target package entry');
  }
}

function messageTopic(pkg) {
  return pkg.name.startsWith('@') ? pkg.name.split('/').pop() : pkg.name;
}

function defaultMessages(pkg, version) {
  return {
    first: `feat(${messageTopic(pkg)}): release ${version}`,
    second: `chore(marketplace): publish ${pkg.name}@${version}`,
  };
}

function normalizeMessage(message, label) {
  const text = (message || '').trim();
  if (!text) fail(`${label} must not be empty`);
  if (text.includes('\n')) fail(`${label} must be a single line`);
  return text;
}

async function askLine(rl, prompt) {
  try {
    return (await rl.question(prompt)).trim();
  } catch (error) {
    if (/abort|ctrl\+d|eof/i.test(String(error?.message ?? error))) {
      fail('Commit-message prompt was aborted by a closed stdin (Ctrl+D/EOF). Run without a TTY using --message "<package commit>" --market-message "<marketplace commit>", or --yes to accept the default messages.');
    }
    throw error;
  }
}

async function resolveCommitMessages(options, pkg, version) {
  const defaults = defaultMessages(pkg, version);
  if (options.message !== undefined || options.marketMessage !== undefined) {
    if (options.message === undefined || options.marketMessage === undefined) {
      fail('Pass both --message and --market-message, or neither');
    }
    return {
      first: normalizeMessage(options.message, '--message'),
      second: normalizeMessage(options.marketMessage, '--market-message'),
    };
  }
  if (options.yes) return { ...defaults };
  if (!stdin.isTTY) {
    fail('No TTY for the interactive commit-message prompts. Pass --message "<package commit>" --market-message "<marketplace commit>", or --yes to accept the default messages.');
  }
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const firstAnswer = await askLine(rl, `First commit (package code) [${defaults.first}]: `);
    const secondAnswer = await askLine(rl, `Second commit (marketplace index) [${defaults.second}]: `);
    return {
      first: normalizeMessage(firstAnswer || defaults.first, 'First commit message'),
      second: normalizeMessage(secondAnswer || defaults.second, 'Second commit message'),
    };
  } finally {
    rl.close();
  }
}

function trackFile(backups, file) {
  if (!backups.has(file)) backups.set(file, readFileSync(file, 'utf8'));
}

function rollback(backups, packageJsonPath, committed) {
  const restored = [];
  for (const [file, content] of backups) {
    if (committed && file === packageJsonPath) continue;
    writeFileSync(file, content);
    restored.push(path.relative(ROOT, file));
  }
  if (restored.length) {
    try {
      run('git', ['restore', '--staged', '--', ...restored]);
    } catch {
      // Unstaging is best-effort; the working tree content is already restored.
    }
  }
  return restored;
}

function updatePackageVersion(packageJsonPath, pkg, version) {
  pkg.version = version;
  writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function updateMarketplace(doc, entry, pkg, version, packagePath, commit, timestamp) {
  const record = {
    version,
    publishTimestamp: timestamp,
    source: { type: 'git', url: REPO_URL, commit, path: packagePath },
    ...(pkg.engines?.dsh ? { engines: { dsh: pkg.engines.dsh } } : {}),
  };
  entry.versions.unshift(record);
  writeFileSync(MARKET_FILE, `${JSON.stringify(doc, null, 2)}\n`);
}

function showHelp() {
  console.log('Usage: pnpm release --package <name-or-directory> [--version X.Y.Z] [--init-marketplace] [--dry-run]');
  console.log('First publication: --init-marketplace reads packages/<name>/marketplace-entry.json; existing entries reject this flag.');
  console.log('       pnpm release --package <name> --message "..." --market-message "..."   (no TTY needed)');
  console.log('       pnpm release --package <name> --yes                                    (accept default messages)');
  console.log('Default version: increment patch. Tag: <package-name>-v<version>.');
  console.log('Without --message/--market-message or --yes, both commit messages are asked interactively (TTY required).');
  console.log('On failure before the package commit, the working tree is restored automatically.');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return showHelp();
  const requested = options.package.replace(/^packages\//, '').replace(/\/$/, '');
  if (requested.includes('/') || requested.includes('..')) fail('--package must be a package name or direct packages/<directory>');
  const packagePath = `packages/${requested}`;
  const packageJsonPath = path.join(ROOT, packagePath, 'package.json');
  if (!existsSync(packageJsonPath)) fail(`Package not found: ${packageJsonPath}`);
  const pkg = readJson(packageJsonPath);
  if (pkg.name !== requested && path.basename(packagePath) !== requested) {
    fail(`Package directory/name mismatch: requested ${requested}, package.json name is ${pkg.name}`);
  }
  const version = getNextVersion(pkg.version, options.version);
  const market = readJson(MARKET_FILE);
  validateMarketplace(market);
  const entry = market.plugins.find((plugin) => plugin.name === pkg.name);
  if (entry && options.initMarketplace) fail(`Marketplace entry already exists for ${pkg.name}; omit --init-marketplace`);
  if (!entry && !options.initMarketplace) fail(`No marketplace entry found for ${pkg.name}; first publication requires --init-marketplace and a reviewed marketplace-entry.json`);
  const initialEntry = options.initMarketplace ? readInitialMarketplaceEntry(packagePath, pkg) : undefined;
  const entryTemplate = initialEntry ?? readPublishedMarketplaceEntry(packagePath, pkg);
  ensureUniqueVersion(entry, version);
  if (version === pkg.version) fail(`Target version equals current version ${pkg.version}`);
  const tag = `${pkg.name}-v${version}`;
  if (run('git', ['tag', '--list', tag])) fail(`Tag already exists: ${tag}`);
  const state = validateGitState(packagePath, options.dryRun);
  const buildScript = pkg.scripts?.build;
  if (!buildScript) fail(`${pkg.name} has no build script`);

  console.log(`Package: ${pkg.name}\nCurrent: ${pkg.version}\nTarget: ${version}\nPath: ${packagePath}\nBuild: pnpm --dir ${packagePath} run build\nTag: ${tag}\nMarketplace: marketplace.json`);
  if (initialEntry) console.log(`Initial marketplace entry: ${JSON.stringify(initialEntry)}`);
  else if (entryTemplate) console.log('Marketplace metadata: title/description/metadata will be refreshed from marketplace-entry.json');
  if (options.dryRun) {
    console.log(`Dry-run: no files changed, no build, commit, tag, or push executed.\nWorking-tree changes outside target package are preserved.\nMarketplace source.commit will point to the package commit; push target: ${state.upstream}.`);
    return;
  }

  const messages = await resolveCommitMessages(options, pkg, version);

  const backups = new Map();
  let committed = false;
  try {
    run('pnpm', ['--dir', packagePath, 'run', 'build'], { inherit: true });
    const pkgAfterBuild = readJson(packageJsonPath);
    if (pkgAfterBuild.version !== pkg.version) fail('Build modified package.json version unexpectedly');
    if (initialEntry && JSON.stringify(readInitialMarketplaceEntry(packagePath, pkgAfterBuild)) !== JSON.stringify(initialEntry)) fail('Build changed the reviewed initial marketplace template');
    if (!initialEntry && entryTemplate && JSON.stringify(readPublishedMarketplaceEntry(packagePath, pkgAfterBuild)) !== JSON.stringify(entryTemplate)) fail('Build changed the marketplace metadata template');
    trackFile(backups, packageJsonPath);
    updatePackageVersion(packageJsonPath, pkgAfterBuild, version);

    run('git', ['add', '--', packagePath]);
    verifyStagedPaths(changedPaths(getGitStatus()).filter((file) => isInsidePackage(file, packagePath)), 'Package commit');
    run('git', ['diff', '--cached', '--check']);
    run('git', ['commit', '-m', messages.first], { inherit: true });
    committed = true;
    const packageCommit = run('git', ['rev-parse', 'HEAD']);
    const timestamp = Number(run('git', ['show', '-s', '--format=%ct', packageCommit]));

    const marketBeforeUpdate = readJson(MARKET_FILE);
    const marketAfterCommit = structuredClone(marketBeforeUpdate);
    let entryAfterCommit = marketAfterCommit.plugins.find((plugin) => plugin.name === pkg.name);
    if (initialEntry) {
      if (entryAfterCommit) fail(`Marketplace entry for ${pkg.name} appeared during initial release`);
      entryAfterCommit = structuredClone(initialEntry);
      marketAfterCommit.plugins.push(entryAfterCommit);
    }
    if (!entryAfterCommit) fail(`Marketplace entry for ${pkg.name} disappeared during release`);
    if (!initialEntry) applyEntryTemplate(entryAfterCommit, entryTemplate);
    ensureUniqueVersion(entryAfterCommit, version);
    trackFile(backups, MARKET_FILE);
    updateMarketplace(marketAfterCommit, entryAfterCommit, pkgAfterBuild, version, packagePath, packageCommit, timestamp);
    verifyMarketplaceChange(marketBeforeUpdate, marketAfterCommit, pkg.name, packagePath, version, packageCommit, timestamp, pkgAfterBuild, initialEntry, entryTemplate);
    run('git', ['add', '--', 'marketplace.json']);
    verifyStagedPaths(['marketplace.json'], 'Marketplace commit');
    run('git', ['diff', '--cached', '--check']);
    run('git', ['commit', '-m', messages.second], { inherit: true });

    run('git', ['tag', '-a', tag, packageCommit, '-m', `${pkg.name}@${version}`], { inherit: true });
    run('git', ['push', 'origin', 'main', tag], { inherit: true });
    console.log(`Published ${pkg.name}@${version}\nPackage commit: ${packageCommit}\nTag: ${tag}`);
  } catch (error) {
    try {
      error.releaseRollback = { restored: rollback(backups, packageJsonPath, committed), committed };
    } catch (rollbackError) {
      error.releaseRollback = { restored: [], committed, failure: String(rollbackError?.message ?? rollbackError) };
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(`Release failed: ${error instanceof Error ? error.message : String(error)}`);
  const info = error?.releaseRollback;
  if (info?.failure) {
    console.error(`Rollback also failed: ${info.failure}`);
    console.error('Inspect git status before continuing.');
  } else if (info?.committed) {
    console.error('The package commit already exists and was left in place (no automatic reset).');
    console.error(`Working-tree file(s) restored: ${info.restored.join(', ') || '(none)'}.`);
    console.error('Inspect git status, then finish the marketplace commit, tag, and push manually, or revert the package commit.');
  } else if (info?.restored?.length) {
    console.error(`Nothing was committed, tagged, or pushed. Restored: ${info.restored.join(', ')}.`);
  } else {
    console.error('Nothing was committed, tagged, or pushed; the working tree was left untouched.');
  }
  process.exitCode = 1;
});
