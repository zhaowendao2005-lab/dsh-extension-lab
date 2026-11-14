/**
 * Diff domain. One request per (target, path) with `context: -1`, so the Host returns a
 * single whole-file hunk and both sides can be rebuilt exactly (docs/git-model.md §5.4).
 */
export function createDiffDomain({ client, diff, fail, notify }) {
  let requestEpoch = 0;

  async function open(target, path) {
    if (!target) return null;
    const epoch = requestEpoch + 1;
    requestEpoch = epoch;
    diff.patch({ phase: 'loading', error: null, path, target, files: [], selected: path ?? null });
    try {
      const result = await client.call('git.diff', {
        target: path ? { ...target, path } : target,
        context: -1,
        ignoreWhitespace: false,
      });
      if (epoch !== requestEpoch) return null;
      const file = pickFile(result.files, path);
      diff.patch({
        phase: 'ready',
        error: null,
        files: result.files ?? [],
        selected: file?.path ?? null,
        sides: file ? sidesOf(file) : null,
        hunks: file?.hunks ?? [],
        truncated: Boolean(result.truncated),
        binary: Boolean(result.isBinary),
      });
      return result;
    } catch (error) {
      if (epoch !== requestEpoch) return null;
      diff.patch({ phase: 'error', error: error?.message ?? '读取差异失败' });
      fail(diff, error, '读取差异失败');
      return null;
    }
  }

  return {
    open,
    /** `split` = two panes, `unified` = one pane with inline change marks. */
    setMode(mode) {
      diff.patch({ mode: mode === 'unified' ? 'unified' : 'split' });
    },
    select(path) {
      const state = diff.getSnapshot();
      const file = pickFile(state.files, path);
      diff.patch({
        selected: file?.path ?? null,
        sides: file ? sidesOf(file) : null,
        hunks: file?.hunks ?? [],
        path: file?.path ?? null,
      });
    },
    close() {
      requestEpoch += 1;
      diff.patch({ phase: 'idle', files: [], sides: null, selected: null, error: null, path: null, target: null });
    },
    /**
     * Stage exactly one hunk: the Host writes the *index version of the file with this hunk
     * applied* as a new blob, so untouched hunks stay unstaged (docs/git-model.md §5.5).
     */
    async stageHunk(index) {
      const state = diff.getSnapshot();
      if (!state.path || !state.sides) return null;
      if (state.target?.kind !== 'working') {
        notify('warn', '只能暂存「工作区相对索引」的代码块', null);
        return null;
      }
      const hunk = state.hunks?.[index];
      if (!hunk) return null;
      try {
        const stagedText = applyHunk(state.sides.oldText, hunk);
        await client.call('git.stageHunk', {
          path: state.path,
          hunk: {
            oldStart: hunk.oldStart ?? 1,
            oldLines: hunk.oldLines ?? 0,
            newStart: hunk.newStart ?? 1,
            newLines: hunk.newLines ?? 0,
            lines: (hunk.lines ?? []).map((line) => line.text ?? ''),
            stagedText,
          },
        });
        notify('info', '代码块已暂存', null);
        return true;
      } catch (error) {
        fail(diff, error, '暂存代码块失败');
        return null;
      }
    },

    /** Stage the whole file from the diff surface (same path as the SCM row action). */
    async stageFile() {
      const state = diff.getSnapshot();
      if (!state.path) return null;
      try {
        await client.call('git.stage', { paths: [state.path], all: false });
        notify('info', '文件已暂存', null);
        return true;
      } catch (error) {
        fail(diff, error, '暂存文件失败');
        return null;
      }
    },
  };
}

function pickFile(files, path) {
  if (!Array.isArray(files) || files.length === 0) return null;
  if (!path) return files[0];
  return files.find((file) => file.path === path) ?? files[0];
}

/** Rebuild both sides from the whole-file hunk: context+deletions are `a`, context+adds are `b`. */
export function sidesOf(file) {
  const oldLines = [];
  const newLines = [];
  for (const hunk of file.hunks ?? []) {
    for (const line of hunk.lines ?? []) {
      const type = line.type ?? line.kind;
      if (type === ' ' || type === 'context') {
        oldLines.push(line.text);
        newLines.push(line.text);
      } else if (type === '-' || type === 'del') {
        oldLines.push(line.text);
      } else if (type === '+' || type === 'add') {
        newLines.push(line.text);
      }
    }
  }
  return { oldText: oldLines.join('\n'), newText: newLines.join('\n') };
}


/**
 * Replay one hunk onto the index text. `oldStart` is 1-based; the hunk's new side becomes the
 * replacement for the range it covers. Untouched text keeps its original line endings.
 */
export function applyHunk(oldText, hunk) {
  const lines = oldText.split('\n');
  const start = Math.max(0, (hunk.oldStart ?? 1) - 1);
  const removed = hunk.oldLines ?? countRemoved(hunk);
  const replacement = (hunk.lines ?? [])
    .filter((line) => [' ', 'context', '+', 'add'].includes(line.type ?? line.kind))
    .map((line) => line.text);
  const next = lines.slice(0, start).concat(replacement, lines.slice(start + removed));
  return next.join('\n');
}

function countRemoved(hunk) {
  return (hunk.lines ?? []).filter((line) => [' ', 'context', '-', 'del'].includes(line.type ?? line.kind)).length;
}
