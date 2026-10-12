/**
 * Host-half unit tests: pure functions, the rewrite engine, and every failure
 * path. These run without a DSH host.
 */
import * as m from '../lib/index.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; console.log('  PASS', label) }
  else { fail++; console.log('  FAIL', label, '\n    got     ', String(a).slice(0, 160), '\n    expected', String(e).slice(0, 160)) }
}

const F = '`'.repeat(3)

console.log('== normalizeStyle ==')
// The default reproduces WorkBuddy's own behaviour with no added guidance.
check('default', m.normalizeStyle('default'), 'default')
check('expand', m.normalizeStyle('expand'), 'expand')
check('concise', m.normalizeStyle('concise'), 'concise')
check('structured', m.normalizeStyle('structured'), 'structured')
check('unknown -> default', m.normalizeStyle('nope'), 'default')
check('undefined -> default', m.normalizeStyle(undefined), 'default')
check('number -> default', m.normalizeStyle(42), 'default')

console.log('\n== cleanPrompt ==')
check('fenced with lang', m.cleanPrompt(F + 'markdown\nhello world\n' + F), 'hello world')
check('fenced bare', m.cleanPrompt(F + '\nhello world\n' + F), 'hello world')
check('leading label en', m.cleanPrompt('Enhanced Prompt: do the thing'), 'do the thing')
check('leading label zh', m.cleanPrompt('增强后的提示词：写个爬虫'), '写个爬虫')
check('plain untouched', m.cleanPrompt('  正常内容  '), '正常内容')
check('multiline body kept', m.cleanPrompt(F + 'md\nline1\nline2\n' + F), 'line1\nline2')

console.log('\n== buildUserMessage ==')
const msg = m.buildUserMessage('写个爬虫', 'default')
check('substitutes the draft', msg.includes('写个爬虫'), true)
check('consumes the placeholder', msg.includes('{input}'), false)
check('is WB_PROMPT with the draft', msg, m.WB_PROMPT.replace('{input}', '写个爬虫'))
check('default adds no style',
  msg.length, m.WB_PROMPT.length - '{input}'.length + '写个爬虫'.length)

console.log('\n== collectText ==')
const fake = (async function* () {
  yield { type: 'block-start', index: 0 }
  yield { type: 'text-delta', text: 'a' }
  yield { type: 'reasoning-delta', text: 'IGNORED' }
  yield { type: 'text-delta', text: 'b' }
  yield { type: 'finish', reason: { kind: 'stop' } }
})()
check('joins text deltas only', await m.collectText(fake), 'ab')

console.log('\n== enhance: empty draft short-circuits ==')
check('empty', await m.enhance({}, { draft: '   ' }), { ok: false, error: '草稿为空，没有可增强的内容' })

console.log('\n== enhance: missing service is reported, not thrown ==')
const noLlm = await m.enhance({ get: () => undefined }, { draft: 'hi' })
check('reports failure', noLlm.ok, false)
check('names the service', noLlm.error.includes('llm'), true)

console.log('\n== enhance: happy path ==')
const okCtx = {
  get: () => ({
    stream: () => (async function* () {
      yield { type: 'text-delta', text: 'improved prompt' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })(),
  }),
}
check('ok', await m.enhance(okCtx, { draft: 'hi', provider: 'p', model: 'm' }), { ok: true, prompt: 'improved prompt' })

console.log('\n== enhance: the request matches WorkBuddy ==')
let captured = null
const captureCtx = {
  get: () => ({
    stream: (options) => {
      captured = options
      return (async function* () {
        yield { type: 'text-delta', text: 'x' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }),
}
await m.enhance(captureCtx, { draft: '草稿', style: 'default', provider: 'p', model: 'm' })
check('system is the short role line', captured.system, m.WB_SYSTEM)
check('user message is the full instruction', captured.messages[0].content[0].text, m.WB_PROMPT.replace('{input}', '草稿'))
check('one user message', captured.messages.length, 1)
check('role is user', captured.messages[0].role, 'user')

console.log('\n== enhance: model failure ==')
const badCtx = {
  get: () => ({
    stream: () => (async function* () {
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: '429' } } }
    })(),
  }),
}
const bad = await m.enhance(badCtx, { draft: 'hi', provider: 'p', model: 'm' })
check('rate limit surfaced', bad.ok, false)
check('rate limit text', bad.error.includes('额度'), true)

console.log('\n== enhance: abort ==')
const abortCtx = {
  get: () => ({ stream: () => (async function* () { yield { type: 'finish', reason: { kind: 'aborted' } } })() }),
}
check('aborted', await m.enhance(abortCtx, { draft: 'hi', provider: 'p', model: 'm' }), { ok: false, error: '已取消' })

console.log('\n== enhance: empty model output ==')
const emptyCtx = {
  get: () => ({
    stream: () => (async function* () {
      yield { type: 'text-delta', text: '   ' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })(),
  }),
}
check('empty output rejected', (await m.enhance(emptyCtx, { draft: 'hi', provider: 'p', model: 'm' })).ok, false)

console.log('\n== enhance: stream throws ==')
const throwCtx = {
  get: () => ({ stream: () => (async function* () { throw new Error('boom') })() }),
}
const thrown = await m.enhance(throwCtx, { draft: 'hi', provider: 'p', model: 'm' })
check('does not throw', thrown.ok, false)
check('reports cause', thrown.error.includes('boom'), true)

console.log('\n== describeFailure ==')
check('NO_ADAPTER', m.describeFailure({ code: 'NO_ADAPTER' }).includes('适配器'), true)
check('unknown code', m.describeFailure({ code: 'WEIRD' }).includes('WEIRD'), true)

console.log('')
console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
