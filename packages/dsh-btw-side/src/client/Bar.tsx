/**
 * BTW dock bar. Session-scoped list entry above the composer: renders nothing
 * while idle, a 36px strip while collapsed, and the expanded panel when a run
 * starts. Expansion is remembered per session in localStorage.
 */
import React from './runtime'
import { useSnapshot } from './runtime'
import type { BtwSessionStore } from './store'
import { isRunning } from './store'
import type { Translate } from './i18n'
import { BtwPanel } from './Panel'

export interface BtwBarProps {
  sessionId: string
  store: BtwSessionStore
  t: Translate
}

function excerpt(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}

export function BtwBar(props: BtwBarProps): React.ReactElement | null {
  const snapshot = useSnapshot(props.store)
  const questions = snapshot.questions.filter((question) => !props.store.isHidden(question.requestId))
  if (questions.length === 0) return null

  const running = questions.some((question) => isRunning(question.phase))
  const latest = questions[questions.length - 1]

  if (snapshot.expanded) {
    return (
      <div className="btw-side-bar" data-expanded="true">
        <BtwPanel store={props.store} snapshot={snapshot} questions={questions} t={props.t} />
      </div>
    )
  }

  return (
    <div
      className="btw-side-bar"
      data-expanded="false"
      onClick={() => {
        props.store.setExpanded(true)
      }}
    >
      <div className="btw-side-strip" data-running={running ? 'true' : 'false'}>
        <span className="btw-side-dot" aria-hidden="true" />
        <span className="btw-side-title">{props.t('bar.title')}</span>
        <span className="btw-side-excerpt" title={latest.question}>
          {excerpt(latest.question, 60)}
        </span>
        {running ? (
          <span className="btw-side-live" aria-live="polite">
            {latest.phase === 'thinking' ? props.t('card.thinking') : props.t('bar.streaming')}
          </span>
        ) : null}
        <span className="btw-side-count">{props.t('bar.count', { count: questions.length })}</span>
        <button
          type="button"
          className="btw-side-link"
          title={props.t('bar.expand')}
          aria-label={props.t('bar.expand')}
          onClick={(event) => {
            event.stopPropagation()
            props.store.setExpanded(true)
          }}
        >
          {props.t('bar.expand')}
        </button>
      </div>
    </div>
  )
}
