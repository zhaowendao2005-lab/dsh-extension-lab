/**
 * Row-model derivation for one tool call, ported from
 * ui-tool/src/client/tool/models/tool-call-model.ts.
 *
 * The DSH original reads a frozen `ToolCallBlock` (streaming argument view, settled
 * result nodes, opaque result metadata). The mirror only has the recorded
 * `{name, status, arguments, content}` triple, so `toolRowModel` reads the same
 * classification/summary/body rules off that triple; the classification tables,
 * summary key preference, and body formatting are copied verbatim.
 */

/** Tool-call row variants selected by the generic atomic renderer. */
export type ToolRowVariant = 'search' | 'read' | 'bash' | 'write' | 'edit' | 'code' | 'others';

/** Row lifecycle state used by summary styling and accessible status text. */
export type ToolRowState = 'preparing' | 'running' | 'ok' | 'error' | 'stopped';

/** Locale key per generic row variant. */
export const VARIANT_TITLE_KEYS: Record<ToolRowVariant, string> = {
  search: 'tool.title.search', read: 'tool.title.read', bash: 'tool.title.bash',
  write: 'tool.title.write', edit: 'tool.title.edit', code: 'tool.title.code',
  others: 'tool.title.generic',
};

/**
 * Known tool name -> variant. Copied verbatim from the DSH table, including the
 * tool names DSH deliberately leaves to their own keyed toolview (`cordis_define`,
 * which the mirror renders as the generic row).
 */
const TOOL_VARIANTS: Record<string, ToolRowVariant> = {
  bash: 'bash',
  pwsh: 'bash',
  read: 'read',
  read_image: 'read',
  web_fetch: 'read',
  web_search: 'search',
  grep: 'search',
  glob: 'search',
  write: 'write',
  edit: 'edit',
  apply_patch: 'edit',
  run_code: 'code',
  cua_run_code: 'code',
  cordis_package_inspect: 'read',
  cordis_runtime_inspect: 'read',
  cordis_run: 'others',
  cordis_stop: 'others',
  cordis_undefine: 'others',
};

/** Tool-owned titles that refine a generic row variant without replacing it. */
const TOOL_TITLE_KEYS: Record<string, string> = {
  apply_patch: 'tool.title.applyPatch',
  cordis_package_inspect: 'tool.title.inspect',
  cordis_runtime_inspect: 'tool.title.inspect',
  cordis_run: 'tool.title.runCordis',
  cordis_stop: 'tool.title.stopCordis',
  cordis_undefine: 'tool.title.removeCordis',
  pwsh: 'tool.title.pwsh',
  read_image: 'tool.title.readImage',
  todo_write: 'todo.rowTitle',
  ask_user_question: 'ask.rowTitle',
  create_goal: 'tool.title.createGoal',
  get_goal: 'tool.title.getGoal',
  update_goal: 'tool.title.updateGoal',
  schedule_create: 'tool.title.createSchedule',
  schedule_list: 'tool.title.listSchedules',
  schedule_view: 'tool.title.viewSchedule',
  schedule_edit: 'tool.title.editSchedule',
  schedule_delete: 'tool.title.deleteSchedule',
  schedule_update: 'tool.title.updateSchedule',
  cordis_inspect_list: 'tool.title.inspectProviders',
  cordis_inspect_query: 'tool.title.queryRuntime',
  cordis_inspect_self: 'tool.title.inspectPlugins',
  workflow: 'tool.title.workflow',
  ralph: 'tool.title.ralph',
  session_event_read: 'tool.title.readEvent',
  session_event_search: 'tool.title.searchEvents',
  session_event_trace: 'tool.title.traceEvent',
  session_search: 'tool.title.searchSessions',
  session_trace: 'tool.title.traceSession',
  list_subagent_models: 'tool.title.listModels',
  subagent: 'tool.title.subagent',
  subagent_fork: 'tool.title.subagentFork',
  list_agents: 'tool.title.listAgents',
  send_message: 'tool.title.sendMessage',
  interrupt_agent: 'tool.title.interruptAgent',
  job_list: 'tool.title.listJobs',
  job_output: 'tool.title.readJob',
  job_kill: 'tool.title.killJob',
  terminal_open: 'tool.title.openTerminal',
  terminal_read: 'tool.title.readTerminal',
  terminal_list: 'tool.title.listTerminals',
  terminal_signal: 'tool.title.signalTerminal',
  terminal_close: 'tool.title.closeTerminal',
  lsp: 'tool.title.lsp',
  spawn_teammate: 'tool.title.spawnTeammate',
  team_task_create: 'tool.title.createTeamTask',
  team_task_get: 'tool.title.getTeamTask',
  team_task_update: 'tool.title.updateTeamTask',
  team_task_list: 'tool.title.listTeamTasks',
  wait_agent: 'tool.title.waitAgent',
};

/**
 * Classify a tool name into its row variant.
 * @param toolName - wire tool name.
 * @returns matching variant, others when unknown.
 */
export function classifyTool(toolName: string): ToolRowVariant {
  return TOOL_VARIANTS[toolName] ?? 'others';
}

/**
 * Select a tool-owned or generic title without reading arguments.
 * @param toolName - wire tool name.
 * @returns the locale key of the row title.
 */
export function toolTitleKey(toolName: string): string {
  return TOOL_TITLE_KEYS[toolName] ?? VARIANT_TITLE_KEYS[classifyTool(toolName)];
}

/** Summary key preference per variant (args-derived). */
const SUMMARY_KEYS: Record<ToolRowVariant, readonly string[]> = {
  bash: ['description', 'command'],
  read: ['path', 'file_path', 'url'],
  search: ['query', 'pattern', 'url'],
  write: ['path', 'file_path'],
  edit: ['path', 'file_path'],
  code: ['description'],
  others: [],
};

/** Path keys only — never `url` (web_fetch lands on the read variant). */
const FILE_PATH_KEYS = ['path', 'file_path'] as const;

/** File-tool variants whose summary may be an openable workspace path. */
const FILE_PATH_VARIANTS: ReadonlySet<ToolRowVariant> = new Set(['read', 'write', 'edit']);

function parseArgs(argsRaw: string): unknown {
  try {
    return JSON.parse(argsRaw);
  } catch {
    // Non-JSON args (truncation or a rejected call kept verbatim): summary/body fall back to the raw string.
    return undefined;
  }
}

function firstLine(text: string): string {
  const nl = text.indexOf('\n');
  return nl === -1 ? text : text.slice(0, nl);
}

function pickString(args: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return undefined;
}

function argsRecord(argsRaw: string): Record<string, unknown> | undefined {
  const parsed = parseArgs(argsRaw);
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : undefined;
}

function deriveSummary(variant: ToolRowVariant, argsRaw: string): string {
  const parsed = parseArgs(argsRaw);
  if (typeof parsed !== 'object' || parsed === null) return firstLine(argsRaw);
  const args = parsed as Record<string, unknown>;
  if (variant === 'search' && Array.isArray(args.queries)) {
    const queries = args.queries.filter((query: unknown): query is string => typeof query === 'string' && query !== '');
    if (queries.length > 0) return queries.map(firstLine).join(', ');
  }
  const picked = pickString(args, SUMMARY_KEYS[variant]);
  if (picked !== undefined) return firstLine(picked);
  for (const value of Object.values(args)) {
    if (typeof value === 'string' && value !== '') return firstLine(value);
  }
  return firstLine(argsRaw);
}

/**
 * Summary material for a recorded call: the complete file path for file tools,
 * otherwise the `description` text. Empty when the arguments carry neither, so
 * the caller falls back to the derived summary.
 *
 * DSH reads these off its streaming argument view and displays the path relative
 * to the session workspace / home. The mirror is handed finished argument text
 * and has no cwd or home, so the path is displayed exactly as the tool recorded it.
 */
function argumentSummary(
  variant: ToolRowVariant, argsRaw: string,
): { summary: string; filePath: string | undefined } {
  const args = argsRecord(argsRaw);
  if (FILE_PATH_VARIANTS.has(variant)) {
    const path = args === undefined ? undefined : pickString(args, FILE_PATH_KEYS);
    const filePath = path === undefined ? undefined : firstLine(path);
    return { summary: filePath ?? '', filePath };
  }
  const description = args === undefined ? undefined : pickString(args, ['description']);
  return { summary: description === undefined ? '' : firstLine(description), filePath: undefined };
}

function deriveFilePath(variant: ToolRowVariant, argsRaw: string): string | undefined {
  if (!FILE_PATH_VARIANTS.has(variant)) return undefined;
  const args = argsRecord(argsRaw);
  if (args === undefined) return undefined;
  const picked = pickString(args, FILE_PATH_KEYS);
  return picked === undefined ? undefined : firstLine(picked);
}

/**
 * Format one argument payload when its generic input body becomes visible.
 * @param variant - row presentation selected for the Tool name.
 * @param argsRaw - original argument JSON or incomplete raw text.
 * @returns display body, or null for empty input.
 */
export function formatToolBody(variant: ToolRowVariant, argsRaw: string): string | null {
  if (argsRaw === '') return null;
  const parsed = parseArgs(argsRaw);
  if (parsed === undefined) return argsRaw;
  // The code row's expanded body IS the program, not the args JSON envelope around it.
  if (variant === 'code' && typeof parsed === 'object' && parsed !== null) {
    const code = (parsed as Record<string, unknown>).code;
    if (typeof code === 'string' && code !== '') return code;
  }
  return JSON.stringify(parsed, null, 2);
}

/**
 * Read the openable URL of a web_fetch call from its arguments.
 * @param toolName - wire tool name.
 * @param argsRaw - recorded argument text.
 * @returns the http(s) URL, or undefined for another tool, protocol, or unparsable argument.
 */
export function webFetchHref(toolName: string, argsRaw: string): string | undefined {
  if (toolName !== 'web_fetch') return undefined;
  const args = argsRecord(argsRaw);
  if (args === undefined || typeof args.url !== 'string') return undefined;
  try {
    const { protocol } = new URL(args.url);
    return protocol === 'http:' || protocol === 'https:' ? args.url : undefined;
  } catch {
    // An unparsable URL stays plain summary text.
    return undefined;
  }
}

/** Everything the vendored ToolRow needs, derived once from the recorded triple. */
export interface ToolRowModel {
  variant: ToolRowVariant;
  /** Locale key of the row title; resolve it through `label()`. */
  titleKey: string;
  /** Generic rows retain the wire tool name; available arguments append their summary. */
  summary: string;
  /** Argument path for file rows, displayed exactly as recorded. */
  filePath: string | undefined;
  /** Original argument JSON retained for expansion-time body formatting. */
  bodyRaw: string | null;
  /** Result text; null while running or when the result carries no text. */
  output: string | null;
  /** First line of the result text on an error row; null for every other state. */
  errorSummary: string | null;
  /** Safe http(s) URL from the arguments; renders the summary as a link. */
  href: string | undefined;
  state: ToolRowState;
}

/**
 * Derive the full row model from the recorded call.
 * @param toolName - wire tool name.
 * @param status - recorded lifecycle state: running while streaming, then ok or error.
 * @param argsRaw - formatted argument JSON, or null before arguments were recorded.
 * @param content - recorded result text, or null while running.
 * @returns the row model.
 */
export function toolRowModel(
  toolName: string, status: 'running' | 'ok' | 'error', argsRaw: string | null, content: string | null,
): ToolRowModel {
  const variant = classifyTool(toolName);
  const titleKey = toolTitleKey(toolName);
  const raw = argsRaw ?? '';
  const primary = argumentSummary(variant, raw);
  const filePath = primary.filePath ?? deriveFilePath(variant, raw);
  // The empty string is "no text": a blank result has nothing to expand.
  const output = content === null || content === '' ? null : content;
  // DSH falls back to the call id when the arguments are empty; the mirror never
  // shows an id, so an argument-free call keeps its title alone.
  const base = primary.summary !== '' ? primary.summary : raw === '' ? '' : deriveSummary(variant, raw);
  const summary = [titleKey === 'tool.title.generic' ? toolName : '', base].filter(Boolean).join(' · ');
  const errorSummary = status === 'error' && output !== null ? firstLine(output) : null;
  return {
    variant,
    titleKey,
    summary,
    filePath,
    bodyRaw: raw === '' ? null : raw,
    output,
    errorSummary,
    href: webFetchHref(toolName, raw),
    state: status,
  };
}
