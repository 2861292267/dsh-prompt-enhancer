/**
 * 配置归一化的**幂等性**。
 *
 * 这是从一个真实 bug 反推出来的测试：
 *
 *   cordis.patch.yml 里配了 `styles: { prd: ... }`，但 `/status` 报
 *   `customStyles: []` —— 自定义风格被静默丢弃。
 *
 * 根因：`Config` 是 Standard Schema，**保留未声明的键**，所以 `normalizeConfig`
 * 把 `styles` 解析成 `{ table, ids, customIds }` 之后，这个对象会被回传给
 * `apply()`。再跑一次 `resolveStyles` 时，`table`/`ids`/`customIds` 被当成三个
 * 风格 id，全部不符合 id 规则而被过滤 —— 用户的自定义风格就这样消失了。
 *
 * 本测试锁死：**解析结果必须能安全地二次传入**。
 */
import { resolveStyles, isResolvedStyles, normalizeStyle, buildUserMessage } from '../lib/index.js'

let pass = 0
let fail = 0
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; console.log('  PASS', label) }
  else { fail++; console.log('  FAIL', label, '\n    got     ', a, '\n    expected', e) }
}

console.log('== 1. isResolvedStyles 能识别解析结果 ==')
{
  const resolved = resolveStyles({ prd: '按 PRD 组织' })
  check('识别已解析结构', isResolvedStyles(resolved), true)
  check('原始 config 不被误判', isResolvedStyles({ prd: '按 PRD 组织' }), false)
  check('null 不误判', isResolvedStyles(null), false)
  check('数组不误判', isResolvedStyles([]), false)
  check('空对象不误判', isResolvedStyles({}), false)
  check('缺 customIds 不误判', isResolvedStyles({ table: {}, ids: [] }), false)
  check('table 为数组不误判', isResolvedStyles({ table: [], ids: [], customIds: [] }), false)
}

console.log('\n== 2. 核心：解析结果二次传入不得丢风格（原 bug）==')
{
  const raw = { prd: '按我们的 PRD 模板组织：背景 / 目标 / 非目标 / 验收标准。' }
  const first = resolveStyles(raw)
  check('首次解析保住 prd', first.customIds, ['prd'])

  // 这就是 bug 现场：把解析结果再喂一次
  const second = resolveStyles(first)
  check('二次解析丢失 prd（bug 的现场）', second.customIds, [])
  check('——因此 normalizeConfig 必须靠 isResolvedStyles 短路', isResolvedStyles(first), true)
}

console.log('\n== 3. 模拟 normalizeConfig 的幂等行为 ==')
{
  // 复刻 normalizeConfig 里那三行判断，验证短路逻辑正确
  const normalize = (value) => (isResolvedStyles(value) ? value : resolveStyles(value))

  const raw = { prd: '按我们的 PRD 模板组织' }
  const once = normalize(raw)
  const twice = normalize(once)
  const thrice = normalize(twice)

  check('首次含 prd', once.customIds, ['prd'])
  check('二次仍含 prd', twice.customIds, ['prd'])
  check('三次仍含 prd', thrice.customIds, ['prd'])
  check('三次结果完全一致', JSON.stringify(thrice), JSON.stringify(once))
  check('table 未损坏', typeof once.table.prd, 'string')
}

console.log('\n== 4. 幂等后下游仍然正确 ==')
{
  const normalize = (value) => (isResolvedStyles(value) ? value : resolveStyles(value))
  const normalized = normalize(normalize({ house: '按内部规范写。' }))

  check('customIds 正确', normalized.customIds, ['house'])
  check('ids 含内置与自定义', normalized.ids, ['default', 'expand', 'concise', 'structured', 'house'])
  check('defaultStyle 可解析', normalizeStyle('house', normalized.table), 'house')
  check('未知值仍回落', normalizeStyle('不存在', normalized.table), 'default')

  const msg = buildUserMessage('写点东西', 'house', normalized.table)
  check('自定义指令进入请求文本', msg.includes('按内部规范写。'), true)
  check('草稿仍在原位', msg.includes('写点东西'), true)
}

console.log('\n== 5. 混合形态：raw 与 resolved 交替传入 ==')
{
  const normalize = (value) => (isResolvedStyles(value) ? value : resolveStyles(value))
  const resolved = normalize({ a: '风格 A' })
  // 再传原始形态（模拟用户改了配置文件）
  const updated = normalize({ a: '风格 A', b: '风格 B' })
  check('原始形态按新内容解析', updated.customIds, ['a', 'b'])
  // 再传上次的解析结果
  check('旧的解析结果仍可用', normalize(resolved).customIds, ['a'])
}

console.log('')
console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
