import { randomBytes, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const AGENT_NAME = 'dsh-model';
export const APP_DATA_DIR = 'dsh-acp';
const OWNER = 'dsh-antigravity-acp';
const MAX_SYSTEM_BYTES = 8 * 1024 * 1024;
const owned = new WeakMap();

function validateBridge(bridge) {
  if (!bridge || typeof bridge !== 'object') throw new TypeError('An owned MCP bridge is required');
  let url;
  try { url = new URL(bridge.url); } catch { throw new TypeError('MCP bridge URL must be absolute'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || !url.port || url.username || url.password || url.search || url.hash) throw new TypeError('MCP bridge must use a loopback HTTP URL with an explicit port');
  if (typeof bridge.token !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(bridge.token)) throw new TypeError('MCP bridge token must be a random URL-safe token of at least 32 characters');
  if (!Array.isArray(bridge.toolNames) || bridge.toolNames.length > 1024) throw new TypeError('MCP bridge toolNames must be a bounded array');
  const names = new Set();
  for (const name of bridge.toolNames) {
    if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_-]{0,127}$/.test(name) || names.has(name)) throw new TypeError('MCP bridge tool names must be unique protocol identifiers');
    names.add(name);
  }
  return { url: url.toString(), token: bridge.token, toolNames: [...names] };
}

/** Only safe inherited values survive; tombstones also remove benign-but-routing env. */
export function runtimeEnvironment({ parent = process.env, temporaryDirectory, loginHome } = {}) {
  const env = {};
  for (const key of Object.keys(parent)) env[key] = undefined;
  const keep = /^(?:HOME|USERPROFILE|PATH|LANG|LC_[A-Z_]+|USER|LOGNAME|SHELL|SystemRoot|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT)$/;
  for (const [key, value] of Object.entries(parent)) {
    if (keep.test(key) && typeof value === 'string') env[key] = value;
  }
  if (loginHome !== undefined) {
    if (typeof loginHome !== 'string' || !path.isAbsolute(loginHome) || loginHome.includes('\0')) throw new TypeError('CLI login home must be an absolute path without NUL bytes');
    env.HOME = loginHome;
    if (process.platform === 'win32' || typeof parent.USERPROFILE === 'string') env.USERPROFILE = loginHome;
  }
  if (temporaryDirectory) {
    env.TMPDIR = temporaryDirectory;
    env.TMP = temporaryDirectory;
    env.TEMP = temporaryDirectory;
  }
  return env;
}

async function directory(name) {
  await fs.mkdir(name, { mode: 0o700 });
  await fs.chmod(name, 0o700);
}

async function privateFile(name, content) {
  await fs.writeFile(name, content, { mode: 0o600, flag: 'wx' });
  await fs.chmod(name, 0o600);
}

/** Creates new directories only. All files exist before a CLI process can start. */
export async function createIsolation({ bridge, systemPrompt = '', toolDeclaration = 'null', bridgeTimeoutMs = 600_000 } = {}) {
  const checkedBridge = validateBridge(bridge);
  if (!Number.isSafeInteger(bridgeTimeoutMs) || bridgeTimeoutMs <= 0 || bridgeTimeoutMs > 1_800_000) throw new TypeError('bridgeTimeoutMs must be a positive integer no greater than 1800000');
  if (!['null', 'omitted', '[]'].includes(toolDeclaration)) throw new TypeError('toolDeclaration must be null, omitted, or []');
  if (typeof systemPrompt !== 'string' || systemPrompt.includes('\0') || Buffer.byteLength(systemPrompt) > MAX_SYSTEM_BYTES) throw new TypeError('systemPrompt must be a bounded string without NUL bytes');
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), `${OWNER}-`)));
  await fs.chmod(root, 0o700);
  const identity = { owner: OWNER, formatVersion: 1, id: randomUUID(), nonce: randomBytes(32).toString('hex'), root };
  const isolation = Object.freeze({
    root,
    cwd: path.join(root, 'workspace'),
    geminiDir: path.join(root, 'gemini'),
    temporaryDirectory: path.join(root, 'tmp'),
    appDataDir: APP_DATA_DIR,
    agentName: AGENT_NAME,
    toolDeclaration,
    // This profile is an empirical candidate. Only the adapter owns any prompt gate.
    certificate: false,
  });
  owned.set(isolation, identity);
  try {
    await privateFile(path.join(root, 'owner.json'), `${JSON.stringify(identity)}\n`);
    await directory(isolation.cwd);
    await directory(isolation.temporaryDirectory);
    await directory(isolation.geminiDir);
    const configDir = path.join(isolation.geminiDir, 'config');
    await directory(configDir);
    const agentsDir = path.join(configDir, 'agents');
    await directory(agentsDir);
    const agentDir = path.join(agentsDir, AGENT_NAME);
    await directory(agentDir);
    const appDataPath = path.join(isolation.geminiDir, APP_DATA_DIR);
    await directory(appDataPath);
    const frontmatter = [
      '---',
      `name: ${AGENT_NAME}`,
      'description: DSH model shell.',
      'mainAgent: true',
      'subagent: false',
      'hidden: true',
      'excludeDefaultComponents: true',
      'inheritMcp: true',
      ...(toolDeclaration === 'omitted' ? [] : [`tools: ${toolDeclaration}`]),
      'skills: []',
      'plugins: []',
      '---',
      systemPrompt || 'Answer the user directly and concisely. Use the tools supplied by DSH when useful.',
      '',
    ].join('\n');
    await privateFile(path.join(agentDir, 'agent.md'), frontmatter);
    const eager = Object.fromEntries(checkedBridge.toolNames.map((name) => [name, { eager: true }]));
    await privateFile(path.join(configDir, 'mcp_config.json'), `${JSON.stringify({ mcpServers: { 'dsh-bridge': { serverUrl: checkedBridge.url, headers: { Authorization: `Bearer ${checkedBridge.token}` }, tools: eager, timeoutSeconds: Math.ceil(bridgeTimeoutMs / 1000) } } }, null, 2)}\n`);
    await privateFile(path.join(appDataPath, 'settings.json'), `${JSON.stringify({ toolPermission: 'strict', allowNonWorkspaceAccess: false, permissions: { ask: ['mcp(*)'], deny: ['read_file(*)', 'write_file(*)', 'command(*)', 'read_url(*)', 'execute_url(*)'] } }, null, 2)}\n`);
    return isolation;
  } catch (error) {
    // No process has been created at this point; only this function could own the root.
    try { await removeIsolation(isolation, { exited: true }); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Failed to create and remove the owned ACP isolation profile'); }
    throw error;
  }
}

/** Refuses unowned roots, links, changed markers and deletion before managed exit. */
export async function removeIsolation(isolation, { exited = false } = {}) {
  const identity = owned.get(isolation);
  if (!identity) throw new Error('Refusing to remove an unowned ACP isolation profile');
  if (!exited) throw new Error('Refusing to remove ACP isolation before managed process exit');
  const root = isolation.root;
  if (!path.isAbsolute(root) || root !== identity.root || !path.basename(root).startsWith(`${OWNER}-`)) throw new Error('ACP isolation root identity mismatch');
  const rootInfo = await fs.lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || await fs.realpath(root) !== root) throw new Error('ACP isolation root is not the original directory');
  const markerPath = path.join(root, 'owner.json');
  const markerInfo = await fs.lstat(markerPath);
  if (!markerInfo.isFile() || markerInfo.isSymbolicLink() || markerInfo.nlink !== 1) throw new Error('ACP isolation owner marker is not a private regular file');
  const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
  if (marker.owner !== identity.owner || marker.formatVersion !== identity.formatVersion || marker.id !== identity.id || marker.nonce !== identity.nonce || marker.root !== root) throw new Error('ACP isolation owner marker changed');
  // The absolute path and marker were verified above. rm unlinks child symlinks.
  await fs.rm(root, { recursive: true, force: false });
  owned.delete(isolation);
}
