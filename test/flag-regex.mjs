/**
 * 验证 index.js 里从 STYLES 派生的 flag 正则确实覆盖全部风格。
 * （单独成文件，避免 PowerShell 单行里的反斜杠转义把 \\s 吃掉导致误判。）
 */
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')

let pass = 0, fail = 0
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) { pass++; console.log('  PASS', label) }
  else { fail++; console.log('  FAIL', label, '\n    got     ', a, '\n    expected', e) }
}

// 从源码里取出 STYLE_GUIDE 的键，模拟真实的 STYLES
const guideBlock = /const STYLE_GUIDE = \{([\s\S]*?)\n\}/.exec(SRC)
if (!guideBlock) throw new Error('未找到 STYLE_GUIDE')
const keys = [...guideBlock[1].matchAll(/^\s{2}([a-z]+):/gm)].map((m) => m[1])
console.log('从源码解析出的 STYLES:', JSON.stringify(keys))
check('STYLES 含 4 项', keys.length, 4)
check('含 default', keys.includes('default'), true)

// 正则必须由「生效的风格表」派生，而不是又写死一份。
// 注意来源已从 STYLES（仅内置）改为 config.styles.ids（内置 + 用户自定义），
// 这样用户新增的风格也能在 /enhance 上用。
check('正则由生效风格表派生', /new RegExp\('\^--\(' \+ styleList \+ '\)/.test(SRC), true)
check('不再有写死的三风格正则', /\^--\(expand\|concise\|structured\)/.test(SRC), false)

// 用派生方式重建正则，验证 4 种风格全部匹配、未知 flag 不匹配
const re = new RegExp('^--(' + keys.join('|') + ')\\s+')
for (const style of keys) {
  const m = re.exec(`--${style} 我的草稿`)
  check(`--${style} 被识别，草稿剥离正确`, m && m[1] === style ? '我的草稿' : null, '我的草稿')
}
check('--bogus 不匹配（留给草稿正文）', re.exec('--bogus 内容'), null)

console.log('')
console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
