/**
 * Wire contract shared by both faces: pure data, no imports, no side effects
 * (`AGENTS.md` → shared/ is data + schemas only; `scripts/check.mjs` R10).
 * The authoritative prose lives in docs/remote-contract.md.
 */

/** Every Remote action. `P` marks the phase it becomes reachable in. */
export const ACTIONS = [
  'workspace.resolve', 'workspace.open', 'workspace.state', 'workspace.trust',
  'files.list', 'files.stat', 'files.read', 'files.write', 'files.create',
  'files.rename', 'files.delete', 'files.search', 'files.index',
  'git.status', 'git.refs', 'git.log', 'git.graph', 'git.graph.search', 'git.commit',
  'git.diff', 'git.stage', 'git.unstage', 'git.discard', 'git.commitCreate', 'git.checkout',
  'git.branch', 'git.tag', 'git.stash', 'git.stageHunk', 'git.init', 'git.network', 'git.conflict',
  'git.resolveConflict',
  'terminal.create', 'terminal.write', 'terminal.resize', 'terminal.poll', 'terminal.close',
  'terminal.list', 'terminal.rename',
  'watch.start', 'watch.poll', 'watch.stop',
];

/** Actions that only read; the client may retry them freely. */
export const READ_ONLY_ACTIONS = new Set([
  'workspace.resolve', 'workspace.state', 'files.list', 'files.stat', 'files.read', 'files.search',
  'files.index',
  'git.status', 'git.refs', 'git.log', 'git.graph', 'git.graph.search', 'git.commit', 'git.diff', 'git.conflict',
  'terminal.poll', 'terminal.list', 'watch.poll',
]);

/** Hard limits. Clients must not assume anything larger; Host clamps to these. */
export const LIMITS = {
  readLinesDefault: 2000,
  readLinesMax: 20000,
  readBytesMax: 16 * 1024 * 1024,
  writeBytesMax: 8 * 1024 * 1024,
  dirEntriesMax: 5000,
  logPageDefault: 2000,
  logPageMax: 20000,
  diffBytesMax: 4 * 1024 * 1024,
  diffLinesMax: 50000,
  searchMaxResults: 2000,
  statusTimeoutMs: 8000,
  gitTimeoutMs: 20000,
  terminalBufferBytes: 512 * 1024,
  terminalWriteChars: 65536,
  largeFileBytes: { full: 262144, noFold: 2097152, noSyntax: 10485760, readonly: 20971520 },
  longLineChars: 10000,
  statusPollMs: 1500,
  terminalPollMs: 120,
  dirCacheMs: 500,
};

/** Error codes. Every failure maps onto exactly one of these (AGENTS.md). */
export const ERROR_CODES = [
  'E_NO_ROOT', 'E_NOT_DIR', 'E_OUTSIDE_ROOT', 'E_NOT_FOUND', 'E_VERSION_CONFLICT',
  'E_NOT_A_REPO', 'E_GIT_MISSING', 'E_GIT_FAILED', 'E_TIMEOUT', 'E_CANCELLED',
  'E_TRUST_REQUIRED', 'E_PERMISSION', 'E_INVALID_ARG', 'E_TOO_LARGE', 'E_BINARY',
  'E_LIMIT', 'E_TERMINAL_GONE', 'E_UNSUPPORTED',
];

/** Panes of the activity bar, in order. */
export const VIEW_IDS = ['explorer', 'scm', 'graph'];

/** Trust reasons surfaced through `E_TRUST_REQUIRED.detail.reason`. */
export const TRUST_REASONS = ['write', 'terminal', 'network', 'watch'];

export const WORKBENCH_PANEL_ID = 'workspace-ide';
export const STORAGE_STATE_KEY = 'workspace_ide/state';

export function isAction(value) {
  return ACTIONS.includes(value);
}

export function isReadOnlyAction(value) {
  return READ_ONLY_ACTIONS.has(value);
}
