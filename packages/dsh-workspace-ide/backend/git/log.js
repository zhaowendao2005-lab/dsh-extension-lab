/**
 * 提交日志（git.log）：取数 + 解析。
 *
 * 这个模块负责什么：
 * - 把 `git log` 的 `-z` 输出解析成 Commit 数组（纯函数，text in / model out）；
 * - 拼一次分页取数的 argv 并走 `exec.js`（Host 侧唯一 spawn 出口）拿原始文本。
 *
 * 为什么这样切：
 * - **取数 / 解析分离**：解析必须能对 git 的原始字节直接断言 0 坏行（docs/git-model.md §4.4），
 *   取数必须只有一处碰子进程（AGENTS.md：命令集中在 `backend/git/exec.js`）。两者合在一起就
 *   只能靠跑真 git 来验证解析器，坏的字段切分会被"看起来对"的数据掩盖。
 * - **字段用多字符文本哨兵，不用 `\x1f` / `%x00`**：subject 可能含 `\x1f`（docs/git-model.md
 *   §4.4 记录过用 `%x1f` 时分段数不对）；`-z` 已经把**记录**分隔符变成 NUL，再叠 `%x00` 会让
 *   记录分隔与字段分隔混淆。所以：记录用 `-z` 的 NUL，字段用 `--DSH-SEP-9x--`。
 * - **refs 分组而不是扁平数组**：`%D` 只是一个字符串，先解码成 `{head, local, remote, tags}`
 *   便于分层上色与"当前分支"标记；wire 上的扁平 `Commit.refs[]`（带 `type` / `isHead`）是
 *   service 层的一次映射，别在 Host 内部两处各存一份真值。
 *
 * 硬约束（改这里必须同步文档）：
 * - 改格式串 / 字段顺序 → 同步 `docs/git-model.md` §4.4 与 `LOG_FIELD_COUNT` 断言；
 * - 每条记录必须正好拆出 8 段，否则计 `bad` 并丢弃该条（不丢整次结果），有 bad 时 warn 一次。
 */

import { LIMITS } from '../../shared/contract.js';
import { ideError } from '../../shared/errors.js';
import { gitOrThrow } from './exec.js';

/**
 * 字段哨兵：**多字符**文本，故意选成在正常提交信息里不可能出现的形状。
 *
 * docs/git-model.md §4.4 描述它是「22 字符」，实测该字面量是 14 字符——以本常量为唯一出处；
 * 改这里的值等于改日志格式，必须同步 docs/git-model.md 与下面的字段数断言。
 */
export const FIELD_SEP = '--DSH-SEP-9x--';

/** 每条记录拆出的段数（hash/parents/author/email/at/ct/subject/decoration）。 */
export const LOG_FIELD_COUNT = 8;

/** `--pretty=format:` 的格式串本体：8 个 `%` 占位符用哨兵连接。 */
export const LOG_FORMAT = [
  '%H', // 0 完整 hash
  '%P', // 1 父提交（空格分隔，root 为空）
  '%an', // 2 作者名
  '%ae', // 3 作者邮箱
  '%at', // 4 作者时间（unix 秒）
  '%ct', // 5 提交时间（unix 秒）
  '%s', // 6 subject（单行）
  '%D', // 7 ref 装饰（不带括号）
].join(FIELD_SEP);

/** HEAD 装饰里的箭头（`HEAD -> main`）。 */
const HEAD_ARROW = ' -> ';

/** 完整 hash：sha1(40) 或 sha256(64) 仓库都要能过。 */
const FULL_HASH_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

/** `refs/...` 前缀（用户配置 `log.decorate=full` 时会漏出全名，解析层兜底剥掉）。 */
const REF_PREFIXES = ['refs/heads/', 'refs/tags/', 'refs/remotes/', 'refs/'];

/** shortHash 取前 N 位：与 `--abbrev=7` 的默认呈现一致。 */
const SHORT_HASH_LENGTH = 7;

/**
 * 解析 `git log -z --pretty=format:<LOG_FORMAT>` 的输出。
 *
 * @param {string} text - git 原始输出（`-z`：记录之间是 NUL）
 * @param {{ remotes?: string[] | Set<string> }} [options] - 已知 remote 名，用来精确区分本地/远程 ref
 * @returns {Array<object>} 提交数组（字段见文件头）
 */
export function parseLog(text, options = {}) {
  return parseLogDetailed(text, options).commits;
}

/**
 * 同 `parseLog`，但把解析统计一并返回（供 Host 日志 / 0 坏行断言使用）。
 *
 * @param {string} text - git 原始输出
 * @param {{ remotes?: string[] | Set<string> }} [options]
 * @returns {{ commits: Array<object>, stats: { records: number, bad: number, anomalies: number } }}
 */
export function parseLogDetailed(text, options = {}) {
  const remotes = normalizeRemotes(options.remotes);
  const commits = [];
  const stats = { records: 0, bad: 0, anomalies: 0 };
  const source = typeof text === 'string' ? text : '';

  // `-z` 的记录分隔是 NUL，且**最后一条记录后面没有 NUL**（实测 git 2.54）；
  // 仍防御性跳过空段：老版本 / 被管道补过尾 NUL 时 split 会留一个空串。
  for (const rawRecord of source.split('\0')) {
    if (rawRecord === '') continue;
    stats.records += 1;

    // 少数 git 版本在最后一条记录后补过换行；去掉它，别把 `\n` 带进 %D 段。
    const record = rawRecord.endsWith('\n') ? rawRecord.slice(0, -1) : rawRecord;
    const fields = record.split(FIELD_SEP);
    if (fields.length !== LOG_FIELD_COUNT) {
      stats.bad += 1;
      continue;
    }

    const hash = fields[0].trim();
    if (!FULL_HASH_RE.test(hash)) {
      stats.bad += 1;
      continue;
    }

    const { parents, graphNote } = normalizeParents(hash, fields[1]);
    if (graphNote) stats.anomalies += 1;

    const authorTime = toEpochSeconds(fields[4]);
    const committerTime = toEpochSeconds(fields[5]);

    const commit = {
      hash,
      shortHash: hash.slice(0, SHORT_HASH_LENGTH),
      parents,
      author: fields[2],
      authorEmail: fields[3],
      authorTime,
      committerTime,
      subject: fields[6],
      refs: decodeRefs(fields[7], { remotes }),
      // 兼容别名：`backend/git/index.js` 的 toWireCommit 读的是 email / authoredAt /
      // committedAt（wire 字段名由分发层决定，不是本模块的契约）。同一事实不在这里
      // 重算，只是把已算好的戳再挂一个键，避免两边对不上时静默变成 null / 0。
      email: fields[3],
      authoredAt: authorTime,
      committedAt: committerTime,
    };
    // 只在拓扑异常时出现：layout 用它判断"这条边已经被丢过"，不必重复告警。
    if (graphNote) commit.graphNote = graphNote;

    commits.push(commit);
  }

  return { commits, stats };
}

/**
 * 解码 `%D`（`--decorate=short`）的装饰串。
 *
 * 形态（实测）：
 * - 当前分支：`HEAD -> main`（此时 `main` 不会单独出现）
 * - 游离 HEAD：裸 `HEAD`
 * - 标签：`tag: v1`
 * - 远程跟踪：`origin/main`
 * - 符号远程 ref：某些版本裸出 `origin/HEAD`（无箭头）；带箭头的是别名，跳过不加徽章
 *
 * @param {string} decoration - `%D` 原文
 * @param {{ remotes?: string[] | Set<string> }} [options] - 已知 remote 名
 * `head` 是检出分支的**名字**（不是对象）：wire 层要的是 `refs[].name`，给它一个字符串
 * 比给 `{name}` 少一层解包；游离 HEAD 记忆在响应级的 `headDetached` 上（本模块只返回
 * 单条提交，故挂在 `refs.headDetached`，缺省不存在）。
 *
 * @returns {{ head: string|null, headDetached?: boolean, local: string[], remote: string[], tags: string[] }}
 */
export function decodeRefs(decoration, options = {}) {
  const refs = { head: null, local: [], remote: [], tags: [] };
  const remotes = normalizeRemotes(options.remotes);
  const local = new Set();
  const remote = new Set();
  const tags = new Set();

  /** 按名字归组：给了 remote 名单就精确判定，否则「含 / 视为远程跟踪分支」。 */
  const collect = (rawName) => {
    const name = stripRefPrefix(rawName);
    if (!name) return;
    const slash = name.indexOf('/');
    if (slash === -1) {
      local.add(name);
      return;
    }
    if (remotes && remotes.size > 0) {
      // 已知 remote 名里没有它 → 是带 "/" 的本地分支（如 feature/x），不是远程。
      if (remotes.has(name.slice(0, slash))) remote.add(name);
      else local.add(name);
      return;
    }
    remote.add(name);
  };

  for (const rawToken of String(decoration ?? '').split(',')) {
    const token = rawToken.trim();
    if (token === '') continue;

    if (token.startsWith('tag: ')) {
      const name = stripRefPrefix(token.slice('tag: '.length).trim());
      if (name) tags.add(name);
      continue;
    }

    const arrowAt = token.indexOf(HEAD_ARROW);
    if (arrowAt !== -1) {
      const source = token.slice(0, arrowAt).trim();
      const target = token.slice(arrowAt + HEAD_ARROW.length).trim();
      // 只有 `HEAD -> x` 才是"当前检出分支"；`origin/HEAD -> origin/main` 之类是别名，
      // 目标 ref 通常会自己出现在 %D 里，这里跳过以免同一提交挂两个徽章。
      if (stripRefPrefix(source) === 'HEAD') {
        // `HEAD -> x` 时 x 不会再单独出现，所以这里同时记 head 与 x 本身。
        refs.head = target ? stripRefPrefix(target) : null;
        if (refs.head) collect(target);
      }
      continue;
    }

    if (stripRefPrefix(token) === 'HEAD') {
      // 游离 HEAD：没有分支可挂徽章，只标出来让上层能提示"当前不在任何分支上"。
      refs.headDetached = true;
      continue;
    }

    collect(token);
  }

  // 稳定顺序：码元升序（不依赖 locale，保证同一输入逐字节可比）。
  refs.local = sortNames(local);
  refs.remote = sortNames(remote);
  refs.tags = sortNames(tags);
  return refs;
}

/**
 * 取一页提交日志。
 *
 * 只经 `exec.js` 的 `gitOrThrow`（硬化参数与固定 env 由它负责，调用方不自己拼）。
 * `hasMore` 用 `maxCount + 1` 探测：多取的那一条**不返回**给上层。
 *
 * @param {string} cwd - 仓库工作区根（Host 已解析并校验）
 * @param {object} [options]
 * @param {number} [options.maxCount] - 本页最多返回多少条，默认 `LIMITS.logPageDefault`
 * @param {number} [options.skip] - 跳过多少条（分页用），默认 0
 * @param {'all'|string[]} [options.refs] - `'all'` 或若干 ref 名；数组时**不**与 `--all` 混用
 * @param {string} [options.path] - 只看某路径的历史（追加 `-- <path>`）
 * @param {string[]|Set<string>} [options.remotes] - 已知 remote 名，用于 refs 精确归类
 * @returns {Promise<{ commits: Array<object>, hasMore: boolean, stats: { records: number, bad: number, anomalies: number } }>}
 */
export async function fetchLog(cwd, options = {}) {
  const maxCount = normalizeMaxCount(options.maxCount);
  const skip = normalizeSkip(options.skip);
  const refs = normalizeRefs(options.refs);
  const argv = buildLogArgs({ maxCount, skip, refs, path: options.path });

  const { stdout } = await gitOrThrow(cwd, argv, { timeoutMs: LIMITS.gitTimeoutMs });
  const { commits, stats } = parseLogDetailed(stdout, { remotes: options.remotes });

  if (stats.bad > 0) {
    // 坏记录逐条丢弃、不污染整页；但必须留痕（错误不得静默）。
    console.warn(`[git.log] ${stats.bad}/${stats.records} 条记录字段数不为 ${LOG_FIELD_COUNT}，已跳过`);
  }

  const hasMore = stats.records > maxCount;
  return { commits: hasMore ? commits.slice(0, maxCount) : commits, hasMore, stats };
}

/**
 * 拼 `git log` 的 argv。
 *
 * 与 docs/git-model.md §1.2 #7 一致，另外两处刻意的补充：
 * - `-c i18n.logOutputEncoding=UTF-8`：输出编码不随仓库 locale 漂；
 * - `--decorate=short`：钉住 `%D` 形态（用户配置 `log.decorate=full` 时会漏出 `refs/heads/...`）。
 *
 * @param {{ maxCount: number, skip: number, refs: string[], path?: string }} params
 * @returns {string[]} argv（不含可执行文件与只读硬化前缀，后者由 exec.js 负责）
 */
export function buildLogArgs({ maxCount, skip, refs, path: relPath }) {
  const argv = [
    '-c',
    'i18n.logOutputEncoding=UTF-8',
    'log',
    ...refs,
    '--date-order',
    '--encoding=UTF-8',
    '--decorate=short',
    '-z',
    // 多取一条用于探测 hasMore；返回前会被切掉。
    `--max-count=${maxCount + 1}`,
    `--skip=${skip}`,
    `--pretty=format:${LOG_FORMAT}`,
  ];
  if (relPath !== undefined) argv.push('--', relPath);
  return argv;
}

/** maxCount 归一化：默认一页，越界或非正整数一律 E_INVALID_ARG（契约字段名固定为 maxCount）。 */
function normalizeMaxCount(value) {
  if (value === undefined || value === null) return LIMITS.logPageDefault;
  if (!Number.isInteger(value) || value < 1) {
    throw ideError('E_INVALID_ARG', 'maxCount 必须是正整数', { field: 'maxCount', value });
  }
  if (value > LIMITS.logPageMax) {
    throw ideError('E_INVALID_ARG', `maxCount 不能超过 ${LIMITS.logPageMax}`, {
      field: 'maxCount',
      value,
      limit: LIMITS.logPageMax,
    });
  }
  return value;
}

/** skip 归一化：非负整数（分页游标，由 Host 自己攒出来，不接受负数/小数）。 */
function normalizeSkip(value) {
  if (value === undefined || value === null) return 0;
  if (!Number.isInteger(value) || value < 0) {
    throw ideError('E_INVALID_ARG', 'skip 必须是非负整数', { field: 'skip', value });
  }
  return value;
}

/**
 * refs 归一化：`'all'` → `['--all']`；数组 → 去重后的 ref 名（**不**再拼 `--all`）。
 *
 * ref 名会直接进 argv，所以必须挡住 `-` 开头（会被当成 git 选项）与控制字符。
 */
function normalizeRefs(value) {
  if (value === undefined || value === null || value === 'all') return ['--all'];
  // An empty selection means "no ref filter", not "reject the call": the panel sends an
  // empty array whenever its ref filter is cleared.
  if (Array.isArray(value) && value.length === 0) return ['--all'];
  if (!Array.isArray(value)) {
    throw ideError('E_INVALID_ARG', "refs 必须是 'all' 或非空 ref 名数组", { field: 'refs' });
  }
  const names = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      throw ideError('E_INVALID_ARG', 'refs 的每一项必须是字符串', { field: 'refs' });
    }
    const name = item.trim();
    if (name === '') {
      throw ideError('E_INVALID_ARG', 'refs 里不能有空 ref 名', { field: 'refs' });
    }
    if (name.startsWith('-')) {
      throw ideError('E_INVALID_ARG', 'ref 名不能以 - 开头（避免被当成 git 选项）', { field: 'refs' });
    }
    // eslint-disable-next-line no-control-regex -- 就是为了挡控制字符
    if (/[\u0000-\u001f\u007f]/.test(name)) {
      throw ideError('E_INVALID_ARG', 'ref 名不能含控制字符', { field: 'refs' });
    }
    names.push(name);
  }
  if (names.length === 0) {
    throw ideError('E_INVALID_ARG', 'refs 数组不能为空', { field: 'refs' });
  }
  return [...new Set(names)];
}

/**
 * 父提交归一化：自指边与重复边直接丢掉，并记一个 graphNote。
 *
 * 伪造的 parent 会让布局出现环；解析层丢边比让布局去处理环更省事，
 * layout 侧也会再兜一次（两层都丢不会互相矛盾：第二层看不到第一层丢掉的边）。
 */
function normalizeParents(hash, field) {
  const parents = [];
  const seen = new Set();
  let graphNote;
  for (const rawParent of String(field ?? '').trim().split(' ')) {
    if (rawParent === '') continue;
    if (rawParent === hash) {
      graphNote = graphNote ?? 'self-parent';
      continue;
    }
    if (seen.has(rawParent)) {
      graphNote = graphNote ?? 'duplicate-parent';
      continue;
    }
    seen.add(rawParent);
    parents.push(rawParent);
  }
  return { parents, graphNote };
}

/** unix 秒：解析失败给 null（不静默成 NaN 或 0）。 */
function toEpochSeconds(value) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 剥掉 `refs/heads/…` 这类全名前缀（`--decorate=full` 兜底）。 */
function stripRefPrefix(name) {
  for (const prefix of REF_PREFIXES) {
    if (name.startsWith(prefix)) return name.slice(prefix.length);
  }
  return name;
}

/** remote 名单归一化成 Set（数组 / Set / 未给）。 */
function normalizeRemotes(value) {
  if (value instanceof Set) return value;
  if (Array.isArray(value)) {
    return new Set(value.filter((item) => typeof item === 'string' && item !== ''));
  }
  return null;
}

/** Set → 码元升序数组（稳定去重后的最终顺序）。 */
function sortNames(set) {
  return [...set].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
