/**
 * 面板「有没有改动」的判定。
 *
 * 原来用 `JSON.stringify` 比较两个风格表，**对键顺序敏感** ——
 * 同一份内容只要键序不同就被判为"改过了"，于是白白重写配置文件。
 * 而重写正是"风格看起来消失了"发生的时候，所以这条判定必须可靠。
 *
 * 本测试锁死：内容相同 ⇒ 判定为无改动（与键序无关）。
 */
let pass = 0
let fail = 0
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; console.log('  PASS', label) }
  else { fail++; console.log('  FAIL', label, '\n    got     ', a, '\n    expected', e) }
}

/** 复刻 lib/client.js 里的实现。 */
function sameStyles(a, b) {
  const norm = (o) =>
    Object.entries(o && typeof o === 'object' ? o : {})
      .map(([k, v]) => JSON.stringify([k, v]))
      .sort()
      .join(',')
  return norm(a) === norm(b)
}

console.log('== 1. 内容相同 → 无改动 ==')
check('完全相同的对象', sameStyles({ a: '1' }, { a: '1' }), true)
check('键序不同视为相同（旧实现会误判）', sameStyles({ a: '1', b: '2' }, { b: '2', a: '1' }), true)
check('三键乱序', sameStyles({ a: '1', b: '2', c: '3' }, { c: '3', a: '1', b: '2' }), true)

console.log('\n== 2. 内容不同 → 有改动 ==')
check('值不同', sameStyles({ a: '1' }, { a: '2' }), false)
check('多了键', sameStyles({ a: '1' }, { a: '1', b: '2' }), false)
check('少了键', sameStyles({ a: '1', b: '2' }, { a: '1' }), false)

console.log('\n== 3. 空值处理 ==')
check('两个空对象', sameStyles({}, {}), true)
check('空 vs null', sameStyles({}, null), true)
check('空 vs undefined', sameStyles({}, undefined), true)
check('null vs undefined', sameStyles(null, undefined), true)
check('空 vs 有内容', sameStyles({}, { a: '1' }), false)
check('有内容 vs 空', sameStyles({ a: '1' }, {}), false)

console.log('\n== 4. 边界：值与分隔符别混淆 ==')
// 旧实现靠 JSON 序列化，天然安全；新实现用分隔符拼接，需确认不会串味
check('值里含分隔符不误判相同', sameStyles({ a: 'x\u0001b\u0000y' }, { a: 'x', b: 'y' }), false)
check('键名含分隔符不误判相同', sameStyles({ 'a\u0000b': 'c' }, { a: 'b\u0000c' }), false)

console.log('\n== 5. 真实场景：原 bug 的具体形状 ==')
{
  // 面板从磁盘读回的顺序，与用户编辑后重建的顺序可能不同
  const fromDisk = { sql: '改写为 SQL 需求：说明表、字段、过滤条件。', prd: '按 PRD 模板组织。' }
  const afterEdit = { prd: '按 PRD 模板组织。', sql: '改写为 SQL 需求：说明表、字段、过滤条件。' }
  check('键序不同但内容一致 → 判定无改动（不重写文件）', sameStyles(afterEdit, fromDisk), true)
  // 旧实现在这里会返回"有改动"
  check('旧实现（JSON.stringify）会误判为有改动', JSON.stringify(afterEdit) !== JSON.stringify(fromDisk), true)
}

console.log('\n== 6. 非对象入参不崩 ==')
for (const bad of [null, undefined, 0, '', [], 'x']) {
  let threw = false
  try { sameStyles(bad, bad) } catch { threw = true }
  check(`入参 ${JSON.stringify(bad)} 不抛错`, threw, false)
}

console.log('')
console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
