/**
 * Hand-drawn 20×20 outline glyphs (docs/ui-spec.md §3). No icon library and no
 * reuse of the host's icon factory: a plugin may not import host client packages.
 *
 * Every entry is a plain array of SVG path strings, never a JSX element. React is
 * injected after this module is evaluated, so module-level JSX would call `h`
 * before it points at `createElement` and blow up at import time.
 */
const PATHS = {
  explorer: ['M2.5 4.5a2 2 0 0 1 2-2h3l1.5 2h6.5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z'],
  scm: ['M6 4.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0z', 'M18 4.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0z', 'M10 17.5a2 2 0 1 1 4 0 2 2 0 0 1-4 0z', 'M4 6.5v3a3 3 0 0 0 3 3h3', 'M16 6.5v3a3 3 0 0 1-3 3h-1', 'M12 13.5v2'],
  graph: ['M4 3.5v13', 'M4 8.5h4.5a3.5 3.5 0 0 0 3.5-3.5v-1', 'M4 13.5h7', 'M14.5 4.5a1.5 1.5 0 1 0 0-.01', 'M14.5 13.5a1.5 1.5 0 1 0 0-.01'],
  terminal: ['M3 4.5h14v11H3z', 'M6.5 8l2.5 2-2.5 2', 'M11 12h3'],
  preview: ['M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z', 'M10 7.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4z'],
  search: ['M9 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10z', 'M12.5 12.5 17 17'],
  settings: ['M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', 'M16 10a6 6 0 0 0-.1-1l1.4-1-1.5-2.6-1.6.6a6 6 0 0 0-1.7-1L12.2 3H8.8l-.3 1.9a6 6 0 0 0-1.7 1l-1.6-.6L3.7 8l1.4 1a6 6 0 0 0 0 2l-1.4 1 1.5 2.6 1.6-.6a6 6 0 0 0 1.7 1l.3 1.9h3.4l.3-1.9a6 6 0 0 0 1.7-1l1.6.6 1.5-2.6-1.4-1c.1-.3.1-.7.1-1z'],
  refresh: ['M16 10a6 6 0 1 1-1.8-4.3', 'M16 3.5V7h-3.5'],
  collapse: ['M4 5.5h12', 'M4 14.5h12', 'M10 7.5l0 5', 'M8 8.5l2-2 2 2', 'M8 11.5l2 2 2-2'],
  newFile: ['M11 3.5H5.5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V8', 'M11 3.5 15.5 8h-4.5z', 'M10 12.5v4M8 14.5h4'],
  chevronRight: ['M8 5l5 5-5 5'],
  chevronDown: ['M5 8l5 5 5-5'],
  close: ['M5.5 5.5l9 9', 'M14.5 5.5l-9 9'],
  plus: ['M10 4.5v11', 'M4.5 10h11'],
  trash: ['M4.5 6.5h11', 'M6.5 6.5V15a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1V6.5', 'M8 6.5V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5'],
  folder: ['M2.5 5.5a1.5 1.5 0 0 1 1.5-1.5h3l1.5 2h7a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 15.5 16H4a1.5 1.5 0 0 1-1.5-1.5z'],
  file: ['M12 3.5H6a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6.5z', 'M12 3.5V6.5h3'],
  branch: ['M6 4.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z', 'M6 15.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z', 'M17 7.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z', 'M4.5 6v8', 'M15.5 9v1a3 3 0 0 1-3 3H4.5'],
  check: ['M4.5 10.5l3.5 3.5 7.5-8'],
  dot: ['M10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  warning: ['M10 3.5 17.5 16.5H2.5z', 'M10 8v4', 'M10 14.2v.1'],
};

export function Icon({ name, size = 16 }) {
  const paths = PATHS[name] ?? PATHS.file;
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {paths.map((d, index) => <path key={index} d={d} />)}
    </svg>
  );
}
