import { AcpError } from './adapter/errors.js';

// Generation is allowed only through the local sanitizing gateway. The CLI child
// is pointed at a loopback endpoint, and every agent turn is parsed before it
// leaves this process: native tool declarations are removed and the vendor system
// prompt is replaced with the DSH one. The guarantee is structural rather than an
// empirical profile allowance, and it is re-checked after each completed turn.
export const BRIDGE_TOOL_PREFIX = 'mcp_dsh-bridge_';
export const PURITY_STATUS = Object.freeze({ mechanism: 'sanitizing-gateway', requiresGateway: true, upstreamDeclarationsForwarded: false });

/** Refuses to continue when a completed turn left no gateway attestation. */
export function requireGatewayPurity(attestation) {
  if (!attestation || !Number.isSafeInteger(attestation.sanitizedAgentRequests) || attestation.sanitizedAgentRequests < 1) {
    throw new AcpError('ACP_PURITY_UNVERIFIED', '本轮生成没有经过本地净化网关；已停止，未按纯净通道继续。');
  }
  return attestation;
}
