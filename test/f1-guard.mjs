// Portable paths: this suite runs from a clone, not from the authoring machine.
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 判定 F-1 修复是否真的成立 —— 分离"桩的局限"与"代码的缺陷"。
 *
 * 背景：简单桩只渲染一次，测不到依赖数组修复。真实 React 在 useInput 变化时
 * 会重渲染组件，从而用新 draft 重建 onEnhance。
 *
 * 本文件做两件事：
 *   1. 模拟真实 React 时序（草稿变化 → 重渲染 → 复用新闭包），验证修复成立；
 *   2. 反向验证：**去掉依赖数组修复**时，同一时序下必须失败 —— 证明测试有鉴别力。
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

const CLIENT = join(ROOT, 'lib', 'client.js')
const SRC = readFileSync(CLIENT, 'utf8')

let pass = 0, fail = 0
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) { pass++; console.log('  PASS', label) }
  else { fail++; console.log('  FAIL', label, '\n    got     ', a, '\n    expected', e) }
}

/**
 * 用给定源码跑一次"真实时序"模拟：
 *   渲染 → 点击（发起请求，等待中）→ 草稿变化 → 重渲染 → 请求返回 → 观察是否写回
 *
 * @param source - 被测 client.js 源码。
 * @param withDeps - 是否保留 `draft` 依赖（模拟修复/未修复）。
 * @returns 写回次数。
 */
async function simulate(source, label) {
  const dir = mkdtempSync(join(tmpdir(), 'pe-f1-'))
  const file = join(dir, 'client.mjs')
  writeFileSync(file, source, 'utf8')

  let registered = null
  const savedWindow = globalThis.window
  globalThis.window = { __ModuleLoader__: { load(spec) { registered = spec } } }

  const hooks = { list: [], cursor: 0 }
  const REACT = {
    createElement: (type, props, ...children) => ({
      type, props: { ...(props || {}), children: children.length === 1 ? children[0] : children },
    }),
    useState(initial) {
      const i = hooks.cursor++
      if (!(i in hooks.list)) hooks.list[i] = typeof initial === 'function' ? initial() : initial
      return [hooks.list[i], (v) => { hooks.list[i] = typeof v === 'function' ? v(hooks.list[i]) : v }]
    },
    useRef(initial) {
      const i = hooks.cursor++
      if (!(i in hooks.list)) hooks.list[i] = { current: initial }
      return hooks.list[i]
    },
    useCallback(fn, deps) {
      const i = hooks.cursor++
      const prev = hooks.list[i]
      // 真实 useCallback 语义：deps 变了才换新函数。
      if (!prev || !deps || deps.some((d, k) => !Object.is(d, prev.deps[k]))) {
        hooks.list[i] = { fn, deps }
      }
      return hooks.list[i].fn
    },
    useEffect() { /* 时序测试不依赖 effect */ },
  }

  const savedRequire = globalThis.require
  globalThis.require = (id) => { if (id === 'react') return REACT; throw new Error('unexpected: ' + id) }

  // installStyles() touches the DOM; the mount path needs a minimal stub.
  const savedDocument = globalThis.document
  globalThis.document = {
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild: () => {} },
  }

  await import('file:///' + file)
  const mod = registered.factory(globalThis.require)
  const regs = []
  mod.apply({ slots: { inject: (k, cb) => cb(), register: (s, c) => { regs.push(c); return () => {} } } })
  const Component = regs[0]

  const written = []
  const inputActions = { setDraft: (t) => written.push(t) }

  /** 渲染一次；每次渲染重置 cursor，模拟 React 的 hook 顺序。 */
  let liveDraft = '写个爬虫'
  const render = () => {
    hooks.cursor = 0
    return Component({
      inputActions,
      useInput: (sel) => sel({ draft: liveDraft }),
      locked: false,
    })
  }
  const pickButton = (el) => el.type === 'button' ? el : el.props.children.find((c) => c && c.type === 'button')

  // ---- 时序开始 ----
  const first = pickButton(render())
  // 发起请求；在返回前改变草稿并"重渲染"，从而拿到新闭包。
  let resolveFetch
  const pending = new Promise((r) => { resolveFetch = r })
  const realFetch = globalThis.fetch
  globalThis.fetch = () => pending

  const inflight = first.props.onClick()   // 旧闭包发起请求
  liveDraft = '用户在等待期间新输入的内容'
  const second = pickButton(render())      // React 重渲染 → 新闭包
  // 真实 React 中在途 Promise 仍由旧闭包处理，这里也沿用旧闭包。
  void second

  resolveFetch({ ok: true, status: 200, async json() { return { ok: true, prompt: '改写后的内容' } } })
  await inflight

  globalThis.fetch = realFetch
  globalThis.window = savedWindow
  globalThis.require = savedRequire
  globalThis.document = savedDocument
  return written
}

console.log('== 场景：草稿在飞行期间变化（真实 React 会重渲染）==')

const fixed = await simulate(SRC)
check('修复后：结果被丢弃，未写回', fixed.length, 0)

/**
 * 反向验证：证明这个测试确实有鉴别力。
 *
 * 关键认知：真正的修复机制是 **`draftRef.current` 在每次渲染时被刷新**，
 * 不是依赖数组。因为 await 恢复在"发起请求的那个闭包"里，闭包捕获的局部变量
 * 永远是点击那一刻的值 —— 无论 deps 怎么写。
 *
 * 所以反向验证要破坏的是 ref 的刷新，而不是 deps：
 *   把「每次渲染刷新 draftRef.current」改成「只在首次渲染赋值」，
 *   模拟 ref 不更新 → 守卫应当失效（结果被覆盖）。
 */
const brokenRef = SRC.replace(
  /(\n\s+)draftRef\.current = draft\n/,
  '$1if (draftRef.current === \'\') draftRef.current = draft\n',
)
if (brokenRef === SRC) throw new Error('未能构造 ref 不刷新的变体，反向验证无效')
const brokenResult = await simulate(brokenRef)
check('反向验证：ref 不再刷新时确实会覆盖（证明测试有鉴别力）', brokenResult.length, 1)

console.log('')
console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
