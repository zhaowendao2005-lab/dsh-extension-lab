/**
 * Offline fixture for UI-only preview (`?pds-mock=1`). Never selected in a real
 * DSH instance, so the panel cannot silently show fake sandbox state. Keep the
 * interface identical to sandbox.datasource.js.
 */
export function mockRequested() {
  if (typeof location === 'undefined' || typeof location.search !== 'string') return false;
  return new URLSearchParams(location.search).has('pds-mock');
}

export function createSandboxDatasourceMock() {
  const snapshot = {
    binding: { pluginPath: 'packages/mock-plugin', name: 'mock-plugin' },
    commands: [{ id: 'build' }, { id: 'test' }, { id: 'check' }],
    runtime: { state: 'stopped', pid: null, url: null, error: null },
    command: { state: 'idle', id: null },
    terminals: [],
    logs: [],
    models: [],
    credentials: [],
  };
  let serial = 0;
  const answer = () => structuredClone(snapshot);
  return {
    sessionId: 'mock',
    status: async () => answer(),
    bind: async () => answer(),
    unbind: async () => answer(),
    launch: async () => { snapshot.runtime = { state: 'running', pid: 4242, url: 'http://127.0.0.1:9999/', error: null }; return answer(); },
    stop: async () => { snapshot.runtime = { state: 'stopped', pid: null, url: null, error: null }; return answer(); },
    run: async () => answer(),
    terminalCreate: async (fields = {}) => {
      const id = `mock-${++serial}`;
      snapshot.terminals.push({ id, state: 'running', commandId: fields.commandId, pid: 5000 + serial });
      snapshot.logs.push({ source: 'terminal', terminalId: id, stream: 'stdout', text: 'mock shell ready\r\n' });
      return answer();
    },
    terminalWrite: async (terminalId, data) => {
      snapshot.logs.push({ source: 'terminal', terminalId, stream: 'stdout', text: `$ ${data}mock output\r\n` });
      return answer();
    },
    terminalPoll: async (_terminalId, offset) => ({ offset, dropped: 0, data: '', state: 'closed' }),
    terminalResize: async () => ({ terminals: [] }),
    terminalClose: async (terminalId) => {
      snapshot.terminals = snapshot.terminals.filter((item) => item.id !== terminalId);
      return answer();
    },
    catalog: async () => ({ providers: [{ id: 'mock-provider', name: 'Mock Provider', models: [{ id: 'mock-model', name: 'Mock Model' }] }] }),
    saveModels: async (selectedModels) => { snapshot.models = selectedModels; return answer(); },
  };
}
