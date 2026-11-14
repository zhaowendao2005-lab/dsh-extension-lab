/**
 * Error plumbing shared by both faces (docs/remote-contract.md §1.3).
 * Pure data + tiny helpers; no imports so it stays bundler-neutral.
 */

export class IdeError extends Error {
  /**
   * @param {string} code one of ERROR_CODES
   * @param {string} message human readable, already redacted
   * @param {Record<string, unknown>} [detail] structured context for the UI
   */
  constructor(code, message, detail) {
    super(message);
    this.name = 'IdeError';
    this.code = code;
    this.detail = detail ?? {};
  }
}

export function ideError(code, message, detail) {
  return new IdeError(code, message, detail);
}

/** Normalise anything thrown anywhere in the Host into the wire error shape. */
export function toWireError(error) {
  if (error && typeof error === 'object' && typeof error.code === 'string') {
    return {
      code: error.code,
      message: typeof error.message === 'string' && error.message ? error.message : error.code,
      detail: redactDetail(error.detail),
    };
  }
  const message = error instanceof Error ? error.message : String(error ?? 'unknown error');
  return { code: 'E_UNSUPPORTED', message, detail: {} };
}

/**
 * Detail objects must never leak credentials or absolute host paths beyond the
 * workspace root; the Host calls this before answering (docs/security.md §6).
 */
export function redactDetail(detail) {
  if (!detail || typeof detail !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(detail)) {
    if (/token|secret|password|credential|authorization/i.test(key)) continue;
    if (typeof value === 'string') {
      out[key] = value.length > 4000 ? `${value.slice(0, 4000)}…` : value;
      continue;
    }
    if (Array.isArray(value)) {
      out[key] = value.slice(0, 200).map((item) => (typeof item === 'string' && item.length > 512 ? `${item.slice(0, 512)}…` : item));
      continue;
    }
    if (value && typeof value === 'object') {
      out[key] = redactDetail(value);
      continue;
    }
    out[key] = value;
  }
  return out;
}

/** Client-side helpers: the UI branches on `code`, never on message text. */
export function errorCodeOf(error) {
  return error && typeof error === 'object' && typeof error.code === 'string' ? error.code : 'E_UNSUPPORTED';
}

export function isTrustError(error) {
  return errorCodeOf(error) === 'E_TRUST_REQUIRED';
}

export function errorMessageOf(error) {
  if (error && typeof error === 'object' && typeof error.message === 'string') return error.message;
  return String(error ?? '');
}
