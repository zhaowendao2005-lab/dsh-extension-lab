/**
 * The only route from the frontend to state: every read/write is one Remote call
 * (`pluginDev.execute`) served by backend/service.js. No view or store addresses
 * the Host through any other channel, so the snapshot stays the single source of truth.
 */
export function createSandboxDatasource({ execute, sessionId }) {
  const call = async (action, fields = {}) => {
    const result = await execute({ ...fields, sessionId, action });
    if (!result?.ok) throw new Error(result?.error?.message || 'Sandbox request failed');
    return result.value;
  };
  return {
    sessionId,
    status: () => call('status'),
    bind: (pluginPath) => call('bind', { pluginPath }),
    unbind: () => call('unbind'),
    launch: () => call('launch'),
    stop: () => call('stop'),
    run: (commandId) => call('run', { commandId }),
    terminalCreate: (fields = {}) => call('terminalCreate', fields),
    terminalWrite: (terminalId, data) => call('terminalWrite', { terminalId, data }),
    terminalClose: (terminalId) => call('terminalClose', { terminalId }),
    catalog: () => call('models'),
    saveModels: (selectedModels) => call('saveModels', { selectedModels }),
  };
}
