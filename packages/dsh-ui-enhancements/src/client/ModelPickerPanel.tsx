import React from './runtime'
import { fuzzyRank } from './fuzzy'
import { useDismissablePopover, type DismissReason } from './useDismissablePopover'
import { EffortPicker } from './EffortPicker'
import type {
  CatalogProvider,
  CatalogReasoningEffort,
  CatalogReasoningResult,
} from '../shared/contract'

export interface ModelOption {
  value: string
  providerId: string
  providerName: string
  modelId: string
  label: string
  hint: string
  searchText: string
}

export interface ModelPickerPanelProps {
  open: boolean
  providers: CatalogProvider[]
  loading: boolean
  error?: string
  selectedKey?: string
  /** Last level chosen per `provider:model`, persisted across openings. */
  effortByModel: Record<string, string>
  /** Thinking levels resolved lazily per `provider:model`. */
  reasoningByModel: Record<string, CatalogReasoningResult | 'loading'>
  onClose: (reason: DismissReason) => void
  onRefresh: () => void
  onEffortChange: (modelValue: string, effortId: string) => void
  /** Ask the owner to resolve one model's thinking levels. */
  onNeedReasoning: (option: ModelOption) => void
  /** Committing a choice; the owner closes the panel and restores focus. */
  onSelect: (option: ModelOption, effortId?: string) => void
}

interface AnchorRect {
  left: number
  width: number
  bottom: number
}

const LIST_LIMIT = 240

function Highlight({ text, positions }: { text: string; positions: number[] }) {
  if (!positions.length) return <>{text}</>
  const marks = new Set(positions)
  const parts: { text: string; hit: boolean }[] = []
  for (let index = 0; index < text.length; index += 1) {
    const hit = marks.has(index)
    const last = parts[parts.length - 1]
    if (last && last.hit === hit) last.text += text[index]
    else parts.push({ text: text[index], hit })
  }
  return (
    <>
      {parts.map((part, index) =>
        part.hit ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>,
      )}
    </>
  )
}

function hasCardBoundary(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el)
  const borderWidth =
    parseFloat(style.borderTopWidth || '0') +
    parseFloat(style.borderLeftWidth || '0') +
    parseFloat(style.borderRightWidth || '0') +
    parseFloat(style.borderBottomWidth || '0')
  const radius = parseFloat(style.borderTopLeftRadius || '0')
  const hasShadow = Boolean(style.boxShadow && style.boxShadow !== 'none')
  return borderWidth > 0 || radius >= 8 || hasShadow
}

/**
 * Find the active conversation composer/input card so the model picker
 * matches its exact width and floats directly above it.
 */
function findComposerContainer(): HTMLElement | null {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      'textarea, [contenteditable="true"], [role="textbox"]',
    ),
  ).filter((el) => {
    if (el.closest('[role="dialog"], .dsh-enh-mp-popover')) return false
    const rect = el.getBoundingClientRect()
    return rect.width > 120 && rect.height > 16
  })

  const active = document.activeElement
  const input =
    (active instanceof HTMLElement && candidates.includes(active) ? active : null) ??
    candidates.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0] ??
    null
  if (!input) return null

  // Walk up from the bare input to the rounded/bordered composer card, then stop
  // before climbing into full-pane centering wrappers.
  let current: HTMLElement | null = input
  let best: HTMLElement = input
  const inputWidth = input.getBoundingClientRect().width
  for (let depth = 0; depth < 8 && current?.parentElement; depth += 1) {
    const parent: HTMLElement = current.parentElement
    if (parent === document.body || parent.tagName === 'MAIN') break
    const rect = parent.getBoundingClientRect()
    if (rect.width < inputWidth || rect.width > window.innerWidth * 0.95 || rect.height > 360) {
      break
    }
    if (hasCardBoundary(parent)) {
      best = parent
      break
    }
    if (rect.width - inputWidth <= 120) {
      best = parent
    }
    current = parent
  }
  return best
}

function measureAnchor(el: HTMLElement | null): AnchorRect {
  if (!el) {
    const width = Math.min(720, Math.max(320, window.innerWidth - 48))
    return {
      left: Math.round((window.innerWidth - width) / 2),
      width,
      bottom: 84,
    }
  }
  const rect = el.getBoundingClientRect()
  return {
    left: Math.round(rect.left),
    width: Math.round(rect.width),
    bottom: Math.max(16, Math.round(window.innerHeight - rect.top + 8)),
  }
}

export function ModelPickerPanel({
  open,
  providers,
  loading,
  error,
  selectedKey,
  effortByModel,
  reasoningByModel,
  onClose,
  onRefresh,
  onEffortChange,
  onNeedReasoning,
  onSelect,
}: ModelPickerPanelProps): React.ReactElement | null {
  const [query, setQuery] = React.useState('')
  const [category, setCategory] = React.useState('all')
  const [activeIndex, setActiveIndex] = React.useState(0)
  const [focusPane, setFocusPane] = React.useState<'sidebar' | 'list'>('list')
  const [anchor, setAnchor] = React.useState<AnchorRect>(() => measureAnchor(null))
  /** `provider:model` whose thinking-level row is open, awaiting the second confirm. */
  const [expanded, setExpanded] = React.useState<string | null>(null)

  const inputRef = React.useRef<HTMLInputElement>(null)
  const sidebarRef = React.useRef<HTMLElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)

  const collapse = (refocusSearch = false): void => {
    setExpanded(null)
    if (refocusSearch) {
      // Leaving the sub-mode returns focus to the search box, so left/right
      // switch panes again instead of changing the level.
      window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0)
    }
  }

  const rootRef = useDismissablePopover(open, onClose, () => {
    if (expanded === null) return false
    collapse(true)
    return true
  })

  React.useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
    setFocusPane('list')
    setExpanded(null)
    const target = findComposerContainer()
    const update = () => setAnchor(measureAnchor(target))
    update()

    const observer = target && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    if (target && observer) observer.observe(target)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)

    const focusTimer = setTimeout(() => inputRef.current?.focus(), 0)
    return () => {
      clearTimeout(focusTimer)
      observer?.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  const allOptions = React.useMemo<ModelOption[]>(() => {
    const list: ModelOption[] = []
    for (const provider of providers) {
      for (const model of provider.models) {
        const value = `${provider.id}:${model.id}`
        list.push({
          value,
          providerId: provider.id,
          providerName: provider.name,
          modelId: model.id,
          label: model.name,
          hint: model.id !== model.name ? model.id : provider.name,
          searchText: `${model.name} ${model.id} ${provider.name} ${provider.id}`,
        })
      }
    }
    return list
  }, [providers])

  const scoped = React.useMemo(
    () =>
      category !== 'all'
        ? allOptions.filter((option) => option.providerId === category)
        : allOptions,
    [allOptions, category],
  )

  const ranked = React.useMemo(
    () => (open ? fuzzyRank(scoped, query, (option) => option.label) : []),
    [open, scoped, query],
  )

  const visible = React.useMemo(() => ranked.slice(0, LIST_LIMIT), [ranked])

  const categories = React.useMemo(
    () => ['all', ...providers.map((provider) => provider.id)],
    [providers],
  )

  const reasoningEntry = (option: ModelOption): CatalogReasoningResult | 'loading' | undefined =>
    reasoningByModel[option.value]

  const effortsFor = (option: ModelOption): CatalogReasoningEffort[] => {
    const entry = reasoningEntry(option)
    return entry && entry !== 'loading' ? entry.efforts ?? [] : []
  }

  /**
   * Effective level for a model: the one last chosen, else the adapter default,
   * else the lowest level. Empty for models that cannot think.
   */
  const effortIdFor = (option: ModelOption): string | undefined => {
    const efforts = effortsFor(option)
    if (efforts.length === 0) return undefined
    const remembered = effortByModel[option.value]
    if (remembered && efforts.some((effort) => effort.id === remembered)) return remembered
    const entry = reasoningEntry(option)
    const preferred = entry && entry !== 'loading' ? entry.defaultEffort : undefined
    if (preferred && efforts.some((effort) => effort.id === preferred)) return preferred
    return efforts[0].id
  }

  const expand = (option: ModelOption, index: number): void => {
    setExpanded(option.value)
    setActiveIndex(index)
    setFocusPane('list')
    onNeedReasoning(option)
    // Move focus out of the search box: typing no longer edits the query and
    // the arrow keys belong to the level rail until Escape.
    window.setTimeout(() => listRef.current?.focus({ preventScroll: true }), 0)
  }

  const confirm = (option: ModelOption): void => {
    onSelect(option, effortIdFor(option))
  }

  /** One click behaves like one Enter: expand first, then commit. */
  const advance = (option: ModelOption, index: number): void => {
    if (expanded === option.value) {
      confirm(option)
      return
    }
    expand(option, index)
  }

  const stepEffort = (option: ModelOption | undefined, delta: number): void => {
    if (!option) return
    const efforts = effortsFor(option)
    if (efforts.length === 0) return
    const currentId = effortIdFor(option)
    const current = Math.max(
      0,
      efforts.findIndex((effort) => effort.id === currentId),
    )
    const next = Math.min(efforts.length - 1, Math.max(0, current + delta))
    if (next !== current) onEffortChange(option.value, efforts[next].id)
  }

  React.useEffect(() => {
    setActiveIndex(0)
    setExpanded(null)
  }, [query, category, open])

  React.useEffect(() => {
    if (!open) return
    const activeEl = sidebarRef.current?.querySelector<HTMLElement>('button.is-active')
    activeEl?.scrollIntoView?.({ block: 'nearest' })
  }, [open, category])

  React.useEffect(() => {
    if (!open || focusPane !== 'list') return
    const itemEl = listRef.current?.querySelector<HTMLElement>('.dsh-enh-mp-option.is-highlighted')
    itemEl?.scrollIntoView?.({ block: 'nearest' })
  }, [open, focusPane, activeIndex])

  // Keep the open level row on screen.
  React.useEffect(() => {
    if (!open || expanded === null) return
    const row = listRef.current?.querySelector<HTMLElement>('.dsh-enh-mp-effort-slot')
    row?.scrollIntoView?.({ block: 'nearest' })
  }, [open, expanded, effortByModel, reasoningByModel])

  // The expanded model can disappear from the filtered list.
  React.useEffect(() => {
    if (expanded === null) return
    if (!visible.some(({ item }) => item.value === expanded)) setExpanded(null)
  }, [expanded, visible])

  if (!open) return null

  const expandedIndex = expanded === null ? -1 : visible.findIndex(({ item }) => item.value === expanded)
  const expandedOption = expandedIndex >= 0 ? visible[expandedIndex].item : undefined
  const inEffort = expandedOption !== undefined

  const stepCategory = (delta: number) => {
    if (!categories.length) return
    const currentIdx = Math.max(0, categories.indexOf(category))
    const nextIdx = (currentIdx + delta + categories.length) % categories.length
    setCategory(categories[nextIdx])
  }

  const handlePanelKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const isInput = event.target === inputRef.current
    if (event.key === 'ArrowLeft') {
      if (inEffort) {
        event.preventDefault()
        stepEffort(expandedOption, -1)
        return
      }
      if (
        isInput &&
        inputRef.current &&
        (inputRef.current.selectionStart !== 0 || inputRef.current.selectionEnd !== 0)
      ) {
        return
      }
      if (focusPane !== 'sidebar') {
        event.preventDefault()
        setFocusPane('sidebar')
      }
      return
    }

    if (event.key === 'ArrowRight') {
      if (inEffort) {
        event.preventDefault()
        stepEffort(expandedOption, 1)
        return
      }
      if (
        isInput &&
        inputRef.current &&
        (inputRef.current.selectionStart !== query.length ||
          inputRef.current.selectionEnd !== query.length)
      ) {
        return
      }
      if (focusPane !== 'list') {
        event.preventDefault()
        setFocusPane('list')
      }
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (inEffort) {
        collapse()
        setActiveIndex((idx) => (visible.length ? (idx + 1) % visible.length : 0))
      } else if (focusPane === 'sidebar') {
        stepCategory(1)
      } else {
        setActiveIndex((idx) => (visible.length ? (idx + 1) % visible.length : 0))
      }
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (inEffort) {
        collapse()
        setActiveIndex((idx) => (visible.length ? (idx - 1 + visible.length) % visible.length : 0))
      } else if (focusPane === 'sidebar') {
        stepCategory(-1)
      } else {
        setActiveIndex((idx) => (visible.length ? (idx - 1 + visible.length) % visible.length : 0))
      }
      return
    }

    if (event.key === 'Enter') {
      if (focusPane === 'sidebar') {
        event.preventDefault()
        setFocusPane('list')
      } else if (inEffort) {
        event.preventDefault()
        confirm(expandedOption)
      } else if (visible[activeIndex]) {
        event.preventDefault()
        expand(visible[activeIndex].item, activeIndex)
      }
    }
  }

  const footerHint = inEffort
    ? (expandedOption && effortsFor(expandedOption).length > 0
        ? '←→ 调整思考级别 · Enter 确认 · Esc 返回'
        : 'Enter 确认 · Esc 返回')
    : '↑↓ 选择 · ←→ 切换栏 · Enter 确认 · Esc 关闭'

  return (
    <div
      ref={rootRef}
      className="dsh-enh-mp-popover"
      role="dialog"
      aria-label="模型选择面板"
      onKeyDown={handlePanelKeyDown}
      style={{
        left: `${anchor.left}px`,
        width: `${anchor.width}px`,
        bottom: `${anchor.bottom}px`,
      }}
    >
      <label className="dsh-enh-mp-search">
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="4.5" />
          <line x1="10.5" y1="10.5" x2="14" y2="14" />
        </svg>
        <input
          ref={inputRef}
          value={query}
          placeholder="模糊搜索模型，如 ds v3 / cl sonnet / gm pro"
          aria-label="模型模糊搜索"
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="dsh-enh-mp-total">{ranked.length}</span>
        <button
          type="button"
          className="dsh-enh-mp-refresh"
          title="刷新模型目录"
          aria-label="刷新模型目录"
          onClick={onRefresh}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M13.5 8a5.5 5.5 0 1 1-1.3-3.55" />
            <polyline points="13.5 2.5 13.5 5.5 10.5 5.5" />
          </svg>
        </button>
      </label>

      <div className="dsh-enh-mp-main">
        <nav
          ref={sidebarRef}
          className={`dsh-enh-mp-sidebar ${focusPane === 'sidebar' ? 'is-pane-focused' : ''}`}
          aria-label="模型提供商"
        >
          <button
            type="button"
            className={category === 'all' ? 'is-active' : ''}
            onClick={() => {
              setCategory('all')
              setFocusPane('list')
            }}
          >
            <span className="dsh-enh-mp-sidebar-label">全部</span>
            <span className="dsh-enh-mp-sidebar-count">{allOptions.length}</span>
          </button>
          {providers.map((provider) => (
            <button
              type="button"
              key={provider.id}
              className={category === provider.id ? 'is-active' : ''}
              onClick={() => {
                setCategory(provider.id)
                setFocusPane('list')
              }}
              title={provider.error || provider.name}
            >
              <span className="dsh-enh-mp-sidebar-label">{provider.name}</span>
              <span className="dsh-enh-mp-sidebar-count">{provider.models.length}</span>
            </button>
          ))}
        </nav>

        <div
          ref={listRef}
          className={`dsh-enh-mp-list ${focusPane === 'list' ? 'is-pane-focused' : ''}`}
          role="listbox"
          aria-label="可用模型"
          tabIndex={-1}
        >
          {loading && allOptions.length === 0 ? (
            <p className="dsh-enh-mp-empty">正在加载模型目录…</p>
          ) : error && allOptions.length === 0 ? (
            <p className="dsh-enh-mp-empty">{error}</p>
          ) : visible.length === 0 ? (
            <p className="dsh-enh-mp-empty">没有匹配的模型</p>
          ) : (
            visible.map(({ item, positions }, index) => {
              const active = selectedKey === item.value
              const pending = expanded === item.value
              const highlighted = index === activeIndex
              return (
                <React.Fragment key={item.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    aria-expanded={pending}
                    className={`dsh-enh-mp-option ${active ? 'is-selected' : ''} ${pending ? 'is-pending' : ''} ${highlighted ? 'is-highlighted' : ''}`}
                    onMouseEnter={() => {
                      if (expanded === null) setActiveIndex(index)
                    }}
                    onClick={() => advance(item, index)}
                  >
                    <span className="dsh-enh-mp-check" aria-hidden="true">
                      {(active || pending) && (
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 12 12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <polyline points="2.5 6 5 8.5 9.5 3.5" />
                        </svg>
                      )}
                    </span>
                    <span className="dsh-enh-mp-label">
                      <Highlight text={item.label} positions={positions} />
                    </span>
                    <span className="dsh-enh-mp-hint">{item.hint}</span>
                  </button>
                  {pending && (
                    <div
                      className="dsh-enh-mp-effort-slot"
                      role="presentation"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <EffortPicker
                        efforts={effortsFor(item)}
                        loading={reasoningEntry(item) === 'loading'}
                        error={
                          reasoningEntry(item) && reasoningEntry(item) !== 'loading'
                            ? (reasoningEntry(item) as CatalogReasoningResult).error
                            : undefined
                        }
                        value={effortIdFor(item)}
                        emptyLabel="无法思考 · 此模型不支持思考级别"
                        onChange={(effortId) => onEffortChange(item.value, effortId)}
                      />
                    </div>
                  )}
                </React.Fragment>
              )
            })
          )}
          {ranked.length > LIST_LIMIT && (
            <p className="dsh-enh-mp-more">
              另有 {ranked.length - LIST_LIMIT} 项，请继续输入缩小范围
            </p>
          )}
        </div>
      </div>

      <div className="dsh-enh-mp-footer">
        <span>{footerHint}</span>
        <span>{category === 'all' ? '全部提供商' : providers.find((p) => p.id === category)?.name ?? category}</span>
      </div>
    </div>
  )
}
