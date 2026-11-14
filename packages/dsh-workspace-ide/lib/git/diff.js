/**
 * `git.diff` 的抓取与解析（docs/git-model.md §5、docs/remote-contract.md §git.diff）。
 *
 * 两段式：
 *   1. `--numstat -z` 先拿文件级增删与**权威路径**（`-z` 下路径不转义、不受
 *      `core.quotepath` 影响，重命名以 `\0old\0new\0` 追加两段）；
 *   2. 再逐文件抓 patch（`--no-color --no-ext-diff --unified=<n>`），交给 `parsePatch`。
 * 未跟踪文件没有 numstat，走 `diff --no-index /dev/null <path>`：退出码 1 表示「有差异」，
 * 是正常结果而不是失败（docs/git-model.md #15）。
 *
 * 本文件是只读模块：所有 git 调用都经 `./exec.js`（AGENTS.md：命令集中在 exec.js），
 * 不直接 spawn，也不碰文件系统。
 */

import path from 'node:path';
import { LIMITS } from '../../shared/contract.js';
import { ideError } from '../../shared/errors.js';
import { gitOrThrow, runGit } from './exec.js';

/** 单文件 hunk 数上限，超出则整份文件 `truncated`（docs/git-model.md §5.3）。 */
const MAX_HUNKS_PER_FILE = 2000;
/** 单 hunk 行数上限（同上），超出则截断该 hunk 尾部。 */
const MAX_LINES_PER_HUNK = 20000;
/** `truncated` 时回传的原始 patch 头部字节数（同上）。 */
const TEXT_HEAD_BYTES = 1024 * 1024;
/** `context: -1` 要翻成「足够大」的 unified 值：git 不接受 `-U-1`。 */
const WHOLE_FILE_CONTEXT = 1000000;
/** 路径一律按字面匹配，防 `*` / `:(top)` 之类被当成 pathspec magic（docs/security.md §3）。 */
const GIT_ENV = Object.freeze({ GIT_LITERAL_PATHSPECS: '1' });
/** 未跟踪文件在 `--no-index` 里的「空侧」。 */
const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null';
/** unified diff 行首字符 → 行语义。 */
const LINE_PREFIX = {
  ' ': { type: ' ', kind: 'context' },
  '-': { type: '-', kind: 'del' },
  '+': { type: '+', kind: 'add' },
};
/** `@@ -a,b +c,d @@`；b/d 省略时语义是 1（docs/git-model.md §5.1）。 */
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
/** 只出现一次、且必须落在文件头部的元信息。 */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * 抓取并解析一次 diff。
 *
 * @param {string} cwd 仓库工作目录（绝对路径；根目录只由 Host 解析，本函数不做校验）
 * @param {{kind: string, hash?: string, parent?: string, from?: string, to?: string, path?: string}} target
 *   `kind` ∈ `working` | `index` | `commit` | `range` | `untracked`（docs/remote-contract.md §git.diff）
 * @param {{context?: number, ignoreWhitespace?: boolean}} [options] `context: -1` = 整文件
 * @returns {Promise<{
 *   files: Array<object>, isBinary: boolean, truncated: boolean, text?: string, elapsedMs: number,
 * }>} 响应外壳（`target` / `seq`）由 service 层拼，本函数只回计算结果
 * @throws {IdeError} `E_INVALID_ARG` 参数非法；`E_NOT_FOUND` rev 或未跟踪路径不存在；
 *   `E_TOO_LARGE` 单次 diff 超过 `LIMITS.diffBytesMax`；`E_GIT_FAILED` git 非零退出
 */
export async function fetchDiff(cwd, target, options = {}) {
  const startedAt = Date.now();
  const spec = normalizeTarget(target);
  const settings = normalizeOptions(options);

  if (spec.kind === 'commit') await assertCommitish(cwd, spec.hash, 'target.hash');
  if (spec.kind === 'commit' && spec.parent) await assertCommitish(cwd, spec.parent, 'target.parent');
  if (spec.kind === 'range') {
    await assertCommitish(cwd, spec.from, 'target.from');
    await assertCommitish(cwd, spec.to, 'target.to');
  }

  const entries = await listChangedFiles(cwd, spec, settings);
  /** @type {Array<object>} */
  const files = [];
  const budget = { used: 0 };
  let truncated = false;
  let rawText = '';
  let rawBytes = 0;

  for (const entry of entries) {
    // 一次请求内的总耗时上限：几百个文件时逐个 spawn 会拖死面板，宁可截断。
    if (Date.now() - startedAt > LIMITS.gitTimeoutMs) {
      truncated = true;
      break;
    }

    const paths = entry.origPath && entry.origPath !== entry.path
      ? [entry.origPath, entry.path]
      : [entry.path];
    const raw = entry.patch ?? await readPatch(cwd, spec, settings, paths);

    // truncated 时才回传的原始头部，边读边攒，最多 1 MiB。
    if (rawBytes < TEXT_HEAD_BYTES) {
      rawText += raw;
      rawBytes += Buffer.byteLength(raw);
    }

    const parsed = parsePatch(raw).files[0] ?? emptyFilePatch(entry.path);
    const file = finalizeFile(entry, parsed);
    const { stop } = enforceLimits(file, budget);
    files.push(file);
    if (file.truncated) truncated = true;
    if (stop) {
      truncated = true;
      break;
    }
  }

  const response = {
    files,
    isBinary: files.some((file) => file.binary === true),
    truncated,
    elapsedMs: Date.now() - startedAt,
  };
  if (truncated) response.text = textHead(rawText);
  return response;
}

/**
 * 解析统一 diff 文本（一个或多个文件：`diff --git a/x b/x` 开头）。
 *
 * 纯函数、不做 IO。行号 1-based，语义与 unified diff 完全一致（纯插入 `oldStart: 0`、
 * `oldLines: 0`）；`\ No newline at end of file` 附着到上一行，不产生新行
 * （docs/git-model.md §5.1）。CRLF 在展示层统一成 LF：行尾 `\r` 会被剥掉。
 *
 * 每个 hunk 的行同时给出两套等价命名：
 *   - 契约命名：`type`（`' '` / `'-'` / `'+'`）、`oldNo`、`newNo`；
 *   - 任务书写法：`kind`（`context` / `add` / `del`）、`oldLine`、`newLine`。
 * 两者同源同值，客户端按任意一套取用（见交付说明里的「与契约出入」）。
 *
 * @param {string} text 原始 patch
 * @returns {{files: Array<object>, badLines: number}} `badLines` = 头部声明的行数
 *   与实际行数不符的 hunk 数（已用实际值覆盖，不会被静默忽略）
 */
export function parsePatch(text) {
  const lines = String(text ?? '').split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  /** @type {Array<object>} */
  const files = [];
  let file = null;
  let hunk = null;
  let cursor = { old: 0, new: 0 };
  let badLines = 0;

  for (const rawLine of lines) {
    const line = stripCr(rawLine);

    if (line.startsWith('diff --git ')) {
      file = createFilePatch(line);
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;

    if (line.startsWith('@@')) {
      const next = parseHunkHeader(line);
      if (!next) {
        badLines += 1;
        hunk = null;
        continue;
      }
      file.hunks.push(next);
      hunk = next;
      cursor = { old: next.oldStart, new: next.newStart };
      continue;
    }
    if (hunk && line.startsWith('\\')) {
      markNoNewline(hunk);
      continue;
    }

    const prefix = LINE_PREFIX[line[0]];
    // 空行只在 hunk 还欠行时当上下文行（有些工具会吃掉行尾空格）。
    if (hunk && prefix && (line.length > 0 || hunkExpectsMore(hunk))) {
      pushHunkLine(hunk, cursor, prefix, line.slice(1));
      continue;
    }

    applyFileHeader(file, line);
  }

  for (const item of files) {
    for (const itemHunk of item.hunks) {
      if (!reconcileHunk(itemHunk)) badLines += 1;
    }
  }
  return { files, badLines };
}

/**
 * 解析 `git diff --numstat -z` 的原始输出。
 *
 * `-z` 下每条是 `add\tdel\tpath\0`；重命名/复制是 `add\tdel\t\0old\0new\0`
 * （即第三段为空，随后两段各占一条 NUL 记录）。二进制计数是 `-`，这里给 `null`。
 *
 * @param {string} text
 * @returns {Array<{path: string, origPath: string|null, additions: number|null, deletions: number|null}>}
 */
export function parseNumstat(text) {
  const chunks = String(text ?? '').split('\0');
  /** @type {Array<object>} */
  const files = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (!chunk) continue;
    const parts = chunk.split('\t');
    if (parts.length < 3) continue;

    const additions = numstatCount(parts[0]);
    const deletions = numstatCount(parts[1]);

    if (parts.length === 3 && parts[2] === '') {
      const origPath = chunks[index + 1] ?? '';
      const nextPath = chunks[index + 2] ?? '';
      index += 2;
      if (!nextPath) continue;
      files.push({ path: nextPath, origPath: origPath || null, additions, deletions });
      continue;
    }
    // 路径自己可能含 tab：从第三段起拼回去。
    files.push({ path: parts.slice(2).join('\t'), origPath: null, additions, deletions });
  }
  return files;
}

/**
 * 列出本次 diff 涉及的文件。
 * 未跟踪目标没有 numstat：直接把 patch 抓在手里，增删由 hunk 行数推。
 * @returns {Promise<Array<{path: string, origPath: string|null, additions: number|null, deletions: number|null, patch?: string, untracked?: boolean}>>}
 */
async function listChangedFiles(cwd, spec, settings) {
  if (spec.kind === 'untracked') {
    const patch = await readPatch(cwd, spec, settings, [spec.path]);
    return [{
      path: spec.path,
      origPath: null,
      additions: null,
      deletions: null,
      patch,
      untracked: true,
    }];
  }

  const paths = spec.path ? [spec.path] : [];
  const { stdout } = await gitOrThrow(cwd, buildArgs(spec, settings, 'numstat', paths), {
    env: GIT_ENV,
    timeoutMs: LIMITS.gitTimeoutMs,
    maxBytes: LIMITS.diffBytesMax,
  });
  return parseNumstat(stdout);
}

/**
 * 抓单个文件的 patch。
 * `--no-index` 的退出码 1 是「有差异」，所以 acceptCodes 带上 1；真正的失败（路径不存在）
 * 会以空 stdout + 非空 stderr 出现，这里翻成 `E_NOT_FOUND`。
 */
async function readPatch(cwd, spec, settings, paths) {
  const { stdout, stderr } = await gitOrThrow(cwd, buildArgs(spec, settings, 'patch', paths), {
    env: GIT_ENV,
    timeoutMs: LIMITS.gitTimeoutMs,
    maxBytes: LIMITS.diffBytesMax,
    acceptCodes: [0, 1],
  });
  if (spec.kind === 'untracked' && stdout === '') {
    if (/Could not access/i.test(stderr)) {
      throw ideError('E_NOT_FOUND', '未跟踪路径不存在或不是普通文件', {
        reason: 'not-a-file',
        path: spec.path,
      });
    }
    if (stderr.trim() !== '') {
      throw ideError('E_GIT_FAILED', 'git diff --no-index 失败', {
        reason: 'git-error',
        stderr: stderr.trim().split('\n').slice(0, 12).join('\n'),
      });
    }
  }
  return stdout;
}

/**
 * 拼出某一种 target 的 git argv。
 * @param {object} spec 规范化后的 target
 * @param {{context: number, ignoreWhitespace: boolean}} settings
 * @param {'numstat'|'patch'} mode
 * @param {string[]} paths pathspec（空数组 = 不限）
 * @returns {string[]}
 */
function buildArgs(spec, settings, mode, paths) {
  const flags = ['--no-color', '--no-ext-diff', '--no-textconv'];
  if (settings.ignoreWhitespace) flags.push('--ignore-all-space');
  const shape = mode === 'numstat'
    ? ['--numstat', '-z']
    : [`--unified=${settings.context < 0 ? WHOLE_FILE_CONTEXT : settings.context}`];
  const tail = paths.length > 0 ? ['--', ...paths] : [];

  switch (spec.kind) {
    case 'working':
      return ['diff', '--find-renames=50%', ...flags, ...shape, ...tail];
    case 'index':
      return ['diff', '--cached', '--find-renames=50%', ...flags, ...shape, ...tail];
    case 'range':
      return ['diff', '--find-renames=50%', ...flags, ...shape, `${spec.from}..${spec.to}`, ...tail];
    case 'commit':
      if (spec.parent) {
        return ['diff', '--find-renames=50%', ...flags, ...shape, `${spec.parent}..${spec.hash}`, ...tail];
      }
      // 提交内 diff：`--root` 让首个提交也有父侧，`-r` 必须显式给（diff-tree 默认不递归）。
      return ['diff-tree', ...(mode === 'patch' ? ['-p'] : []), '--root', '-r', '--no-commit-id',
        '--find-renames=50%', ...flags, ...shape, spec.hash, ...tail];
    case 'untracked':
      return ['diff', '--no-index', ...flags, ...shape, '--', NULL_DEVICE, spec.path];
    default:
      throw ideError('E_INVALID_ARG', '未知的 diff target.kind', {
        field: 'target.kind',
        value: spec.kind,
      });
  }
}

/** 把 numstat 的增删与 patch 的结构合成契约里的文件条目。 */
function finalizeFile(entry, parsed) {
  const binary = parsed.binary === true || (entry.untracked !== true && entry.additions === null);
  return {
    path: entry.path,
    ...(entry.origPath && entry.origPath !== entry.path ? { origPath: entry.origPath } : {}),
    status: parsed.status,
    additions: binary ? null : entry.additions ?? countHunkLines(parsed.hunks, 'add'),
    deletions: binary ? null : entry.deletions ?? countHunkLines(parsed.hunks, 'del'),
    binary,
    truncated: false,
    hunks: parsed.hunks,
  };
}

/**
 * 套用三层上限（docs/git-model.md §5.3）：单文件 hunk 数、单 hunk 行数、整次 diff 行数。
 * 全程按 hunk 边界裁剪，不切开 hunk；真被裁过的 hunk 会重算 `oldLines/newLines`，
 * 保证 `header` 之外的结构自洽（`header` 是 git 原文，不改写）。
 * @returns {{stop: boolean}} `stop` = 全局行预算耗尽，后续文件不用再抓
 */
function enforceLimits(file, budget) {
  if (file.hunks.length > MAX_HUNKS_PER_FILE) {
    file.hunks = file.hunks.slice(0, MAX_HUNKS_PER_FILE);
    file.truncated = true;
  }

  for (const hunk of file.hunks) {
    if (hunk.lines.length > MAX_LINES_PER_HUNK) {
      hunk.lines = hunk.lines.slice(0, MAX_LINES_PER_HUNK);
      hunk.oldLines = countHunkLines([hunk], 'context') + countHunkLines([hunk], 'del');
      hunk.newLines = countHunkLines([hunk], 'context') + countHunkLines([hunk], 'add');
      file.truncated = true;
    }
  }

  const kept = [];
  let stop = false;
  for (const hunk of file.hunks) {
    if (budget.used + hunk.lines.length > LIMITS.diffLinesMax) {
      stop = true;
      break;
    }
    kept.push(hunk);
    budget.used += hunk.lines.length;
  }
  if (kept.length !== file.hunks.length) {
    file.hunks = kept;
    file.truncated = true;
    stop = true;
  }
  return { stop };
}

/**
 * 校验并规范化 target 形状（docs/remote-contract.md §git.diff）。
 * @returns {{kind: string, path?: string|null, hash?: string, parent?: string|null, from?: string, to?: string}}
 */
function normalizeTarget(target) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    throw ideError('E_INVALID_ARG', 'target 必须是对象', { field: 'target' });
  }
  const kind = target.kind;
  switch (kind) {
    case 'working':
    case 'index':
      return { kind, path: optionalRelativePath(target.path, 'target.path') };
    case 'commit':
      return {
        kind,
        hash: assertRev(target.hash, 'target.hash'),
        parent: target.parent === undefined || target.parent === null || target.parent === ''
          ? null
          : assertRev(target.parent, 'target.parent'),
        path: optionalRelativePath(target.path, 'target.path'),
      };
    case 'range':
      return {
        kind,
        from: assertRev(target.from, 'target.from'),
        to: assertRev(target.to, 'target.to'),
        path: optionalRelativePath(target.path, 'target.path'),
      };
    case 'untracked':
      return { kind, path: assertRelativePath(target.path, 'target.path') };
    default:
      throw ideError('E_INVALID_ARG', 'target.kind 只能是 working / index / commit / range / untracked', {
        field: 'target.kind',
        value: kind,
      });
  }
}

/** @returns {{context: number, ignoreWhitespace: boolean}} */
function normalizeOptions(options) {
  const raw = options && typeof options === 'object' ? options : {};
  const context = raw.context === undefined ? 3 : raw.context;
  if (!Number.isInteger(context) || context < -1) {
    throw ideError('E_INVALID_ARG', 'context 必须是 -1（整文件）或非负整数', {
      field: 'context',
      value: context,
    });
  }
  return { context, ignoreWhitespace: raw.ignoreWhitespace === true };
}

/**
 * rev 必须能被解析成**单个** commit，否则按契约给 `E_NOT_FOUND`（docs/git-model.md §10）。
 * 用 `^{commit}` 剥离 tag / 树对象：`commit` 与 `range` 两端都必须是提交。
 */
async function assertCommitish(cwd, rev, field) {
  const { code } = await runGit(cwd, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], {
    env: GIT_ENV,
    timeoutMs: LIMITS.statusTimeoutMs,
  });
  if (code !== 0) {
    throw ideError('E_NOT_FOUND', `找不到 rev：${rev}`, { reason: 'bad-ref', field, ref: rev });
  }
}

/**
 * rev 是位置参数（在 `--` 之前），必须以 `-` 开头时拒绝，避免被 git 当选项。
 * @returns {string}
 */
function assertRev(value, field) {
  if (typeof value !== 'string' || value === '') {
    throw ideError('E_INVALID_ARG', `${field} 必须是非空字符串`, { field, value });
  }
  if (CONTROL_CHARS.test(value)) {
    throw ideError('E_INVALID_ARG', `${field} 含控制字符`, { field });
  }
  if (value.startsWith('-')) {
    throw ideError('E_INVALID_ARG', `${field} 不能以 - 开头（会被当成 git 选项）`, { field, value });
  }
  return value;
}

/**
 * wire 上的路径一律 `/` 分隔、相对仓库根。绝对路径、盘符、UNC、跳出根目录一律拒绝
 * （docs/security.md §5）；真正的根目录归属校验在 Host（workspace.resolvePath），这里只挡住
 * 传递到 git argv 的畸形值。
 * @returns {string} 规范化后的相对路径
 */
function assertRelativePath(value, field) {
  if (typeof value !== 'string' || value === '') {
    throw ideError('E_INVALID_ARG', `${field} 必须是非空相对路径`, { field, value });
  }
  if (CONTROL_CHARS.test(value)) {
    throw ideError('E_INVALID_ARG', `${field} 含控制字符`, { field });
  }
  if (value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(value)) {
    throw ideError('E_INVALID_ARG', `${field} 必须是相对路径`, { field, value });
  }
  const normalized = path.posix.normalize(value);
  if (normalized === '..' || normalized.startsWith('../')) {
    throw ideError('E_INVALID_ARG', `${field} 不能跳出仓库根`, { field, value });
  }
  return normalized;
}

/** 可选路径：空值当「不限」。 */
function optionalRelativePath(value, field) {
  if (value === undefined || value === null || value === '') return null;
  return assertRelativePath(value, field);
}

/** 从 `diff --git a/X b/Y` 起头建一个文件条目。 */
function createFilePatch(line) {
  const { oldPath, newPath } = splitDiffHeader(line.slice('diff --git '.length));
  return {
    path: newPath ?? oldPath ?? '',
    origPath: null,
    status: 'M',
    binary: false,
    hunks: [],
  };
}

/** numstat 拿不到 patch 时的兜底（理论上不会发生）。 */
function emptyFilePatch(relativePath) {
  return { path: relativePath, origPath: null, status: 'M', binary: false, hunks: [] };
}

/** 文件级元信息行（都在第一个 `@@` 之前出现）。 */
function applyFileHeader(file, line) {
  if (line.startsWith('new file mode ')) {
    file.status = 'A';
    return;
  }
  if (line.startsWith('deleted file mode ')) {
    file.status = 'D';
    return;
  }
  if (line.startsWith('rename from ') || line.startsWith('rename to ')) {
    file.status = 'R';
    const from = line.startsWith('rename from ') ? line.slice('rename from '.length) : null;
    if (from !== null) file.origPath = unquotePath(from);
    return;
  }
  if (line.startsWith('copy from ') || line.startsWith('copy to ')) {
    file.status = 'C';
    const from = line.startsWith('copy from ') ? line.slice('copy from '.length) : null;
    if (from !== null) file.origPath = unquotePath(from);
    return;
  }
  if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
    file.binary = true;
  }
}

/** 行首 `@@` 解析；`b`/`d` 省略时是 1。 */
function parseHunkHeader(line) {
  const match = HUNK_HEADER.exec(line);
  if (!match) return null;
  return {
    header: line,
    oldStart: Number(match[1]),
    oldLines: match[2] === undefined ? 1 : Number(match[2]),
    newStart: Number(match[3]),
    newLines: match[4] === undefined ? 1 : Number(match[4]),
    lines: [],
  };
}

/**
 * 推一行 hunk 内容。行号 1-based：`-` 行只有 oldNo、`+` 行只有 newNo，
 * `oldStart: 0` 的纯插入 hunk 里 oldNo 一律 null（docs/remote-contract.md §git.diff）。
 */
function pushHunkLine(hunk, cursor, prefix, text) {
  const oldNo = prefix.kind === 'add' ? null : cursor.old;
  const newNo = prefix.kind === 'del' ? null : cursor.new;
  hunk.lines.push({
    type: prefix.type,
    text,
    oldNo,
    newNo,
    kind: prefix.kind,
    oldLine: oldNo,
    newLine: newNo,
  });
  if (prefix.kind !== 'add') cursor.old += 1;
  if (prefix.kind !== 'del') cursor.new += 1;
}

/** `\ No newline at end of file` 附着到上一条行，并按行语义补 hunk 级 EOL 标记。 */
function markNoNewline(hunk) {
  const last = hunk.lines[hunk.lines.length - 1];
  if (!last) {
    hunk.newNoEol = true;
    return;
  }
  last.noNewline = true;
  if (last.type === '-') hunk.oldNoEol = true;
  else if (last.type === '+') hunk.newNoEol = true;
  else {
    hunk.oldNoEol = true;
    hunk.newNoEol = true;
  }
}

/** hunk 声明的行数还没推满（空行是否算上下文行的判据）。 */
function hunkExpectsMore(hunk) {
  let oldUsed = 0;
  let newUsed = 0;
  for (const line of hunk.lines) {
    if (line.type !== '+') oldUsed += 1;
    if (line.type !== '-') newUsed += 1;
  }
  return oldUsed < hunk.oldLines || newUsed < hunk.newLines;
}

/**
 * 头部计数与实际行数对账：不符就用实际值覆盖（docs/git-model.md §5.1「计 bad」）。
 * @returns {boolean} 是否一致
 */
function reconcileHunk(hunk) {
  const oldCount = countHunkLines([hunk], 'context') + countHunkLines([hunk], 'del');
  const newCount = countHunkLines([hunk], 'context') + countHunkLines([hunk], 'add');
  if (oldCount === hunk.oldLines && newCount === hunk.newLines) return true;
  hunk.oldLines = oldCount;
  hunk.newLines = newCount;
  return false;
}

/** 统计 hunk 里某一类行数（`context` 两侧都算）。 */
function countHunkLines(hunks, kind) {
  let total = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.kind === kind) total += 1;
    }
  }
  return total;
}

/** 剥掉行尾 `\r`：展示层统一 LF（docs/git-model.md §5.2）。 */
function stripCr(line) {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/** numstat 计数：`-` = 二进制。 */
function numstatCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number;
}

/**
 * 拆 `diff --git` 的两个路径。git 只在含特殊字符时加引号，含空格时**不加**，
 * 所以无引号时按 `a/`、`b/` 前缀找对称那个切点。
 */
function splitDiffHeader(rest) {
  if (rest.startsWith('"')) {
    const first = readQuoted(rest, 0);
    const second = first ? readQuoted(rest, first.end + 1) : null;
    return {
      oldPath: first ? stripGitPrefix(first.value) : null,
      newPath: second ? stripGitPrefix(second.value) : null,
    };
  }
  const cuts = [];
  let at = rest.indexOf(' b/');
  while (at !== -1) {
    cuts.push(at);
    at = rest.indexOf(' b/', at + 1);
  }
  if (cuts.length === 0) return { oldPath: stripGitPrefix(rest), newPath: null };
  const symmetric = cuts.find((cut) => rest.slice(2, cut) === rest.slice(cut + 3));
  const cut = symmetric ?? cuts[cuts.length - 1];
  return {
    oldPath: stripGitPrefix(rest.slice(0, cut)),
    newPath: stripGitPrefix(rest.slice(cut + 1)),
  };
}

/** 去掉 `a/` / `b/` 前缀（`--no-index` 下没有前缀，原样返回）。 */
function stripGitPrefix(value) {
  return /^[ab]\//.test(value) ? value.slice(2) : value;
}

/** 读 git 的 C 风格引号路径（`\346\227\245` 这种八进制转义）。 */
function readQuoted(text, start) {
  if (text[start] !== '"') return null;
  let value = '';
  let index = start + 1;
  while (index < text.length) {
    const char = text[index];
    if (char === '"') return { value, end: index };
    if (char !== '\\') {
      value += char;
      index += 1;
      continue;
    }
    const next = text[index + 1];
    index += 2;
    if (next === undefined) break;
    if (next === 'n') value += '\n';
    else if (next === 't') value += '\t';
    else if (next === 'r') value += '\r';
    else if (next === 'b') value += '\b';
    else if (next === 'f') value += '\f';
    else if (next === 'v') value += '\v';
    else if (next === 'a') value += '\u0007';
    else if (/[0-7]/.test(next)) {
      let digits = next;
      while (digits.length < 3 && /[0-7]/.test(text[index] ?? '')) {
        digits += text[index];
        index += 1;
      }
      value += String.fromCharCode(Number.parseInt(digits, 8));
    } else value += next;
  }
  return { value, end: text.length };
}

/** 有引号就解，没有就原样。 */
function unquotePath(raw) {
  if (!raw.startsWith('"')) return raw;
  const parsed = readQuoted(raw, 0);
  return parsed ? parsed.value : raw;
}

/** `truncated` 时回传的 patch 头部：按字节截断，并统一成 LF。 */
function textHead(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  if (Buffer.byteLength(normalized) <= TEXT_HEAD_BYTES) return normalized;
  const buffer = Buffer.from(normalized, 'utf8').subarray(0, TEXT_HEAD_BYTES);
  return buffer.toString('utf8');
}
