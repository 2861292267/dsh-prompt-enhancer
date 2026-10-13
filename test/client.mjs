// Portable paths: this suite runs from a clone, not from the authoring machine.
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Standalone load-check for the browser half.
 *
 * Recreates the globals DSH's client loader provides — `window.__ModuleLoader__`,
 * `require`, `document` — then asserts the bundle registers the right id, mounts
 * into the right slot, and renders every interaction state without throwing.
 * This catches syntax and contract mistakes without a browser.
 */
import { readFileSync } from 'node:fs'

const CLIENT = join(ROOT, 'lib', 'client.js')

let registered = null
const loaded = []
let styleInjected = null

globalThis.window = {
  __ModuleLoader__: {
    load(spec) { registered = spec },
  },
}

/** Minimal React stub: enough to render the component, not to run effects. */
const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => {
    // A settable pair, so state-dependent rendering can be exercised.
    const cell = { value: initial }
    return [cell.value, (next) => { cell.value = next }]
  },
  useEffect: () => {},
  useCallback: (fn) => fn,
  useRef: (value) => ({ current: value }),
}

globalThis.require = (id) => {
  loaded.push(id)
  if (id === 'react') return React
  throw new Error('unexpected require: ' + id)
}

globalThis.document = {
  getElementById: () => null,
  createElement: () => ({ set textContent(v) { styleInjected = v }, id: '' }),
  head: { appendChild: () => {} },
}
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { clipboard: { writeText: async () => {} } },
})

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; console.log('  PASS', label) }
  else { fail++; console.log('  FAIL', label, '\n    got     ', a, '\n    expected', e) }
}

console.log('== evaluate the bundle ==')
await import('file:///' + CLIENT)
check('registered an entry', registered !== null, true)
check('entry id is the package name', registered && registered.id, '@local/dsh-prompt-forge')
check('factory is a function', typeof (registered && registered.factory), 'function')

console.log('\n== instantiate ==')
const mod = registered.factory(globalThis.require)
check('exports name', mod.name, 'dsh-prompt-forge-client')
check('exports inject', Array.isArray(mod.inject) && mod.inject.includes('slots'), true)
check('exports apply', typeof mod.apply, 'function')

console.log('\n== mounts into the slot that renders BEFORE the model selector ==')
const registrations = []
const injections = []
const ctx = {
  slots: {
    inject(key, cb) { injections.push(key); cb() },
    register(spec, component) { registrations.push({ spec, component }); return () => {} },
  },
}
mod.apply(ctx)
// `conversation.input.right` is rendered before `conversation.input.model`,
// which is what puts the control on the LEFT of the model picker.
// The settings panel is a second, independent surface.
check('injected into exactly the two expected slots', injections,
  ['conversation.input.right', 'settings.section'])
check('registered two components', registrations.length, 2)

const composer = registrations.find((r) => r.spec.name === 'conversation.input.right')
const panel = registrations.find((r) => r.spec.name === 'settings.section')
check('composer slot present', Boolean(composer), true)
check('composer has a stable id', composer.spec.id, 'prompt-enhancer')
check('does not target the activity slot', injections.includes('conversation.input.activity'), false)
check('composer component is a function', typeof composer.component, 'function')

check('settings slot present', Boolean(panel), true)
check('settings has a stable id', panel.spec.id, 'prompt-forge')
check('settings label is a function', typeof panel.spec.label, 'function')
check('settings label resolves to a string', typeof panel.spec.label(), 'string')
check('settings order is a number', typeof panel.spec.order, 'number')
check('settings component is a function', typeof panel.component, 'function')

check('styles installed', typeof styleInjected, 'string')
check('styles target the control', styleInjected.includes('dsh-prompt-forge-button'), true)
check('styles cover the settings panel', styleInjected.includes('dsh-forge-settings'), true)

console.log('\n== apply survives a hostile ctx ==')
let threw = false
try { mod.apply({ slots: { inject() { throw new Error('no slot') }, register() {} } }) } catch { threw = true }
check('swallows mount failure', threw, false)

console.log('\n== dependency surface ==')
check('requires react only', loaded, ['react'])

console.log('\n== render: idle with a draft ==')
const Button = registrations[0].component
console.log('\n== the input store field is `draft` (this broke the feature once) ==')
// ui-conversation reads `inputState.draft === ""`. A stub using any other key
// makes this suite pass while the real control reads an empty composer — which
// is precisely how "请先输入一点内容" appeared over a filled input box.
const CLIENT_SRC = readFileSync(CLIENT, 'utf8')
check('bundle reads `draft`', CLIENT_SRC.includes("'draft'"), true)
check('bundle does not read state.text', CLIENT_SRC.includes('state.text'), false)
check('bundle does not read snapshot.text', CLIENT_SRC.includes('snapshot.text'), false)

/**
 * Find the enhance button inside whatever the component returns.
 *
 * The control now renders a group: an optional style `<select>` followed by the
 * button. Assertions should target the button, not the wrapper, so that adding
 * sibling controls does not require rewriting every expectation about it.
 *
 * @param el - the element returned by the component.
 * @returns the button element, or the input unchanged when it is already one.
 */
function findButton(el) {
  if (!el) return el
  if (el.type === 'button') return el
  const children = Array.isArray(el.children) ? el.children : []
  for (const child of children) {
    if (child && child.type === 'button') return child
  }
  return el
}

/** Render with a given draft and optional overrides. */
function render(text, overrides = {}) {
  return findButton(Button({
    inputActions: { setDraft: () => {} },
    // The real snapshot shape: `{ draft }`.
    useInput: (selector) => selector({ draft: text }),
    locked: false,
    ...overrides,
  }))
}
const idle = render('写个爬虫')
check('renders a button', idle && idle.type, 'button')
check('mode is idle', idle.props['data-dsh-mode'], 'idle')
check('carries the plugin marker', idle.props['data-dsh-plugin'], 'dsh-prompt-forge')
check('label is the feature name', idle.props['aria-label'], '增强提示词')
check('reading { draft } marks it ready', idle.props['data-dsh-ready'], 'true')

console.log('\n== the button is never disabled (that was the "no feedback" bug) ==')
// A disabled control with no explanation is indistinguishable from a broken
// one. Every state is clickable; refusals explain themselves via a notice.
check('not disabled with a draft', idle.props.disabled, undefined)
check('not disabled with a blank draft', render('   ').props.disabled, undefined)
check('not disabled when locked', render('x', { locked: true }).props.disabled, undefined)
check('readiness is exposed instead', idle.props['data-dsh-ready'], 'true')
check('blank draft reports not ready', render('   ').props['data-dsh-ready'], 'false')

console.log('\n== the label is visible text, not just an icon ==')
// The control previously rendered a bare 14px glyph, which read as decoration.
const texts = idle.children.filter(Boolean).map((c) => c && c.props && c.props.className)
check('renders an icon span', texts.includes('dsh-pe-icon'), true)
check('renders a text span', texts.includes('dsh-pe-text'), true)

console.log('\n== a click always produces feedback ==')
const src = readFileSync(CLIENT, 'utf8')
// The refusals are the point: each one sets a notice instead of doing nothing.
for (const message of ['请先输入一点内容', '输入框当前被锁定', '当前界面不支持写入输入框', '读不到输入框内容']) {
  check('has a notice for: ' + message.slice(0, 12), src.includes(message), true)
}

console.log('\n== the control offers revert, like WorkBuddy ==')
// WorkBuddy renders `onRevert` + `hasBackup`; the revert branch must exist in
// the markup, so its label is reachable from this component at all.
check('has an onRevert path', src.includes('onRevert'), true)
check('keeps a backup', src.includes('setBackup'), true)
check('revert label present', src.includes('恢复原文'), true)
check('cancel while busy', src.includes('onCancel'), true)
check('busy state present', src.includes('正在增强'), true)
check('data-dsh-mode exposes the state', src.includes("'data-dsh-mode'"), true)

console.log('\n== the button keeps the caret in the editor ==')
check('prevents default on mousedown', src.includes('onMouseDown'), true)
check('preventDefault wired', src.includes('preventDefault'), true)

console.log('\n== a click writes the enhanced text back ==')
{
  // Drive the real handler end to end with a stubbed fetch, so the write path
  // is verified rather than assumed.
  const written = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() { return { ok: true, prompt: '改写后的内容' } },
  })

  const ctx2 = {
    slots: { inject: (k, cb) => cb(), register: () => () => {} },
  }
  const srcModule = registered.factory(globalThis.require)
  srcModule.apply(ctx2)
  // Select by slot name, not by position: the plugin now registers two
  // surfaces, and which one lands last is an implementation detail.
  const Component = registrations.find((r) => r.spec.name === 'conversation.input.right').component

  // Build the element, then invoke its onClick directly. `findButton` because the
  // component now returns a group (style selector + button).
  const el = findButton(Component({
    inputActions: { setDraft: (t) => written.push(t) },
    useInput: (selector) => selector({ draft: '写个爬虫' }),
    locked: false,
  }))
  let threw = false
  try { await el.props.onClick() } catch (e) { threw = true; console.log('   onClick threw:', e.message) }
  check('onClick did not throw', threw, false)
  check('setDraft was called', written.length >= 1, true)
  check('wrote the enhanced prompt', written[written.length - 1], '改写后的内容')

  globalThis.fetch = realFetch
}

console.log('')
console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
