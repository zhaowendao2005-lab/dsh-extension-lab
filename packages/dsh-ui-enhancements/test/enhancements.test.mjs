import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

test('built host and client bundles exist and export expected symbols', async () => {
  const hostCode = await readFile(path.join(root, 'lib/index.js'), 'utf8')
  const clientCode = await readFile(path.join(root, 'lib/client.js'), 'utf8')

  assert.match(hostCode, /enableSwissSettings/)
  assert.match(hostCode, /enableModelPicker/)
  assert.match(hostCode, /modelPickerShortcut/)
  assert.match(hostCode, /volatile/)

  assert.match(clientCode, /__ModuleLoader__/)
  assert.match(clientCode, /settings\.section/)
  assert.match(clientCode, /dsh-enh-mp-popover/)
  assert.match(clientCode, /dsh-enh-settings/)

  let registered = null
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(mod) {
          registered = mod
        },
      },
    },
    document: {},
    console,
  }
  sandbox.globalThis = sandbox
  sandbox.self = sandbox
  vm.runInNewContext(clientCode, sandbox)
  assert.equal(registered?.id, 'dsh-ui-enhancements')
  const plugin = registered.factory(() => ({
    createElement() {},
    Fragment: Symbol('Fragment'),
    createRoot() {},
  }))
  assert.equal(plugin.name, 'dsh-ui-enhancements')
  assert.deepEqual(Array.from(plugin.inject), ['slots'])
})

test('fuzzyRank supports subsequence matching, aliases, and highlight positions', async () => {
  const { build } = await import(
    path.resolve(root, '../dsh-btw-side/node_modules/esbuild/lib/main.js')
  )
  const result = await build({
    entryPoints: [path.join(root, 'src/client/fuzzy.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
  })
  const mod = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
  )

  const models = [
    { name: 'deepseek-chat' },
    { name: 'claude-3-7-sonnet' },
    { name: 'gemini-2.5-pro' },
  ]

  const empty = mod.fuzzyRank(models, '', (m) => m.name)
  assert.equal(empty.length, 3)

  const dsHits = mod.fuzzyRank(models, 'ds chat', (m) => m.name)
  assert.ok(dsHits.length >= 1)
  assert.equal(dsHits[0].item.name, 'deepseek-chat')
  assert.ok(dsHits[0].positions.length > 0)

  const clHits = mod.fuzzyRank(models, 'cl sonnet', (m) => m.name)
  assert.equal(clHits.length, 1)
  assert.equal(clHits[0].item.name, 'claude-3-7-sonnet')
})

test('shortcut parser and matcher handle Mod+Shift+M and Alt+K', async () => {
  const { build } = await import(
    path.resolve(root, '../dsh-btw-side/node_modules/esbuild/lib/main.js')
  )
  const result = await build({
    entryPoints: [path.join(root, 'src/client/shortcuts.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
  })
  const mod = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
  )

  const parsed = mod.parseShortcut('Mod+Shift+M')
  assert.deepEqual(parsed, {
    mod: true,
    ctrl: false,
    meta: false,
    alt: false,
    shift: true,
    code: 'KeyM',
  })

  const dshBinding = mod.toDshBinding('Mod+Shift+M')
  assert.deepEqual(dshBinding, { code: 'KeyM', modifiers: ['primary', 'shift'] })

  const ctrlPBinding = mod.toDshBinding('Ctrl+P')
  assert.deepEqual(ctrlPBinding, { code: 'KeyP', modifiers: ['control'] })

  assert.equal(
    mod.matchesShortcut(
      { code: 'KeyK', metaKey: false, ctrlKey: false, altKey: true, shiftKey: false },
      'Alt+K',
    ),
    true,
  )
  assert.equal(
    mod.matchesShortcut(
      { code: 'KeyK', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false },
      'Alt+K',
    ),
    false,
  )
})

test('FeatureStyleManager hot-swaps style tags on config toggle', async () => {
  const headChildren = []
  const makeEl = () => ({
    dataset: {},
    textContent: '',
    remove() {
      const idx = headChildren.indexOf(this)
      if (idx >= 0) headChildren.splice(idx, 1)
    },
  })
  globalThis.document = {
    head: {
      appendChild(el) {
        headChildren.push(el)
      },
    },
    querySelectorAll() {
      return []
    },
    createElement() {
      return makeEl()
    },
  }

  const { build } = await import(
    path.resolve(root, '../dsh-btw-side/node_modules/esbuild/lib/main.js')
  )
  const result = await build({
    entryPoints: [path.join(root, 'src/client/features.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    loader: { '.css': 'text' },
  })
  const mod = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
  )

  const mgr = new mod.FeatureStyleManager()
  mgr.apply({
    enableSwissSettings: true,
    enableSwissModals: true,
    enableSwissPopovers: true,
    enableSwissMarket: true,
    enableModelPicker: true,
    modelPickerShortcut: 'Mod+Shift+M',
  })
  assert.equal(headChildren.length, 6)

  mgr.apply({
    enableSwissSettings: false,
    enableSwissModals: true,
    enableSwissPopovers: false,
    enableSwissMarket: true,
    enableModelPicker: true,
    modelPickerShortcut: 'Mod+Shift+M',
  })
  const features = headChildren.map((el) => el.dataset.feature)
  assert.ok(!features.includes('swiss-settings'))
  assert.ok(!features.includes('swiss-popovers'))
  assert.ok(features.includes('swiss-modals'))
  assert.ok(features.includes('swiss-market'))

  mgr.dispose()
  assert.equal(headChildren.length, 0)
  delete globalThis.document
})

test('workbench scope detection respects keyboard focus and shadow DOM overlay', async () => {
  const { build } = await import(
    path.resolve(root, '../dsh-btw-side/node_modules/esbuild/lib/main.js')
  )
  const result = await build({
    entryPoints: [path.join(root, 'src/client/shortcuts.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
  })
  const mod = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
  )

  function makeNode(attrs = {}, parentNode = null) {
    return {
      parentNode,
      shadowRoot: null,
      hasAttribute(k) {
        return Object.prototype.hasOwnProperty.call(attrs, k)
      },
      getAttribute(k) {
        return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null
      },
    }
  }

  const chatInput = makeNode()
  const sidebarScope = makeNode({
    'data-dsh-workbench-scope': 'sidebar',
    'data-dsh-workbench-active': 'true',
  })
  const sidebarEditor = makeNode({}, sidebarScope)

  const overlayHost = makeNode({
    'data-dsh-workbench-scope': 'overlay',
    'data-dsh-workbench-active': 'true',
  })
  const overlayDialog = makeNode({
    'data-dsh-workbench-scope': 'overlay',
    'data-dsh-workbench-active': 'true',
  })
  const overlayInput = makeNode({}, overlayDialog)
  overlayHost.shadowRoot = { activeElement: overlayInput }

  globalThis.document = { activeElement: chatInput }
  assert.equal(mod.isFocusInWorkbenchScope(), false)
  assert.equal(mod.isEventInWorkbenchScope({ target: chatInput, composedPath: () => [chatInput] }), false)

  // Focus inside active sidebar workbench
  globalThis.document = { activeElement: sidebarEditor }
  assert.equal(mod.isFocusInWorkbenchScope(), true)
  assert.equal(mod.isEventInWorkbenchScope({ target: sidebarEditor, composedPath: () => [sidebarEditor, sidebarScope] }), true)

  // Focus inside shadow DOM fullview overlay
  globalThis.document = { activeElement: overlayHost }
  assert.equal(mod.isFocusInWorkbenchScope(), true)

  // Inactive sidebar scope (e.g. fullview is open or tab hidden) must not match
  const inactiveSidebar = makeNode({
    'data-dsh-workbench-scope': 'sidebar',
    'data-dsh-workbench-active': 'false',
  })
  const inactiveEditor = makeNode({}, inactiveSidebar)
  globalThis.document = { activeElement: inactiveEditor }
  assert.equal(mod.isFocusInWorkbenchScope(), false)

  delete globalThis.document
})

test('Enhans client uses DSH shortcuts when available, blocks inside workbench, and never bypasses conflicts', async () => {
  const clientCode = await readFile(path.join(root, 'lib/client.js'), 'utf8')

  async function bootEnhans({ withShortcutService = true, describeResult = { issue: null, conflicts: [] }, registerThrows = false } = {}) {
    let registeredPlugin = null
    const windowListeners = new Map()
    const effectsCleanup = []
    const shortcutDisposers = []
    const registeredCommands = []
    let currentActiveElement = null

    globalThis.document = {
      get activeElement() {
        return currentActiveElement
      },
      head: { appendChild() {} },
      body: { appendChild() {} },
      createElement() {
        return { dataset: {}, style: {}, appendChild() {}, remove() {} }
      },
      querySelectorAll() {
        return []
      },
    }

    const sandbox = {
      window: {
        __ModuleLoader__: {
          load(mod) {
            registeredPlugin = mod
          },
        },
        addEventListener(type, fn, capture) {
          if (!windowListeners.has(type)) windowListeners.set(type, new Set())
          windowListeners.get(type).add({ fn, capture: Boolean(capture) })
        },
        removeEventListener(type, fn, capture) {
          const set = windowListeners.get(type)
          if (!set) return
          for (const entry of set) {
            if (entry.fn === fn && entry.capture === Boolean(capture)) set.delete(entry)
          }
        },
      },
      document: globalThis.document,
      navigator: { platform: 'MacIntel', userAgent: 'Mac' },
      HTMLElement: function HTMLElement() {},
      console,
      setTimeout,
      clearTimeout,
      localStorage: {
        getItem() { return null },
        setItem() {},
      },
    }
    sandbox.window.localStorage = sandbox.localStorage
    sandbox.globalThis = sandbox
    sandbox.self = sandbox
    vm.runInNewContext(clientCode, sandbox)

    const plugin = registeredPlugin.factory(() => ({
      createElement() {},
      Fragment: Symbol('Fragment'),
      createRoot() { return { render() {}, unmount() {} } },
      useState(v) { return [v, () => {}] },
      useEffect() {},
      useRef(v) { return { current: v } },
      useSyncExternalStore(_s, g) { return g() },
    }))

    const shortcutService = {
      describeBinding() {
        return describeResult
      },
      register(cmd) {
        if (registerThrows) throw new Error('rejected by host')
        registeredCommands.push(cmd)
        return () => {
          const idx = registeredCommands.indexOf(cmd)
          if (idx >= 0) registeredCommands.splice(idx, 1)
        }
      },
    }

    const ctx = {
      config: null,
      slots: {
        inject(_name, fn) { return fn() },
        register() { return () => {} },
      },
      effect(fn) {
        const cleanup = fn()
        if (typeof cleanup === 'function') effectsCleanup.push(cleanup)
        return cleanup
      },
      inject(deps, fn) {
        if (deps.includes('shortcuts') && withShortcutService) {
          fn({
            get(name) { return name === 'shortcuts' ? shortcutService : null },
            effect(e) {
              const c = e()
              if (typeof c === 'function') shortcutDisposers.push(c)
            },
          })
        }
      },
    }

    await plugin.apply(ctx)

    return {
      keydownListeners: () => Array.from(windowListeners.get('keydown') ?? []),
      registeredCommands,
      setActiveElement(el) { currentActiveElement = el },
      dispose() {
        for (const c of effectsCleanup) c()
        for (const c of shortcutDisposers) c()
      },
    }
  }

  // 1. With DSH shortcuts service available & non-conflicting:
  //    - No window fallback keydown listener remains active
  //    - Command is registered in DSH shortcuts
  //    - resolve() blocks inside active workbench scope and handles outside
  const env1 = await bootEnhans({ withShortcutService: true })
  assert.equal(env1.keydownListeners().length, 0)
  assert.equal(env1.registeredCommands.length, 1)

  const cmd = env1.registeredCommands[0]
  const outsideEl = { parentNode: null, hasAttribute: () => false, getAttribute: () => null }
  env1.setActiveElement(outsideEl)
  assert.equal(cmd.resolve().status, 'handled')

  const wbScope = {
    parentNode: null,
    hasAttribute: (k) => k === 'data-dsh-workbench-scope',
    getAttribute: (k) => (k === 'data-dsh-workbench-scope' ? 'sidebar' : k === 'data-dsh-workbench-active' ? 'true' : null),
  }
  const insideEl = { parentNode: wbScope, hasAttribute: () => false, getAttribute: () => null }
  env1.setActiveElement(insideEl)
  assert.equal(cmd.resolve().status, 'blocked')
  env1.dispose()

  // 2. When Host detects a conflict or rejects registration:
  //    - Enhans must NOT register and must NOT leave a window keydown fallback active
  // 2b. When Host rejects web:* defaults (e.g. Ctrl+P) but accepts desktop:* defaults,
  //     and when describeBinding omits issue (undefined), registration still succeeds on Desktop.
  let callCount = 0
  const envDesktopOnly = await bootEnhans({
    withShortcutService: true,
    describeResult: { conflicts: [] },
  })
  assert.equal(envDesktopOnly.registeredCommands.length, 1)
  envDesktopOnly.dispose()

  const envConflict = await bootEnhans({
    withShortcutService: true,
    describeResult: { issue: null, conflicts: ['workspace-ide.quickOpen'] },
  })
  assert.equal(envConflict.registeredCommands.length, 0)
  assert.equal(envConflict.keydownListeners().length, 0)
  envConflict.dispose()

  const envThrows = await bootEnhans({ withShortcutService: true, registerThrows: true })
  assert.equal(envThrows.registeredCommands.length, 0)
  assert.equal(envThrows.keydownListeners().length, 0)
  envThrows.dispose()

  // 3. When DSH shortcuts service is unavailable:
  //    - Fallback window keydown listener IS active, but yields inside active workbench scope
  const envFallback = await bootEnhans({ withShortcutService: false })
  assert.equal(envFallback.keydownListeners().length, 1)
  const fallbackFn = envFallback.keydownListeners()[0].fn

  let prevented = 0
  let stopped = 0
  const modShiftM = (target) => ({
    code: 'KeyM',
    key: 'M',
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: true,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    target,
    composedPath: () => [target],
    preventDefault() { prevented += 1 },
    stopPropagation() { stopped += 1 },
  })

  // Inside workbench scope -> yields (does not prevent/stop)
  envFallback.setActiveElement(insideEl)
  fallbackFn(modShiftM(insideEl))
  assert.equal(prevented, 0)
  assert.equal(stopped, 0)

  // Outside workbench scope -> handles & consumes
  envFallback.setActiveElement(outsideEl)
  fallbackFn(modShiftM(outsideEl))
  assert.equal(prevented, 1)
  assert.equal(stopped, 1)

  envFallback.dispose()
  assert.equal(envFallback.keydownListeners().length, 0)
  delete globalThis.document
})
