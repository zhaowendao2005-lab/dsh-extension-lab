import { z } from 'zod'

export const PACKAGE_ID = 'dsh-delivery-orchestrator'
export const SERVICE_KEY = 'deliveryOrchestrator'
export const WIRE_NAMESPACE = 'delivery'
const codec = (name, shape) => ({ mode: 'strict', typeSymbol: `${PACKAGE_ID}#${name}`, create: shape })
const requestCodec = codec('DeliveryStatusRequest', () => z.object({ sessionId: z.string().min(1), runId: z.string().optional() }))
const resultCodec = codec('DeliveryResult', () => z.any())
const frameCodec = codec('DeliveryFrame', () => z.object({ type: z.literal('run'), run: z.any() }))
const endpoint = method => `${PACKAGE_ID}#${WIRE_NAMESPACE}/${method}`
const requestParam = () => ({ name: 'request', wire: 'request', source: 'json', codec: requestCodec })
export const DESCRIPTORS = [
  { id: endpoint('status'), service: SERVICE_KEY, namespace: WIRE_NAMESPACE, method: 'status', invocation: { kind: 'direct' }, parameters: [requestParam()], result: resultCodec },
  { id: endpoint('watch'), service: SERVICE_KEY, namespace: WIRE_NAMESPACE, method: 'watch', mode: 'stream', invocation: { kind: 'direct' }, parameters: [requestParam()], cancellation: { parameter: 'signal' }, result: frameCodec },
]
export const remoteInfo = { package: PACKAGE_ID, descriptors: DESCRIPTORS }
export const hostContribution = { package: PACKAGE_ID, face: 'host', schemas: [], invocations: DESCRIPTORS, model: { symbols: [], exports: [], relations: [] } }
