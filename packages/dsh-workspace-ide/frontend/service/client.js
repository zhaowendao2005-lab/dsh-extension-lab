/**
 * The only place the browser talks to the Host. Every `call` returns `data` on
 * success and throws an `IdeError` carrying the contract's `code` on failure, so
 * callers branch on codes instead of parsing messages (docs/remote-contract.md §1).
 */
import { ERROR_CODES } from '../../shared/contract.js';

export class IdeError extends Error {
  constructor(code, message, detail) {
    super(message || code);
    this.name = 'IdeError';
    this.code = code;
    this.detail = detail ?? {};
  }
}

export function isTrustError(error) {
  return error?.code === 'E_TRUST_REQUIRED';
}

/**
 * Peel the Typert transport envelope off a Remote result. A Host that answers with the bare
 * service envelope (older builds) is still accepted, so the two layers never have to be in
 * lockstep.
 */
function unwrapTransport(response) {
  if (typeof response.value === 'object' && response.value !== null && 'ok' in response.value) {
    return response.value;
  }
  return response;
}

export function createClient(execute, getSessionId) {
  return {
    /**
     * @param {string} action one of shared/contract.js ACTIONS
     * @param {Record<string, unknown>} [payload]
     */
    async call(action, payload) {
      const request = { action, payload: payload ?? {} };
      const sessionId = getSessionId?.();
      if (sessionId) request.sessionId = sessionId;
      let response;
      try {
        response = await execute(request);
      } catch (error) {
        throw new IdeError('E_LIMIT', error?.message ?? '与宿主的连接中断', { cause: 'transport' });
      }
      if (!response || typeof response !== 'object') {
        throw new IdeError('E_LIMIT', '宿主返回了无法识别的响应', { cause: 'protocol' });
      }
      // The Remote transport wraps every result in its own `{ ok, value | error }` envelope;
      // our service contract then carries a second `{ ok, data | error }` envelope inside it.
      const envelope = unwrapTransport(response);
      if (envelope.ok) return envelope.data;
      const wire = envelope.error ?? {};
      throw new IdeError(
        ERROR_CODES.includes(wire.code) ? wire.code : 'E_LIMIT',
        wire.message || '操作失败',
        wire.detail ?? {},
      );
    },
  };
}
