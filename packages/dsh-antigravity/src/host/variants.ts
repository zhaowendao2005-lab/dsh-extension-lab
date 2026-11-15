import { createHash } from 'node:crypto';
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import {
  buildAntigravityRequest,
  normalizeEnabledCreditTypes,
  type BuildRequestInput,
} from './translate.ts';
import { POLICY_DEFAULT_MAX_OUTPUT_TOKENS } from './catalog.ts';

export type RequestVariantName =
  | 'baseline'
  | 'credit_only'
  | 'output_only_65536'
  | 'both'
  | 'server_default';

export const REQUEST_VARIANT_NAMES: readonly RequestVariantName[] = [
  'baseline',
  'credit_only',
  'output_only_65536',
  'both',
  'server_default',
];

export interface JsonPointerDiffEntry {
  pointer: string;
  kind: 'added' | 'removed' | 'changed';
  left?: unknown;
  right?: unknown;
}

export interface BuiltRequestVariant {
  variant: RequestVariantName;
  envelope: Record<string, unknown>;
  requestId: string;
  canonicalModel: string;
  upstreamModel: string;
  hasToolActivity: boolean;
  payloadSha256: string;
  byteLength: number;
  diffsFromBaseline: JsonPointerDiffEntry[];
}

export interface VariantMatrixSummaryRow {
  variant: RequestVariantName;
  payloadSha256: string;
  byteLength: number;
  diffPointers: string[];
  diffsFromBaseline: JsonPointerDiffEntry[];
}

function escapeJsonPointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

function appendJsonPointer(prefix: string, token: string): string {
  return `${prefix}/${escapeJsonPointerToken(token)}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

/**
 * Computes RFC 6901 JSON Pointer structural diffs between two JSON values.
 */
export function diffJsonPointers(
  left: unknown,
  right: unknown,
  prefix = '',
): JsonPointerDiffEntry[] {
  if (Object.is(left, right)) return [];

  if (Array.isArray(left) && Array.isArray(right)) {
    const diffs: JsonPointerDiffEntry[] = [];
    const maxLen = Math.max(left.length, right.length);
    for (let i = 0; i < maxLen; i++) {
      const ptr = appendJsonPointer(prefix, String(i));
      if (i >= left.length) {
        diffs.push({ pointer: ptr, kind: 'added', right: right[i] });
      } else if (i >= right.length) {
        diffs.push({ pointer: ptr, kind: 'removed', left: left[i] });
      } else {
        diffs.push(...diffJsonPointers(left[i], right[i], ptr));
      }
    }
    return diffs;
  }

  if (isPlainRecord(left) && isPlainRecord(right)) {
    const diffs: JsonPointerDiffEntry[] = [];
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      const ptr = appendJsonPointer(prefix, key);
      const inLeft = Object.prototype.hasOwnProperty.call(left, key);
      const inRight = Object.prototype.hasOwnProperty.call(right, key);
      if (!inLeft && inRight) {
        diffs.push({ pointer: ptr, kind: 'added', right: right[key] });
      } else if (inLeft && !inRight) {
        diffs.push({ pointer: ptr, kind: 'removed', left: left[key] });
      } else {
        diffs.push(...diffJsonPointers(left[key], right[key], ptr));
      }
    }
    return diffs;
  }

  return [
    {
      pointer: prefix || '/',
      kind: 'changed',
      left,
      right,
    },
  ];
}

function sha256AndSize(envelope: Record<string, unknown>): {
  payloadSha256: string;
  byteLength: number;
} {
  const raw = JSON.stringify(envelope);
  return {
    payloadSha256: createHash('sha256').update(raw, 'utf8').digest('hex'),
    byteLength: Buffer.byteLength(raw, 'utf8'),
  };
}

/**
 * Generates deterministic single-variable request variants from one canonical
 * prompt/conversation context so A/B diffs isolate exact field changes.
 */
export function buildRequestVariants(
  baseInput: Omit<BuildRequestInput, 'omitMaxOutputTokens'>,
  variantOptions?: {
    enabledCreditTypes?: readonly string[];
    defaultOutputTokens?: number;
  },
): Record<RequestVariantName, BuiltRequestVariant> {
  const fixedNowMs = baseInput.nowMs ?? 1_760_000_000_000;
  const fixedTrajectoryId = baseInput.trajectoryId ?? 'trj-variant-fixed';
  const defaultOutputTokens =
    variantOptions?.defaultOutputTokens ?? POLICY_DEFAULT_MAX_OUTPUT_TOKENS;
  const creditTypes =
    normalizeEnabledCreditTypes(
      variantOptions?.enabledCreditTypes ??
        baseInput.enabledCreditTypes ?? ['GOOGLE_ONE_AI'],
    ) ?? ['GOOGLE_ONE_AI'];

  const optionsWithoutMax: GenerateOptions = {
    ...baseInput.options,
    maxTokens: undefined,
  };
  const optionsWith65536: GenerateOptions = {
    ...baseInput.options,
    maxTokens: defaultOutputTokens,
  };

  const baselineBuilt = buildAntigravityRequest({
    ...baseInput,
    options: optionsWithoutMax,
    nowMs: fixedNowMs,
    trajectoryId: fixedTrajectoryId,
    enabledCreditTypes: undefined,
    omitMaxOutputTokens: false,
  });

  // Reuse exact requestId generated for baseline so structural diffs strictly
  // isolate single wire policy fields without requestId entropy noise.
  const lockedRequestId = baselineBuilt.requestId;

  const specs: Array<{
    name: RequestVariantName;
    options: GenerateOptions;
    enabledCreditTypes?: readonly string[];
    omitMaxOutputTokens?: boolean;
  }> = [
    {
      name: 'baseline',
      options: optionsWithoutMax,
      enabledCreditTypes: undefined,
      omitMaxOutputTokens: false,
    },
    {
      name: 'credit_only',
      options: optionsWithoutMax,
      enabledCreditTypes: creditTypes,
      omitMaxOutputTokens: false,
    },
    {
      name: 'output_only_65536',
      options: optionsWith65536,
      enabledCreditTypes: undefined,
      omitMaxOutputTokens: false,
    },
    {
      name: 'both',
      options: optionsWith65536,
      enabledCreditTypes: creditTypes,
      omitMaxOutputTokens: false,
    },
    {
      name: 'server_default',
      options: optionsWithoutMax,
      enabledCreditTypes: undefined,
      omitMaxOutputTokens: true,
    },
  ];

  const out = {} as Record<RequestVariantName, BuiltRequestVariant>;

  for (const spec of specs) {
    const built =
      spec.name === 'baseline'
        ? baselineBuilt
        : buildAntigravityRequest({
            ...baseInput,
            options: spec.options,
            nowMs: fixedNowMs,
            trajectoryId: fixedTrajectoryId,
            requestId: lockedRequestId,
            enabledCreditTypes: spec.enabledCreditTypes,
            omitMaxOutputTokens: spec.omitMaxOutputTokens,
          });
    const { payloadSha256, byteLength } = sha256AndSize(built.envelope);
    const diffsFromBaseline = diffJsonPointers(
      baselineBuilt.envelope,
      built.envelope,
    );
    out[spec.name] = {
      variant: spec.name,
      envelope: built.envelope,
      requestId: built.requestId,
      canonicalModel: built.canonicalModel,
      upstreamModel: built.upstreamModel,
      hasToolActivity: built.hasToolActivity,
      payloadSha256,
      byteLength,
      diffsFromBaseline,
    };
  }

  return out;
}

export function summarizeVariantMatrix(
  variants: Record<RequestVariantName, BuiltRequestVariant>,
): VariantMatrixSummaryRow[] {
  return REQUEST_VARIANT_NAMES.map((name) => {
    const entry = variants[name];
    return {
      variant: entry.variant,
      payloadSha256: entry.payloadSha256,
      byteLength: entry.byteLength,
      diffPointers: entry.diffsFromBaseline.map((d) => d.pointer),
      diffsFromBaseline: entry.diffsFromBaseline,
    };
  });
}
