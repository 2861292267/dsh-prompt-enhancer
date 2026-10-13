/**
 * Switch this plugin from a local `link:` install to a `github:` install so the
 * Market can track and update it.
 *
 * Why this is needed: the Market reports `source: "linked"` with
 * `latestVersion: null` for a `link:` dependency — there is no registry or
 * remote behind it, so "update" has no meaning. A `github:` dependency carries a
 * commit id, which the Market can compare against the branch head.
 *
 * The package NAME stays `@local/dsh-prompt-enhancer`. That is the identity the
 * loader resolves the patch entry against, and changing it would break the
 * profile's `cordis.patch.yml` row.
 *
 * Usage:
 *   node tools/switch-to-github.mjs            # dry run, prints the plan
 *   node tools/switch-to-github.mjs --apply    # performs the change
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const PKG = '@local/dsh-prompt-enhancer'
const REPO = 'github:2861292267/dsh-prompt-enhancer'
const PROFILE_DIR = join(homedir(), '.dsh', 'profiles', 'desktop')
const PKG_JSON = join(PROFILE_DIR, 'package.json')
const APPLY = process.argv.includes('--apply')

if (!existsSync(PKG_JSON)) {
  console.error(`找不到 profile package.json: ${PKG_JSON}`)
  process.exit(1)
}

const raw = readFileSync(PKG_JSON, 'utf8')
const json = JSON.parse(raw)
const current = json.dependencies?.[PKG]

if (current === undefined) {
  console.error(`profile 里没有依赖 ${PKG}`)
  process.exit(1)
}

console.log(`profile      : ${PROFILE_DIR}`)
console.log(`当前依赖写法 : ${current}`)

if (current.startsWith('github:')) {
  console.log('已经是 github 源，无需切换。')
  process.exit(0)
}

if (!current.startsWith('link:')) {
  console.error(`未预期的来源类型，请人工处理：${current}`)
  process.exit(1)
}

const next = `${REPO}#main`
console.log(`目标写法     : ${next}`)
console.log('')
console.log('将要做的改动：')
console.log(`  1. dependencies["${PKG}"]  ${current}  →  ${next}`)
console.log(`  2. dsh.profile.bundles 保持包含 "${PKG}"（不变）`)
console.log('  3. 备份原 package.json 为 package.json.bak-before-github')
console.log('')
console.log('保持不变：')
console.log(`  · 包名仍是 ${PKG}（cordis.patch.yml 靠它定位，不能改）`)
console.log(`  · profile 的 cordis.patch.yml 里的 "- id: prompt-enhancer" 无需改动`)
console.log('')

if (!APPLY) {
  console.log('当前是预演（dry run）。确认无误后加 --apply 执行。')
  process.exit(0)
}

// Preserve the original file byte-for-byte before touching it.
copyFileSync(PKG_JSON, PKG_JSON + '.bak-before-github')

json.dependencies[PKG] = next
writeFileSync(PKG_JSON, JSON.stringify(json, null, 2) + '\n', 'utf8')

console.log(`已改写依赖：${next}`)
console.log(`备份：${PKG_JSON}.bak-before-github`)
console.log('')
console.log('下一步：')
console.log('  1. 在 profile 目录执行 pnpm install（或让 DSH 重启时自行安装）')
console.log('  2. 重启 DSH')
console.log('  3. 访问 /plugins/dsh-prompt-enhancer/update 应返回 kind=current 或 available')
console.log('')
console.log('回滚：把 package.json.bak-before-github 覆盖回去并重新 pnpm install。')
