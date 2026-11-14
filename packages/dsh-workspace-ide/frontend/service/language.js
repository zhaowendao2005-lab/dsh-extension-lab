/**
 * Extension → language id + human label. The id is what `frontend/editor/languages.js`
 * turns into a CodeMirror extension; unknown files are `plaintext` and still editable.
 * Keep this table the single source of truth: check R13 only allows lang-* imports here.
 */
const BY_EXTENSION = new Map([
  ['ts', 'typescript'], ['mts', 'typescript'], ['cts', 'typescript'],
  ['tsx', 'tsx'], ['js', 'javascript'], ['mjs', 'javascript'], ['cjs', 'javascript'], ['jsx', 'jsx'],
  ['json', 'json'], ['jsonc', 'json'], ['json5', 'json'],
  ['md', 'markdown'], ['mdx', 'markdown'], ['markdown', 'markdown'],
  ['html', 'html'], ['htm', 'html'], ['vue', 'html'], ['svelte', 'html'],
  ['css', 'css'], ['scss', 'css'], ['less', 'css'],
  ['py', 'python'], ['pyi', 'python'],
  ['rs', 'rust'],
  ['go', 'go'],
  ['java', 'java'],
  ['c', 'cpp'], ['h', 'cpp'], ['cc', 'cpp'], ['cpp', 'cpp'], ['cxx', 'cpp'], ['hpp', 'cpp'], ['hh', 'cpp'],
  ['xml', 'xml'], ['svg', 'xml'], ['plist', 'xml'],
  ['yaml', 'yaml'], ['yml', 'yaml'],
  ['sql', 'sql'],
  ['php', 'php'],
]);

const BY_NAME = new Map([
  ['dockerfile', 'plaintext'],
  ['makefile', 'plaintext'],
  ['.gitignore', 'plaintext'],
  ['.npmrc', 'plaintext'],
  ['.editorconfig', 'plaintext'],
  ['package.json', 'json'],
  ['tsconfig.json', 'json'],
  ['jsconfig.json', 'json'],
]);

const LABELS = {
  plaintext: 'Plain Text',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  jsx: 'JavaScript JSX',
  tsx: 'TypeScript JSX',
  json: 'JSON',
  markdown: 'Markdown',
  html: 'HTML',
  css: 'CSS',
  python: 'Python',
  rust: 'Rust',
  go: 'Go',
  java: 'Java',
  cpp: 'C++',
  xml: 'XML',
  yaml: 'YAML',
  sql: 'SQL',
  php: 'PHP',
};

export function languageForPath(path) {
  if (!path) return 'plaintext';
  const name = String(path).split('/').pop() ?? String(path);
  const byName = BY_NAME.get(name.toLowerCase());
  if (byName) return byName;
  const dot = name.lastIndexOf('.');
  if (dot === -1) return 'plaintext';
  return BY_EXTENSION.get(name.slice(dot + 1).toLowerCase()) ?? 'plaintext';
}

export function languageLabelForPath(path) {
  return LABELS[languageForPath(path)] ?? LABELS.plaintext;
}

export function languageLabel(id) {
  return LABELS[id] ?? LABELS.plaintext;
}
