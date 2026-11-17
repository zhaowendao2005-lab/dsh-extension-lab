import React from '../../runtime'
import type { HTMLAttributes } from 'react'
import { createPortal } from './react-dom'
import { IconCloseOutlineRegular } from './icons/index'
/** Lightbox strings the owner resolves from its own locale namespace. */
export interface ImageLightboxLabels {
  /** Accessible name of the preview dialog. */
  dialog: string
  /** Accessible label of the close control. */
  close: string
}

/**
 * Document-level original-image preview opened by clicking a thumbnail.
 * Closes on Escape, backdrop press, or the close control, and restores focus
 * to the opener on unmount. Rendered through a body portal: an opener inside
 * a transformed or filtered ancestor would otherwise trap the fixed backdrop
 * in that ancestor's box instead of covering the viewport.
 *
 * @param props.src - the original image URL.
 * @param props.alt - the image's alt text.
 * @param props.labels - dialog and close-control strings.
 * @param props.contextMenuProps - optional original-image gesture bindings.
 * @param props.onClose - dismiss callback owned by the opener.
 * @returns the modal preview dialog.
 */
export function ImageLightbox({ src, alt, labels, onClose, contextMenuProps }: {
  src: string
  alt: string
  labels: ImageLightboxLabels
  onClose: () => void
  contextMenuProps?: Pick<HTMLAttributes<HTMLElement>, 'onContextMenu' | 'onKeyDown' | 'tabIndex'> | undefined
}) {
  const closeRef = React.useRef<HTMLButtonElement | null>(null)
  const restoreRef = React.useRef<HTMLElement | null>(null)

  React.useEffect(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      // A portaled image menu owns Escape and Tab until it returns focus.
      if (event.defaultPrevented || document.activeElement?.closest('[role="menu"]')) return
      if (event.key === 'Escape') { event.stopPropagation(); onClose() }
      if (event.key === 'Tab') { event.preventDefault(); closeRef.current?.focus() }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      restoreRef.current?.focus()
    }
  }, [onClose])

  return createPortal(
    <div
      className={'mit-chat-md-backdrop'}
      role="dialog"
      aria-modal="true"
      aria-label={labels.dialog}
    >
      <div className={'mit-chat-md-stage'}>
        <div className={'mit-chat-md-mask'} aria-hidden="true" onMouseDown={onClose} />
        <img className={'mit-chat-md-image'} src={src} alt={alt} {...contextMenuProps} />
        <button ref={closeRef} type="button" className={'mit-chat-md-close'} aria-label={labels.close} onClick={onClose}>
          <IconCloseOutlineRegular size={16} />
        </button>
      </div>
    </div>,
    document.body,
  )
}
