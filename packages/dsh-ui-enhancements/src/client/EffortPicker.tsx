import React from './runtime'
import type { CatalogReasoningEffort } from '../shared/contract'

export interface EffortPickerProps {
  /** Thinking levels reported by the model adapter, lowest first. */
  efforts: CatalogReasoningEffort[]
  /** Currently effective level id. */
  value?: string
  /** Levels are being resolved for this model. */
  loading?: boolean
  /** The adapter lookup failed; levels are unknown, not absent. */
  error?: string
  /** Shown in place of the rail when the model cannot think. */
  emptyLabel: string
  onChange: (id: string) => void
}

/**
 * Thinking-level rail shown under a model row after the first confirm.
 *
 * Mirrors the host's own effort control: a dot per level on one rail, the level
 * names under their dots, and the active level's description below. Left/right
 * arrow keys are handled by the panel so the rail itself stays a plain,
 * pointer-friendly control.
 */
export function EffortPicker({
  efforts,
  value,
  loading = false,
  error,
  emptyLabel,
  onChange,
}: EffortPickerProps): React.ReactElement {
  const index = efforts.findIndex((effort) => effort.id === value)
  const activeIndex = index >= 0 ? index : 0
  const active = efforts[activeIndex]
  const count = Math.max(efforts.length, 1)
  const interactive = efforts.length > 0 && !loading

  const step = (delta: number): void => {
    const next = Math.min(efforts.length - 1, Math.max(0, activeIndex + delta))
    if (next !== activeIndex) onChange(efforts[next].id)
  }

  const placeholder = loading
    ? '正在读取思考级别…'
    : error
      ? '无法读取思考级别'
      : emptyLabel

  return (
    <div className="dsh-enh-mp-effort" role="group" aria-label="思考级别">
      <div className="dsh-enh-mp-effort-head">
        <span className="dsh-enh-mp-effort-title">Effort</span>
        <button
          type="button"
          className="dsh-enh-mp-effort-nav"
          aria-label="降低思考级别"
          disabled={!interactive || activeIndex <= 0}
          onClick={() => step(-1)}
        >
          <svg width="9" height="10" viewBox="0 0 9 10" fill="currentColor" aria-hidden="true">
            <path d="M8 0.5 1.2 5 8 9.5Z" />
          </svg>
        </button>
        <div className="dsh-enh-mp-effort-track">
          {efforts.length === 0 ? (
            <p className="dsh-enh-mp-effort-empty" title={error || undefined}>
              {placeholder}
            </p>
          ) : (
            <>
              <div
                className="dsh-enh-mp-effort-rail"
                style={{ ['--mp-effort-count' as string]: count }}
              >
                <span className="dsh-enh-mp-effort-line" aria-hidden="true" />
                {efforts.map((effort, dotIndex) => (
                  <button
                    type="button"
                    key={effort.id}
                    className={`dsh-enh-mp-effort-dot-wrap ${dotIndex === activeIndex ? 'is-active' : ''}`}
                    aria-label={effort.name}
                    aria-pressed={dotIndex === activeIndex}
                    onClick={() => onChange(effort.id)}
                  >
                    <span className="dsh-enh-mp-effort-dot" aria-hidden="true" />
                  </button>
                ))}
              </div>
              <div className="dsh-enh-mp-effort-names">
                {efforts.map((effort, nameIndex) => (
                  <span
                    key={effort.id}
                    className={nameIndex === activeIndex ? 'is-active' : ''}
                    title={effort.description || effort.name}
                  >
                    {effort.name}
                  </span>
                ))}
              </div>
              <p className="dsh-enh-mp-effort-desc">
                {active?.description || '使用 ← → 调整思考级别'}
              </p>
            </>
          )}
        </div>
        <button
          type="button"
          className="dsh-enh-mp-effort-nav"
          aria-label="提高思考级别"
          disabled={!interactive || activeIndex >= efforts.length - 1}
          onClick={() => step(1)}
        >
          <svg width="9" height="10" viewBox="0 0 9 10" fill="currentColor" aria-hidden="true">
            <path d="M1 0.5 7.8 5 1 9.5Z" />
          </svg>
        </button>
      </div>
    </div>
  )
}
