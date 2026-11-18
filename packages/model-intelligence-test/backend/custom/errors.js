/** Shared sanitization for custom-run failures shown in the UI (no secrets, bounded). */
const SECRET = /(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/=-]{8,}|"?(?:api[_-]?key|authorization|access[_-]?token)"?\s*[:=]\s*"?[^\s",}]{6,})/gi;
const scrub = (value, max) => typeof value === 'string' && value ? value.replace(SECRET, '[redacted]').slice(0, max) : undefined;
/** Sanitized, bounded failure detail for the UI: full message, stack, cause chain, upstream status/body. */
export function errorDetail(error) {
  if (!error || typeof error !== 'object') return error === undefined ? null : { message: scrub(String(error), 4000) };
  const causes = []; let cause = error.cause; const seen = new Set([error]);
  while (cause && typeof cause === 'object' && !seen.has(cause) && causes.length < 5) {
    seen.add(cause); causes.push({ name: scrub(cause.name, 120), message: scrub(cause.message, 2000), code: scrub(typeof cause.code === 'string' ? cause.code : undefined, 64), stack: scrub(cause.stack, 4000) });
    cause = cause.cause;
  }
  const status = Number.isInteger(error.status) ? error.status : Number.isInteger(error.httpStatus) ? error.httpStatus : undefined;
  return { name: scrub(error.name, 120), message: scrub(error.message, 4000), stack: scrub(error.stack, 8000), ...(status ? { status } : {}), ...(typeof error.requestId === 'string' ? { requestId: error.requestId.slice(0, 200) } : {}), ...(typeof error.body === 'string' ? { body: scrub(error.body, 4000) } : {}), ...(causes.length ? { causes } : {}) };
}

