/** Expanded BTW panel: header actions plus the scrolling list of side-ask cards. */
import React from './runtime'
import type { ClientQuestionView, BtwSessionStore, BtwSnapshot } from './store'
import type { Translate } from './i18n'
import { BtwCard } from './Card'
import { isRunning } from './store'

export interface BtwPanelProps {
  store: BtwSessionStore
  snapshot: BtwSnapshot
  questions: readonly ClientQuestionView[]
  t: Translate
}

export function BtwPanel(props: BtwPanelProps): React.ReactElement {
  const { store, snapshot, questions, t } = props
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const lastLength = questions.length === 0 ? 0 : questions[questions.length - 1].answer.length
  const running = questions.some((question) => isRunning(question.phase))

  React.useEffect(() => {
    const element = scrollRef.current
    if (element !== null) element.scrollTop = element.scrollHeight
  }, [questions.length, lastLength])

  return (
    <div
      className="btw-side-panel"
      role="region"
      aria-label={t('bar.heading')}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          store.setExpanded(false)
        }
      }}
    >
      <div className="btw-side-header">
        <span className="btw-side-heading">{t('bar.heading')}</span>
        <span className="btw-side-spacer" />
        {snapshot.status === 'reconnecting' ? (
          <span className="btw-side-muted" role="status">
            {t('bar.reconnecting')}
          </span>
        ) : null}
        <button
          type="button"
          className="btw-side-action"
          title={t('bar.clear')}
          aria-label={t('bar.clear')}
          onClick={() => {
            void store.clear()
          }}
        >
          {t('bar.clear')}
        </button>
        <button
          type="button"
          className="btw-side-action"
          title={t('bar.collapse')}
          aria-label={t('bar.collapse')}
          onClick={() => {
            store.setExpanded(false)
          }}
        >
          {t('bar.collapse')}
        </button>
      </div>
      <div className="btw-side-scroll" ref={scrollRef} aria-busy={running}>
        {questions.map((view) => (
          <BtwCard
            key={view.requestId}
            view={view}
            t={t}
            onRetry={(question) => {
              void store.retry(question)
            }}
            onCancel={(requestId) => {
              void store.cancel(requestId)
            }}
            onRemove={(requestId) => {
              store.hide(requestId)
            }}
          />
        ))}
      </div>
      {snapshot.notice !== undefined ? (
        <div className="btw-side-error-line" role="status">
          {t('bar.notice')}
        </div>
      ) : null}
    </div>
  )
}
