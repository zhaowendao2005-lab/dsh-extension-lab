/** One side-ask card: question, streaming answer, error, provenance, actions. */
import React from './runtime'
import type { ClientQuestionView } from './store'
import { copyText, isRunning } from './store'
import type { Translate } from './i18n'

export interface BtwCardProps {
  view: ClientQuestionView
  t: Translate
  onRetry(question: string): void
  onCancel(requestId: string): void
  onRemove(requestId: string): void
}

function clock(ts: number | undefined): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return ''
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function errorText(t: Translate, code: string, fallback: string): string {
  const key = `error.${code}`
  const text = t(key)
  return text === key || text === '' ? fallback : text
}

export function BtwCard(props: BtwCardProps): React.ReactElement {
  const { view, t } = props
  const [copied, setCopied] = React.useState(false)
  const running = isRunning(view.phase)
  const waiting = view.phase === 'queued' || view.phase === 'calling' || view.phase === 'thinking'

  const copy = (): void => {
    void copyText(view.answer).then((ok) => {
      setCopied(ok)
      if (ok) setTimeout(() => setCopied(false), 1500)
    })
  }

  const provenance = view.provenance
  const provenanceText =
    provenance === undefined
      ? ''
      : [
          t('card.provenance', {
            model: provenance.model,
            count: provenance.messageCount,
            time: clock(provenance.capturedAt),
          }),
          provenance.degraded === true || provenance.reason === 'reconstructed'
            ? `· ${t('card.provenance.reconstructed')}`
            : '',
        ]
          .filter((part) => part !== '')
          .join(' ')

  return (
    <article
      className="btw-side-card"
      data-phase={view.phase}
      aria-busy={running}
      aria-label={t('card.aria')}
    >
      <div className="btw-side-card-question" title={view.question}>
        {view.question}
      </div>
      <div className="btw-side-card-answer">
        {waiting ? <span className="btw-side-muted">{view.phase === 'queued' ? t('card.waiting') : t('card.thinking')}</span> : null}
        {view.answer !== '' ? <span className="btw-side-answer-text">{view.answer}</span> : null}
        {running && view.answer !== '' ? (
          <span className="btw-side-cursor" aria-hidden="true">
            ▍
          </span>
        ) : null}
        {view.phase === 'cancelled' ? <span className="btw-side-muted">{t('card.cancelled')}</span> : null}
        {view.phase === 'error' && view.error !== undefined ? (
          <span className="btw-side-error">
            {errorText(t, view.error.code, view.error.message)}
          </span>
        ) : null}
      </div>
      {provenanceText !== '' ? (
        <div className="btw-side-card-meta">
          <span className="btw-side-provenance" title={provenanceText}>
            {provenanceText}
          </span>
          {view.usage?.totalTokens !== undefined ? (
            <span className="btw-side-muted">{t('card.usage', { tokens: view.usage.totalTokens })}</span>
          ) : null}
        </div>
      ) : null}
      <div className="btw-side-card-actions">
        <button
          type="button"
          className="btw-side-link"
          title={t('card.copy')}
          aria-label={t('card.copy')}
          disabled={view.answer === ''}
          onClick={copy}
        >
          {copied ? t('card.copied') : t('card.copy')}
        </button>
        <button
          type="button"
          className="btw-side-link"
          title={t('card.retry')}
          aria-label={t('card.retry')}
          onClick={() => {
            props.onRetry(view.question)
          }}
        >
          {t('card.retry')}
        </button>
        {running ? (
          <button
            type="button"
            className="btw-side-link"
            title={t('card.cancel')}
            aria-label={t('card.cancel')}
            onClick={() => {
              props.onCancel(view.requestId)
            }}
          >
            {t('card.cancel')}
          </button>
        ) : (
          <button
            type="button"
            className="btw-side-link"
            title={t('card.remove')}
            aria-label={t('card.remove')}
            onClick={() => {
              props.onRemove(view.requestId)
            }}
          >
            {t('card.remove')}
          </button>
        )}
      </div>
    </article>
  )
}
