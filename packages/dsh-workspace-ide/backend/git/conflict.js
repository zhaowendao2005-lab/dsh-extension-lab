/**
 * Conflict stages (docs/milestones.md M4-2).
 * A conflicted path exists in up to three index stages: `:1:` base, `:2:` ours, `:3:` theirs.
 * Add/add and delete/modify conflicts legitimately miss one or two of them, so every field is
 * nullable and the view must render "该侧不存在" rather than silently showing an empty file.
 */
import { gitOrThrow } from './exec.js';
import { ideError } from '../../shared/errors.js';
import { LIMITS } from '../../shared/contract.js';

const LITERAL = { GIT_LITERAL_PATHSPECS: '1' };

async function stageBlob(cwd, stage, filePath) {
  try {
    const result = await gitOrThrow(cwd, ['show', `:${stage}:${filePath}`], {
      timeoutMs: LIMITS.gitTimeoutMs,
      maxBytes: LIMITS.diffBytesMax,
      env: LITERAL,
    });
    return result.stdout;
  } catch (error) {
    // `fatal: path '…' does not exist in '…'` is the normal answer for a missing stage.
    if (error?.code === 'E_GIT_FAILED') return null;
    throw error;
  }
}

/**
 * @returns {Promise<{path: string, base: string|null, ours: string|null, theirs: string|null,
 *   binary: boolean, truncated: boolean, elapsedMs: number}>}
 */
export async function fetchConflictStages(cwd, filePath) {
  if (typeof filePath !== 'string' || !filePath) {
    throw ideError('E_INVALID_ARG', 'path 不能为空', { field: 'path' });
  }
  const startedAt = Date.now();
  const [base, ours, theirs] = await Promise.all([
    stageBlob(cwd, 1, filePath),
    stageBlob(cwd, 2, filePath),
    stageBlob(cwd, 3, filePath),
  ]);
  if (base === null && ours === null && theirs === null) {
    throw ideError('E_NOT_FOUND', '该文件没有冲突阶段', { path: filePath });
  }
  const binary = [base, ours, theirs].some((text) => typeof text === 'string' && text.includes('\u0000'));
  let truncated = false;
  const clip = (text) => {
    if (text === null) return null;
    if (text.length <= LIMITS.diffBytesMax) return text;
    truncated = true;
    return text.slice(0, LIMITS.diffBytesMax);
  };
  return {
    path: filePath,
    base: binary ? null : clip(base),
    ours: binary ? null : clip(ours),
    theirs: binary ? null : clip(theirs),
    binary,
    truncated,
    elapsedMs: Date.now() - startedAt,
  };
}
