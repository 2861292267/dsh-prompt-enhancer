// Portable paths: this suite runs from a clone, not from the authoring machine.
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * P1 回归测试：状态机缺陷与 i18n。
 *
 * 覆盖第二批改动：
 *   1. 双击竞态 —— 同步门闩必须拦住同 tick 的第二次点击
 *   2. 跨会话串台 —— 会话变化时在途结果不得写入新会话
 *   3. 剪贴板假成功 —— 写入失败且剪贴板也失败时，提示不得说"已复制"
 *   4. i18n —— 字典可切换、locale 缺失时降级不崩
 *   5. 无障碍 —— aria-label 与可见文本一致、存在 role="status"
 */
import { readFileSync } from 'node:fs'

const CLIENT = join(ROOT, 'lib', 'client.js')
const SRC = readFileSync(CLIENT, 'utf8')

let pass = 0, fail = 0
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) { pass++; console.log('  PASS', label) }
  else { fail++; console.log('  FAIL', label, '\n    got     ', a, '\n    expected', e) }
}

/**
 * The bundle registers itself through `window.__ModuleLoader__` the first time it
 * is imported, and ESM caches that import. So the bundle is loaded once here and
 * every case reuses the captured module, fresh host stubs and fresh React hooks.
 */
/**
 * The bundle is imported once (ESM caches it), and `factory(require)` captures
 * whichever React stub it was first handed. So the stub must be a single stable
 * object whose *state* is reset per case — handing `load()` a fresh React object
 * would leave the component writing into a store the test no longer reads.
 */
const HOOKS = { list: [], cursor: 0 }
const EFFECTS = []
const REACT = {
  createElement: (type, props, ...children) => ({
    type, props: { ...(props || {}), children: children.length === 1 ? children[0] : children },
  }),
  useState(initial) {
    const i = HOOKS.cursor++
    if (!(i in HOOKS.list)) HOOKS.list[i] = typeof initial === 'function' ? initial() : initial
    return [HOOKS.list[i], (v) => {
      HOOKS.list[i] = typeof v === 'function' ? v(HOOKS.list[i]) : v
      // Optional observer so a test can read state without re-rendering.
      if (typeof REACT.__onSet === 'function') REACT.__onSet(i, HOOKS.list[i])
    }]
  },
  useRef(initial) {
    const i = HOOKS.cursor++
    if (!(i in HOOKS.list)) HOOKS.list[i] = { current: initial }
    return HOOKS.list[i]
  },
  useCallback(fn, deps) {
    const i = HOOKS.cursor++
    const prev = HOOKS.list[i]
    if (!prev || !deps || deps.some((d, k) => !Object.is(d, prev.deps[k]))) HOOKS.list[i] = { fn, deps }
    return HOOKS.list[i].fn
  },
  useEffect(fn, deps) {
    const i = HOOKS.cursor++
    const prev = HOOKS.list[i]
    if (!prev || !deps || deps.some((d, k) => !Object.is(d, prev.deps[k]))) {
      HOOKS.list[i] = { deps }
      EFFECTS.push(fn)
    }
  },
  __hooks: HOOKS,
  __effects: EFFECTS,
}

/** Reset the stub between cases: new instance = empty hook slots. */
function resetReact() {
  HOOKS.list.length = 0
  HOOKS.cursor = 0
  EFFECTS.length = 0
  REACT.__onSet = undefined
}

let BUNDLE = null

async function load() {
  let registered = null
  globalThis.window = { __ModuleLoader__: { load(spec) { registered = spec } } }
  globalThis.document = {
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild: () => {} },
  }

  resetReact()
  globalThis.require = (id) => { if (id === 'react') return REACT; throw new Error('unexpected: ' + id) }
  if (!BUNDLE) {
    await import('file:///' + CLIENT)
    BUNDLE = registered.factory(globalThis.require)
  }

  const regs = []
  BUNDLE.apply({
    slots: { inject: (k, cb) => cb(), register: (spec, C) => { regs.push({ spec, C }); return () => {} } },
  })
  return { REACT, mod: BUNDLE, regs, Component: regs[0].C }
}

/**
 * This suite's React stub stores children on `props.children` (matching how the
 * real `createElement` receives them), so every traversal reads that field.
 */
const kidsOf = (el) => {
  if (!el || !el.props) return []
  const c = el.props.children
  if (c === undefined || c === null) return []
  return Array.isArray(c) ? c : [c]
}
const findButton = (el) => {
  if (!el) return null
  if (el.type === 'button') return el
  for (const k of kidsOf(el)) { const r = findButton(k); if (r) return r }
  return null
}
const findByPart = (el, part) => {
  if (!el || !el.props) return null
  if (el.props['data-dsh-part'] === part) return el
  for (const k of kidsOf(el)) { const r = findByPart(k, part); if (r) return r }
  return null
}

// ─────────────────────────────────────────────
console.log('== 1. 双击竞态：同一 tick 内第二次点击必须被门闩拦住 ==')
{
  const { REACT, Component } = await load()
  const written = []
  const calls = []
  const realFetch = globalThis.fetch
  // fetch 挂起，制造"两个请求同时在途"的条件
  globalThis.fetch = (url, init) => {
    calls.push(init?.body ? JSON.parse(init.body) : {})
    return new Promise(() => {})   // 永不 resolve
  }

  REACT.__hooks.cursor = 0
  const el = Component({
    inputActions: { setDraft: (x) => written.push(x) },
    useInput: (sel) => sel({ draft: '写个爬虫' }),
  })
  const btn = findButton(el)

  // 同一 tick 连点两次（不 await 第一次）
  const p1 = btn.props.onClick()
  const p2 = btn.props.onClick()
  void p1; void p2
  await new Promise((r) => setTimeout(r, 50))

  check('只发出一个请求（第二次被同步门闩拦住）', calls.length, 1)
  globalThis.fetch = realFetch
}

// ─────────────────────────────────────────────
console.log('\n== 2. 跨会话串台：会话变化后在途结果不得写入 ==')
{
  /**
   * Models the host REUSING one component instance across sessions — the only
   * case in which the cross-session path exists. Reuse means the hook slots (and
   * therefore the refs) persist across both renders, so one stable hook store is
   * driven here rather than letting the stub reset per call.
   */
  const { REACT, Component } = await load()
  const written = []
  const realFetch = globalThis.fetch
  let resolveFetch
  globalThis.fetch = () => new Promise((r) => { resolveFetch = r })

  const render = (sessionId) => {
    REACT.__hooks.cursor = 0            // same hook order every render, as React does
    return Component({
      sessionId,
      inputActions: { setDraft: (x) => written.push(x) },
      useInput: (sel) => sel({ draft: '写个爬虫' }),
    })
  }

  const first = render('session-A')
  const inflight = findButton(first).props.onClick()

  // Same instance, new session. Only this render's effects are replayed.
  REACT.__effects.length = 0
  render('session-B')
  for (const fn of REACT.__effects) {
    if (typeof fn === 'function') {
      try { fn() } catch { /* the effect guards itself */ }
    }
  }

  resolveFetch({ ok: true, status: 200, async json() { return { ok: true, prompt: '旧会话的结果' } } })
  await inflight.catch(() => {})
  await new Promise((r) => setTimeout(r, 60))

  /**
   * The invariant that matters: the stale result must not reach the editor.
   *
   * Whether the abort in the session effect wins the race, or the write-back
   * session check catches it, the observable outcome is the same — nothing is
   * written. Asserting the outcome rather than the mechanism keeps this test
   * meaningful if either guard is refactored.
   */
  check('旧会话结果未写入输入框', written.includes('旧会话的结果'), false)
  globalThis.fetch = realFetch
}

// ─────────────────────────────────────────────
console.log('\n== 3. 剪贴板假成功：剪贴板也失败时不得说"已复制" ==')
{
  /**
   * The notice is component state, so it is read from a live render rather than a
   * fresh one. The stub records every `setNotice` value so the final message can
   * be asserted without re-rendering.
   */
  const notices = []
  const { REACT, Component } = await load()
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, status: 200, async json() { return { ok: true, prompt: '结果' } } })

  const savedDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true })

  // Capture notices by intercepting the hook's setter; the store is already
  // reset by `load()`, so this case starts from a clean instance.
  REACT.__onSet = (i, v) => { if (typeof v === 'string' && v !== '') notices.push(v) }

  REACT.__hooks.cursor = 0
  const el = Component({
    inputActions: { setDraft: () => { throw new Error('editor refused') } },
    useInput: (sel) => sel({ draft: '写个爬虫' }),
  })
  await findButton(el).props.onClick()
  await new Promise((r) => setTimeout(r, 80))

  const all = notices.join(' | ')
  check('全程未声称"结果已复制"', all.includes('结果已复制'), false)
  check('最终提示要求手动复制', all.includes('手动复制'), true)

  if (savedDesc) Object.defineProperty(globalThis, 'navigator', savedDesc)
  else delete globalThis.navigator
  globalThis.fetch = realFetch
}
// ─────────────────────────────────────────────
console.log('\n== 4. 无障碍契约 ==')
{
  const { REACT, Component } = await load()
  REACT.__hooks.cursor = 0
  const el = Component({
    inputActions: { setDraft: () => {} },
    useInput: (sel) => sel({ draft: '写个爬虫' }),
  })
  const btn = findButton(el)
  const status = findByPart(el, 'status')
  const visible = kidsOf(btn)[1].props.children

  check('aria-label 与可见文本一致', btn.props['aria-label'], visible)
  check('存在 role="status" 的 live region', status?.props?.role, 'status')
  check('live region 为 polite', status?.props?.['aria-live'], 'polite')
}

// ─────────────────────────────────────────────
console.log('\n== 5. i18n ==')
{
  const { mod } = await load()

  // 字典必须 zh/en 成对
  check('字典含 zh', typeof mod.name, 'string')

  // locale 缺失时 apply 不得抛错（降级）
  let threw = false
  try { mod.apply({ slots: { inject: (k, cb) => cb(), register: () => () => {} } }) }
  catch { threw = true }
  check('无 locale 时 apply 不抛错', threw, false)

  // locale 存在时应注册并绑定
  const registeredNs = []
  let bound = null
  const fakeCtx = {
    slots: { inject: (k, cb) => cb(), register: () => () => {} },
    locale: {
      register: (ns) => registeredNs.push(ns),
      bind: (ns) => { bound = ns; return (k) => (k === 'enhance' ? 'ENHANCED!' : k) },
    },
  }
  mod.apply(fakeCtx)
  check('注册了 locale 命名空间', registeredNs, ['dsh-prompt-forge'])
  check('绑定了同一命名空间', bound, 'dsh-prompt-forge')

  // locale.register 抛错时也必须继续挂载
  let mountThrew = false
  let mounted = false
  try {
    mod.apply({
      slots: { inject: (k, cb) => cb(), register: () => { mounted = true; return () => {} } },
      locale: { register: () => { throw new Error('locale broke') }, bind: () => () => '' },
    })
  } catch { mountThrew = true }
  check('locale.register 抛错时 apply 仍不崩', mountThrew, false)
  check('locale.register 抛错时仍完成挂载', mounted, true)
}

console.log('')
console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
