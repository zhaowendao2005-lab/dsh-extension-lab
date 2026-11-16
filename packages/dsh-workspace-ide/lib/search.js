/** Shared bounded search runner. Workers keep regex execution off the Host event loop. */
import { Worker } from 'node:worker_threads';
import { LIMITS } from '../shared/contract.js';
import { ideError } from '../shared/errors.js';

export function createSearch(ctx, workspace) {
  const running = new Set();
  const cache = new Map();
  let disposed = false;
  let generation = 0;
  ctx.effect(() => () => {
    disposed = true;
    cache.clear();
    for (const cancel of running) cancel();
  });

  return {
    invalidate() { generation += 1; cache.clear(); },
    async run(mode, input = {}) {
      if (disposed) throw ideError('E_CANCELLED', '搜索已停止', {});
      const root = workspace.requireRoot();
      const requestedGeneration = generation;
      const options = { ...input, limit: Math.min(input.limit ?? LIMITS.searchIndexMax, LIMITS.searchIndexMax) };
      const key = JSON.stringify([root, options.include ?? '', options.exclude ?? '', options.excludeGlobs ?? [], options.useIgnoreFiles !== false, options.limit]);
      const hit = cache.get(key);
      if (mode === 'index' && hit && Date.now() - hit.at < (input.maxAgeMs ?? 5000)) {
        return { ...hit.value, queryId: input.queryId ?? null };
      }
      const value = await new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./search-worker.js', import.meta.url), {
          workerData: { root, mode, input: options },
          execArgv: [],
          resourceLimits: { maxOldGenerationSizeMb: 128 },
        });
        const started = Date.now();
        let latest = mode === 'index' ? { paths: [], total: 0 } : { hits: [], scanned: 0 };
        let settled = false;
        const finish = (error, result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          running.delete(cancel);
          void worker.terminate().catch(() => {});
          if (error) reject(error);
          else resolve(result);
        };
        const cancel = () => finish(ideError('E_CANCELLED', '搜索已停止', {}));
        const timer = setTimeout(() => finish(null, {
          ...latest, queryId: input.queryId ?? null, engine: 'node',
          elapsedMs: Date.now() - started, truncated: true,
          warnings: [...(latest.warnings ?? []), '搜索达到时间上限，结果不完整'],
        }), LIMITS.searchTimeoutMs);
        running.add(cancel);
        worker.on('message', (message) => {
          if (message.progress) latest = message.progress;
          if (message.result) finish(null, message.result);
          if (message.error) finish(ideError(message.error.code, message.error.message, message.error.detail ?? {}));
        });
        worker.on('error', (error) => finish(ideError('E_UNSUPPORTED', '搜索工作线程无法启动', { reason: error.message })));
        worker.on('exit', (code) => {
          if (!settled) finish(ideError('E_CANCELLED', '搜索工作线程提前退出', { code }));
        });
      });
      if (mode === 'index' && !value.truncated && !disposed && generation === requestedGeneration) {
        cache.set(key, { at: Date.now(), value });
        if (cache.size > 8) cache.delete(cache.keys().next().value);
      }
      return value;
    },
  };
}
