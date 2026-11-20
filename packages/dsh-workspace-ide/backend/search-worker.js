/** Read-only search worker: no subprocesses, links, or unbounded result buffers. */
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import ignore from 'ignore';
import { LIMITS } from '../shared/contract.js';
import { searchPathFilter } from './search-globs.js';
import { pathInside } from './platform.js';
import { ideError } from '../shared/errors.js';

export async function runSearch({ root, mode, input }, progress = () => {}) {
  const started = Date.now();
  const canonical = await fs.realpath(root);
  const filters = searchPathFilter(input);
  const cap = mode === 'index' ? Math.min(input.limit ?? LIMITS.searchIndexMax, LIMITS.searchIndexMax)
    : Math.min(input.maxResults ?? 200, LIMITS.searchMaxResults);
  const warnings = new Set();
  const paths = [];
  const hits = [];
  let scanned = 0;
  let visited = 0;
  let bytes = 0;
  let truncated = false;
  let lastProgress = 0;
  let matcher;
  if (mode === 'search') {
    try {
      const source = input.regex ? input.query : input.query.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
      matcher = new RegExp(source, input.caseSensitive ? 'gu' : 'giu');
    } catch (error) {
      throw ideError('E_INVALID_ARG', '搜索正则表达式无效', { field: 'query', reason: error.message });
    }
  }
  const snapshot = () => ({
    ...(mode === 'index' ? { paths, total: paths.length } : { hits, scanned }),
    queryId: input.queryId ?? null, truncated, engine: 'node',
    elapsedMs: Date.now() - started, warnings: [...warnings],
  });
  const publish = (force = false) => {
    if (force || Date.now() - lastProgress >= 100) {
      lastProgress = Date.now();
      progress(snapshot());
    }
  };
  const inside = (absolute) => pathInside(canonical, absolute);
  const note = (relative, error) => {
    if (error?.code === 'ENOENT') return;
    if (warnings.size < 20) warnings.add('无法读取 ' + (relative || '.') + ' (' + (error?.code ?? 'IO') + ')');
  };
  async function safeRead(absolute, relative, maxBytes) {
    let handle;
    try {
      const real = await fs.realpath(absolute);
      if (!inside(real)) return null;
      const info = await fs.lstat(absolute);
      if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) return null;
      handle = await fs.open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      const opened = await handle.stat();
      if (!opened.isFile() || opened.size > maxBytes) return null;
      const checkedPath = await fs.realpath(absolute);
      if (!inside(checkedPath)) return null;
      const checked = await fs.stat(checkedPath);
      if (checked.dev !== opened.dev || checked.ino !== opened.ino) return null;
      const buffer = Buffer.alloc(Math.min(opened.size + 1, maxBytes + 1));
      let offset = 0;
      while (offset < buffer.length) {
        const result = await handle.read(buffer, offset, buffer.length - offset, null);
        if (!result.bytesRead) break;
        offset += result.bytesRead;
      }
      return offset > maxBytes ? null : buffer.subarray(0, offset);
    } catch (error) {
      note(relative, error);
      return null;
    } finally {
      if (handle) await handle.close();
    }
  }
  async function ignoreRules(absolute, relative, inherited) {
    if (input.useIgnoreFiles === false) return inherited;
    const matcher = ignore({ ignorecase: process.platform === 'win32' });
    let found = false;
    for (const name of ['.gitignore', '.ignore']) {
      const buffer = await safeRead(path.join(absolute, name), [relative, name].filter(Boolean).join('/'), LIMITS.searchIgnoreBytesMax);
      if (buffer) { matcher.add(buffer.toString('utf8')); found = true; }
    }
    return found ? [...inherited, { base: relative, matcher }] : inherited;
  }
  function ignored(relative, directory, rules) {
    let excluded = false;
    for (const rule of rules) {
      const local = rule.base ? relative.slice(rule.base.length + 1) : relative;
      const status = rule.matcher.test(local + (directory ? '/' : ''));
      if (status.ignored) excluded = true;
      if (status.unignored) excluded = false;
    }
    return excluded;
  }
  const queue = [{ relative: '', absolute: canonical, rules: [], depth: 0 }];
  for (let cursor = 0; cursor < queue.length && !truncated; cursor += 1) {
    const current = queue[cursor];
    if (Date.now() - started >= LIMITS.searchTimeoutMs - 200) {
      warnings.add('搜索达到时间上限，结果不完整'); truncated = true; break;
    }
    let entries;
    let rules;
    try {
      if (!inside(await fs.realpath(current.absolute))) continue;
      if ((await fs.lstat(current.absolute)).isSymbolicLink()) continue;
      rules = await ignoreRules(current.absolute, current.relative, current.rules);
      entries = await fs.opendir(current.absolute);
    } catch (error) { note(current.relative, error); continue; }
    for await (const entry of entries) {
      if (++visited > LIMITS.searchEntriesMax) {
        warnings.add('搜索达到目录项上限，结果不完整'); truncated = true; break;
      }
      if (entry.name === '.git' || entry.isSymbolicLink()) continue;
      const relative = [current.relative, entry.name].filter(Boolean).join('/');
      const directory = entry.isDirectory();
      if (filters.excluded(relative) || ignored(relative, directory, rules)) continue;
      const absolute = path.join(current.absolute, entry.name);
      if (directory) {
        if (current.depth >= 64) { warnings.add('搜索跳过超过 64 层的目录'); truncated = true; continue; }
        queue.push({ relative, absolute, rules, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile() || !filters.included(relative)) continue;
      if (mode === 'index') {
        if (paths.length >= cap) { truncated = true; break; }
        if (inside(await fs.realpath(absolute).catch(() => ''))) paths.push(relative);
      } else {
        if (scanned >= LIMITS.searchFilesMax || bytes >= LIMITS.searchTotalBytesMax) {
          warnings.add('搜索达到扫描上限，结果不完整'); truncated = true; break;
        }
        scanned += 1;
        const buffer = await safeRead(absolute, relative, LIMITS.searchFileBytesMax);
        if (!buffer) continue;
        if (bytes + buffer.length > LIMITS.searchTotalBytesMax) {
          warnings.add('搜索达到读取字节上限，结果不完整'); truncated = true; break;
        }
        bytes += buffer.length;
        if (buffer.subarray(0, 8000).includes(0)) continue;
        let text;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { continue; }
        const lines = text.split(/\r\n|\n|\r/);
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
          const line = lines[lineIndex];
          matcher.lastIndex = 0;
          publish();
          let match;
          while ((match = matcher.exec(line))) {
            if (!match[0].length) {
              const point = line.codePointAt(matcher.lastIndex);
              matcher.lastIndex += point > 0xffff ? 2 : 1;
              continue;
            }
            const end = match.index + match[0].length;
            const word = (char) => !!char && /[\p{L}\p{N}_]/u.test(char);
            if (input.wholeWord && (word([...line.slice(0, match.index)].pop()) || word(line.slice(end).match(/^./u)?.[0]))) continue;
            if (hits.length >= cap) { truncated = true; break; }
            const snippetStart = Math.max(0, match.index - 120);
            hits.push({ path: relative, line: lineIndex + 1, column: match.index + 1,
              text: line.slice(snippetStart, snippetStart + 400), snippetStart,
              matchStart: match.index - snippetStart, matchEnd: Math.min(end - snippetStart, 400) });
          }
          if (truncated) break;
        }
      }
      publish();
      if (truncated) break;
    }
  }
  if (mode === 'index') paths.sort();
  return snapshot();
}

if (parentPort && workerData) {
  runSearch(workerData, (progress) => parentPort.postMessage({ progress })).then(
    (result) => parentPort.postMessage({ result }),
    (error) => parentPort.postMessage({ error: { code: error.code?.startsWith('E_') ? error.code : 'E_PERMISSION', message: error.message, detail: error.detail } }),
  );
}
