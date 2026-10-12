/**
 * Verify the port reproduces WorkBuddy's behaviour, using the strings recovered
 * from its own bundle as the reference.
 */
import { readFileSync } from 'node:fs'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; console.log('  PASS', label) }
  else { fail++; console.log('  FAIL', label, '\n    got     ', String(a).slice(0, 200), '\n    expected', String(e).slice(0, 200)) }
}

const mod = await import(new URL('../lib/index.js', import.meta.url).href)

console.log('== the instruction matches WorkBuddy exactly ==')
// `_wb/prompt-exact.txt` is the decoded `Zo` template literal, extracted by
// scanning to its unescaped closing backtick (see _wb_exact.mjs).
const ref = readFileSync('D:/DeepSeek Harness工作区/破甲软件/_wb/prompt-exact.txt', 'utf8')
check('WB_PROMPT equals the extracted literal', mod.WB_PROMPT === ref, true)
console.log('     plugin:', mod.WB_PROMPT.length, 'chars | reference:', ref.length, 'chars')
if (mod.WB_PROMPT !== ref) {
  let i = 0
  while (i < ref.length && i < mod.WB_PROMPT.length && ref[i] === mod.WB_PROMPT[i]) i++
  console.log('     first divergence at', i)
  console.log('     ref   :', JSON.stringify(ref.slice(i, i + 120)))
  console.log('     plugin:', JSON.stringify(mod.WB_PROMPT.slice(i, i + 120)))
}

console.log('\n== the system prompt is WorkBuddy short role line ==')
check('WB_SYSTEM', mod.WB_SYSTEM,
  'You are a prompt enhancement assistant. Improve the user prompt while preserving its intent and language.')

console.log('\n== {input} substitution ==')
const built = mod.buildUserMessage('写个爬虫', 'default')
check('draft substituted', built.includes('写个爬虫'), true)
check('placeholder consumed', built.includes('{input}'), false)
check('default style adds nothing', built, mod.WB_PROMPT.replace('{input}', '写个爬虫'))

console.log('\n== other styles append guidance ==')
for (const style of ['expand', 'concise', 'structured']) {
  const out = mod.buildUserMessage('x', style)
  check(style + ' starts from WB_PROMPT', out.startsWith(mod.WB_PROMPT.replace('{input}', 'x')), true)
  check(style + ' is longer', out.length > mod.WB_PROMPT.length, true)
}

console.log('\n== quote stripping matches WorkBuddy rule ==')
check('double quotes', mod.cleanPrompt('"hello"'), 'hello')
check('single quotes', mod.cleanPrompt("'hello'"), 'hello')
check('curly double quotes', mod.cleanPrompt('\u201Chello\u201D'), 'hello')
check('curly single quotes', mod.cleanPrompt('\u2018hello\u2019'), 'hello')
check('surrounding space', mod.cleanPrompt('   hello   '), 'hello')
check('inner quotes preserved', mod.cleanPrompt('say "hi" now'), 'say "hi" now')
check('fence removed', mod.cleanPrompt('```\nhello\n```'), 'hello')

console.log('\n== styles normalize to the original by default ==')
check('unknown -> default', mod.normalizeStyle('nope'), 'default')
check('undefined -> default', mod.normalizeStyle(undefined), 'default')
check('default is a known style', mod.normalizeStyle('default'), 'default')

console.log('\n== the language rules survived the port ==')
for (const rule of [
  'LANGUAGE CONSISTENCY',
  'MUST be entirely in Chinese',
  'MUST be entirely in English',
  'never include language analysis or language labels',
  'Do not answer the request',
  'Return only the enhanced prompt text',
]) {
  check('contains: ' + rule.slice(0, 40), mod.WB_PROMPT.includes(rule), true)
}

console.log('')
console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
