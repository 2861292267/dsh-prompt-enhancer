/**
 * 端到端验证：用与真实 profile 相同的配置文本，驱动真实 apply()，
 * 确认自定义风格确实出现在 status 里，且在"归一化产物被回喂"时不会丢。
 *
 * 这个测试**依赖本机已安装的 profile**，别人克隆后没有该文件。
 * 因此不存在时**跳过并返回成功**，而不是失败——CI 上不该因为它红。
 * 逻辑本身的覆盖在 `custom-styles.mjs` 里，那套随时可跑。
 *
 * 用户配置文件是**可变的外部状态**（设置面板会写它，且它的优先级高于
 * patch）。断言直接对着它就会随用户操作变红——所以这里把用户配置**临时移开**，
 * 测完还原，让本测试对着受控输入跑。
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PATCH = join(homedir(), '.dsh', 'profiles', 'desktop', 'cordis.patch.yml')
const USER_CONFIG = join(homedir(), '.dsh', 'dsh-prompt-forge.config.json')

if (!existsSync(PATCH)) {
  console.log('跳过：本机没有 profile 配置（' + PATCH + '）')
  console.log('RESULT: 0 passed, 0 failed')
  process.exit(0)
}

// 把用户配置移开，保证断言不受它的影响；无论成败都还原。
const savedUserConfig = existsSync(USER_CONFIG) ? readFileSync(USER_CONFIG, 'utf8') : null
if (savedUserConfig !== null) unlinkSync(USER_CONFIG)
const restoreUserConfig = () => {
  try {
    if (savedUserConfig === null) { if (existsSync(USER_CONFIG)) unlinkSync(USER_CONFIG) }
    else writeFileSync(USER_CONFIG, savedUserConfig, 'utf8')
  } catch { /* 还原失败也不该让测试崩 */ }
}
process.on('exit', restoreUserConfig)

const mod = await import(new URL('../lib/index.js', import.meta.url).href)

let pass = 0
let fail = 0
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; console.log('  PASS', label) }
  else { fail++; console.log('  FAIL', label, '\n    got     ', a, '\n    expected', e) }
}

// 从真实 profile 里把 prompt-enhancer 那一段配置抠出来。
//
// 这里刻意用 DSH 自带的 `yaml` 包解析，而不是手写正则：手写解析器会把 `|`
// 块标量的竖线当成内容的一部分，于是测试自己出错却报绿——
// 正是本项目记录过的"桩和代码犯同一个错"那一类问题。
async function readProfileConfig() {
  const SCRIPT = `
const fs = require('fs');
const YAML = require('yaml');
const doc = YAML.parse(fs.readFileSync(process.argv[1], 'utf8'));
const layer = Array.isArray(doc) ? doc : (doc.insert ?? doc);
const all = Array.isArray(layer) ? layer : [layer];
const entry = all.flat().find((e) => e && e.id === 'prompt-enhancer');
process.stdout.write(JSON.stringify(entry && entry.config ? entry.config : null));
`
  const out = execFileSync(process.execPath, ['-e', SCRIPT, PATCH], {
    cwd: join(homedir(), '.dsh', 'profiles', 'desktop'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],   // 静音 profile 自带的 !!js 警告
    maxBuffer: 4 * 1024 * 1024,
  })
  return JSON.parse(out)
}

const config = await readProfileConfig()

/**
 * Run against a CONTROLLED config, not the live one.
 *
 * The runtime config file is user-writable (`PUT /config`), and it takes
 * precedence over this patch. Asserting against whatever the patch happens to
 * say therefore made this suite depend on mutable external state: adding a style
 * from the settings panel turned it red even though nothing was wrong.
 *
 * The patch is still READ, so the suite proves it parses and reaches `apply()`'s
 * shape; the asserted values come from here, where they cannot drift.
 */
const TEST_STYLE_ID = 'zztest'
const TEST_CONFIG = {
  ...config,
  styles: { [TEST_STYLE_ID]: '测试用风格：这一段只用于验证配置链路。' },
}

console.log('=== profile 里的配置段（原文）===')
{
  const patch = readFileSync(PATCH, 'utf8')
  const i = patch.indexOf('- id: prompt-enhancer')
  const end = patch.indexOf('\n- ', i + 10)
  console.log(patch.slice(i, end === -1 ? undefined : end).trim())
}
console.log('\n=== 解析出的 profile config（形状校验）===')
console.log(JSON.stringify(config, null, 2))
console.log(`\n=== 断言使用受控配置（风格 id: ${TEST_STYLE_ID}）===`)

/**
 * Drive the real `apply()` with the real profile config.
 *
 * `Config` is a Standard Schema that KEEPS unknown keys, so the loader hands the
 * resolved config back on later passes. This harness therefore runs `apply()`
 * twice — once with the raw config, once with the config the first run produced —
 * which is what actually exposed the idempotence bug this suite now guards.
 */
function runApply(rawConfig) {
  let statusBody
  const routes = []
  const fakeWebServer = {
    register: (def) => {
      routes.push(def.path)
      if (def.path.endsWith('/status')) {
        const res = { writeHead() {}, end: (text) => { statusBody = text } }
        def.handler({ method: 'GET', headers: {} }, res)
      }
      return () => {}
    },
  }
  const ctx = {
    effect: (fn) => fn(),
    get: (n) => (n === 'webServer' ? fakeWebServer : undefined),
    inject: () => {},
  }
  mod.apply(ctx, rawConfig)
  return { routes, status: statusBody ? JSON.parse(statusBody) : null }
}

const first = runApply(TEST_CONFIG)
await new Promise((r) => setTimeout(r, 50))

console.log('\n=== 断言（首次 apply）===')
check('四条路由已挂载（status / enhance / update / config）', first.routes.length, 4)
check('含 status 路由', first.routes.some((p) => p.endsWith('/status')), true)
check('含 enhance 路由', first.routes.some((p) => p.endsWith('/enhance')), true)
check('含 update 路由', first.routes.some((p) => p.endsWith('/update')), true)
check('含 config 路由（设置面板用）', first.routes.some((p) => p.endsWith('/config')), true)

check('自定义风格进入 styles', first.status.styles.includes(TEST_STYLE_ID), true)
check('customStyles 标出它', first.status.customStyles, [TEST_STYLE_ID])
check('内置仍完整', first.status.styles.filter((s) => ['default', 'expand', 'concise', 'structured'].includes(s)).length, 4)
check('defaultStyle 仍是 default', first.status.defaultStyle, 'default')

/**
 * The loader re-enters `apply()` with the config the previous run produced,
 * because `Config` keeps unknown keys. What it hands back is the plugin's own
 * normalized config object — specifically the resolved
 * `{ table, ids, customIds }` under `styles`, not the id array `/status` reports.
 *
 * Feeding that straight back used to strip every custom style, because
 * `resolveStyles` treated `table`/`ids`/`customIds` as three malformed style ids.
 * This is the regression guard.
 */
console.log('\n=== 断言（把归一化产物再喂给 apply —— 真实装载路径）===')
{
  const resolvedStyles = mod.resolveStyles(TEST_CONFIG.styles)
  const second = runApply({ ...TEST_CONFIG, styles: resolvedStyles })
  check('二次 apply 后自定义风格仍在', second.status.customStyles, [TEST_STYLE_ID])
  check('二次 apply 后自定义风格仍在 styles 里', second.status.styles.includes(TEST_STYLE_ID), true)
  check('二次 apply 后内置风格未受影响', second.status.styles.filter((s) => ['default', 'expand', 'concise', 'structured'].includes(s)).length, 4)
}

console.log('')
console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
