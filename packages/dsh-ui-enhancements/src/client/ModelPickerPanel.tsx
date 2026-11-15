import React from './runtime'
import { fuzzyRank } from './fuzzy'
import { useDismissablePopover } from './useDismissablePopover'
import type { CatalogProvider } from '../shared/contract'

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
  onClose: () => void
  onRefresh: () => void
  onSelect: (option: ModelOption) => void
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
  onClose,
  onRefresh,
  onSelect,
}: ModelPickerPanelProps): React.ReactElement | null {
  const [query, setQuery] = React.useState('')
  const [category, setCategory] = React.useState('all')
  const [activeIndex, setActiveIndex] = React.useState(0)
  const [anchor, setAnchor] = React.useState<AnchorRect>(() => measureAnchor(null))

  const rootRef = useDismissablePopover(open, onClose)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
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

  React.useEffect(() => {
    setActiveIndex(0)
  }, [query, category, open])

  if (!open) return null

  const pick = (option: ModelOption) => {
    onSelect(option)
    onClose()
  }

  return (
    <div
      ref={rootRef}
      className="dsh-enh-mp-popover"
      role="dialog"
      aria-label="模型选择面板"
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
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActiveIndex((idx) => (visible.length ? (idx + 1) % visible.length : 0))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActiveIndex((idx) =>
                visible.length ? (idx - 1 + visible.length) % visible.length : 0,
              )
            } else if (event.key === 'Enter' && visible[activeIndex]) {
              event.preventDefault()
              pick(visible[activeIndex].item)
            }
          }}
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
        <nav className="dsh-enh-mp-sidebar" aria-label="模型提供商">
          <button
            type="button"
            className={category === 'all' ? 'is-active' : ''}
            onClick={() => setCategory('all')}
          >
            <span className="dsh-enh-mp-sidebar-label">全部</span>
            <span className="dsh-enh-mp-sidebar-count">{allOptions.length}</span>
          </button>
          {providers.map((provider) => (
            <button
              type="button"
              key={provider.id}
              className={category === provider.id ? 'is-active' : ''}
              onClick={() => setCategory(provider.id)}
              title={provider.error || provider.name}
            >
              <span className="dsh-enh-mp-sidebar-label">{provider.name}</span>
              <span className="dsh-enh-mp-sidebar-count">{provider.models.length}</span>
            </button>
          ))}
        </nav>

        <div className="dsh-enh-mp-list" role="listbox" aria-label="可用模型">
          {loading && allOptions.length === 0 ? (
            <p className="dsh-enh-mp-empty">正在加载模型目录…</p>
          ) : error && allOptions.length === 0 ? (
            <p className="dsh-enh-mp-empty">{error}</p>
          ) : visible.length === 0 ? (
            <p className="dsh-enh-mp-empty">没有匹配的模型</p>
          ) : (
            visible.map(({ item, positions }, index) => {
              const active = selectedKey === item.value
              const highlighted = index === activeIndex
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  key={item.value}
                  className={`dsh-enh-mp-option ${active ? 'is-selected' : ''} ${highlighted ? 'is-highlighted' : ''}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => pick(item)}
                >
                  <span className="dsh-enh-mp-check" aria-hidden="true">
                    {active && (
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
        <span>↑↓ 选择 · Enter 确认 · Esc 关闭</span>
        <span>{category === 'all' ? '全部提供商' : providers.find((p) => p.id === category)?.name ?? category}</span>
      </div>
    </div>
  )
}
