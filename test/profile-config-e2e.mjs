/**
 * 端到端验证：用与真实 profile 完全相同的配置文本，驱动真实 apply()，
 * 确认自定义风格确实出现在 status 里。
 *
 * 这个测试**依赖本机已安装的 profile**，别人克隆后没有该文件。
 * 因此不存在时**跳过并返回成功**，而不是失败——CI 上不该因为它红。
 * 这不是"测不到就算过"：它测的是一个只有装好插件才存在的集成点，
 * 逻辑本身的覆盖在 `custom-styles.mjs` 里，那套随时可跑。
 */
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PATCH = join(homedir(), '.dsh', 'profiles', 'desktop', 'cordis.patch.yml')

if (!existsSync(PATCH)) {
  console.log('跳过：本机没有 profile 配置（' + PATCH + '）')
  console.log('RESULT: 0 passed, 0 failed')
  process.exit(0)
}

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

console.log('=== profile 里的配置段（原文）===')
{
  const patch = readFileSync(PATCH, 'utf8')
  const i = patch.indexOf('- id: prompt-enhancer')
  const end = patch.indexOf('\n- ', i + 10)
  console.log(patch.slice(i, end === -1 ? undefined : end).trim())
}
console.log('\n=== 解析出的 config ===')
console.log(JSON.stringify(config, null, 2))

// ---- 用真实配置驱动真实 apply() ----
let statusBody
const routes = []
const fakeWebServer = {
  register: (def) => {
    routes.push(def.path)
    if (def.path.endsWith('/status')) {
      // 直接调用 handler，读真实响应
      const res = {
        writeHead() {},
        end: (text) => { statusBody = text },
      }
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

mod.apply(ctx, config)
await new Promise((r) => setTimeout(r, 50))

console.log('\n=== 断言 ===')
check('四条路由已挂载（status / enhance / update / config）', routes.length, 4)
check('含 status 路由', routes.some((p) => p.endsWith('/status')), true)
check('含 enhance 路由', routes.some((p) => p.endsWith('/enhance')), true)
check('含 update 路由', routes.some((p) => p.endsWith('/update')), true)
check('含 config 路由（设置面板用）', routes.some((p) => p.endsWith('/config')), true)

const status = JSON.parse(statusBody)
check('自定义风格进入 styles', status.styles.includes('prd'), true)
check('customStyles 标出它', status.customStyles, ['prd'])
check('内置仍完整', status.styles.filter((s) => ['default', 'expand', 'concise', 'structured'].includes(s)).length, 4)
check('defaultStyle 仍是 default', status.defaultStyle, 'default')

console.log('')
console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
