/**
 * The only place allowed to import `@codemirror/lang-*` (check R13). Every entry is a
 * thunk so nothing is constructed until a file of that language is actually opened —
 * the bundle still carries every parser (IIFE can't split), but states stay untouched.
 */
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { go } from '@codemirror/lang-go';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { sql } from '@codemirror/lang-sql';
import { php } from '@codemirror/lang-php';

const THUNKS = {
  javascript: () => javascript(),
  typescript: () => javascript({ typescript: true }),
  jsx: () => javascript({ jsx: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
  json: () => json(),
  markdown: () => markdown(),
  html: () => html(),
  css: () => css(),
  python: () => python(),
  rust: () => rust(),
  go: () => go(),
  java: () => java(),
  cpp: () => cpp(),
  xml: () => xml(),
  yaml: () => yaml(),
  sql: () => sql(),
  php: () => php(),
};

/** Language support for an id from `service/language.js`; `null` means "no parser". */
export function languageSupport(id) {
  const thunk = THUNKS[id];
  return thunk ? thunk() : null;
}

export const LANGUAGE_IDS = Object.keys(THUNKS);
