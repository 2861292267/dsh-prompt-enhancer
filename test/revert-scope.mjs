/**
 * Regression: the revert offer must not outlive the draft it belongs to.
 *
 * Reported by a user: type → enhance → send (the host clears the composer) →
 * the button still read 恢复原文 → type something new → press it → the new text
 * was replaced by the previous round's original. Silent loss of typed work.
 *
 * The offer is now gated on `draft === enhancedRef.current`, a value recomputed
 * every render, so it cannot lag behind a host-driven clear the way a scheduled
 * effect could.
 *
 * NOTE ON THE HARNESS: these stubs record effects but never replay them (there is
 * no React scheduler here). That is deliberate for this case — it proves the
 * guard does not depend on an effect having run. If the guard is ever moved back
 * into an effect, this suite fails.
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = join(ROOT, 'lib', 'client.js')

let pass = 0
let fail = 0
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; console.log('  PASS', label) }
  else { fail++; console.log('  FAIL', label, '\n    got     ', a, '\n    expected', e) }
}

// ---- host environment ----
let registered = null
globalThis.window = { __ModuleLoader__: { load(s) { registered = s } } }
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({ id: '', textContent: '' }),
  head: { appendChild: () => {} },
}

const HOOKS = { list: [], cursor: 0 }
const EFFECTS = []
const REACT = {
  createElement: (type, props, ...children) => ({
    type, props: { ...(props || {}), children: children.length === 1 ? children[0] : children },
  }),
  useState(initial) {
    const i = HOOKS.cursor++
    if (!(i in HOOKS.list)) HOOKS.list[i] = typeof initial === 'function' ? initial() : initial
    return [HOOKS.list[i], (v) => { HOOKS.list[i] = typeof v === 'function' ? v(HOOKS.list[i]) : v }]
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
      // Recorded, deliberately NOT replayed — see the note at the top.
      EFFECTS.push(fn)
    }
  },
}
globalThis.require = (id) => { if (id === 'react') return REACT; throw new Error(id) }

await import('file:///' + CLIENT)
const mod = registered.factory(globalThis.require)
const regs = []
mod.apply({ slots: { inject: (k, cb) => cb(), register: (s, C) => { regs.push(C); return () => {} } } })
const Component = regs[0]

const kidsOf = (el) => { const c = el?.props?.children; return c == null ? [] : (Array.isArray(c) ? c : [c]) }
const findBtn = (el) => el?.type === 'button' ? el : kidsOf(el).map(findBtn).find(Boolean)

/** The host owns the draft; a send clears it. */
let composerDraft = ''
const inputActions = { setDraft: (v) => { composerDraft = v } }

const render = () => {
  HOOKS.cursor = 0
  return Component({
    sessionId: 's1',
    inputActions,
    useInput: (sel) => sel({ draft: composerDraft }),
  })
}
const click = async (btn) => btn.props.onClick()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  async json() { return { ok: true, prompt: '【增强后的内容】' } },
})

console.log('== 发送清空输入框后，不得再提供「恢复原文」 ==')
{
  HOOKS.list.length = 0
  composerDraft = '原始草稿'

  // enhance
  await click(findBtn(render()))
  await sleep(30)
  check('增强后草稿被替换', composerDraft, '【增强后的内容】')
  check('此时提供撤销', findBtn(render()).props['data-dsh-mode'], 'revert')

  // host clears the composer on send
  composerDraft = ''
  check('发送清空后不再提供撤销', findBtn(render()).props['data-dsh-mode'], 'idle')

  // user types something new
  composerDraft = '用户新输入的内容'
  check('输入新内容后仍不提供撤销', findBtn(render()).props['data-dsh-mode'], 'idle')

  // pressing the button now must enhance the NEW text, not restore the old one
  await click(findBtn(render()))
  await sleep(30)
  check('新内容被正常增强，而不是被旧原文覆盖', composerDraft, '【增强后的内容】')
}

console.log('\n== 同一场景的反向验证：未改动的草稿必须保有撤销 ==')
{
  HOOKS.list.length = 0
  composerDraft = '另一段草稿'
  await click(findBtn(render()))
  await sleep(30)
  check('增强后提供撤销', findBtn(render()).props['data-dsh-mode'], 'revert')

  // No external change — the offer must survive re-renders.
  check('重渲染后撤销仍在', findBtn(render()).props['data-dsh-mode'], 'revert')

  const btn = findBtn(render())
  await click(btn)
  await sleep(20)
  check('撤销确实恢复了原文', composerDraft, '另一段草稿')
}

console.log('\n== 用户手改增强结果后，撤销也必须失效 ==')
{
  HOOKS.list.length = 0
  composerDraft = '第三段草稿'
  await click(findBtn(render()))
  await sleep(30)
  check('增强后提供撤销', findBtn(render()).props['data-dsh-mode'], 'revert')

  composerDraft = '【增强后的内容】我自己又补了几个字'
  check('手改后撤销失效（避免覆盖手改内容）', findBtn(render()).props['data-dsh-mode'], 'idle')
}

console.log('')
console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
