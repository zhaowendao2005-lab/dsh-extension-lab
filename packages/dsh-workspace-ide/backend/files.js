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
import { createSearch } from './search.js';

const ALWAYS_IGNORED = new Set(['.git', 'node_modules', '.DS_Store']);
const BINARY_PROBE_BYTES = 8000;
const MAX_TREE_ENTRIES = 200_000;

const dirCache = new Map();

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
  const searchEngine = createSearch(ctx, workspace);

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

  /**
   * One full-file cache per (absolute, version). Paging a 100k-line file used to re-read and
   * re-split the whole file for every 2000-line page; the version key keeps concurrent or
   * external edits from serving stale text.
   */
  const FILE_CACHE_MAX_BYTES = 8 * 1024 * 1024;
  const fileCache = new Map();

  function invalidateFile(absolute) {
    fileCache.delete(absolute);
    searchEngine.invalidate();
  }

  async function readTextFile(absolute, version) {
    const hit = fileCache.get(absolute);
    if (hit && version && hit.version === version) return hit.text;
    const buffer = await fs.readFile(absolute);
    if (looksBinary(buffer)) throw ideError('E_BINARY', '二进制文件不能按文本打开', { path: absolute });
    if (buffer.length > LIMITS.readBytesMax) {
      throw ideError('E_TOO_LARGE', '文件超过读取上限', { bytes: buffer.length, limit: LIMITS.readBytesMax });
    }
    const text = buffer.toString('utf8');
    if (version) {
      fileCache.set(absolute, { version, text, lines: null, size: buffer.length, at: Date.now() });
      let bytes = 0;
      for (const entry of fileCache.values()) bytes += entry.size;
      for (const [key, entry] of fileCache) {
        if (bytes <= FILE_CACHE_MAX_BYTES) break;
        fileCache.delete(key);
        bytes -= entry.size;
      }
    }
    return text;
  }

  /** Return text + line split from one cache entry, so paging does not re-split the whole file. */
  async function readCached(absolute, version) {
    const text = await readTextFile(absolute, version);
    const entry = fileCache.get(absolute);
    if (entry && version && entry.version === version) {
      if (!entry.lines) entry.lines = splitLines(text);
      return { text, lines: entry.lines };
    }
    return { text, lines: splitLines(text) };
  }

  /** Read only the bytes a stat probe needs; large files no longer get fully buffered twice. */
  async function probeHead(absolute, limit) {
    const handle = await fs.open(absolute, 'r');
    try {
      const length = Math.min(limit, 64 * 1024);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close().catch(() => {});
    }
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
        case 'files.readMedia':
          return await readMedia(payload);
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
    const buffer = info.size <= 1024 * 1024 ? await fs.readFile(absolute) : await probeHead(absolute, info.size);
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
    const { text, lines } = await readCached(absolute, version);
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

  async function readMedia({ path: relative, offset = 0, limit }) {
    const ext = path.extname(relative).toLowerCase();
    const mime = MEDIA_MIMES[ext];
    if (!mime) throw ideError('E_UNSUPPORTED', '不支持预览该媒体格式', { path: relative });
    const { absolute } = await workspace.resolvePath(relative);
    const info = await readStat(absolute);
    if (info.isDirectory()) throw ideError('E_NOT_DIR', '目标是目录', { path: relative });
    const isVideo = mime.startsWith('video/');
    const maxBytes = isVideo ? LIMITS.mediaVideoBytesMax : LIMITS.mediaImageBytesMax;
    if (info.size > maxBytes) {
      throw ideError('E_TOO_LARGE', '媒体文件过大，暂不支持预览', { path: relative, size: info.size, limit: maxBytes });
    }
    const chunkSize = Math.min(limit ?? LIMITS.mediaChunkBytes, 4 * 1024 * 1024);
    const start = Math.max(0, Math.min(offset, info.size));
    const toRead = Math.min(chunkSize, Math.max(0, info.size - start));
    let base64 = '';
    let bytesRead = 0;
    if (toRead > 0) {
      const handle = await fs.open(absolute, 'r');
      try {
        const buffer = Buffer.allocUnsafe(toRead);
        const result = await handle.read(buffer, 0, toRead, start);
        bytesRead = result.bytesRead;
        base64 = buffer.subarray(0, bytesRead).toString('base64');
      } finally {
        await handle.close().catch(() => {});
      }
    }
    const nextOffset = start + bytesRead;
    return {
      path: relative,
      mime,
      size: info.size,
      offset: start,
      length: bytesRead,
      nextOffset,
      eof: nextOffset >= info.size,
      base64,
    };
  }

  async function write({ path: relative, text, expectedVersion, create: createMode, force }) {
    const { absolute } = await workspace.resolvePath(relative);
    workspace.requireRoot();
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
      invalidateFile(absolute);
      return { path: relative, version: statVersion(info), size: info.size, created: !existing };
    });
  }

  async function create({ path: relative, kind, text }) {
    const { absolute } = await workspace.resolvePath(relative);
    workspace.requireRoot();
    if (kind === 'directory') {
      await fs.mkdir(absolute, { recursive: true });
      searchEngine.invalidate();
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
      invalidateFile(absolute);
      return { path: relative, kind: 'file', version: statVersion(info) };
    });
  }

  async function rename({ from, to }) {
    const { absolute: source } = await workspace.resolvePath(from);
    const { absolute: target } = await workspace.resolvePath(to);
    workspace.requireRoot();
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
    invalidateFile(source);
    invalidateFile(target);
    return { from, to };
  }

  async function remove({ path: relative, recursive }) {
    const { absolute } = await workspace.resolvePath(relative);
    workspace.requireRoot();
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
    invalidateFile(absolute);
    return { path: relative, deleted: true };
  }

  async function index(input = {}) {
    return searchEngine.run('index', input);
  }

  async function search(input) {
    return searchEngine.run('search', input);
  }
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

const MEDIA_MIMES = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.ogv': 'video/ogg',
});
