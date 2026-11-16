/** Remote selection only. Workspace path validation and ignore semantics stay on Host. */
export function createQuickAccessDatasource(client) {
  return {
    index: (input) => client.call('files.index', input),
    search: (input) => client.call('files.search', input),
  };
}
