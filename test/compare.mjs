/**
 * 多风格对比引擎。
 *
 * 这个功能的**最重要语义是"部分成功"**：一次跑多个风格时，某个风格失败
 * （额度、限流、无适配器）不该把其它已经成功的结果一起丢掉。
 * 本测试重点覆盖这条，以及取消、去重、上限。
 */
import { compareStyles } from '../lib/index.js'

let pass = 0
let fail = 0
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; console.log('  PASS', label) }
  else { fail++; console.log('  FAIL', label, '\n    got     ', a, '\n    expected', e) }
}

/**
 * 造一个假的 ctx：`llm.stream` 按调用次序返回预设结果。
 * @param plan - 每项为 `{ text }`（成功）或 `{ fail }`（模型返回失败原因）
 */
function fakeCtx(plan, calls) {
  let i = 0
  return {
    get: (name) => {
      if (name !== 'llm') return undefined
      return {
        stream: () => {
          const step = plan[i++] ?? { text: '默认结果' }
          if (calls) calls.push(step)
          return (async function* () {
            if (step.fail) {
              yield { type: 'finish', reason: { kind: 'error', failure: { code: step.fail, message: 'x' } } }
              return
            }
            yield { type: 'text-delta', text: step.text }
            yield { type: 'finish', reason: { kind: 'stop' } }
          })()
        },
      }
    },
  }
}

const OPTS = { provider: 'p', model: 'm' }

console.log('== 1. 全部成功 ==')
{
  const calls = []
  const ctx = fakeCtx([{ text: '结果A' }, { text: '结果B' }], calls)
  const r = await compareStyles(ctx, {
    draft: '草稿',
    styles: ['default', 'concise'],
    ...OPTS,
  })
  check('整体成功', r.ok, true)
  check('两个结果', r.results.length, 2)
  check('顺序与请求一致', r.results.map((x) => x.style), ['default', 'concise'])
  check('内容正确', r.results.map((x) => x.prompt), ['结果A', '结果B'])
}

console.log('\n== 2. 部分失败：成功的结果必须保留（核心语义）==')
{
  const ctx = fakeCtx([
    { text: '成功的那个' },
    { fail: 'RATE_LIMIT' },       // 第二个风格失败
    { text: '第三个也成功' },
  ])
  const r = await compareStyles(ctx, {
    draft: '草稿',
    styles: ['default', 'concise', 'expand'],
    ...OPTS,
  })
  check('整体仍算成功', r.ok, true)
  check('三个条目都在', r.results.length, 3)
  check('成功项带 prompt', r.results[0].ok && r.results[0].prompt, '成功的那个')
  check('失败项带 error 而非 prompt', r.results[1].ok, false)
  check('失败项有可读原因', typeof r.results[1].error, 'string')
  check('后续风格继续执行', r.results[2].prompt, '第三个也成功')
}

console.log('\n== 3. 全部失败 ==')
{
  const ctx = fakeCtx([{ fail: 'NO_ADAPTER' }, { fail: 'NO_ADAPTER' }])
  const r = await compareStyles(ctx, { draft: '草稿', styles: ['default', 'concise'], ...OPTS })
  check('整体失败', r.ok, false)
  check('但仍返回全部条目', r.results.length, 2)
  check('每条都有原因', r.results.every((x) => !x.ok && x.error), true)
}

console.log('\n== 4. 去重与顺序 ==')
{
  const calls = []
  const ctx = fakeCtx([{ text: 'x1' }, { text: 'x2' }], calls)
  const r = await compareStyles(ctx, {
    draft: '草稿',
    styles: ['concise', 'default', 'concise', 'default'],   // 重复
    ...OPTS,
  })
  check('重复被去掉', r.results.map((x) => x.style), ['concise', 'default'])
  check('只发了两次模型调用', calls.length, 2)
}

console.log('\n== 5. 上限（每次风格都是一次模型调用）==')
{
  const calls = []
  const ctx = fakeCtx(Array.from({ length: 10 }, (_, i) => ({ text: `r${i}` })), calls)
  const r = await compareStyles(ctx, {
    draft: '草稿',
    styles: ['default', 'expand', 'concise', 'structured', 's5', 's6'],
    ...OPTS,
  })
  check('最多 4 个', r.results.length, 4)
  check('只发了 4 次调用', calls.length, 4)
}

console.log('\n== 6. 逐个回调（面板据此渐进填充）==')
{
  const seen = []
  const ctx = fakeCtx([{ text: 'a' }, { text: 'b' }])
  await compareStyles(ctx, {
    draft: '草稿',
    styles: ['default', 'concise'],
    ...OPTS,
    onResult: (entry) => seen.push({ style: entry.style, ok: entry.ok }),
  })
  check('每个结果都回调了一次', seen, [{ style: 'default', ok: true }, { style: 'concise', ok: true }])
}

console.log('\n== 7. 取消：不继续跑，但已完成的保留 ==')
{
  const controller = new AbortController()
  const seen = []
  const ctx = fakeCtx([{ text: '第一个' }, { text: '不该跑到' }])
  const r = await compareStyles(ctx, {
    draft: '草稿',
    styles: ['default', 'concise'],
    ...OPTS,
    signal: controller.signal,
    onResult: (entry) => {
      seen.push(entry.style)
      controller.abort()   // 第一个结果一回来就取消
    },
  })
  check('第一个已完成', r.results[0].prompt, '第一个')
  check('第二个标记为已取消', r.results[1].error, '已取消')
  check('第二个没有真正执行', r.results[1].prompt, undefined)
  check('回调覆盖两项', seen, ['default', 'concise'])
}

console.log('\n== 8. 入参守卫 ==')
{
  const ctx = fakeCtx([])
  const empty = await compareStyles(ctx, { draft: '   ', styles: ['default'], ...OPTS })
  check('空草稿被拒', empty.ok, false)
  check('空草稿返回空结果', empty.results, [])

  const noStyles = await compareStyles(ctx, { draft: '草稿', styles: [], ...OPTS })
  check('未选风格被拒', noStyles.ok, false)

  const notArray = await compareStyles(ctx, { draft: '草稿', styles: 'default', ...OPTS })
  check('styles 非数组被拒', notArray.ok, false)
}

console.log('')
console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
