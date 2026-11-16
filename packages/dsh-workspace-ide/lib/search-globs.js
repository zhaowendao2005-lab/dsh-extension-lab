/** VS Code search-box globs: commas split alternatives except inside braces/classes. */
import picomatch from 'picomatch';
import { ideError } from '../shared/errors.js';

export function splitSearchGlobs(value = '') {
  const parts = [];
  let start = 0;
  let braces = 0;
  let brackets = 0;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (char === '[') brackets += 1;
    else if (char === ']') brackets = Math.max(0, brackets - 1);
    else if (!brackets && char === '{') braces += 1;
    else if (!brackets && char === '}') braces = Math.max(0, braces - 1);
    else if (char === ',' && !braces && !brackets) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

export function searchPathFilter(input) {
  const compile = (patterns, searchBox) => patterns.flatMap((pattern) => {
    let normalized = pattern.trim();
    if (!normalized) return [];
    if (normalized.includes('\0') || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').includes('..')) {
      throw ideError('E_INVALID_ARG', '搜索模式必须相对工作区，不能包含 ..', { field: 'include/exclude' });
    }
    const anchored = normalized.startsWith('./');
    if (anchored) normalized = normalized.slice(2);
    else if (searchBox && !normalized.startsWith('**/')) normalized = '**/' + normalized;
    normalized = normalized.replace(/\/+$/, '');
    if (!normalized) return [];
    try {
      const options = { dot: true, nonegate: true, noext: true, posixSlashes: true, strictBrackets: true };
      return [picomatch(normalized, options), picomatch(normalized + '/**', options)];
    } catch (error) {
      throw ideError('E_INVALID_ARG', '搜索 glob 无效', { field: 'include/exclude', reason: error.message });
    }
  });
  const includes = compile(splitSearchGlobs(input.include), true);
  const excludes = compile(splitSearchGlobs(input.exclude), true).concat(compile(input.excludeGlobs ?? [], false));
  return {
    excluded: (relative) => excludes.some((match) => match(relative) || match(relative + '/')),
    included: (relative) => !includes.length || includes.some((match) => match(relative)),
  };
}
