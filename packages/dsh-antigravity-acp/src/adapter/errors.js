import { RpcError } from '../protocol/connection.js';

export class AcpError extends Error {
  constructor(code, message, options) { super(message, options); this.name = 'AcpError'; this.code = code; }
}
export function aborted(signal) {
  if (signal?.aborted) throw new AcpError('ACP_ABORTED', 'ACP 请求已取消。');
}
export function failure(error) {
  // Never put raw CLI stderr, RPC error data, prompts or arguments into durable DSH errors.
  // ACP defines -32000 as AUTH_REQUIRED. Never include the peer's raw message/data.
  if (error instanceof RpcError && error.code === -32000) return {code:'ACP_AUTH_REQUIRED',message:'官方 CLI 尚未认证。请先在该系统用户下登录 agy，并检查插件的 loginHome 登录目录配置。'};
  return { code: error instanceof AcpError ? error.code : 'ACP_FAILURE', message: error instanceof AcpError ? error.message : 'ACP 连接失败；本次请求未自动重试。' };
}
