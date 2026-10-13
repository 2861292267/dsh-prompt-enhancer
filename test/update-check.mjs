/**
 * Update check: every branch, with a stubbed Market.
 *
 * The Market's API is versioned and its absence is normal (a Host without
 * `dshmarket` installed), so each outcome has to be an explainable state rather
 * than a thrown error.
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// `import()` needs a URL on Windows; a bare `D:\...` path is rejected.
const mod = await import(new URL('../lib/index.js', import.meta.url).href)

let pass = 0
let fail = 0
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; console.log('  PASS', label) }
  else { fail++; console.log('  FAIL', label, '\n    got     ', a, '\n    expected', e) }
}

const REAL_FETCH = globalThis.fetch
const CAPS = {
  schema: 'dsh-market/update-api/v1',
  marketVersion: '1.66.11',
  restart: { supported: false, managedBy: 'desktop-host' },
}

/** Install a fake Market that answers the two endpoints. */
function fakeMarket({ caps = CAPS, pkg, failCaps = false, failPkg = false, badSchema = false } = {}) {
  globalThis.fetch = async (url) => {
    if (url.endsWith('/capabilities')) {
      if (failCaps) return { ok: false }
      return { ok: true, async json() { return badSchema ? { schema: 'other' } : caps } }
    }
    if (url.includes('/updates?name=')) {
      if (failPkg) return { ok: false }
      return { ok: true, async json() { return { schema: 'dsh-market/update-api/v1', package: pkg } } }
    }
    return { ok: false }
  }
}

console.log('== 1. 市场未安装（capabilities 不可达）==')
fakeMarket({ failCaps: true })
{
  const r = await mod.checkForUpdate('http://127.0.0.1:19387')
  check('不抛错且标记 unavailable', r.kind, 'unavailable')
  check('仍然报告自身版本', r.current, mod.PACKAGE_VERSION)
  check('给出可读原因', typeof r.reason === 'string' && r.reason.length > 0, true)
}

console.log('\n== 2. 市场响应 schema 不匹配（未来版本）==')
fakeMarket({ badSchema: true })
{
  const r = await mod.checkForUpdate('http://127.0.0.1:19387')
  check('拒绝非 v1 schema，视为不可用', r.kind, 'unavailable')
}

console.log('\n== 3. link 安装（本机常见）==')
fakeMarket({ pkg: { name: '@local/dsh-prompt-forge', source: 'linked', installedVersion: '1.1.0', latestVersion: null, updateAvailable: false } })
{
  const r = await mod.checkForUpdate('http://127.0.0.1:19387')
  check('识别为 linked', r.kind, 'linked')
  check('无可用更新', r.updateAvailable, false)
  check('不给 latest', r.latest, null)
  check('说明为何不能远程更新', r.reason.includes('link'), true)
}

console.log('\n== 4. github 源且已是最新 ==')
fakeMarket({ pkg: { name: '@local/dsh-prompt-forge', source: 'github', installedVersion: '1.1.0', latestVersion: 'abc1234', updateAvailable: false } })
{
  const r = await mod.checkForUpdate('http://127.0.0.1:19387')
  check('识别为 current', r.kind, 'current')
  check('updateAvailable=false', r.updateAvailable, false)
  check('带上 source', r.source, 'github')
}

console.log('\n== 5. 有新版本 ==')
fakeMarket({ pkg: { name: '@local/dsh-prompt-forge', source: 'npm', installedVersion: '1.1.0', latestVersion: '1.2.0', updateAvailable: true } })
{
  const r = await mod.checkForUpdate('http://127.0.0.1:19387')
  check('识别为 available', r.kind, 'available')
  check('updateAvailable=true', r.updateAvailable, true)
  check('给出版本号', [r.current, r.latest], ['1.1.0', '1.2.0'])
}

console.log('\n== 6. 重启能力必须如实透传 ==')
fakeMarket({
  caps: { ...CAPS, restart: { supported: true, managedBy: 'self' } },
  pkg: { name: '@local/dsh-prompt-forge', source: 'npm', installedVersion: '1.1.0', latestVersion: '1.2.0', updateAvailable: true },
})
{
  const r = await mod.checkForUpdate('http://127.0.0.1:19387')
  check('restart.supported=true 被透传', r.restartSupported, true)
}
fakeMarket({ pkg: { name: '@local/dsh-prompt-forge', source: 'npm', installedVersion: '1.1.0', latestVersion: '1.2.0', updateAvailable: true } })
{
  const r = await mod.checkForUpdate('http://127.0.0.1:19387')
  check('Desktop 托管时 restart.supported=false', r.restartSupported, false)
}

console.log('\n== 7. 边界输入不得抛错 ==')
{
  for (const bad of ['', null, undefined, 123]) {
    let threw = false
    let r
    try { r = await mod.checkForUpdate(bad) } catch { threw = true }
    check(`入参 ${JSON.stringify(bad)} 不抛错`, threw, false)
    check(`入参 ${JSON.stringify(bad)} 返回 unavailable`, r && r.kind, 'unavailable')
  }
}
{
  // 市场收录了包但无 package 字段
  globalThis.fetch = async (url) => {
    if (url.endsWith('/capabilities')) return { ok: true, async json() { return CAPS } }
    return { ok: true, async json() { return { schema: 'dsh-market/update-api/v1' } } }
  }
  const r = await mod.checkForUpdate('http://127.0.0.1:19387')
  check('无 package 字段时标记 unknown', r.kind, 'unknown')
}

console.log('\n== 8. 网络超时被捕获，不冒泡 ==')
{
  globalThis.fetch = async () => { throw new Error('network down') }
  const r = await mod.checkForUpdate('http://127.0.0.1:19387')
  check('网络异常归为 unavailable', r.kind, 'unavailable')
}

globalThis.fetch = REAL_FETCH
console.log('')
console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
