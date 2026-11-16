import { resolveFileIcon } from '../../service/file-icons.js';

export { fileIconKind } from '../../service/file-icons.js';

/** Real Seti SVG outlines, independent of SCM state and any runtime font or asset route. */
export function FileIcon({ name, size = 14, className = '', languageId }) {
  const icon = resolveFileIcon(name, languageId);
  return (
    <svg className={'wid-file-icon ' + className} data-file-kind={icon.kind} data-file-tone={icon.tone}
      width={size} height={size} viewBox={icon.viewBox} fill="currentColor"
      aria-hidden="true" focusable="false">
      <path d={icon.path} />
    </svg>
  );
}
