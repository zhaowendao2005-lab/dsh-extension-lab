import { createHash, randomUUID } from 'node:crypto';
import { attributionHeaders } from '@deepseek-ai/dsh-llm';

/**
 * Antigravity identity, header hygiene, requestId, and sessionId helpers.
 * Aligned with Antigravity-Manager v5.0.3 (hub_version.rs, upstream/client.rs,
 * common_utils.rs, and session.rs).
 */

export const OFFICIAL_HUB_VERSION = '2.28.0';
export const OFFICIAL_HUB_CL = '1008300195';
export const MIN_STABLE_LEGACY_VERSION = '4.3.0';

export function resolveHostPlatformTags(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): { osType: string; arch: string } {
  const osType =
    platform === 'darwin'
      ? 'darwin'
      : platform === 'win32'
        ? 'windows'
        : platform === 'linux'
          ? 'linux'
          : platform;
  const mappedArch =
    arch === 'arm64'
      ? 'arm64'
      : arch === 'x64'
        ? 'amd64'
        : arch === 'ia32'
          ? '386'
          : arch;
  return { osType, arch: mappedArch };
}

export type EnvelopeUserAgent = 'antigravity' | 'jetski';
export type IdeType = 'ANTIGRAVITY' | 'JETSKI';

export interface OfficialFingerprint {
  envelopeUserAgent: EnvelopeUserAgent;
  ideType: IdeType;
}

const DISALLOWED_HEADER_NAMES = new Set([
  'x-session-id',
  'x-client-name',
  'x-client-version',
  'x-machine-id',
  'x-vscode-sessionid',
  'x-goog-api-client',
  'client-metadata',
  'user-agent',
  'authorization',
  'content-type',
  'accept-encoding',
  'x-goog-user-project',
]);

function compareSemver(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function parseSemverTuple(raw: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(raw.trim());
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Build default Antigravity Hub User-Agent matching the active host OS and architecture
 * so same-machine official CLI/IDE and DSH sessions do not report conflicting platforms.
 */
export function buildHubUserAgent(options?: {
  version?: string;
  cl?: string;
  osType?: string;
  arch?: string;
}): string {
  const version = options?.version?.trim() || OFFICIAL_HUB_VERSION;
  const cl = options?.cl?.trim() || OFFICIAL_HUB_CL;
  const host = resolveHostPlatformTags();
  const osType = options?.osType?.trim() || host.osType;
  const arch = options?.arch?.trim() || host.arch;
  return `antigravity/hub/${version} (aidev_client; os_type=${osType}; arch=${arch}; cl=${cl})`;
}

export const DEFAULT_HUB_USER_AGENT = buildHubUserAgent();

/**
 * Sanitize optional custom User-Agent:
 * - Preserves `antigravity/hub/...` verbatim (after stripping CR/LF).
 * - Requires `antigravity` token in any custom string.
 * - Clamps legacy `antigravity/X.Y.Z` versions below 4.3.0 up to 4.3.0.
 */
export function sanitizeUserAgent(raw?: string): string {
  if (!raw) return DEFAULT_HUB_USER_AGENT;
  const cleaned = raw.replace(/[\r\n\0]+/g, ' ').trim();
  if (!cleaned) return DEFAULT_HUB_USER_AGENT;

  if (/^antigravity\/hub\//i.test(cleaned)) {
    return cleaned;
  }

  if (!/antigravity/i.test(cleaned)) {
    return DEFAULT_HUB_USER_AGENT;
  }

  const versionMatch = /^antigravity\/(\d+\.\d+\.\d+)(.*)$/i.exec(cleaned);
  if (versionMatch) {
    const parsed = parseSemverTuple(versionMatch[1]);
    const minTuple = parseSemverTuple(MIN_STABLE_LEGACY_VERSION)!;
    if (parsed && compareSemver(parsed, minTuple) < 0) {
      return `antigravity/${MIN_STABLE_LEGACY_VERSION}${versionMatch[2]}`;
    }
  }

  return cleaned;
}

/**
 * Option B attribution separation (PLAN §9.1):
 * DSH attributionHeaders() yields `{ 'user-agent': 'deepseek-harness/...' }`,
 * which triggers upstream 403 if sent on Cloud Code endpoints. We keep DSH
 * attribution metadata strictly separate for internal diagnostics/UI notices
 * and never allow it to overwrite outbound `User-Agent`.
 */
export function getInternalAttributionSummary(): Record<string, string> {
  try {
    return { ...attributionHeaders() };
  } catch {
    return { 'user-agent': 'deepseek-harness' };
  }
}

/**
 * Strip banned or conflicting client headers and build the exact minimal outbound
 * Cloud Code header bag.
 * `x-goog-user-project` is emitted ONLY on non-content requests (`loadCodeAssist`,
 * `fetchAvailableModels`, `retrieveUserQuotaSummary`, `countTokens`).
 */
export function buildOutboundHeaders(params: {
  accessToken: string;
  userAgent?: string;
  projectId?: string;
  isContentRequest: boolean;
  extraHeaders?: Record<string, string>;
}): Record<string, string> {
  const headers: Record<string, string> = {};

  if (params.extraHeaders) {
    for (const [key, value] of Object.entries(params.extraHeaders)) {
      const lower = key.toLowerCase();
      if (DISALLOWED_HEADER_NAMES.has(lower) || lower.startsWith('x-jeikcode')) {
        continue;
      }
      const cleanVal = String(value).replace(/[\r\n\0]+/g, ' ').trim();
      if (cleanVal) headers[key] = cleanVal;
    }
  }

  headers['Content-Type'] = 'application/json';
  headers['Accept-Encoding'] = 'gzip';
  headers['Authorization'] = `Bearer ${params.accessToken}`;
  headers['User-Agent'] = sanitizeUserAgent(params.userAgent);

  const normalizedProject = params.projectId?.trim();
  if (
    !params.isContentRequest &&
    normalizedProject &&
    normalizedProject.toLowerCase() !== 'aicode-consumers'
  ) {
    headers['x-goog-user-project'] = normalizedProject;
  }

  return headers;
}

/**
 * Consumer Gmail uses `antigravity` / `ANTIGRAVITY`; Workspace/GCP accounts use `jetski` / `JETSKI`.
 */
export function resolveOfficialFingerprint(email?: string): OfficialFingerprint {
  const normalized = (email ?? '').trim().toLowerCase();
  if (
    !normalized ||
    normalized.endsWith('@gmail.com') ||
    normalized.endsWith('@googlemail.com')
  ) {
    return { envelopeUserAgent: 'antigravity', ideType: 'ANTIGRAVITY' };
  }
  return { envelopeUserAgent: 'jetski', ideType: 'JETSKI' };
}

/**
 * Derive a deterministic 16-hex-char conversationId from DSH sessionId.
 */
export function deriveConversationId(sessionId?: string): string {
  const seed = sessionId && sessionId.trim() !== '' ? sessionId.trim() : 'default';
  return createHash('sha256').update(seed).digest('hex').slice(0, 16);
}

/**
 * Derive an 8-hex-char trajectory identifier.
 */
export function deriveTrajectoryId(seed?: string): string {
  if (seed && seed.trim() !== '') {
    return createHash('sha256').update(seed.trim()).digest('hex').slice(0, 8);
  }
  return randomUUID().replace(/-/g, '').slice(0, 8);
}

/**
 * Build 5-segment official requestId:
 * `agent/{conversationId}/{unixMs}/{trajectoryId}/{step}`
 */
export function buildOfficialRequestId(
  sessionId: string | undefined,
  step: number,
  trajectoryId?: string,
  nowMs: number = Date.now(),
): string {
  const conversationId = deriveConversationId(sessionId);
  const traj =
    trajectoryId && /^[0-9a-f]{8}$/i.test(trajectoryId)
      ? trajectoryId.toLowerCase()
      : deriveTrajectoryId();
  const safeStep = Number.isFinite(step) && step >= 0 ? Math.trunc(step) : 0;
  return `agent/${conversationId}/${Math.trunc(nowMs)}/${traj}/${safeStep}`;
}

export function extractTrajectoryId(requestId: string): string {
  const parts = requestId.split('/');
  if (parts.length >= 4 && parts[3]) return parts[3];
  return deriveTrajectoryId(requestId);
}

const FNV_OFFSET_BASIS_I64 = -3750763034362895579n;
const FNV_PRIME_64 = 1099511628211n;

/**
 * Compute 64-bit signed FNV-1a integer string matching AGM `common/session.rs`,
 * producing a large stable integer string for Cloud Code `request.sessionId`.
 */
export function deriveUpstreamSessionId(
  accountId: string,
  sessionId?: string,
  generation: number = 0,
): string {
  const fingerprint = sessionId?.trim() ?? '';
  const input =
    fingerprint === '' && generation === 0
      ? accountId
      : `${accountId}|${fingerprint}|${generation}`;
  const bytes = Buffer.from(input, 'utf8');
  let hash = BigInt.asUintN(64, FNV_OFFSET_BASIS_I64);
  for (const byte of bytes) {
    hash = BigInt.asUintN(64, hash * FNV_PRIME_64);
    hash = BigInt.asUintN(64, hash ^ BigInt(byte));
  }
  return BigInt.asIntN(64, hash).toString();
}
