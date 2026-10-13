/**
 * 自定义风格模板。
 *
 * 内置四种风格原本写死在代码里，用户无法增改。现在 `styles` 配置可以追加
 * 自己的风格（一段附加指令文本），复刻"数据而非代码"的做法。
 *
 * 关键约束（本测试逐条覆盖）：
 *   - 自定义风格不得覆盖内置（尤其 default 必须保持 WorkBuddy 原样）；
 *   - 非法 id / 非字符串 / 空文本一律**静默跳过**，绝不让配置错误禁用功能；
 *   - 数量有上限，避免失控的配置撑爆每次请求；
 *   - `defaultStyle` 可以指向自定义风格，但未知值仍回落 default。
 */
import { resolveStyles, normalizeStyle, buildUserMessage } from '../lib/index.js'

let pass = 0
let fail = 0
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; console.log('  PASS', label) }
  else { fail++; console.log('  FAIL', label, '\n    got     ', a, '\n    expected', e) }
}

console.log('== 1. 无自定义时，行为与改动前完全一致 ==')
{
  const r = resolveStyles(undefined)
  check('四项内置', r.ids.length, 4)
  check('无自定义', r.customIds, [])
  check('顺序稳定', r.ids.join(','), 'default,expand,concise,structured')
}

console.log('\n== 2. 合法自定义风格被接受 ==')
{
  const r = resolveStyles({ prd: '按我们的 PRD 模板组织：背景 / 目标 / 验收。' })
  check('内置 + 自定义', r.ids, ['default', 'expand', 'concise', 'structured', 'prd'])
  check('customIds 记下它', r.customIds, ['prd'])
  check('内容被包进风格框架', r.table.prd.includes('ADDITIONAL STYLE - PRD:'), true)
  check('原文保留', r.table.prd.includes('按我们的 PRD 模板组织'), true)
}

console.log('\n== 3. 不得覆盖内置（最重要）==')
{
  const r = resolveStyles({ default: '被篡改的 default', concise: '被篡改的 concise' })
  check('default 未被覆盖', r.table.default, '')
  check('concise 未被覆盖', r.table.concise.includes('Tighten the result'), true)
  check('两个都被跳过，不算自定义', r.customIds, [])
  // 这是护栏的核心：default 必须仍是"什么都不附加"
  check('default 风格仍等于原版行为',
    buildUserMessage('草稿', 'default', r.table) === buildUserMessage('草稿', 'default'),
    true)
}

console.log('\n== 4. 非法条目静默跳过，不影响其它条目 ==')
{
  const r = resolveStyles({
    '带空格 的id': 'x',          // id 非法
    '中文id': 'x',               // id 非法
    '1开头': 'x',                // 不能数字开头
    'A大写': 'x',                // 必须小写
    good: '合法的那一个',
    empty: '   ',                // 空白文本
    number: 123,                 // 非字符串
    nul: null,
  })
  check('只留下合法的', r.customIds, ['good'])
  check('合法的内容正确', r.table.good.includes('合法的那一个'), true)
}

console.log('\n== 5. styles 配置本身形态错误时不崩 ==')
{
  for (const bad of [null, undefined, [], 'string', 42, true]) {
    let threw = false
    let r
    try { r = resolveStyles(bad) } catch { threw = true }
    check(`入参 ${JSON.stringify(bad)} 不抛错`, threw, false)
    check(`入参 ${JSON.stringify(bad)} 退回内置`, r.ids.length, 4)
  }
}

console.log('\n== 6. 数量上限 ==')
{
  const many = {}
  for (let i = 0; i < 40; i++) many[`s${i}`] = `风格 ${i}`
  const r = resolveStyles(many)
  check('自定义数量被限制', r.customIds.length <= 12, true)
  check('确实有截断', r.customIds.length, 12)
}

console.log('\n== 7. defaultStyle 可指向自定义风格 ==')
{
  const r = resolveStyles({ house: '按内部规范写。' })
  check('自定义风格可作默认', normalizeStyle('house', r.table), 'house')
  check('内置仍可用', normalizeStyle('concise', r.table), 'concise')
  check('未知值回落 default', normalizeStyle('不存在', r.table), 'default')
}

console.log('\n== 8. 自定义风格真的进入了发给模型的文本 ==')
{
  const r = resolveStyles({ house: '按内部规范写。' })
  const withCustom = buildUserMessage('写点东西', 'house', r.table)
  const builtinOnly = buildUserMessage('写点东西', 'house')   // 无 table → 回落 default

  check('含自定义指令', withCustom.includes('按内部规范写。'), true)
  check('未传 table 时回落为 default 行为', builtinOnly === buildUserMessage('写点东西', 'default'), true)
  check('草稿仍在 {input} 位置', withCustom.includes('写点东西'), true)
  check('两段确实不同', withCustom !== builtinOnly, true)
}

console.log('')
console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
