/**
 * Zero-dependency syntax highlighting for Markdown fenced code blocks using the
 * Lezer parsers and highlight tags already bundled for CodeMirror 6 (check R13).
 */
import { highlightTree, tagHighlighter, tags } from '@lezer/highlight';
import { languageSupport } from './languages.js';

const MAX_HIGHLIGHT_CHARS = 100_000;

const LANG_ALIASES = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  javascript: 'javascript',
  node: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  typescript: 'typescript',
  jsx: 'jsx',
  javascriptreact: 'jsx',
  tsx: 'tsx',
  typescriptreact: 'tsx',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  jsonl: 'json',
  md: 'markdown',
  markdown: 'markdown',
  html: 'html',
  htm: 'html',
  css: 'css',
  py: 'python',
  py3: 'python',
  python: 'python',
  rs: 'rust',
  rust: 'rust',
  go: 'go',
  golang: 'go',
  java: 'java',
  c: 'cpp',
  h: 'cpp',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hxx: 'cpp',
  'c++': 'cpp',
  xml: 'xml',
  svg: 'xml',
  xsd: 'xml',
  plist: 'xml',
  yml: 'yaml',
  yaml: 'yaml',
  sql: 'sql',
  mysql: 'sql',
  postgres: 'sql',
  postgresql: 'sql',
  sqlite: 'sql',
  php: 'php',
};

const HIGHLIGHTER = tagHighlighter([
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], class: 'wid-md__tok-keyword' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], class: 'wid-md__tok-string' },
  { tag: [tags.number, tags.bool, tags.null], class: 'wid-md__tok-number' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], class: 'wid-md__tok-comment' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], class: 'wid-md__tok-function' },
  { tag: [tags.typeName, tags.className, tags.namespace], class: 'wid-md__tok-type' },
  { tag: [tags.propertyName, tags.attributeName], class: 'wid-md__tok-property' },
  { tag: [tags.tagName], class: 'wid-md__tok-tag' },
  { tag: [tags.definition(tags.variableName), tags.definition(tags.propertyName)], class: 'wid-md__tok-variable' },
  { tag: [tags.heading, tags.strong], class: 'wid-md__tok-strong' },
  { tag: tags.emphasis, class: 'wid-md__tok-em' },
  { tag: [tags.link, tags.url], class: 'wid-md__tok-link' },
]);

const parserCache = new Map();

export function normalizeCodeLanguage(lang) {
  if (typeof lang !== 'string') return '';
  const token = lang.trim().toLowerCase().split(/\s+/)[0];
  return token;
}

export function resolveHighlightLanguageId(lang) {
  const normalized = normalizeCodeLanguage(lang);
  return LANG_ALIASES[normalized] ?? null;
}

function getParser(id) {
  if (!id) return null;
  if (parserCache.has(id)) return parserCache.get(id);
  const support = languageSupport(id);
  const parser = support?.language?.parser ?? null;
  parserCache.set(id, parser);
  return parser;
}

/**
 * Tokenize a code string into `[{ text, className }]` segments.
 * Returns `null` when no bundled parser applies or the block exceeds the size cap.
 */
export function highlightCodeSegments(code, lang) {
  const source = String(code ?? '');
  if (!source || source.length > MAX_HIGHLIGHT_CHARS) return null;
  const id = resolveHighlightLanguageId(lang);
  const parser = getParser(id);
  if (!parser) return null;

  try {
    const tree = parser.parse(source);
    const segments = [];
    let pos = 0;
    highlightTree(tree, HIGHLIGHTER, (from, to, className) => {
      if (from > pos) segments.push({ text: source.slice(pos, from), className: null });
      if (to > from) segments.push({ text: source.slice(from, to), className });
      pos = to;
    });
    if (pos < source.length) segments.push({ text: source.slice(pos), className: null });
    return segments;
  } catch {
    return null;
  }
}
