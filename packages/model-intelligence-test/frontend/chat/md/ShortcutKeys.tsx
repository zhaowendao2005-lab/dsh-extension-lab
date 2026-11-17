/** Shared shortcut keycaps; callers supply the effective platform presentation. */
import React from '../../runtime'
import clsx from 'clsx'
/**
 * Render one command's keycaps without owning binding defaults or localized copy.
 * @param props - effective key labels, presentation variant and optional interaction styling.
 * @returns unboxed keys by default, or tooltip keycaps with plus-separated combinations grouped together.
 */
export function ShortcutKeys({ keys, variant = 'plain', className }: { keys: readonly string[]; variant?: 'plain' | 'tooltip'; className?: string | undefined }) {
  return <span className={clsx('mit-chat-md-keys', variant === 'tooltip' && 'mit-chat-md-tooltip', variant === 'tooltip' && keys.includes('+') && 'mit-chat-md-joined', className)}>{keys.map((key, index) => <kbd key={index} className={key === '+' ? 'mit-chat-md-separator' : 'mit-chat-md-key'}>{key}</kbd>)}</span>
}
