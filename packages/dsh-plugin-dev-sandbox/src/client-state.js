// Stable per-session observable shared by the entry button and right panel.
export function createSandboxStore(execute, sessionId, delay = 2000) {
  let value = { snapshot: null, busy: false, error: null, loading: true };
  let timer;
  let disposed = false;
  let inFlight = false;
  let revision = 0;
  const listeners = new Set();
  const publish = (next) => { if (disposed) return; value = { ...value, ...next }; for (const listener of listeners) listener(); };
  async function call(action, fields = {}) {
    const result = await execute({ ...fields, sessionId, action });
    if (!result.ok) throw new Error(result.error?.message || 'Sandbox request failed');
    return result.value;
  }
  async function refresh() {
    if (disposed || inFlight || value.busy) return;
    inFlight = true;
    const started = revision;
    try { const snapshot = await call('status'); if (started === revision) publish({ snapshot, loading: false, error: null }); }
    catch (error) { if (started === revision) publish({ error: error.message, loading: false }); }
    finally { inFlight = false; }
  }
  return {
    getSnapshot: () => value,
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      if (listeners.size === 1) { void refresh(); timer = setInterval(refresh, delay); }
      return () => { listeners.delete(listener); if (!listeners.size) clearInterval(timer); };
    },
    async action(action, fields) {
      if (value.busy || disposed) return undefined;
      // Invalidate older reads; they may finish after this action.
      revision++;
      publish({ busy: true, error: null });
      try {
        const result = await call(action, fields);
        // Session actions answer with the shared snapshot; catalog-style reads do not.
        if (result && typeof result === 'object' && 'runtime' in result) publish({ snapshot: result, loading: false });
        else publish({ loading: false });
        return result;
      } catch (error) { publish({ error: error.message, loading: false }); return undefined; }
      finally { publish({ busy: false }); }
    },
    request: call,
    refresh,
    dispose() { disposed = true; clearInterval(timer); listeners.clear(); },
  };
}
