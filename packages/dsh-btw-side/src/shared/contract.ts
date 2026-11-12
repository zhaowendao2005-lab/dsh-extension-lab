import { z } from 'zod'
import { PACKAGE_ID, SERVICE_KEY, WIRE_NAMESPACE } from './frames'

const codec = (symbol: string, shape: () => z.ZodTypeAny) => ({
  mode: 'strict' as const,
  typeSymbol: `${PACKAGE_ID}#${symbol}`,
  create: shape,
})

const frameCodec = codec('BtwFrame', () => z.any())
const watchRequestCodec = codec('WatchRequest', () =>
  z.object({ sessionId: z.string(), afterSeq: z.number().optional() }),
)
const stateRequestCodec = codec('StateRequest', () => z.object({ sessionId: z.string() }))
const closeRequestCodec = codec('CloseRequest', () =>
  z.object({ sessionId: z.string(), requestId: z.string() }),
)
const clearRequestCodec = codec('ClearRequest', () => z.object({ sessionId: z.string() }))
const stateResultCodec = codec('StateResult', () => z.any())
const okCodec = codec('OkResult', () => z.object({ ok: z.boolean() }))

const requestParam = (name: string, payload: ReturnType<typeof codec>) => ({
  name,
  wire: name,
  source: 'json' as const,
  codec: payload,
})

const endpoint = (method: string) => `${PACKAGE_ID}#${WIRE_NAMESPACE}/${method}`

/** Hand-written strict Remote descriptors: the canonical generated form is not shipped by DSH. */
export const DESCRIPTORS: any[] = [
  {
    id: endpoint('watch'),
    service: SERVICE_KEY,
    namespace: WIRE_NAMESPACE,
    method: 'watch',
    mode: 'stream',
    invocation: { kind: 'direct' },
    parameters: [requestParam('request', watchRequestCodec)],
    cancellation: { parameter: 'signal' },
    result: frameCodec,
  },
  {
    id: endpoint('state'),
    service: SERVICE_KEY,
    namespace: WIRE_NAMESPACE,
    method: 'state',
    invocation: { kind: 'direct' },
    parameters: [requestParam('request', stateRequestCodec)],
    result: stateResultCodec,
  },
  {
    id: endpoint('close'),
    service: SERVICE_KEY,
    namespace: WIRE_NAMESPACE,
    method: 'close',
    invocation: { kind: 'direct' },
    parameters: [requestParam('request', closeRequestCodec)],
    result: okCodec,
  },
  {
    id: endpoint('clear'),
    service: SERVICE_KEY,
    namespace: WIRE_NAMESPACE,
    method: 'clear',
    invocation: { kind: 'direct' },
    parameters: [requestParam('request', clearRequestCodec)],
    result: okCodec,
  },
]

/** Client mount contribution consumed by `remote.$mount`. */
export const remoteInfo = { package: PACKAGE_ID, descriptors: DESCRIPTORS }

/** Host contribution registered through `ctx.typert.register`. */
export const hostContribution = {
  package: PACKAGE_ID,
  face: 'host' as const,
  schemas: [] as unknown[],
  invocations: DESCRIPTORS,
  model: { symbols: [] as unknown[], exports: [] as unknown[], relations: [] as unknown[] },
}
