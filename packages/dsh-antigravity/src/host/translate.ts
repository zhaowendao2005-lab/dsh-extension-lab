import {
  ToolCallId,
  offloadedImageText,
  requestImageHandleText,
  type ContentBlock,
  type FinishReason,
  type GenerateOptions,
  type ImageAttachmentAccess,
  type RequestMessage,
  type StreamChunk,
  type ToolSchema,
} from '@deepseek-ai/dsh-llm';
import { isGemini3SeriesModel, normalizeModelId } from './catalog.ts';
import {
  buildOfficialRequestId,
  deriveUpstreamSessionId,
  extractTrajectoryId,
  resolveOfficialFingerprint,
} from './identity.ts';
import {
  GEMINI_SENTINEL_THOUGHT_SIGNATURE,
  buildReplayEnvelope,
  extractAlignedReplayBlocks,
  isUsableSignature,
  type AntigravityReplayBlockState,
} from './replay.ts';
import {
  mapUsage,
  mergeUsageMetadata,
  type GeminiUsageMetadata,
} from './usage.ts';
import { classifyUpstreamHttpError, AntigravityUpstreamError } from './client.ts';
import type { ReasoningEffortValue } from '../shared/types.ts';

export interface ResolvedImageData {
  data: Uint8Array;
  mediaType: string;
  width?: number;
  height?: number;
  access?: ImageAttachmentAccess;
}

export interface BuildRequestInput {
  options: GenerateOptions;
  accountId: string;
  accountEmail?: string;
  projectId: string;
  sessionGeneration?: number;
  defaultThinkingEffort?: 'auto' | ReasoningEffortValue;
  images?: ReadonlyMap<string, ResolvedImageData>;
  nowMs?: number;
  trajectoryId?: string;
}

interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { id: string; name: string; args: Record<string, unknown> };
  functionResponse?: { id: string; name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

function flattenTextBlocks(blocks: readonly ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text' && block.text) {
      parts.push(block.text);
    } else if (block.type === 'tool-addition') {
      parts.push(`[tool-added: ${block.toolName}]`);
    } else if (block.type === 'tool-removal') {
      parts.push(`[tool-removed: ${block.toolName}]`);
    }
  }
  return parts.join('\n');
}

function wrapInSystemReminder(text: string): string {
  const escaped = text.replaceAll('</system-reminder>', '<\\/system-reminder>');
  return `<system-reminder>\n${escaped}\n</system-reminder>`;
}

function safeParseJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { raw };
  }
}

const UPPERCASE_SCHEMA_TYPE: Record<string, string> = {
  string: 'STRING',
  number: 'NUMBER',
  integer: 'INTEGER',
  boolean: 'BOOLEAN',
  array: 'ARRAY',
  object: 'OBJECT',
  null: 'TYPE_UNSPECIFIED',
};

const STRIPPED_SCHEMA_KEYS = new Set([
  '$schema',
  '$id',
  '$defs',
  'definitions',
  'additionalProperties',
  'default',
  'title',
  'examples',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'patternProperties',
  'unevaluatedProperties',
  'propertyNames',
]);

function resolveRef(
  ref: string,
  defs: Record<string, unknown>,
  seen: Set<string>,
): Record<string, unknown> | undefined {
  if (!ref.startsWith('#/') || seen.has(ref)) return undefined;
  seen.add(ref);
  const parts = ref.slice(2).split('/');
  const leaf = parts[parts.length - 1];
  const candidate = defs[leaf];
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    return candidate as Record<string, unknown>;
  }
  return undefined;
}

/**
 * Clean JSON Schema cleanly into Gemini FunctionDeclaration `parameters` Schema proto.
 */
export function cleanJsonSchemaForGemini(
  schema: unknown,
  rootDefs?: Record<string, unknown>,
  seenRefs: Set<string> = new Set(),
): Record<string, unknown> {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    return { type: 'OBJECT' };
  }

  const obj = schema as Record<string, unknown>;
  const defs =
    rootDefs ??
    ((obj.$defs as Record<string, unknown>) ??
      (obj.definitions as Record<string, unknown>) ??
      {});

  if (typeof obj.$ref === 'string') {
    const resolved = resolveRef(obj.$ref, defs, new Set(seenRefs));
    if (resolved) {
      return cleanJsonSchemaForGemini(resolved, defs, seenRefs);
    }
    return { type: 'STRING' };
  }

  const out: Record<string, unknown> = {};
  let nullable = obj.nullable === true;

  const branchArray = Array.isArray(obj.anyOf)
    ? obj.anyOf
    : Array.isArray(obj.oneOf)
      ? obj.oneOf
      : undefined;

  if (branchArray) {
    const nonNull = branchArray.filter((b) => {
      if (b && typeof b === 'object' && (b as { type?: unknown }).type === 'null') {
        nullable = true;
        return false;
      }
      return true;
    });
    if (nonNull.length > 0) {
      const firstCleaned = cleanJsonSchemaForGemini(nonNull[0], defs, seenRefs);
      if (nullable) firstCleaned.nullable = true;
      if (typeof obj.description === 'string' && !firstCleaned.description) {
        firstCleaned.description = obj.description;
      }
      return firstCleaned;
    }
  }

  for (const [key, val] of Object.entries(obj)) {
    if (STRIPPED_SCHEMA_KEYS.has(key) || key === 'anyOf' || key === 'oneOf' || key === '$ref') {
      continue;
    }
    if (key === 'const') {
      out.enum = [val];
      if (!out.type) {
        out.type =
          typeof val === 'number'
            ? 'NUMBER'
            : typeof val === 'boolean'
              ? 'BOOLEAN'
              : 'STRING';
      }
      continue;
    }
    if (key === 'type') {
      if (typeof val === 'string') {
        const mapped = UPPERCASE_SCHEMA_TYPE[val.toLowerCase()];
        out.type = mapped ?? val.toUpperCase();
      } else if (Array.isArray(val)) {
        const nonNull = val.filter((t) => t !== 'null');
        if (val.includes('null')) nullable = true;
        const primary = typeof nonNull[0] === 'string' ? nonNull[0] : 'string';
        out.type = UPPERCASE_SCHEMA_TYPE[primary.toLowerCase()] ?? primary.toUpperCase();
      }
      continue;
    }
    if (key === 'properties' && val && typeof val === 'object' && !Array.isArray(val)) {
      const cleanedProps: Record<string, unknown> = {};
      for (const [pKey, pSchema] of Object.entries(val as Record<string, unknown>)) {
        cleanedProps[pKey] = cleanJsonSchemaForGemini(pSchema, defs, seenRefs);
      }
      out.properties = cleanedProps;
      continue;
    }
    if (key === 'items') {
      out.items = cleanJsonSchemaForGemini(val, defs, seenRefs);
      continue;
    }
    if (key === 'required' && Array.isArray(val)) {
      out.required = val.filter((item): item is string => typeof item === 'string');
      continue;
    }
    if (key === 'enum' && Array.isArray(val)) {
      out.enum = val.filter((item) => item !== null && item !== undefined);
      continue;
    }
    if (key === 'description' && typeof val === 'string') {
      out.description = val;
      continue;
    }
    out[key] = val;
  }

  if (out.properties && !out.type) {
    out.type = 'OBJECT';
  }
  if (out.items && !out.type) {
    out.type = 'ARRAY';
  }
  if (!out.type) {
    out.type = 'STRING';
  }
  if (nullable) {
    out.nullable = true;
  }

  return out;
}

function normalizeTools(tools: readonly ToolSchema[] | undefined): unknown[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  const declarations = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: cleanJsonSchemaForGemini(tool.parameters),
  }));
  return [{ functionDeclarations: declarations }];
}

function buildThinkingConfig(params: {
  model: string;
  effort?: string;
  defaultEffort?: 'auto' | ReasoningEffortValue;
}): Record<string, unknown> | undefined {
  const model = params.model.toLowerCase();
  if (model.includes('lite')) return undefined;

  let chosen: ReasoningEffortValue | undefined;
  if (params.effort === 'low' || params.effort === 'medium' || params.effort === 'high') {
    chosen = params.effort;
  } else if (
    params.defaultEffort === 'low' ||
    params.defaultEffort === 'medium' ||
    params.defaultEffort === 'high'
  ) {
    chosen = params.defaultEffort;
  } else if (model.endsWith('-high')) {
    chosen = 'high';
  } else if (model.endsWith('-low')) {
    chosen = 'low';
  } else if (model.includes('pro') || model.includes('gemini-3') || model.includes('gemini-2.5')) {
    chosen = 'medium';
  }

  if (!chosen) return undefined;

  if (isGemini3SeriesModel(model)) {
    return {
      includeThoughts: true,
      thinkingLevel: chosen.toUpperCase(),
    };
  }

  const budgetMap: Record<ReasoningEffortValue, number> = {
    low: 1024,
    medium: 8192,
    high: 24576,
  };
  return {
    includeThoughts: true,
    thinkingBudget: budgetMap[chosen],
  };
}

function pushTurn(contents: GeminiContent[], role: 'user' | 'model', parts: GeminiPart[]): void {
  if (parts.length === 0) return;
  const prev = contents[contents.length - 1];
  if (prev && prev.role === role) {
    prev.parts.push(...parts);
    return;
  }
  contents.push({ role, parts: [...parts] });
}

function imageBlockToParts(
  block: Extract<ContentBlock, { type: 'image' }>,
  images?: ReadonlyMap<string, ResolvedImageData>,
): GeminiPart[] {
  if (block.offloaded === true) {
    return [{ text: offloadedImageText(block.attachment) }];
  }
  const resolved = images?.get(block.attachment.attachmentId);
  if (!resolved) {
    return [{ text: offloadedImageText(block.attachment) }];
  }
  const parts: GeminiPart[] = [];
  if (resolved.width !== undefined && resolved.height !== undefined) {
    parts.push({
      text: requestImageHandleText(
        block.attachment,
        { width: resolved.width, height: resolved.height },
        resolved.access,
      ),
    });
  }
  parts.push({
    inlineData: {
      mimeType: resolved.mediaType,
      data: Buffer.from(resolved.data).toString('base64'),
    },
  });
  return parts;
}

/**
 * Translate DSH `GenerateOptions` into an ordered Cloud Code `v1internal` envelope:
 * Top-level key order: `project -> requestId -> request -> model -> userAgent -> requestType`
 * Inner `request` key order: `contents -> systemInstruction -> tools -> labels -> generationConfig -> sessionId`
 */
export function buildAntigravityRequest(input: BuildRequestInput): {
  envelope: Record<string, unknown>;
  requestId: string;
  canonicalModel: string;
  hasToolActivity: boolean;
} {
  const { options } = input;
  const canonicalModel = normalizeModelId(options.model);
  const { envelopeUserAgent } = resolveOfficialFingerprint(input.accountEmail);

  // 1. Freeze leading system messages + options.system into top-level systemInstruction.
  const leadingSystemChunks: string[] = [];
  if (options.system && options.system.trim() !== '') {
    leadingSystemChunks.push(options.system);
  }
  let historyStartIndex = 0;
  while (
    historyStartIndex < options.messages.length &&
    options.messages[historyStartIndex].role === 'system'
  ) {
    const text = flattenTextBlocks(options.messages[historyStartIndex].content);
    if (text.trim() !== '') leadingSystemChunks.push(text);
    historyStartIndex += 1;
  }
  const frozenSystemText = leadingSystemChunks.join('\n\n');

  // 2. Translate history messages preserving prefix stability & exact role alternation.
  const toolNames = new Map<string, string>();
  const contents: GeminiContent[] = [];

  for (let i = historyStartIndex; i < options.messages.length; i++) {
    const message: RequestMessage = options.messages[i];

    if (message.role === 'system' || message.role === 'developer') {
      const text = flattenTextBlocks(message.content);
      if (text.trim() !== '') {
        pushTurn(contents, 'user', [{ text: wrapInSystemReminder(text) }]);
      }
      continue;
    }

    if (message.role === 'user') {
      const parts: GeminiPart[] = [];
      for (const block of message.content) {
        if (block.type === 'text') {
          if (block.text !== '') parts.push({ text: block.text });
        } else if (block.type === 'image') {
          parts.push(...imageBlockToParts(block, input.images));
        }
      }
      pushTurn(contents, 'user', parts);
      continue;
    }

    if (message.role === 'tool') {
      const textParts: string[] = [];
      const extraParts: GeminiPart[] = [];
      for (const block of message.content) {
        if (block.type === 'text' && block.text !== '') {
          textParts.push(block.text);
        } else if (block.type === 'image') {
          extraParts.push(...imageBlockToParts(block, input.images));
        }
      }
      const output = textParts.join('\n') || '(no output)';
      const name = toolNames.get(message.toolCallId) ?? 'tool';
      const responsePart: GeminiPart = {
        functionResponse: {
          id: message.toolCallId,
          name,
          response: message.isError ? { error: output } : { output },
        },
      };
      pushTurn(contents, 'user', [responsePart, ...extraParts]);
      continue;
    }

    if (message.role === 'assistant') {
      const replayStates = extractAlignedReplayBlocks(
        message.content,
        message.source?.replayState,
      );
      const parts: GeminiPart[] = [];
      let sawNonThinking = false;
      let turnHasRealSignature = false;

      for (let bIdx = 0; bIdx < message.content.length; bIdx++) {
        const block = message.content[bIdx];
        const replay = replayStates[bIdx];
        const sig = isUsableSignature(replay?.thoughtSignature)
          ? replay!.thoughtSignature
          : undefined;
        if (sig) turnHasRealSignature = true;

        if (block.type === 'reasoning') {
          if (!block.text.trim()) continue;
          if (!sawNonThinking) {
            parts.push({
              text: block.text,
              thought: true,
              ...(sig ? { thoughtSignature: sig } : {}),
            });
          } else {
            parts.push({ text: block.text });
          }
        } else if (block.type === 'text') {
          if (block.text === '' && !sig) continue;
          sawNonThinking = true;
          parts.push({
            text: block.text,
            ...(sig ? { thoughtSignature: sig } : {}),
          });
        } else if (block.type === 'tool-call') {
          sawNonThinking = true;
          toolNames.set(block.id, block.name);
          parts.push({
            functionCall: {
              id: block.id,
              name: block.name,
              args: safeParseJsonObject(block.arguments),
            },
            ...(sig ? { thoughtSignature: sig } : {}),
          });
        }
      }

      // If an assistant turn contains Gemini functionCall parts without any signature,
      // attach Base64 skip sentinel strictly to the FIRST functionCall part (AGM inbound.rs).
      if (!turnHasRealSignature) {
        const firstFc = parts.find((p) => p.functionCall !== undefined);
        if (firstFc) {
          firstFc.thoughtSignature = GEMINI_SENTINEL_THOUGHT_SIGNATURE;
        }
      }

      pushTurn(contents, 'model', parts);
    }
  }

  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: '.' }] });
  }

  const tools = normalizeTools(options.tools);
  const hasToolInteractions = contents.some((c) =>
    c.parts.some((p) => p.functionCall !== undefined || p.functionResponse !== undefined),
  );
  const hasToolActivity = (tools !== undefined && tools.length > 0) || hasToolInteractions;

  const modelTurns = contents.filter((c) => c.role === 'model').length;
  const requestId = buildOfficialRequestId(
    options.sessionId,
    contents.length,
    input.trajectoryId,
    input.nowMs,
  );
  const trajId = extractTrajectoryId(requestId);
  const labels = {
    last_step_index: String(modelTurns),
    model_enum: canonicalModel,
    request_id: `${trajId}-${modelTurns}`,
    trajectory_id: trajId,
    used_claude: 'false',
    used_claude_conservative: 'false',
    used_non_gemini_model: 'false',
  };

  // Ordered generationConfig: maxOutputTokens -> thinkingConfig -> temperature -> stopSequences
  const generationConfig: Record<string, unknown> = {};
  if (typeof options.maxTokens === 'number' && Number.isFinite(options.maxTokens) && options.maxTokens > 0) {
    generationConfig.maxOutputTokens = Math.trunc(options.maxTokens);
  }
  const thinkingConfig = buildThinkingConfig({
    model: canonicalModel,
    effort: options.reasoningEffort,
    defaultEffort: input.defaultThinkingEffort,
  });
  if (thinkingConfig) {
    generationConfig.thinkingConfig = thinkingConfig;
  }
  if (typeof options.temperature === 'number' && Number.isFinite(options.temperature)) {
    generationConfig.temperature = options.temperature;
  }
  if (options.stop && options.stop.length > 0) {
    generationConfig.stopSequences = [...options.stop];
  }

  const upstreamSessionId = deriveUpstreamSessionId(
    input.accountId,
    options.sessionId,
    input.sessionGeneration ?? 0,
  );

  // Ordered inner request:
  // contents -> systemInstruction -> tools -> labels -> generationConfig -> sessionId
  const innerRequest: Record<string, unknown> = {
    contents,
  };
  if (frozenSystemText !== '') {
    innerRequest.systemInstruction = {
      role: 'user',
      parts: [{ text: frozenSystemText }],
    };
  }
  if (tools) {
    innerRequest.tools = tools;
  }
  innerRequest.labels = labels;
  if (Object.keys(generationConfig).length > 0) {
    innerRequest.generationConfig = generationConfig;
  }
  innerRequest.sessionId = upstreamSessionId;

  // Ordered top-level envelope:
  // project -> requestId -> request -> model -> userAgent -> requestType
  const envelope: Record<string, unknown> = {
    project: input.projectId || 'aicode-consumers',
    requestId,
    request: innerRequest,
    model: canonicalModel,
    userAgent: envelopeUserAgent,
  };
  if (hasToolActivity) {
    envelope.requestType = 'agent';
  }

  return { envelope, requestId, canonicalModel, hasToolActivity };
}

export function buildCountTokensEnvelope(innerRequest: Record<string, unknown>): {
  request: Record<string, unknown>;
} {
  const { safetySettings: _omit, ...rest } = innerRequest;
  return { request: rest };
}

interface RawGeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  thought_signature?: string;
  functionCall?: {
    id?: string;
    name?: string;
    args?: Record<string, unknown>;
  };
}

interface RawGeminiPayload {
  response?: {
    responseId?: string;
    candidates?: Array<{
      finishReason?: string;
      finish_reason?: string;
      content?: { parts?: RawGeminiPart[] };
    }>;
    usageMetadata?: GeminiUsageMetadata;
  };
  responseId?: string;
  candidates?: Array<{
    finishReason?: string;
    finish_reason?: string;
    content?: { parts?: RawGeminiPart[] };
  }>;
  usageMetadata?: GeminiUsageMetadata;
  error?: { code?: number; message?: string; status?: string };
}

function mapGeminiFinishReason(
  rawReason: string | undefined,
  sawToolCall: boolean,
): FinishReason {
  if (sawToolCall) return { kind: 'tool-calls' };
  const upper = (rawReason ?? '').toUpperCase();
  if (upper === 'MAX_TOKENS') return { kind: 'max-tokens' };
  return { kind: 'stop' };
}

/**
 * Stateful Gemini `v1internal:streamGenerateContent?alt=sse` decoder producing
 * valid DSH `StreamChunk`s in strict block-start / delta / block-end / usage / finish order.
 */
export class GeminiSseStreamDecoder {
  private readonly utf8 = new TextDecoder('utf-8', { fatal: false });
  private buffer = '';

  private nextBlockIndex = 0;
  private activeBlock:
    | {
        index: number;
        kind: 'text' | 'reasoning';
        text: string;
        thoughtSignature?: string;
      }
    | undefined;

  private readonly replayBlocks: AntigravityReplayBlockState[] = [];
  private usageMetadata: GeminiUsageMetadata | undefined;
  private rawFinishReason: string | undefined;
  private responseId: string | undefined;
  private sawToolCall = false;
  private toolCounter = 0;

  constructor(
    private readonly model: string,
    private readonly accountId?: string,
    private readonly requestId?: string,
  ) {}

  feed(chunkBytes: Uint8Array): StreamChunk[] {
    this.buffer += this.utf8.decode(chunkBytes, { stream: true }).replaceAll('\r\n', '\n');
    return this.drainCompleteEvents();
  }

  finish(): { chunks: StreamChunk[]; usage: ReturnType<typeof mapUsage>; hasOutput: boolean } {
    this.buffer += this.utf8.decode().replaceAll('\r\n', '\n');
    const out = this.drainCompleteEvents();

    // Handle trailing partial line without double-newline terminator if valid SSE data.
    if (this.buffer.trim() !== '') {
      out.push(...this.processEventBlock(this.buffer));
      this.buffer = '';
    }

    this.closeActiveBlock(out);

    const usage = mapUsage(this.usageMetadata);
    out.push({ type: 'usage', usage });

    const reason = mapGeminiFinishReason(this.rawFinishReason, this.sawToolCall);
    const replayState = buildReplayEnvelope({
      model: this.model,
      accountId: this.accountId,
      responseId: this.responseId,
      blockStates: this.replayBlocks,
    });
    out.push({ type: 'finish', reason, replayState });

    return {
      chunks: out,
      usage,
      hasOutput: this.replayBlocks.length > 0,
    };
  }

  private drainCompleteEvents(): StreamChunk[] {
    const out: StreamChunk[] = [];
    for (;;) {
      const sepIdx = this.buffer.indexOf('\n\n');
      if (sepIdx === -1) break;
      const rawEvent = this.buffer.slice(0, sepIdx);
      this.buffer = this.buffer.slice(sepIdx + 2);
      out.push(...this.processEventBlock(rawEvent));
    }
    return out;
  }

  private processEventBlock(rawEvent: string): StreamChunk[] {
    const dataLines: string[] = [];
    for (const line of rawEvent.split('\n')) {
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length === 0) return [];
    const dataPayload = dataLines.join('\n').trim();
    if (!dataPayload || dataPayload === '[DONE]') return [];

    let parsed: RawGeminiPayload;
    try {
      parsed = JSON.parse(dataPayload) as RawGeminiPayload;
    } catch {
      return [];
    }

    if (parsed.error) {
      const code =
        typeof parsed.error.code === 'number' ? parsed.error.code : 502;
      throw new AntigravityUpstreamError(
        classifyUpstreamHttpError(code, dataPayload),
        this.requestId,
      );
    }

    const inner = parsed.response ?? parsed;
    if (typeof inner.responseId === 'string' && !this.responseId) {
      this.responseId = inner.responseId;
    }
    if (inner.usageMetadata) {
      this.usageMetadata = mergeUsageMetadata(this.usageMetadata, inner.usageMetadata);
    }

    const out: StreamChunk[] = [];
    const candidate = inner.candidates?.[0];
    if (!candidate) return out;

    const finish = candidate.finishReason ?? candidate.finish_reason;
    if (typeof finish === 'string' && finish !== '') {
      this.rawFinishReason = finish;
    }

    const parts = candidate.content?.parts ?? [];
    for (const part of parts) {
      const sig = part.thoughtSignature ?? part.thought_signature;

      if (part.functionCall) {
        this.closeActiveBlock(out);
        this.sawToolCall = true;
        this.toolCounter += 1;
        const callId = ToolCallId(
          part.functionCall.id?.trim() || `ag_call_${this.toolCounter}`,
        );
        const name = part.functionCall.name?.trim() || 'unknown_tool';
        const argsStr = JSON.stringify(part.functionCall.args ?? {});
        const index = this.nextBlockIndex++;

        out.push({ type: 'block-start', index, blockType: 'tool-call' });
        out.push({
          type: 'tool-call-delta',
          index,
          id: callId,
          name,
          argumentsDelta: argsStr,
        });
        out.push({
          type: 'block-end',
          index,
          block: {
            type: 'tool-call',
            id: callId,
            name,
            arguments: argsStr,
          },
        });
        this.replayBlocks.push({
          kind: 'tool-call',
          toolCallId: callId,
          toolName: name,
          ...(isUsableSignature(sig) ? { thoughtSignature: sig.trim() } : {}),
        });
        continue;
      }

      if ((typeof part.text === 'string' && part.text !== '') || isUsableSignature(sig)) {
        const isThought = part.thought === true;
        const targetKind: 'reasoning' | 'text' = isThought ? 'reasoning' : 'text';
        const text = part.text ?? '';

        if (this.activeBlock && this.activeBlock.kind !== targetKind) {
          this.closeActiveBlock(out);
        }

        if (!this.activeBlock) {
          const index = this.nextBlockIndex++;
          this.activeBlock = {
            index,
            kind: targetKind,
            text: '',
            ...(isUsableSignature(sig) ? { thoughtSignature: sig.trim() } : {}),
          };
          out.push({
            type: 'block-start',
            index,
            blockType: targetKind,
          });
        } else if (isUsableSignature(sig)) {
          this.activeBlock.thoughtSignature = sig.trim();
        }

        if (text !== '') {
          this.activeBlock.text += text;
          out.push({
            type: targetKind === 'reasoning' ? 'reasoning-delta' : 'text-delta',
            index: this.activeBlock.index,
            text,
          });
        }
      }
    }

    return out;
  }

  private closeActiveBlock(out: StreamChunk[]): void {
    if (!this.activeBlock) return;
    const block = this.activeBlock;
    this.activeBlock = undefined;

    out.push({
      type: 'block-end',
      index: block.index,
      block:
        block.kind === 'reasoning'
          ? { type: 'reasoning', text: block.text }
          : { type: 'text', text: block.text },
    });
    this.replayBlocks.push({
      kind: block.kind,
      ...(block.kind === 'reasoning' ? { thought: true } : {}),
      ...(block.thoughtSignature ? { thoughtSignature: block.thoughtSignature } : {}),
    });
  }
}
