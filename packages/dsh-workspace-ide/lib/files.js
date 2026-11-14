/**
 * File tree, text paging, atomic writes (docs/files.md).
 * Everything here validates the path against the workspace root first and
 * reports failures as IdeError so the panel can render a real message.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { LIMITS } from '../shared/contract.js';
import { ideError } from '../shared/errors.js';
import { gitOrThrow } from './git/exec.js';

const ALWAYS_IGNORED = new Set(['.git', 'node_modules', '.DS_Store']);
const INDEX_TTL_MS = 5000;
const INDEX_MAX_ENTRIES = 50_000;
const BINARY_PROBE_BYTES = 8000;
const MAX_TREE_ENTRIES = 200_000;

const dirCache = new Map();
/** Lazily built file list for quick-open; `null` means "never built for this root". */
let indexCache = { at: 0, root: null, paths: null, engine: null };

function statVersion(stat) {
  return createHash('sha1').update(`${stat.size}|${stat.mtimeMs}|${stat.ino ?? 0}`).digest('hex').slice(0, 16);
}

function detectEol(text) {
  if (!text) return 'lf';
  if (text.includes('\r\n')) return 'crlf';
  if (text.includes('\r')) return 'cr';
  return 'lf';
}

function looksBinary(buffer) {
  const probe = buffer.subarray(0, BINARY_PROBE_BYTES);
  if (probe.includes(0)) return true;
  let control = 0;
  for (const byte of probe) {
    if (byte < 7 || (byte > 13 && byte < 32)) control += 1;
  }
  return probe.length > 0 && control / probe.length > 0.3;
}

function splitLines(text) {
  if (text === '') return [];
  return text.split('\n');
}

export function createFiles(ctx, workspace) {
  const writeQueues = new Map();

  function serializeWrite(key, task) {
    const previous = writeQueues.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    writeQueues.set(key, next.catch(() => {}));
    void next.finally(() => {
      if (writeQueues.get(key) === next) writeQueues.delete(key);
    });
    return next;
  }

  async function readStat(absolute) {
    try {
      return await fs.stat(absolute);
    } catch (error) {
      if (error?.code === 'ENOENT') throw ideError('E_NOT_FOUND', '文件不存在', { path: absolute });
      throw ideError('E_PERMISSION', '无法访问该路径', { syscall: error?.code ?? 'stat' });
    }
  }

  async function readTextFile(absolute) {
    const buffer = await fs.readFile(absolute);
    if (looksBinary(buffer)) throw ideError('E_BINARY', '二进制文件不能按文本打开', { path: absolute });
    if (buffer.length > LIMITS.readBytesMax) {
      throw ideError('E_TOO_LARGE', '文件超过读取上限', { bytes: buffer.length, limit: LIMITS.readBytesMax });
    }
    return buffer.toString('utf8');
  }

  return {
    async dispatch(action, payload) {
      switch (action) {
        case 'files.list':
          return await list(payload);
        case 'files.stat':
          return await stat(payload);
        case 'files.read':
          return await read(payload);
        case 'files.write':
          return await write(payload);
        case 'files.create':
          return await create(payload);
        case 'files.rename':
          return await rename(payload);
        case 'files.delete':
          return await remove(payload);
        case 'files.search':
          return await search(payload);
        case 'files.index':
          return await index(payload);
        default:
          throw ideError('E_UNSUPPORTED', `未知动作 ${action}`, {});
      }
    },
  };

  async function list({ path: relative, refresh }) {
    const { absolute } = await workspace.resolvePath(relative ?? '');
    const key = absolute;
    if (!refresh) {
      const hit = dirCache.get(key);
      if (hit && Date.now() - hit.at < LIMITS.dirCacheMs) return hit.value;
    }
    const entries = [];
    let truncated = false;
    let dir;
    try {
      dir = await fs.opendir(absolute);
    } catch (error) {
      const code = error?.code === 'ENOENT' ? 'E_NOT_FOUND' : error?.code === 'ENOTDIR' ? 'E_NOT_DIR' : 'E_PERMISSION';
      throw ideError(code, '无法打开目录', { path: relative ?? '', syscall: error?.code ?? '' });
    }
    try {
      for await (const entry of dir) {
        if (entries.length >= LIMITS.dirEntriesMax || entries.length >= MAX_TREE_ENTRIES) {
          truncated = true;
          break;
        }
        const name = entry.name;
        const isDir = entry.isDirectory();
        const hidden = ALWAYS_IGNORED.has(name);
        let size;
        let mtime;
        if (!isDir) {
          try {
            const info = await fs.stat(path.join(absolute, name));
            size = info.size;
            mtime = info.mtimeMs;
          } catch {
            continue;
          }
        }
        entries.push({ name, type: isDir ? 'directory' : 'file', size, mtime, ignored: hidden });
      }
    } finally {
      await dir.close().catch(() => {});
    }
    entries.sort(compareEntries);
    const value = { path: relative ?? '', entries, truncated };
    dirCache.set(key, { at: Date.now(), value });
    return value;
  }

  async function stat({ path: relative }) {
    const { absolute } = await workspace.resolvePath(relative);
    const info = await readStat(absolute);
    if (info.isDirectory()) {
      return { type: 'directory', size: 0, mtime: info.mtimeMs, version: statVersion(info), eol: 'lf', bom: false, binary: false, writable: await canWrite(absolute), encoding: 'utf8', mode: info.mode };
    }
    const buffer = await fs.readFile(absolute);
    const binary = looksBinary(buffer);
    let bom = false;
    let text = '';
    if (!binary) {
      text = buffer.toString('utf8');
      bom = text.charCodeAt(0) === 0xfeff;
    }
    return {
      type: 'file',
      size: info.size,
      mtime: info.mtimeMs,
      version: statVersion(info),
      eol: detectEol(text),
      bom,
      binary,
      writable: await canWrite(absolute),
      encoding: 'utf8',
      mode: info.mode,
    };
  }

  async function read({ path: relative, offset = 1, limit, expectedVersion }) {
    const { absolute } = await workspace.resolvePath(relative);
    const info = await readStat(absolute);
    if (info.isDirectory()) throw ideError('E_NOT_DIR', '目标是目录', { path: relative });
    const version = statVersion(info);
    if (expectedVersion && expectedVersion !== version) {
      throw ideError('E_VERSION_CONFLICT', '文件已被改动', { path: relative, expected: expectedVersion, actual: version });
    }
    const text = await readTextFile(absolute);
    const lines = splitLines(text);
    const totalLines = lines.length;
    const size = limit ?? LIMITS.readLinesDefault;
    const max = Math.min(size, LIMITS.readLinesMax);
    const startIndex = Math.max(0, offset - 1);
    const slice = lines.slice(startIndex, startIndex + max);
    return {
      path: relative,
      version,
      offset: startIndex + 1,
      lines: slice.length,
      totalLines,
      text: slice.join('\n'),
      eof: startIndex + slice.length >= totalLines,
      eol: detectEol(text),
      bom: text.charCodeAt(0) === 0xfeff,
      size: info.size,
    };
  }

  async function write({ path: relative, text, expectedVersion, create: createMode, force }) {
    const { absolute } = await workspace.resolvePath(relative);
    workspace.assertTrusted('write');
    if (typeof text !== 'string') throw ideError('E_INVALID_ARG', 'text 必须是字符串', { field: 'text' });
    if (Buffer.byteLength(text, 'utf8') > LIMITS.writeBytesMax) {
      throw ideError('E_TOO_LARGE', '内容超过写入上限', { limit: LIMITS.writeBytesMax });
    }
    return await serializeWrite(absolute, async () => {
      let existing = null;
      try {
        existing = await fs.stat(absolute);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw ideError('E_PERMISSION', '无法访问目标文件', { syscall: error?.code ?? 'stat' });
      }
      if (existing && expectedVersion && !force) {
        const current = statVersion(existing);
        if (current !== expectedVersion) {
          throw ideError('E_VERSION_CONFLICT', '文件已被其他人改动，保存被拒绝', {
            path: relative,
            expected: expectedVersion,
            actual: current,
          });
        }
      }
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      const temp = `${absolute}.dsh-wid-${process.pid}-${Date.now()}.tmp`;
      try {
        await fs.writeFile(temp, text, 'utf8');
        await fs.rename(temp, absolute);
      } catch (error) {
        await fs.unlink(temp).catch(() => {});
        throw ideError('E_PERMISSION', '写入失败', { syscall: error?.code ?? 'write' });
      }
      const info = await fs.stat(absolute);
      dirCache.delete(path.dirname(absolute));
      return { path: relative, version: statVersion(info), size: info.size, created: !existing };
    });
  }

  async function create({ path: relative, kind, text }) {
    const { absolute } = await workspace.resolvePath(relative);
    workspace.assertTrusted('write');
    if (kind === 'directory') {
      await fs.mkdir(absolute, { recursive: true });
      dirCache.delete(path.dirname(absolute));
      return { path: relative, kind };
    }
    return await serializeWrite(absolute, async () => {
      try {
        await fs.writeFile(absolute, text ?? '', { encoding: 'utf8', flag: 'wx' });
      } catch (error) {
        if (error?.code === 'EEXIST') throw ideError('E_VERSION_CONFLICT', '同名文件已存在', { path: relative });
        throw ideError('E_PERMISSION', '创建失败', { syscall: error?.code ?? 'write' });
      }
      const info = await fs.stat(absolute);
      dirCache.delete(path.dirname(absolute));
      return { path: relative, kind: 'file', version: statVersion(info) };
    });
  }

  async function rename({ from, to }) {
    const { absolute: source } = await workspace.resolvePath(from);
    const { absolute: target } = await workspace.resolvePath(to);
    workspace.assertTrusted('write');
    try {
      await fs.access(target);
      throw ideError('E_VERSION_CONFLICT', '目标已存在', { path: to });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    try {
      await fs.rename(source, target);
    } catch (error) {
      if (error?.code === 'EPERM' && process.platform === 'darwin') {
        const staging = `${source}.dsh-wid-case-${Date.now()}`;
        await fs.rename(source, staging);
        await fs.rename(staging, target);
      } else if (error?.code === 'ENOENT') {
        throw ideError('E_NOT_FOUND', '源文件不存在', { path: from });
      } else {
        throw ideError('E_PERMISSION', '重命名失败', { syscall: error?.code ?? 'rename' });
      }
    }
    dirCache.delete(path.dirname(source));
    dirCache.delete(path.dirname(target));
    return { from, to };
  }

  async function remove({ path: relative, recursive }) {
    const { absolute } = await workspace.resolvePath(relative);
    workspace.assertTrusted('write');
    if (absolute === workspace.root) throw ideError('E_INVALID_ARG', '不能删除工作区根目录', { field: 'path' });
    let info;
    try {
      info = await fs.lstat(absolute);
    } catch (error) {
      if (error?.code === 'ENOENT') throw ideError('E_NOT_FOUND', '路径不存在', { path: relative });
      throw ideError('E_PERMISSION', '无法访问该路径', { syscall: error?.code ?? 'lstat' });
    }
    if (info.isDirectory() && !recursive) {
      const entries = await fs.readdir(absolute).catch(() => []);
      if (entries.length > 0) {
        throw ideError('E_INVALID_ARG', '目录非空，需要 recursive 才能删除', { field: 'recursive', entries: entries.length });
      }
    }
    try {
      await fs.rm(absolute, { recursive: Boolean(recursive) && info.isDirectory(), force: false });
    } catch (error) {
      throw ideError('E_PERMISSION', '删除失败', { syscall: error?.code ?? 'rm' });
    }
    dirCache.delete(path.dirname(absolute));
    return { path: relative, deleted: true };
  }

  /**
   * Flat file list for quick-open. `git ls-files` is the fast path because it already honours
   * `.gitignore` and needs one process; a plain walk is the fallback for non-repositories.
   */
  async function index({ maxAgeMs, limit = INDEX_MAX_ENTRIES } = {}) {
    const root = workspace.requireRoot();
    const ttl = maxAgeMs ?? INDEX_TTL_MS;
    const fresh = indexCache.paths && indexCache.root === root && Date.now() - indexCache.at < ttl;
    if (!fresh) {
      const started = Date.now();
      let paths = null;
      let engine = 'walk';
      const state = await workspace.state();
      if (state.git?.isRepo) {
        try {
          const result = await gitOrThrow(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
            timeoutMs: LIMITS.gitTimeoutMs,
            maxBytes: 32 * 1024 * 1024,
          });
          paths = result.stdout.split('\0').filter(Boolean);
          engine = 'git';
        } catch {
          paths = null;
        }
      }
      if (!paths) paths = await walkIndex(root);
      indexCache = { at: Date.now(), root, paths, engine, elapsedMs: Date.now() - started };
    }
    const cap = Math.min(limit, INDEX_MAX_ENTRIES);
    const paths = indexCache.paths;
    return {
      paths: paths.length > cap ? paths.slice(0, cap) : paths,
      total: paths.length,
      truncated: paths.length > cap,
      engine: indexCache.engine,
      elapsedMs: indexCache.elapsedMs ?? 0,
    };
  }

  async function walkIndex(root) {
    const paths = [];
    const queue = [root];
    while (queue.length && paths.length < INDEX_MAX_ENTRIES) {
      const current = queue.shift();
      let dir;
      try {
        dir = await fs.opendir(current);
      } catch {
        continue;
      }
      try {
        for await (const entry of dir) {
          if (paths.length >= INDEX_MAX_ENTRIES) break;
          if (entry.isDirectory()) {
            if (ALWAYS_IGNORED.has(entry.name) || entry.name.startsWith('.cache')) continue;
            queue.push(path.join(current, entry.name));
            continue;
          }
          if (entry.name === '.DS_Store') continue;
          paths.push(path.relative(root, path.join(current, entry.name)).split(path.sep).join('/'));
        }
      } finally {
        await dir.close().catch(() => {});
      }
    }
    return paths;
  }

  async function search({ query, include, exclude, maxResults = 200, caseSensitive, regex, wholeWord }) {
    workspace.requireRoot();
    if (!query) throw ideError('E_INVALID_ARG', 'query 不能为空', { field: 'query' });
    const limit = Math.min(maxResults, LIMITS.searchMaxResults);
    const matcher = buildMatcher({ query, caseSensitive, regex, wholeWord });
    const includeRe = include ? new RegExp(include) : null;
    const excludeRe = exclude ? new RegExp(exclude) : null;
    const hits = [];
    let scanned = 0;
    let truncated = false;
    const started = Date.now();
    const queue = [workspace.root];

    while (queue.length && hits.length < limit) {
      const current = queue.shift();
      let dir;
      try {
        dir = await fs.opendir(current);
      } catch {
        continue;
      }
      try {
        for await (const entry of dir) {
          const absolute = path.join(current, entry.name);
          const relative = path.relative(workspace.root, absolute).split(path.sep).join('/');
          if (entry.isDirectory()) {
            if (ALWAYS_IGNORED.has(entry.name) || entry.name.startsWith('.cache')) continue;
            if (excludeRe && excludeRe.test(relative)) continue;
            queue.push(absolute);
            continue;
          }
          if (scanned >= 20_000) {
            truncated = true;
            break;
          }
          scanned += 1;
          if (includeRe && !includeRe.test(relative)) continue;
          if (excludeRe && excludeRe.test(relative)) continue;
          let text;
          try {
            const info = await fs.stat(absolute);
            if (info.size > 2 * 1024 * 1024) continue;
            const buffer = await fs.readFile(absolute);
            if (looksBinary(buffer)) continue;
            text = buffer.toString('utf8');
          } catch {
            continue;
          }
          const lines = text.split('\n');
          for (let index = 0; index < lines.length && hits.length < limit; index += 1) {
            const line = lines[index];
            matcher.lastIndex = 0;
            const match = matcher.exec(line);
            if (!match) continue;
            hits.push({
              path: relative,
              line: index + 1,
              column: match.index + 1,
              text: line.slice(0, 400),
              matchStart: match.index,
              matchEnd: match.index + match[0].length,
            });
          }
          if (hits.length >= limit) {
            truncated = true;
            break;
          }
        }
      } finally {
        await dir.close().catch(() => {});
      }
    }

    return { hits, truncated, engine: 'js', elapsedMs: Date.now() - started, scanned };
  }
}

function buildMatcher({ query, caseSensitive, regex, wholeWord }) {
  const source = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = wholeWord ? `\\b(?:${source})\\b` : source;
  return new RegExp(pattern, caseSensitive ? 'g' : 'gi');
}

async function canWrite(absolute) {
  try {
    await fs.access(absolute, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function compareEntries(left, right) {
  if (left.type !== right.type) return left.type === 'directory' ? -1 : 1;
  return left.name.localeCompare(right.name, 'en');
}
