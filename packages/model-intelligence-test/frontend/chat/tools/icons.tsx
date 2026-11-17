/** Product icon subset of the DSH icon set, inlined instead of sprite-referenced.

    Geometry, viewBox, stroke colour and default sizes are copied verbatim from
    ui-primitives/src/icons/artwork.ts; the sprite `<use>` indirection is dropped
    because this plugin cannot publish the Host's icon sprite. */

import React from '../../runtime';

/** Shared props for every product icon component. */
export interface IconProps {
  /** Square edge in px; defaults to the glyph's own drawn size. */
  size?: number | undefined;
  /** Extra class for layout placement; color rides currentColor. */
  className?: string | undefined;
}

/** search-outline — 16px, regular 1px stroke. */
export function IconSearchOutlineRegular({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" strokeWidth={1} className={className} data-icon="dsw-icon-search-outline-regular" aria-hidden="true">
      <path d="M6.58727 11.8586C9.55061 11.8586 11.9529 9.45637 11.9529 6.49304C11.9529 3.5297 9.55061 1.12744 6.58727 1.12744C3.62394 1.12744 1.22168 3.5297 1.22168 6.49304C1.22168 9.45637 3.62394 11.8586 6.58727 11.8586Z" stroke="currentColor" />
      <path d="M10.2991 10.3933L14.7783 14.8725" stroke="currentColor" />
    </svg>
  );
}

/** browse-outline — 16px, regular 1px stroke. */
export function IconBrowseOutlineRegular({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" strokeWidth={1} className={className} data-icon="dsw-icon-browse-outline-regular" aria-hidden="true">
      <path d="M4.9375 5.90295H11.0625" stroke="currentColor" />
      <path d="M4.9375 9.02991H8.27841" stroke="currentColor" />
      <path d="M12.5 1.32617C13.3039 1.32617 14 1.95171 14 2.77637V13.2246C13.9996 14.0489 13.3036 14.6738 12.5 14.6738H3.5C2.69637 14.6738 2.00042 14.0489 2 13.2246V2.77637C2 1.95171 2.69613 1.32617 3.5 1.32617H12.5ZM3.5 2.32617C3.1993 2.32617 3 2.55186 3 2.77637V13.2246C3.00044 13.4489 3.19963 13.6738 3.5 13.6738H12.5C12.8004 13.6738 12.9996 13.4489 13 13.2246V2.77637C13 2.55186 12.8007 2.32617 12.5 2.32617H3.5Z" fill="currentColor" />
    </svg>
  );
}

/** edit-outline — 16px, regular 1px stroke. */
export function IconEditOutlineRegular({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" strokeWidth={1} className={className} data-icon="dsw-icon-edit-outline-regular" aria-hidden="true">
      <path d="M8.85596 2.69971H4.19971C3.37141 2.69971 2.69992 3.37146 2.69971 4.19971V11.8003C2.69992 12.6285 3.37141 13.3003 4.19971 13.3003H11.8003C12.6283 13.2999 13.3001 12.6283 13.3003 11.8003V7.89893H14.3003V11.8003C14.3001 13.1806 13.1806 14.2999 11.8003 14.3003H4.19971C2.81913 14.3003 1.69992 13.1808 1.69971 11.8003V4.19971C1.69992 2.81918 2.81913 1.69971 4.19971 1.69971H8.85596V2.69971Z" fill="currentColor" />
      <path d="M7.7849 8.23878L13.888 2.13574" stroke="currentColor" />
    </svg>
  );
}

/** code-outline — 16px, regular 1px stroke. */
export function IconCodeOutlineRegular({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" strokeWidth={1} className={className} data-icon="dsw-icon-code-outline-regular" aria-hidden="true">
      <path d="M6.27612 1.5L4.52612 14.5" stroke="currentColor" />
      <path d="M11.4739 1.5L9.72388 14.5" stroke="currentColor" />
      <path d="M2.39868 5.5H14.0681" stroke="currentColor" />
      <path d="M1.93188 10.5H13.6013" stroke="currentColor" />
    </svg>
  );
}

/** api-outline — 14px, regular 1px stroke. */
export function IconApiOutlineRegular({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" strokeWidth={1} className={className} data-icon="dsw-icon-api-outline-regular" aria-hidden="true">
      <path d="M3 4L7 8L3 12" stroke="currentColor" />
      <path d="M9 12H13" stroke="currentColor" />
    </svg>
  );
}

/** sparkle — 16px, regular 1px stroke. */
export function IconSparkleRegular({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" strokeWidth={1} className={className} data-icon="dsw-icon-sparkle-regular" aria-hidden="true">
      <path d="M5.875 3C5.875 6.33333 7.54167 8 10.875 8C7.54167 8 5.875 9.66667 5.875 13C5.875 9.66667 4.20833 8 0.875 8C4.20833 8 5.875 6.33333 5.875 3Z" stroke="currentColor" />
      <path d="M12.375 1.55823C12.375 3.39156 13.2917 4.30823 15.125 4.30823C13.2917 4.30823 12.375 5.22489 12.375 7.05823C12.375 5.22489 11.4583 4.30823 9.625 4.30823C11.4583 4.30823 12.375 3.39156 12.375 1.55823Z" stroke="currentColor" />
      <path d="M12.375 10.4418C12.375 11.7751 13.0417 12.4418 14.375 12.4418C13.0417 12.4418 12.375 13.1084 12.375 14.4418C12.375 13.1084 11.7083 12.4418 10.375 12.4418C11.7083 12.4418 12.375 11.7751 12.375 10.4418Z" stroke="currentColor" />
    </svg>
  );
}

/** chevron-down-outline — 14px, regular 1px stroke. */
export function IconChevronDownOutlineRegular({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" strokeWidth={1} className={className} data-icon="dsw-icon-chevron-down-outline-regular" aria-hidden="true">
      <path d="M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6" stroke="currentColor" />
    </svg>
  );
}

/** chevron-up-outline — 14px, regular 1px stroke. */
export function IconChevronUpOutlineRegular({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" strokeWidth={1} className={className} data-icon="dsw-icon-chevron-up-outline-regular" aria-hidden="true">
      <path d="M12 10L8.70711 6.70711C8.31658 6.31658 7.68342 6.31658 7.29289 6.70711L4 10" stroke="currentColor" />
    </svg>
  );
}

/** inspect-outline — 12px, regular 1px stroke. */
export function IconInspectOutlineRegular({ size = 12, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" strokeWidth={1} className={className} data-icon="dsw-icon-inspect-outline-regular" aria-hidden="true">
      <path d="M4.67398 4.25061L1.36094 7.86484C1.29085 7.9413 1.29085 8.05866 1.36094 8.13513L4.67398 11.7494" stroke="currentColor" />
      <path d="M11.3262 4.25061L14.6392 7.86484C14.7093 7.9413 14.7093 8.05866 14.6392 8.13513L11.3262 11.7494" stroke="currentColor" />
      <path d="M9.56222 3.62573L6.43774 12.3743" stroke="currentColor" />
    </svg>
  );
}
