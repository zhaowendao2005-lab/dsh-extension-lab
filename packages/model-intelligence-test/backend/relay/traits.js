/**
 * Model traits inferred from a relay model name.
 *
 * The relay catalog only tells us a channel's model *name*: it has no capability metadata. A
 * channel that exposes `claude-sonnet-5` accepts images, one that exposes `deepseek-v4.1-flash`
 * does not, and both arrive here as a bare string. Guessing from the name is what the user asked
 * for ("就按照模型名猜"), so the tables below encode the naming families that a6api actually
 * forwards. Every guess is overridable: the registry stores an explicit `image`/`reasoning` once
 * the user edits one, and the stored value always wins over inference.
 */

/** Families known to accept image input. */
const IMAGE_UNSUPPORTED = [/deepseek-(v3|v4|r1|chat|reasoner)/i, /llama-?3(?!.*vision)/i, /qwen(?!.*(?:vl|omni))/i, /glm-(4|3)(?!.*v)/i, /kimi-k2(?!.*vision)/i];
const IMAGE_SUPPORTED = [/vision/i, /-vl\b/i, /vl-/i, /omni/i, /4o\b/i, /gemini/i, /claude-(3|4|5|sonnet|opus|haiku)/i, /gpt-(4\.1|5|6|4o)/i, /o[34]-.*(?:vision)?/i, /pixtral/i, /llava/i, /gemma-?3/i, /glm-4\.?\d*v/i, /qwen[\w.-]*-(vl|omni)/i, /step-1v/i, /internvl/i, /minicpm-v/i];

/** Families with an explicit thinking / reasoning level. */
const REASONING_FAMILIES = [/thinking/i, /reasoning/i, /^o[134](?:-|$)/i, /gpt-(5|6)/i, /gpt-4\.1.*(?:think)/i, /deepseek-(v4|r1|reasoner)/i, /r1(?:-|$)/i, /qwq/i, /glm-[\d.]*(?:air|think|z1)/i, /claude-.*(?:sonnet|opus|thinking)/i, /grok-[3-9]/i, /kimi-k2.*(?:think)/i, /qwen3/i];

/** The four levels every relay reasoning family speaks, cheapest first. */
export const REASONING_EFFORTS = [
  { id: 'off', name: '关闭' },
  { id: 'low', name: '低' },
  { id: 'medium', name: '中' },
  { id: 'high', name: '高' },
];
const THINKING_BUDGET = { low: 1024, medium: 4096, high: 8192 };

function matches(table, id) {
  return table.some(pattern => pattern.test(id));
}

/**
 * Whether one model name accepts images.
 * @param model - relay model name (`claude-sonnet-5`, `deepseek-v4.1-flash`, …)
 */
export function inferImage(model) {
  const id = String(model ?? '');
  if (!id) return false;
  if (matches(IMAGE_UNSUPPORTED, id)) return false;
  return matches(IMAGE_SUPPORTED, id);
}

/**
 * Whether one model name exposes thinking levels.
 * @param model - relay model name
 */
export function inferReasoning(model) {
  const id = String(model ?? '');
  return Boolean(id) && matches(REASONING_FAMILIES, id);
}

/**
 * The reasoning descriptor for `resolveModel`, or undefined for a non-reasoning route.
 * @param model - relay model name
 * @param enabled - registry override: `false` disables levels, `true` forces them
 */
export function reasoningInfo(model, enabled) {
  const on = enabled === undefined ? inferReasoning(model) : Boolean(enabled);
  if (!on) return undefined;
  return { efforts: REASONING_EFFORTS, defaultEffort: 'medium' };
}

/**
 * Provider-native thinking parameters for one protocol, omitted when the caller keeps thinking off.
 * @param api - `chat` | `responses` | `messages`
 * @param effort - selected reasoning effort id
 */
export function thinkingParams(api, effort) {
  if (!effort || effort === 'off') return {};
  const budget = THINKING_BUDGET[effort];
  if (!budget) return {};
  if (api === 'messages') return { thinking: { type: 'enabled', budget_tokens: budget } };
  if (api === 'responses') return { reasoning: { effort } };
  return { reasoning_effort: effort };
}
