/** Remote selection only; package discovery and script validation stay on Host. */
export function createCommandsDatasource(client) {
  return {
    scan: () => client.call('workspace.scan', {}),
    packageScripts: (path) => client.call('workspace.packageScripts', { path }),
  };
}
