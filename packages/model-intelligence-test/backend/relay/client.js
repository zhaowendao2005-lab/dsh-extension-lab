const USER_AGENT = 'dsh-model-intelligence-test/1.0 (+relay source adaptation)';
const DEFAULT_TIMEOUT_MS = 30_000;

export class RelayError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function failure(status, headers) {
  const error = status === 404 ? new RelayError('relay-not-found', '中转站没有找到请求的公开接口。')
    : status === 429 ? new RelayError('relay-rate-limited', '中转站限流，请稍后重试。')
      : status >= 500 ? new RelayError('relay-unavailable', '中转站服务暂时不可用，请稍后重试。')
        : new RelayError('relay-request-failed', `中转站请求失败（HTTP ${status}）。`);
  error.status = status;
  // Rate limiting is documented as a real risk for scripted crawls: honour the server's own
  // backoff hint instead of retrying on a fixed short delay.
  const retryAfter = Number(headers?.get?.('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterMs = Math.min(retryAfter, 120) * 1000;
  return error;
}

/** Public, anonymous JSON GET. Timeouts are bounded and errors are normalized to fixed text. */
export async function getJson(url, {timeoutMs = DEFAULT_TIMEOUT_MS} = {}) {
  let response;
  try {
    response = await fetch(url, {
      headers: {accept: 'application/json', 'user-agent': USER_AGENT},
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw timedOut
      ? new RelayError('relay-timeout', `中转站响应超时（${Math.round(timeoutMs / 1000)} 秒）。`)
      : new RelayError('relay-network', '无法连接中转站，请检查网络后重试。');
  }
  if (!response.ok) throw failure(response.status, response.headers);
  let body;
  try { body = await response.json(); }
  catch { throw new RelayError('relay-invalid', '中转站返回的内容不是有效 JSON。'); }
  if (!body || typeof body !== 'object') throw new RelayError('relay-invalid', '中转站返回的内容为空。');
  if (body.success === false) {
    const message = typeof body.message === 'string' && body.message.length <= 200 ? body.message : '中转站拒绝了这次公开查询。';
    throw new RelayError('relay-rejected', message);
  }
  return body.data ?? body;
}
