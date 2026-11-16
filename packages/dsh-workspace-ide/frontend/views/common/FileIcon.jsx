/** Small self-contained file glyphs. No fonts, network assets, colors or SCM status. */
const SPECIAL_FILES = new Map([
  ['package.json', 'package'], ['deno.json', 'package'], ['deno.jsonc', 'package'],
  ['cargo.toml', 'package'], ['pyproject.toml', 'package'], ['composer.json', 'package'],
  ['package-lock.json', 'npm-lock'], ['npm-shrinkwrap.json', 'npm-lock'],
  ['pnpm-lock.yaml', 'pnpm-lock'], ['yarn.lock', 'yarn-lock'],
  ['bun.lock', 'bun-lock'], ['bun.lockb', 'bun-lock'],
  ['cargo.lock', 'lock'], ['poetry.lock', 'lock'], ['uv.lock', 'lock'], ['composer.lock', 'lock'],
  ['.gitignore', 'git'], ['.gitattributes', 'git'], ['.gitmodules', 'git'],
  ['.gitconfig', 'git'], ['.gitkeep', 'git'], ['.gitmessage', 'git'], ['.git-blame-ignore-revs', 'git'],
  ['.npmrc', 'package-config'], ['.yarnrc', 'package-config'], ['.yarnrc.yml', 'package-config'],
  ['pnpm-workspace.yaml', 'package-config'], ['.pnpmfile.cjs', 'package-config'],
  ['.editorconfig', 'config'], ['makefile', 'terminal'], ['gnumakefile', 'terminal'],
  ['justfile', 'terminal'], ['procfile', 'terminal'],
]);

export function fileIconKind(name = '') {
  const filename = String(name).split('/').pop().toLowerCase();
  // Full names and tool-specific variants take precedence over generic extensions.
  const special = SPECIAL_FILES.get(filename);
  if (special) return special;
  if (/^tsconfig(?:\.[^.]+)*\.json$/.test(filename)) return 'tsconfig';
  if (/^jsconfig(?:\.[^.]+)*\.json$/.test(filename)) return 'jsconfig';
  if (/^vite\.config(?:\.[^.]+)*\.[cm]?[jt]s$/.test(filename)) return 'vite';
  if (/^webpack\.config(?:\.[^.]+)*\.[cm]?[jt]s$/.test(filename)) return 'webpack';
  if (/^rollup\.config(?:\.[^.]+)*\.[cm]?[jt]s$/.test(filename)) return 'rollup';
  if (/^(?:eslint\.config(?:\.[^.]+)*\.[cm]?[jt]s|\.eslintrc(?:\.[cm]?js|\.json|\.ya?ml)?|\.eslintignore)$/.test(filename)) return 'eslint';
  if (/^(?:prettier\.config(?:\.[^.]+)*\.[cm]?[jt]s|\.prettierrc(?:\.[cm]?[jt]s|\.json|\.json5|\.ya?ml|\.toml)?|\.prettierignore)$/.test(filename)) return 'prettier';
  if (/^(?:readme|changelog|contributing)(?:\.[^.]+)*$/.test(filename)) return 'readme';
  if (/^(?:licen[cs]e|copying|notice)(?:\.[^.]+)*$/.test(filename)) return 'license';
  if (/^(?:dockerfile(?:\.[^.]+)*|(?:[^.]+\.)+dockerfile)$/.test(filename)) return 'container';
  if (/^(?:docker-)?compose(?:\.[^.]+)*\.ya?ml$/.test(filename)) return 'compose';
  if (filename === '.dockerignore') return 'container';
  if (/^\.env(?:\.[^.]+)*$/.test(filename)) return 'environment';
  if (/^tailwind\.config(?:\.[^.]+)*\.[cm]?[jt]s$/.test(filename)) return 'tailwind';
  if (/^(?:postcss\.config\.[cm]?[jt]s|\.postcssrc(?:\.[cm]?js|\.json|\.ya?ml)?)$/.test(filename)) return 'postcss';
  if (/^(?:babel\.config\.[cm]?[jt]s|\.babelrc(?:\.[cm]?js|\.json)?)$/.test(filename)) return 'babel';
  if (/^(?:vitest|jest|playwright|cypress)\.config(?:\.[^.]+)*\.[cm]?[jt]s$/.test(filename)) return 'test-config';
  if (filename.endsWith('.lock') || filename.endsWith('-lock.json')) return 'lock';
  const dot = filename.lastIndexOf('.');
  const extension = dot < 0 ? '' : filename.slice(dot + 1);
  switch (extension) {
    case 'ts': case 'mts': case 'cts': return 'typescript';
    case 'js': case 'mjs': case 'cjs': return 'javascript';
    case 'jsx': case 'tsx': case 'vue': case 'svelte': return 'component';
    case 'css': case 'scss': case 'sass': case 'less': return 'style';
    case 'html': case 'htm': case 'xml': case 'svg': return 'markup';
    case 'json': case 'jsonc': return 'data';
    case 'yaml': case 'yml': case 'toml': case 'ini': case 'conf': case 'env': return 'config';
    case 'md': case 'mdx': case 'rst': case 'txt': return 'document';
    case 'py': case 'pyi': return 'python';
    case 'sh': case 'bash': case 'zsh': case 'fish': case 'ps1': case 'bat': return 'terminal';
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'webp': case 'ico': case 'avif': return 'image';
    case 'zip': case 'gz': case 'tar': case '7z': case 'rar': return 'archive';
    case 'go': case 'rs': case 'c': case 'h': case 'cpp': case 'java': case 'rb': case 'php': case 'swift': return 'code';
    default: return 'file';
  }
}

const OUTLINE = 'M11.5 2.5H4.5v15h11V6.5z M11.5 2.5v4h4';

export function FileIcon({ name, size = 14, className = '' }) {
  const kind = fileIconKind(name);
  let glyph;
  switch (kind) {
    case 'package': glyph = 'M10 8l4 2v4l-4 2-4-2v-4z M6 10l4 2 4-2 M10 12v4 M8 9l4 2'; break;
    case 'npm-lock': glyph = 'M6 9h8v4H6z M8 13v-3h2v3 M12 10v3 M9 15h4'; break;
    case 'pnpm-lock': glyph = 'M6 8h3v3H6z M11 8h3v3h-3z M11 13h3v3h-3z M6 13h3v3H6z'; break;
    case 'yarn-lock': glyph = 'M7 9c-3 3 0 7 3 6s5-5 2-6-5 1-3 3 4 0 3-1 M8 15l-2 1'; break;
    case 'bun-lock': glyph = 'M6 12c0-2 2-4 4-5 0 2 4 3 4 5a4 3 0 0 1-8 0z M8 12h.1 M12 12h.1 M9 14h2'; break;
    case 'package-config': glyph = 'M6 9h8 M6 13h8 M8 8v2 M12 12v2 M7 16h6'; break;
    case 'tsconfig': glyph = 'M6 9h6 M9 9v6 M12 12h2v3h-2z M6 16h4'; break;
    case 'jsconfig': glyph = 'M9 9v5a1.5 1.5 0 0 1-3 0 M12 11h2v4h-2z M11 16h4'; break;
    case 'vite': glyph = 'M6 9l4 7 4-7h-3l1-2-4 1 1 3h2l-1 3'; break;
    case 'webpack': glyph = 'M10 8l4 2v4l-4 2-4-2v-4z M8 11l2-1 2 1v2l-2 1-2-1z'; break;
    case 'rollup': glyph = 'M7 16V9h4a2 2 0 0 1 0 4H7 M10 13l4 3 M7 9l7 7'; break;
    case 'eslint': glyph = 'M8 8h4l3 4-3 4H8l-3-4z M8 10h4v4H8z'; break;
    case 'prettier': glyph = 'M6 9h5 M13 9h1 M6 11h2 M10 11h4 M6 13h6 M6 15h3 M11 15h3'; break;
    case 'readme': glyph = 'M6 9h3l1 1 1-1h3v6h-3l-1 1-1-1H6z M10 10v6'; break;
    case 'license': glyph = 'M10 8v8 M6 10h8 M7 10l-2 4h4z M13 10l-2 4h4z M7 16h6'; break;
    case 'compose': glyph = 'M6 8h3v3H6z M11 8h3v3h-3z M9 13h3v3H9z M7.5 11v3H9 M12.5 11v2'; break;
    case 'environment': glyph = 'M8 8v5a2 2 0 0 0 4 0V8 M7 8h6 M8 11h4 M6 15l-1 1 M14 15l1 1'; break;
    case 'tailwind': glyph = 'M5 11c2-4 4 2 7-1 1-1 2-1 3-1 M5 15c2-4 4 2 7-1 1-1 2-1 3-1'; break;
    case 'postcss': glyph = 'M7 16V9h4a2 2 0 0 1 0 4H7 M12 14l2 2 M11 16h3'; break;
    case 'babel': glyph = 'M6 15l3-6h2l3 6 M7 13h6 M9 9V8h2v1'; break;
    case 'test-config': glyph = 'M8 8h4 M9 8v3l-3 5h8l-3-5V8 M8 14h4'; break;
    case 'typescript': glyph = 'M6.5 10h5 M9 10v5 M13.5 10h-1v2h1v3h-2'; break;
    case 'javascript': glyph = 'M9 10v4a1 1 0 0 1-2 0 M14 10h-2v2h2v3h-2'; break;
    case 'component': glyph = 'M6 10l4 5 4-5-4-2z M6 10h8'; break;
    case 'style': glyph = 'M6.5 9h7l-1 6-3 1-2.5-1 M7 11.5h5.5'; break;
    case 'markup': glyph = 'M8 10l-2 2 2 2 M12 10l2 2-2 2 M10.5 9l-1 6'; break;
    case 'data': glyph = 'M8.5 9H7v2l-1 1 1 1v2h1.5 M11.5 9H13v2l1 1-1 1v2h-1.5'; break;
    case 'config': glyph = 'M6 10h8 M6 14h8 M8 9v2 M12 13v2'; break;
    case 'document': glyph = 'M6.5 9h7 M6.5 12h7 M6.5 15h4'; break;
    case 'python': glyph = 'M6.5 12V9h6v3h-5v3h6v-3 M9 10h.1 M11 14h.1'; break;
    case 'terminal': glyph = 'M6 10l2.5 2L6 14 M10 14h4'; break;
    case 'image': glyph = 'M6 15l3-4 2 2 1-1 2 3z M7 9h.1'; break;
    case 'archive': glyph = 'M9 7h2 M9 9h2 M9 11h2 M9 13h2v3H9z'; break;
    case 'lock': glyph = 'M8 12V10a2 2 0 0 1 4 0v2 M7 12h6v4H7z'; break;
    case 'git': glyph = 'M8 9v6 M8 10h4v3 M7 8h2v2H7z M11 13h2v2h-2z'; break;
    case 'container': glyph = 'M6 11h8l-1 4H7z M7 8h2v3 M10 8h2v3 M8 8V6'; break;
    case 'code': glyph = 'M8 10l-2 2 2 2 M12 10l2 2-2 2'; break;
    default: glyph = 'M7 10h6 M7 13h4';
  }
  return (
    <svg className={'wid-file-icon ' + className} data-file-kind={kind} width={size} height={size}
      viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.25"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={OUTLINE} /><path d={glyph} />
    </svg>
  );
}
