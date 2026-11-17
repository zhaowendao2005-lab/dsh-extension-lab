/**
 * Minimal class-name joiner. The vendored rows used `clsx`; a plugin may not add
 * dependencies, and every call site only ever joins strings with `false`/
 * `undefined` holes, so this keeps the exact output of the reference call sites.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  let out = '';
  for (const part of parts) {
    if (typeof part !== 'string' || part === '') continue;
    out = out === '' ? part : `${out} ${part}`;
  }
  return out;
}
