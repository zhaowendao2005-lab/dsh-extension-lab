/**
 * Wire schema + Typert contribution (docs/remote-contract.md §1).
 * Shape: { sessionId?, action, payload? } → { ok: true, data } | { ok: false, error }.
 */
import { z } from 'zod';
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info';
import { ACTIONS } from '../shared/contract.js';

const SESSION_ID = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const REL_PATH = z.string().min(0).max(4096);

/** Per-action payload schemas. Unknown actions are rejected by the enum. */
export const payloadSchemas = {
  'workspace.resolve': z.strictObject({}),
  'workspace.open': z.strictObject({ root: z.string().min(1).max(4096) }),
  'workspace.state': z.strictObject({}),
  'workspace.trust': z.strictObject({ trusted: z.boolean() }),

  'files.list': z.strictObject({ path: REL_PATH.optional(), refresh: z.boolean().optional() }),
  'files.stat': z.strictObject({ path: z.string().min(1).max(4096) }),
  'files.read': z.strictObject({
    path: z.string().min(1).max(4096),
    offset: z.number().int().min(1).optional(),
    limit: z.number().int().min(1).max(20000).optional(),
    expectedVersion: z.string().max(128).optional(),
  }),
  'files.write': z.strictObject({
    path: z.string().min(1).max(4096),
    text: z.string(),
    expectedVersion: z.string().max(128).optional(),
    create: z.boolean().optional(),
    force: z.boolean().optional(),
  }),
  'files.create': z.strictObject({
    path: z.string().min(1).max(4096),
    kind: z.enum(['file', 'directory']),
    text: z.string().max(8 * 1024 * 1024).optional(),
  }),
  'files.rename': z.strictObject({ from: z.string().min(1).max(4096), to: z.string().min(1).max(4096) }),
  'files.delete': z.strictObject({ path: z.string().min(1).max(4096), recursive: z.boolean().optional() }),
  'files.search': z.strictObject({
    query: z.string().min(1).max(512),
    include: z.string().max(512).optional(),
    exclude: z.string().max(512).optional(),
    maxResults: z.number().int().min(1).max(2000).optional(),
    caseSensitive: z.boolean().optional(),
    regex: z.boolean().optional(),
    wholeWord: z.boolean().optional(),
    queryId: z.string().max(64).optional(),
  }),

  'files.index': z.strictObject({
    maxAgeMs: z.number().int().min(0).max(600000).optional(),
    limit: z.number().int().min(1).max(200000).optional(),
  }),

  'git.conflict': z.strictObject({ path: z.string().min(1).max(4096) }),
  'git.resolveConflict': z.strictObject({
    path: z.string().min(1).max(4096),
    side: z.enum(['ours', 'theirs', 'both', 'delete']),
  }),

  'git.status': z.strictObject({ untrackedMode: z.enum(['all', 'normal', 'none']).optional() }),
  'git.refs': z.strictObject({}),
  'git.log': z.strictObject({
    refs: z.array(z.string().max(512)).max(64).optional(),
    path: z.string().max(4096).optional(),
    skip: z.number().int().min(0).optional(),
    maxCount: z.number().int().min(1).max(20000).optional(),
  }),
  'git.graph': z.strictObject({
    refs: z.array(z.string().max(512)).max(64).optional(),
    path: z.string().max(4096).optional(),
    skip: z.number().int().min(0).optional(),
    maxCount: z.number().int().min(1).max(20000).optional(),
  }),
  'git.graph.search': z.strictObject({ query: z.string().min(1).max(512), mode: z.enum(['message', 'author', 'hash']).optional() }),
  'git.commit': z.strictObject({ hash: z.string().min(4).max(64) }),
  'git.diff': z.strictObject({
    target: z.object({
      kind: z.enum(['working', 'index', 'commit', 'range', 'untracked']),
      path: z.string().max(4096).optional(),
      hash: z.string().max(64).optional(),
      from: z.string().max(64).optional(),
      to: z.string().max(64).optional(),
    }),
    path: z.string().max(4096).optional(),
    context: z.number().int().min(-1).max(50).optional(),
    ignoreWhitespace: z.boolean().optional(),
  }),
  'git.stage': z.strictObject({ paths: z.array(z.string().max(4096)).max(5000).optional(), all: z.boolean().optional() }),
  'git.unstage': z.strictObject({ paths: z.array(z.string().max(4096)).max(5000).optional(), all: z.boolean().optional() }),
  'git.discard': z.strictObject({
    paths: z.array(z.string().max(4096)).min(1).max(500).optional(),
    untracked: z.array(z.string().max(4096)).max(500).optional(),
    all: z.boolean().optional(),
  }),
  'git.commitCreate': z.strictObject({
    message: z.string().min(1).max(20000),
    paths: z.array(z.string().max(4096)).max(5000).optional(),
    amend: z.boolean().optional(),
    signOff: z.boolean().optional(),
  }),
  'git.checkout': z.strictObject({
    ref: z.string().min(1).max(512),
    force: z.boolean().optional(),
    create: z.boolean().optional(),
  }),
  'git.branch': z.strictObject({ name: z.string().min(1).max(512), action: z.enum(['create', 'delete', 'rename']), to: z.string().max(512).optional() }),
  'git.tag': z.strictObject({ name: z.string().min(1).max(512), action: z.enum(['create', 'delete']), hash: z.string().max(64).optional(), message: z.string().max(20000).optional() }),
  'git.stash': z.strictObject({ action: z.enum(['push', 'pop', 'apply', 'drop', 'list']), message: z.string().max(20000).optional(), index: z.number().int().min(0).optional() }),
  'git.stageHunk': z.strictObject({
    path: z.string().min(1).max(4096),
    hunk: z.object({
      oldStart: z.number().int().min(0), oldLines: z.number().int().min(0),
      newStart: z.number().int().min(0), newLines: z.number().int().min(0),
      lines: z.array(z.string()).max(50000),
    }),
    expectedIndexSha: z.string().max(64).optional(),
  }),
  'git.init': z.strictObject({ defaultBranch: z.string().max(64).optional() }),
  'git.network': z.strictObject({ op: z.enum(['fetch', 'pull', 'push']), remote: z.string().min(1).max(64) }),

  'terminal.create': z.strictObject({
    cwd: z.string().max(4096).optional(),
    shell: z.string().max(1024).optional(),
    rows: z.number().int().min(2).max(300).optional(),
    cols: z.number().int().min(10).max(500).optional(),
    confirmed: z.boolean().optional(),
  }),
  'terminal.write': z.strictObject({ terminalId: z.string().min(1).max(128), data: z.string().max(65536) }),
  'terminal.resize': z.strictObject({
    terminalId: z.string().min(1).max(128),
    rows: z.number().int().min(2).max(300),
    cols: z.number().int().min(10).max(500),
  }),
  'terminal.poll': z.strictObject({ terminalId: z.string().min(1).max(128), offset: z.number().int().min(0) }),
  'terminal.close': z.strictObject({ terminalId: z.string().min(1).max(128) }),
  'terminal.list': z.strictObject({}),
  'terminal.rename': z.strictObject({ terminalId: z.string().min(1).max(128), title: z.string().min(1).max(200) }),

  'watch.start': z.strictObject({ kinds: z.array(z.enum(['files', 'git'])).max(4).optional() }),
  'watch.poll': z.strictObject({ token: z.string().min(1).max(128), offset: z.number().int().min(0) }),
  'watch.stop': z.strictObject({ token: z.string().min(1).max(128) }),
};

export const requestSchema = z.strictObject({
  sessionId: SESSION_ID.optional(),
  action: z.enum(ACTIONS),
  payload: z.record(z.string(), z.unknown()).optional(),
});

const input = {
  mode: 'strict',
  typeSymbol: 'dsh-workspace-ide#workspaceIde/execute:request',
  create: () => requestSchema,
};

export const remoteInfo = createTypertRemoteInfo({
  package: 'dsh-workspace-ide',
  methods: {
    'workspaceIde/execute': {
      service: 'workspaceIde',
      description: 'Drive the workspace IDE panel: workspace, files, git and terminal actions.',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'request', source: 'json', codec: input, strictCodec: input }],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-workspace-ide#workspaceIde/execute:result',
        create: () => z.json(),
      },
    },
  },
}, z);

export const hostContribution = {
  package: remoteInfo.package,
  face: 'host',
  schemas: [],
  invocations: remoteInfo.descriptors,
  model: { symbols: [], exports: [], relations: [] },
};

export { z };
