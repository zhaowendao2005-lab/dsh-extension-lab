export interface ParsedShortcut {
  mod: boolean
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
  code: string
}

const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)

const MODIFIER_CODES = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
])

function normalizeKeyToken(token: string): string {
  const upper = token.trim().toUpperCase()
  if (/^[A-Z]$/.test(upper)) return `Key${upper}`
  if (/^[0-9]$/.test(upper)) return `Digit${upper}`
  const trimmed = token.trim()
  if (/^Key[A-Z]$/i.test(trimmed)) return `Key${trimmed.slice(3).toUpperCase()}`
  if (/^Digit[0-9]$/i.test(trimmed)) return `Digit${trimmed.slice(5)}`
  if (trimmed.toLowerCase() === 'space') return 'Space'
  if (trimmed.toLowerCase() === 'slash' || trimmed === '/') return 'Slash'
  if (trimmed.toLowerCase() === 'backquote' || trimmed === '`') return 'Backquote'
  return trimmed
}

function codeToDisplay(code: string): string {
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code === 'Space') return 'Space'
  if (code === 'Slash') return '/'
  if (code === 'Backquote') return '`'
  return code
}

export function parseShortcut(spec: string): ParsedShortcut | null {
  if (!spec || typeof spec !== 'string') return null
  const parts = spec
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return null

  let mod = false
  let ctrl = false
  let meta = false
  let alt = false
  let shift = false
  let code = ''

  for (const part of parts) {
    const low = part.toLowerCase()
    if (low === 'mod' || low === 'primary' || low === 'cmdorctrl') mod = true
    else if (low === 'ctrl' || low === 'control') ctrl = true
    else if (low === 'meta' || low === 'cmd' || low === 'command' || low === 'super') meta = true
    else if (low === 'alt' || low === 'option' || low === 'opt') alt = true
    else if (low === 'shift') shift = true
    else code = normalizeKeyToken(part)
  }

  if (!code) return null
  return { mod, ctrl, meta, alt, shift, code }
}

export function formatShortcutFromEvent(event: KeyboardEvent): string | null {
  if (MODIFIER_CODES.has(event.code) || !event.code) return null
  const tokens: string[] = []
  const primaryPressed = IS_MAC ? event.metaKey : event.ctrlKey
  if (primaryPressed) tokens.push('Mod')
  if (IS_MAC && event.ctrlKey) tokens.push('Ctrl')
  if (!IS_MAC && event.metaKey) tokens.push('Meta')
  if (event.altKey) tokens.push('Alt')
  if (event.shiftKey) tokens.push('Shift')
  tokens.push(codeToDisplay(event.code))
  return tokens.join('+')
}

export function matchesShortcut(event: KeyboardEvent, spec: string): boolean {
  const parsed = parseShortcut(spec)
  if (!parsed) return false
  if (event.code !== parsed.code) return false

  const wantMeta = parsed.meta || (parsed.mod && IS_MAC)
  const wantCtrl = parsed.ctrl || (parsed.mod && !IS_MAC)

  return (
    event.metaKey === wantMeta &&
    event.ctrlKey === wantCtrl &&
    event.altKey === parsed.alt &&
    event.shiftKey === parsed.shift
  )
}

export function toDshBinding(spec: string): { code: string; modifiers: string[] } | null {
  const parsed = parseShortcut(spec)
  if (!parsed) return null
  const modifiers: string[] = []
  if (parsed.mod) modifiers.push('primary')
  if (parsed.ctrl) modifiers.push('control')
  if (parsed.meta) modifiers.push('meta')
  if (parsed.alt) modifiers.push('alt')
  if (parsed.shift) modifiers.push('shift')
  return { code: parsed.code, modifiers }
}

function isActiveWorkbenchScopeNode(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false
  const el = node as Element
  return (
    typeof el.getAttribute === 'function' &&
    el.hasAttribute('data-dsh-workbench-scope') &&
    el.getAttribute('data-dsh-workbench-active') === 'true'
  )
}

function getDeepActiveElement(root: Document | ShadowRoot | null): Element | null {
  if (!root) return null
  const active = root.activeElement ?? null
  if (active && active.shadowRoot?.activeElement) {
    return getDeepActiveElement(active.shadowRoot)
  }
  return active
}

function isNodeInsideActiveWorkbenchScope(node: Node | null): boolean {
  let cur: Node | null = node
  while (cur) {
    if (isActiveWorkbenchScopeNode(cur)) return true
    if (cur.parentNode) {
      cur = cur.parentNode
    } else if (typeof ShadowRoot !== 'undefined' && cur instanceof ShadowRoot) {
      cur = cur.host
    } else {
      cur = null
    }
  }
  return false
}

export function isFocusInWorkbenchScope(): boolean {
  if (typeof document === 'undefined') return false
  return isNodeInsideActiveWorkbenchScope(getDeepActiveElement(document))
}

export function forwardShortcutToFocusedWorkbench(spec: string): void {
  if (typeof document === 'undefined' || typeof KeyboardEvent === 'undefined') return
  const target = getDeepActiveElement(document)
  if (!target || !isNodeInsideActiveWorkbenchScope(target)) return
  const parsed = parseShortcut(spec)
  if (!parsed) return
  const key = parsed.code.startsWith('Key')
    ? (parsed.shift ? parsed.code.slice(3).toUpperCase() : parsed.code.slice(3).toLowerCase())
    : parsed.code
  const ev = new KeyboardEvent('keydown', {
    key,
    code: parsed.code,
    ctrlKey: parsed.ctrl || (parsed.mod && !IS_MAC),
    metaKey: parsed.meta || (parsed.mod && IS_MAC),
    altKey: parsed.alt,
    shiftKey: parsed.shift,
    bubbles: true,
    cancelable: true,
    composed: true,
  })
  target.dispatchEvent(ev)
}

export function isEventInWorkbenchScope(event?: KeyboardEvent | null): boolean {
  if (isFocusInWorkbenchScope()) return true
  if (event && typeof event.composedPath === 'function') {
    for (const node of event.composedPath()) {
      if (isActiveWorkbenchScopeNode(node)) return true
    }
  }
  return isNodeInsideActiveWorkbenchScope((event?.target as Node | null) ?? null)
}

export function displayShortcut(spec: string): string {
  const parsed = parseShortcut(spec)
  if (!parsed) return spec || '未设置'
  const parts: string[] = []
  if (parsed.mod) parts.push(IS_MAC ? '⌘' : 'Ctrl')
  if (parsed.ctrl) parts.push(IS_MAC ? '⌃' : 'Ctrl')
  if (parsed.meta) parts.push(IS_MAC ? '⌘' : 'Win')
  if (parsed.alt) parts.push(IS_MAC ? '⌥' : 'Alt')
  if (parsed.shift) parts.push(IS_MAC ? '⇧' : 'Shift')
  parts.push(codeToDisplay(parsed.code))
  return parts.join(' + ')
}
