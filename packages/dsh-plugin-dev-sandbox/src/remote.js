import { z } from 'zod';
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info';

export const ACTIONS = ['status', 'bind', 'launch', 'run', 'stop', 'unbind', 'terminalCreate', 'terminalWrite', 'terminalClose', 'models', 'saveModels'];
export const requestSchema = z.strictObject({
  sessionId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),
  action: z.enum(ACTIONS),
  pluginPath: z.string().min(1).max(4096).optional(),
  commandId: z.string().min(1).max(256).optional(),
  terminalId: z.string().min(1).max(128).optional(),
  data: z.string().max(16_384).optional(),
  rows: z.number().int().min(2).max(300).optional(),
  cols: z.number().int().min(10).max(500).optional(),
  selectedModels: z.array(z.object({ provider: z.string().min(1).max(128), model: z.string().min(1).max(256) })).max(500).optional(),
});
const input = {
  mode: 'strict',
  typeSymbol: 'dsh-plugin-dev-sandbox#pluginDev/execute:request',
  create: () => requestSchema,
};
// A shared explicit Typert contribution: exactly the same descriptors on both faces.
// Registration/mounting is owned by apply(), not implicit ctx.provide discovery.
export const remoteInfo = createTypertRemoteInfo({
  package: 'dsh-plugin-dev-sandbox',
  methods: {
    'pluginDev/execute': {
      service: 'pluginDev',
      description: 'Read or control the sandbox bound to one existing session.',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'request', source: 'json', codec: input, strictCodec: input }],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-plugin-dev-sandbox#pluginDev/execute:result',
        create: () => z.json(),
      },
    },
  },
}, z);
export const hostContribution = {
  package: remoteInfo.package,
  face: 'host',
  schemas: [],
  invocations: remoteInfo.descriptors,
  model: { symbols: [], exports: [], relations: [] },
};
