/** Passive, contained image preview for Markdown image links. */
import React from '../../runtime'
import { IconLoadingOutlineRegular } from './icons/index'
/**
 * Render an image without introducing a second activation target.
 * @param props - Source, accessible description, localized status.
 * @returns A contained preview with loading or failure status.
 */
export function ImagePreview({ src, alt, loadingLabel, failedLabel }: {
  src: string
  alt: string
  loadingLabel: string
  failedLabel: string
}) {
  return <Preview key={src} src={src} alt={alt} loadingLabel={loadingLabel} failedLabel={failedLabel} />
}

function Preview({ src, alt, loadingLabel, failedLabel }: {
  src: string
  alt: string
  loadingLabel: string
  failedLabel: string
}) {
  const [state, setState] = React.useState<'loading' | 'ready' | 'failed'>('loading')
  return <span className={'mit-chat-md-frame'}>
    {state !== 'failed' && <img src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer"
      className={'mit-chat-md-image'} data-ready={state === 'ready' || undefined}
      onLoad={() => { setState('ready') }} onError={() => { setState('failed') }} />}
    {state !== 'ready' && <span className={'mit-chat-md-status'} role="status">
      {state === 'loading' && <IconLoadingOutlineRegular size={16} />}
      <span>{state === 'loading' ? loadingLabel : failedLabel}</span>
    </span>}
  </span>
}
