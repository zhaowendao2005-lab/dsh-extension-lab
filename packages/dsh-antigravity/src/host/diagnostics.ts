import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { DiagnosticMode, DiagnosticsStatusSummary } from '../shared/types.ts';

const TRACE_FILENAME = 'protocol-trace.jsonl';
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_FILES = 5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const SAFE_HEADER_NAMES = new Set([
  'user-agent',
  'content-type',
  'accept-encoding',
  'x-goog-user-project',
  'content-length',
]);

export interface ProtocolDiagnosticObserver {
  readonly enabled: boolean;
  record(event: ProtocolDiagnosticEventInput): void;
  summarize?(): Promise<DiagnosticsStatusSummary>;
  clear?(): Promise<void>;
  dispose?(): Promise<void>;
}

export interface ProtocolDiagnosticEventInput {
  requestId: string;
  sessionId?: string;
  source: 'agent-loop' | 'direct-adapter' | 'aux';
  method: string;
  attempt: number;
  endpoint: string;
  accountIdHash?: string;
  entitlementSource?: string;
  entitlementGeneration?: number;
  wirePolicyV2?: boolean;
  retrySafetyV2?: boolean;
  resolvedMaxTokens?: number;
  headers?: Record<string, string>;
  body?: unknown;
  byteLength?: number;
  httpStatus?: number;
  classifiedCode?: string;
  classifiedSubType?: string;
  retryAfterMs?: number;
  parsedDelaySource?: string;
  errorDetailSummary?: string;
  finishReason?: string;
  modelVersion?: string;
  usageSummary?: Record<string, number | undefined>;
  durationMs?: number;
}

export interface ProtocolDiagnosticRecord {
  schemaVersion: 1;
  timestamp: string;
  requestId: string;
  sessionHash?: string;
  source: 'agent-loop' | 'direct-adapter' | 'aux';
  method: string;
  attempt: number;
  endpointOrigin: string;
  accountHash?: string;
  headerPresence?: Record<string, boolean>;
  userAgent?: string;
  requestMetadata?: {
    envelopeKeyOrder: string[];
    requestKeyOrder: string[];
    model?: string;
    upstreamModel?: string;
    requestType?: string;
    userAgentField?: string;
    enabledCreditTypes?: string[];
    hasProject: boolean;
    generationConfig?: {
      maxOutputTokens?: number;
      thinkingConfig?: {
        includeThoughts?: boolean;
        thinkingLevel?: string;
        thinkingBudget?: number;
      };
    };
    labelsKeys: string[];
    hasSystemInstruction: boolean;
    contentsCount: number;
    contentsRoles: string[];
    toolsGroupCount: number;
    toolDeclCount: number;
    byteLength?: number;
    structureHmac: string;
  };
  responseMetadata?: {
    httpStatus?: number;
    classifiedCode?: string;
    classifiedSubType?: string;
    retryAfterMs?: number;
    parsedDelaySource?: string;
    errorDetailSummary?: string;
    finishReason?: string;
    modelVersion?: string;
    usageSummary?: Record<string, number | undefined>;
    durationMs?: number;
  };
  policyDecision?: {
    wirePolicyV2?: boolean;
    retrySafetyV2?: boolean;
    resolvedMaxTokens?: number;
    entitlementSource?: string;
    entitlementGeneration?: number;
  };
}

export function sanitizeErrorDetailText(raw: string | undefined, maxLen = 240): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const scrubbed = trimmed
    .replace(/ya29\.[A-Za-z0-9._-]+/g, '<redacted-token>')
    .replace(/\bsk-[A-Za-z0-9._-]{12,}/g, '<redacted-key>')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer <redacted>')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<redacted-email>')
    .replace(/(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)[^\s"'`]+/g, '<redacted-path>')
    .replace(/([?&](?:key|token|code|secret|access_token|refresh_token)=)[^&\s]+/gi, '$1<redacted>')
    .replace(/\s+/g, ' ');
  return scrubbed.length > maxLen ? `${scrubbed.slice(0, maxLen - 3)}...` : scrubbed;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function extractAllowlistedBodyMetadata(
  body: unknown,
  byteLength: number | undefined,
  hmacSecret: Buffer,
): ProtocolDiagnosticRecord['requestMetadata'] | undefined {
  const env = asRecord(body);
  if (!env) return undefined;
  const req = asRecord(env.request);
  const genCfg = asRecord(req?.generationConfig);
  const thinking = asRecord(genCfg?.thinkingConfig);
  const labels = asRecord(req?.labels);
  const contents = Array.isArray(req?.contents) ? req.contents : [];
  const tools = Array.isArray(req?.tools) ? req.tools : [];

  const contentsRoles = contents.map((item) => {
    const rec = asRecord(item);
    return typeof rec?.role === 'string' ? rec.role : 'unknown';
  });

  let toolDeclCount = 0;
  for (const grp of tools) {
    const rec = asRecord(grp);
    if (Array.isArray(rec?.functionDeclarations)) {
      toolDeclCount += rec.functionDeclarations.length;
    }
  }

  const envelopeKeyOrder = Object.keys(env);
  const requestKeyOrder = req ? Object.keys(req) : [];
  const enabledCreditTypes = Array.isArray(env.enabledCreditTypes)
    ? env.enabledCreditTypes.filter((item): item is string => typeof item === 'string')
    : undefined;

  const generationConfigOut: NonNullable<ProtocolDiagnosticRecord['requestMetadata']>['generationConfig'] =
    genCfg
      ? {
          ...(typeof genCfg.maxOutputTokens === 'number'
            ? { maxOutputTokens: genCfg.maxOutputTokens }
            : {}),
          ...(thinking
            ? {
                thinkingConfig: {
                  ...(typeof thinking.includeThoughts === 'boolean'
                    ? { includeThoughts: thinking.includeThoughts }
                    : {}),
                  ...(typeof thinking.thinkingLevel === 'string'
                    ? { thinkingLevel: thinking.thinkingLevel }
                    : {}),
                  ...(typeof thinking.thinkingBudget === 'number'
                    ? { thinkingBudget: thinking.thinkingBudget }
                    : {}),
                },
              }
            : {}),
        }
      : undefined;

  const structureSkeleton = JSON.stringify({
    envelopeKeyOrder,
    requestKeyOrder,
    model: typeof env.model === 'string' ? env.model : undefined,
    requestType: typeof env.requestType === 'string' ? env.requestType : undefined,
    enabledCreditTypes,
    generationConfig: generationConfigOut,
    labelsKeys: labels ? Object.keys(labels).sort() : [],
    hasSystemInstruction: Boolean(req?.systemInstruction),
    contentsRoles,
    toolsGroupCount: tools.length,
    toolDeclCount,
  });

  const structureHmac = crypto
    .createHmac('sha256', hmacSecret)
    .update(structureSkeleton)
    .digest('hex');

  return {
    envelopeKeyOrder,
    requestKeyOrder,
    model: typeof env.model === 'string' ? env.model : undefined,
    upstreamModel: typeof env.model === 'string' ? env.model : undefined,
    requestType: typeof env.requestType === 'string' ? env.requestType : undefined,
    userAgentField: typeof env.userAgent === 'string' ? env.userAgent : undefined,
    ...(enabledCreditTypes ? { enabledCreditTypes } : {}),
    hasProject: typeof env.project === 'string' && env.project.length > 0,
    ...(generationConfigOut ? { generationConfig: generationConfigOut } : {}),
    labelsKeys: labels ? Object.keys(labels).sort() : [],
    hasSystemInstruction: Boolean(req?.systemInstruction),
    contentsCount: contents.length,
    contentsRoles,
    toolsGroupCount: tools.length,
    toolDeclCount,
    ...(typeof byteLength === 'number' ? { byteLength } : {}),
    structureHmac,
  };
}

function isSystemRootAlias(cursor: string): boolean {
  if (process.platform !== 'darwin') return false;
  return cursor === '/var' || cursor === '/tmp' || cursor === '/etc';
}

function assertNoSymlinkInExistingComponents(targetDir: string): void {
  const resolved = path.resolve(targetDir);
  const parsed = path.parse(resolved);
  const rel = resolved.slice(parsed.root.length);
  const parts = rel.split(path.sep).filter(Boolean);
  let cursor = parsed.root || path.sep;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    try {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink()) {
        if (isSystemRootAlias(cursor)) {
          continue;
        }
        throw new Error(`Refusing symlink diagnostic directory component`);
      }
      if (!stat.isDirectory()) {
        throw new Error(`Diagnostic parent path component is not a directory`);
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        continue;
      }
      throw err;
    }
  }
}

async function ensurePrivateDirNoSymlinks(targetDir: string): Promise<void> {
  assertNoSymlinkInExistingComponents(targetDir);
  await fsp.mkdir(targetDir, { recursive: true, mode: 0o700 });
  const stat = await fsp.lstat(targetDir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error('Diagnostic directory validation failed');
  }
  await fsp.chmod(targetDir, 0o700);
}

async function appendLineSafe(filePath: string, line: string): Promise<void> {
  try {
    const stat = await fsp.lstat(filePath);
    if (stat.isSymbolicLink()) {
      throw new Error('Refusing symlink diagnostic trace file');
    }
    if (!stat.isFile()) {
      throw new Error('Diagnostic trace target is not a regular file');
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      throw err;
    }
  }

  const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
  const flags =
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | noFollow;
  const handle = await fsp.open(filePath, flags, 0o600);
  try {
    const fdStat = await handle.stat();
    if (!fdStat.isFile()) {
      throw new Error('Opened diagnostic descriptor is not a regular file');
    }
    await handle.chmod(0o600);
    await handle.write(line, null, 'utf8');
  } finally {
    await handle.close();
  }
}

export interface JsonlDiagnosticSinkOptions {
  diagnosticDir: string;
  mode: DiagnosticMode;
  retainDays?: number;
  maxFileBytes?: number;
  maxFiles?: number;
}

export class JsonlDiagnosticSink implements ProtocolDiagnosticObserver {
  private readonly dir: string;
  private readonly mode: DiagnosticMode;
  private readonly retainDays: number;
  private readonly maxFileBytes: number;
  private readonly maxFiles: number;
  private readonly hmacSecret: Buffer;
  private writeQueue: Promise<void> = Promise.resolve();
  private disposed = false;
  private lastError: string | undefined;

  constructor(options: JsonlDiagnosticSinkOptions) {
    this.dir = path.resolve(options.diagnosticDir);
    this.mode = options.mode;
    this.retainDays = Math.min(30, Math.max(1, Math.trunc(options.retainDays ?? 7)));
    this.maxFileBytes = Math.max(1024, Math.trunc(options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES));
    this.maxFiles = Math.max(1, Math.trunc(options.maxFiles ?? DEFAULT_MAX_FILES));
    // Per-process ephemeral HMAC key held only in RAM — never persisted or static.
    this.hmacSecret = crypto.randomBytes(32);
  }

  get enabled(): boolean {
    return !this.disposed && this.mode === 'metadata';
  }

  private get tracePath(): string {
    return path.join(this.dir, TRACE_FILENAME);
  }

  record(event: ProtocolDiagnosticEventInput): void {
    if (!this.enabled) return;
    const record = this.buildSanitizedRecord(event);
    const line = `${JSON.stringify(record)}\n`;
    this.writeQueue = this.writeQueue
      .then(() => this.persistLine(line))
      .catch((err) => {
        this.lastError = sanitizeErrorDetailText(
          err instanceof Error ? err.message : String(err),
        );
      });
  }

  buildSanitizedRecord(event: ProtocolDiagnosticEventInput): ProtocolDiagnosticRecord {
    let endpointOrigin = 'invalid-endpoint';
    try {
      const parsed = new URL(event.endpoint);
      endpointOrigin = parsed.origin;
    } catch {
      endpointOrigin = 'unknown-endpoint';
    }

    let safeUserAgent: string | undefined;
    const headerPresence: Record<string, boolean> = {};
    if (event.headers) {
      for (const [rawKey, rawVal] of Object.entries(event.headers)) {
        const lower = rawKey.toLowerCase();
        if (lower === 'authorization') {
          headerPresence.authorization = Boolean(rawVal);
          continue;
        }
        if (SAFE_HEADER_NAMES.has(lower)) {
          headerPresence[lower] = Boolean(rawVal);
          if (lower === 'user-agent' && typeof rawVal === 'string') {
            safeUserAgent = rawVal;
          }
        }
      }
    }

    const sessionHash = event.sessionId
      ? crypto.createHmac('sha256', this.hmacSecret).update(event.sessionId).digest('hex').slice(0, 16)
      : undefined;
    const accountHash = event.accountIdHash
      ? crypto.createHmac('sha256', this.hmacSecret).update(event.accountIdHash).digest('hex').slice(0, 16)
      : undefined;

    const requestMetadata =
      event.body !== undefined
        ? extractAllowlistedBodyMetadata(event.body, event.byteLength, this.hmacSecret)
        : undefined;

    const hasResponseFields =
      event.httpStatus !== undefined ||
      event.classifiedCode !== undefined ||
      event.retryAfterMs !== undefined ||
      event.errorDetailSummary !== undefined ||
      event.finishReason !== undefined ||
      event.durationMs !== undefined;

    return {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      requestId: event.requestId,
      ...(sessionHash ? { sessionHash } : {}),
      source: event.source,
      method: event.method,
      attempt: event.attempt,
      endpointOrigin,
      ...(accountHash ? { accountHash } : {}),
      ...(Object.keys(headerPresence).length > 0 ? { headerPresence } : {}),
      ...(safeUserAgent ? { userAgent: safeUserAgent } : {}),
      ...(requestMetadata ? { requestMetadata } : {}),
      ...(hasResponseFields
        ? {
            responseMetadata: {
              ...(event.httpStatus !== undefined ? { httpStatus: event.httpStatus } : {}),
              ...(event.classifiedCode ? { classifiedCode: event.classifiedCode } : {}),
              ...(event.classifiedSubType ? { classifiedSubType: event.classifiedSubType } : {}),
              ...(event.retryAfterMs !== undefined ? { retryAfterMs: event.retryAfterMs } : {}),
              ...(event.parsedDelaySource ? { parsedDelaySource: event.parsedDelaySource } : {}),
              ...(event.errorDetailSummary
                ? { errorDetailSummary: sanitizeErrorDetailText(event.errorDetailSummary) }
                : {}),
              ...(event.finishReason ? { finishReason: event.finishReason } : {}),
              ...(event.modelVersion ? { modelVersion: event.modelVersion } : {}),
              ...(event.usageSummary ? { usageSummary: event.usageSummary } : {}),
              ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
            },
          }
        : {}),
      ...(event.wirePolicyV2 !== undefined ||
      event.retrySafetyV2 !== undefined ||
      event.resolvedMaxTokens !== undefined ||
      event.entitlementSource !== undefined
        ? {
            policyDecision: {
              ...(event.wirePolicyV2 !== undefined ? { wirePolicyV2: event.wirePolicyV2 } : {}),
              ...(event.retrySafetyV2 !== undefined ? { retrySafetyV2: event.retrySafetyV2 } : {}),
              ...(event.resolvedMaxTokens !== undefined
                ? { resolvedMaxTokens: event.resolvedMaxTokens }
                : {}),
              ...(event.entitlementSource ? { entitlementSource: event.entitlementSource } : {}),
              ...(event.entitlementGeneration !== undefined
                ? { entitlementGeneration: event.entitlementGeneration }
                : {}),
            },
          }
        : {}),
    };
  }

  private async persistLine(line: string): Promise<void> {
    if (this.disposed || this.mode !== 'metadata') return;
    await ensurePrivateDirNoSymlinks(this.dir);
    await this.rotateIfNeeded(Buffer.byteLength(line, 'utf8'));
    await this.pruneExpiredFiles();
    await appendLineSafe(this.tracePath, line);
    this.lastError = undefined;
  }

  private async rotateIfNeeded(incomingBytes: number): Promise<void> {
    let stat: fs.Stats | undefined;
    try {
      stat = await fsp.lstat(this.tracePath);
      if (stat.isSymbolicLink()) {
        throw new Error('Refusing symlink diagnostic trace file');
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return;
      throw err;
    }

    if (stat.size + incomingBytes <= this.maxFileBytes) return;

    for (let idx = this.maxFiles - 1; idx >= 1; idx -= 1) {
      const src = idx === 1 ? this.tracePath : `${this.tracePath}.${idx - 1}`;
      const dst = `${this.tracePath}.${idx}`;
      try {
        const srcStat = await fsp.lstat(src);
        if (srcStat.isSymbolicLink()) {
          throw new Error('Refusing symlink diagnostic trace file during rotation');
        }
        await fsp.rename(src, dst);
        await fsp.chmod(dst, 0o600);
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
          throw err;
        }
      }
    }
  }

  private async pruneExpiredFiles(): Promise<void> {
    const cutoffMs = Date.now() - this.retainDays * MS_PER_DAY;
    let entries: string[] = [];
    try {
      entries = await fsp.readdir(this.dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return;
      throw err;
    }

    for (const name of entries) {
      if (!name.startsWith(TRACE_FILENAME)) continue;
      const suffix = name.slice(TRACE_FILENAME.length);
      if (suffix.startsWith('.')) {
        const idx = Number(suffix.slice(1));
        if (Number.isInteger(idx) && idx >= this.maxFiles) {
          await fsp.unlink(path.join(this.dir, name)).catch(() => undefined);
          continue;
        }
      }
      const full = path.join(this.dir, name);
      try {
        const stat = await fsp.lstat(full);
        if (stat.isSymbolicLink()) continue;
        if (stat.mtimeMs < cutoffMs) {
          await fsp.unlink(full);
        }
      } catch {
        // Ignore transient unlink races.
      }
    }
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  async readAllRecordsForTest(): Promise<ProtocolDiagnosticRecord[]> {
    await this.flush();
    assertNoSymlinkInExistingComponents(this.dir);
    try {
      const stat = await fsp.lstat(this.tracePath);
      if (stat.isSymbolicLink()) {
        throw new Error('Refusing symlink diagnostic trace file');
      }
      const raw = await fsp.readFile(this.tracePath, 'utf8');
      return raw
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as ProtocolDiagnosticRecord);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
      throw err;
    }
  }

  async summarize(): Promise<DiagnosticsStatusSummary> {
    await this.flush();
    let recordCount = 0;
    let fileBytes = 0;
    let rotatedFiles = 0;
    let writable = this.enabled;

    try {
      assertNoSymlinkInExistingComponents(this.dir);
      const entries = await fsp.readdir(this.dir).catch(() => [] as string[]);
      for (const name of entries) {
        if (!name.startsWith(TRACE_FILENAME)) continue;
        const full = path.join(this.dir, name);
        const stat = await fsp.lstat(full).catch(() => undefined);
        if (!stat || stat.isSymbolicLink() || !stat.isFile()) continue;
        fileBytes += stat.size;
        if (name === TRACE_FILENAME) {
          const text = await fsp.readFile(full, 'utf8').catch(() => '');
          recordCount = text ? text.split('\n').filter(Boolean).length : 0;
        } else {
          rotatedFiles += 1;
        }
      }
    } catch (err) {
      writable = false;
      this.lastError = sanitizeErrorDetailText(err instanceof Error ? err.message : String(err));
    }

    return {
      mode: this.mode,
      retainDays: this.retainDays,
      recordCount,
      fileBytes,
      rotatedFiles,
      writable,
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  async clear(): Promise<void> {
    await this.flush();
    try {
      assertNoSymlinkInExistingComponents(this.dir);
      const entries = await fsp.readdir(this.dir).catch(() => [] as string[]);
      for (const name of entries) {
        if (!name.startsWith(TRACE_FILENAME)) continue;
        const full = path.join(this.dir, name);
        const stat = await fsp.lstat(full).catch(() => undefined);
        if (!stat || stat.isSymbolicLink()) continue;
        await fsp.unlink(full).catch(() => undefined);
      }
      this.lastError = undefined;
    } catch (err) {
      this.lastError = sanitizeErrorDetailText(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.writeQueue;
  }
}

export const NOOP_DIAGNOSTIC_OBSERVER: ProtocolDiagnosticObserver = {
  enabled: false,
  record() {},
  async summarize() {
    return {
      mode: 'off',
      retainDays: 7,
      recordCount: 0,
      fileBytes: 0,
      rotatedFiles: 0,
      writable: false,
    };
  },
  async clear() {},
  async dispose() {},
};
