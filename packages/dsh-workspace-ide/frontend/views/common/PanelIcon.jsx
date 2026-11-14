/** The sidebar's Workspace entry icon; the sidebar owns the button and label. */
export function PanelIcon({ size }) {
  const edge = size || 20;
  return (
    <svg width={edge} height={edge} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="3.5" width="15" height="13" rx="1.5" />
      <path d="M7.5 3.5v13" />
      <path d="M4.6 6.4h1.4M4.6 9h1.4" />
    </svg>
  );
}
