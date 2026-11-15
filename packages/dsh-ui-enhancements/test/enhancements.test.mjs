import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
