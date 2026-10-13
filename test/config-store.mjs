/**
 * 配置持久化层。
 *
 * 这一层最容易出错的地方不是"能不能写"，而是：
 *   - 读写失败时**不能抛**（磁盘只读、JSON 损坏、文件被截断）；
 *   - 写入必须**原子**（中途崩溃不能留半个文件）；
 *   - 必须是**顶层键 merge**（多写入方不互相清空）。
 *
 * 测试用真实的配置文件，但会先备份并在结束时还原。
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { CONFIG_FILE, readUserConfig, writeUserConfig, mergeConfig } from '../lib/config.js'

let pass = 0
let fail = 0
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; console.log('  PASS', label) }
  else { fail++; console.log('  FAIL', label, '\n    got     ', a, '\n    expected', e) }
}

// 备份用户的真实配置，测完还原——这些测试会写真实文件
const BACKUP = existsSync(CONFIG_FILE) ? readFileSync(CONFIG_FILE, 'utf8') : null
const restore = () => {
  try {
    if (BACKUP === null) { if (existsSync(CONFIG_FILE)) unlinkSync(CONFIG_FILE) }
    else writeFileSync(CONFIG_FILE, BACKUP, 'utf8')
  } catch { /* 还原失败也不该让测试崩 */ }
}

console.log(`配置文件: ${CONFIG_FILE}`)

try {
  // 干净起点
  if (existsSync(CONFIG_FILE)) unlinkSync(CONFIG_FILE)

  console.log('\n== 1. 文件不存在时返回空对象 ==')
  check('readUserConfig 返回 {}', readUserConfig(), {})

  console.log('\n== 2. 写入后能读回 ==')
  {
    const w = writeUserConfig({ defaultStyle: 'concise' })
    check('写入成功', w.ok, true)
    check('文件已生成', existsSync(CONFIG_FILE), true)
    check('读回一致', readUserConfig().defaultStyle, 'concise')
  }

  console.log('\n== 3. 顶层键 merge，不整体替换 ==')
  {
    writeUserConfig({ slashCommand: false })
    const c = readUserConfig()
    check('旧键仍在', c.defaultStyle, 'concise')
    check('新键已写入', c.slashCommand, false)
  }

  console.log('\n== 4. 损坏的 JSON 不抛错，退回空对象 ==')
  {
    writeFileSync(CONFIG_FILE, '{ 这不是 JSON', 'utf8')
    let threw = false
    let r
    try { r = readUserConfig() } catch { threw = true }
    check('不抛错', threw, false)
    check('退回空对象', r, {})
    // 损坏后仍能写入（覆盖恢复）
    const w = writeUserConfig({ defaultStyle: 'expand' })
    check('损坏后仍可写入', w.ok, true)
    check('写入后可读回', readUserConfig().defaultStyle, 'expand')
  }

  console.log('\n== 5. 内容是数组 / 标量时不当作配置 ==')
  {
    writeFileSync(CONFIG_FILE, '[1,2,3]', 'utf8')
    check('数组退回空对象', readUserConfig(), {})
    writeFileSync(CONFIG_FILE, '42', 'utf8')
    check('标量退回空对象', readUserConfig(), {})
  }

  console.log('\n== 6. 非法 patch 被拒 ==')
  {
    for (const bad of [null, undefined, 'x', 42, []]) {
      const w = writeUserConfig(bad)
      check(`patch=${JSON.stringify(bad)} 被拒`, w.ok, false)
      check(`patch=${JSON.stringify(bad)} 有原因`, typeof w.error, 'string')
    }
  }

  console.log('\n== 7. mergeConfig 的优先级：用户配置 > 静态 config ==')
  {
    if (existsSync(CONFIG_FILE)) unlinkSync(CONFIG_FILE)
    writeUserConfig({ defaultStyle: 'structured' })
    const merged = mergeConfig({ provider: 'p', model: 'm', defaultStyle: 'default', slashCommand: true })
    check('用户值覆盖静态值', merged.defaultStyle, 'structured')
    check('静态值在不冲突时保留', merged.provider, 'p')
    check('静态值在不冲突时保留（2）', merged.slashCommand, true)
  }

  console.log('\n== 8. 无用户配置时退回静态 config ==')
  {
    if (existsSync(CONFIG_FILE)) unlinkSync(CONFIG_FILE)
    const merged = mergeConfig({ provider: 'p', model: 'm' })
    check('原样返回', merged.provider, 'p')
    check('原样返回（2）', merged.model, 'm')
  }

  console.log('\n== 9. 静态 config 非法时不崩 ==')
  {
    for (const bad of [null, undefined, 'x', 42, []]) {
      let threw = false
      let r
      try { r = mergeConfig(bad) } catch { threw = true }
      check(`静态 ${JSON.stringify(bad)} 不抛错`, threw, false)
      check(`静态 ${JSON.stringify(bad)} 返回对象`, typeof r, 'object')
    }
  }

  console.log('\n== 10. 写入是原子的（不留临时文件） ==')
  {
    writeUserConfig({ defaultStyle: 'default' })
    const dir = dirname(CONFIG_FILE)
    const leftovers = readFileSync(CONFIG_FILE, 'utf8').includes('.tmp')
    check('配置文件内容正常', leftovers, false)
    // 目录里不应残留 .tmp
    const { readdirSync } = await import('node:fs')
    const tmps = readdirSync(dir).filter((f) => f.includes('dsh-prompt-forge.config.json.') && f.endsWith('.tmp'))
    check('无残留临时文件', tmps, [])
  }
} finally {
  restore()
}

console.log('')
console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
