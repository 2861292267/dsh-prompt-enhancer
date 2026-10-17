/**
 * 路由解析的优先级。
 *
 * 这一版把「跟随默认模型」放在配置之前 —— 原来是硬编码优先，
 * 因为早期版本读不到 `agentDefaultModel` 服务，硬编码是绕开
 * `provider "undefined"` 的唯一办法。那个绕法活过了问题本身：
 * 部署的默认 provider 一换，写死的值就静默过期，而改写一直用旧的。
 *
 * 本测试锁死优先级，以及那条曾经有害的兜底。
 */
import { resolveRoute, anyProviderRoute } from '../lib/index.js'

let pass = 0
let fail = 0
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; console.log('  PASS', label) }
  else { fail++; console.log('  FAIL', label, `\n    got=${a}\n    exp=${e}`) }
}

/** 造一个最小 ctx：按服务名返回替身。 */
function ctxWith(services) {
  return { get: (name) => services[name], services }
}

/** agentDefaultModel 的忠实替身。 */
const defaultModel = (provider, model) => ({
  currentSelection: () => ({ provider, model }),
})

/** llm 的替身，只给 listProviders。 */
const llmWith = (...providers) => ({ listProviders: () => providers })

console.log('== 1. 会话默认模型胜过配置（本次改动的核心）==')
{
  const ctx = ctxWith({ agentDefaultModel: defaultModel('buddy', 'v4-flash') })
  const config = { provider: 'workbuddy-xdpool', model: 'deepseek-v4.1-flash' }
  const r = resolveRoute(ctx, config, undefined)
  check('用会话的 provider', r.provider, 'buddy')
  check('用会话的 model', r.model, 'v4-flash')
}

console.log('\n== 2. 请求体胜过会话 ==')
{
  const ctx = ctxWith({ agentDefaultModel: defaultModel('buddy', 'v4-flash') })
  const config = { provider: 'p', model: 'm' }
  const r = resolveRoute(ctx, config, { provider: 'explicit', model: 'explicit-model' })
  check('provider 被覆盖', r.provider, 'explicit')
  check('model 被覆盖', r.model, 'explicit-model')
}

console.log('\n== 3. 会话不可用时回落到配置 ==')
{
  const ctx = ctxWith({})   // 没有任何服务
  const config = { provider: 'workbuddy-xdpool', model: 'deepseek-v4.1-flash' }
  const r = resolveRoute(ctx, config, undefined)
  check('回落到配置 provider', r.provider, 'workbuddy-xdpool')
  check('回落到配置 model', r.model, 'deepseek-v4.1-flash')
}

console.log('\n== 4. 字段独立解析：会话只有 provider 时 ==')
{
  // currentSelection 返回 provider 但 model 为空
  const ctx = ctxWith({ agentDefaultModel: { currentSelection: () => ({ provider: 'buddy', model: '' }) } })
  const config = { provider: 'cfg-p', model: 'cfg-m' }
  const r = resolveRoute(ctx, config, undefined)
  check('provider 用会话的', r.provider, 'buddy')
  check('model 回落到配置的（不是整体回落）', r.model, 'cfg-m')
}

console.log('\n== 5. preferAgentDefault:false 时配置优先 ==')
{
  const ctx = ctxWith({ agentDefaultModel: defaultModel('buddy', 'v4-flash') })
  const config = { provider: 'pinned', model: 'pinned-model' }
  const r = resolveRoute(ctx, config, undefined, { preferAgentDefault: false })
  check('配置说了算', r.provider, 'pinned')
  check('配置说了算（model）', r.model, 'pinned-model')
}

console.log('\n== 6. 关键：任意 provider 不得盖过配置 ==')
{
  // 这是本次重构修掉的真实缺陷：listProviders 曾在 currentAgentRoute 的
  // 兜底链里，导致一个"随便挑的" provider 赢过配置里正确的值。
  const ctx = ctxWith({
    agentDefaultModel: { currentSelection: () => ({ provider: '', model: '' }) },
    llm: llmWith('some-random-provider'),
  })
  const config = { provider: 'workbuddy-xdpool', model: 'deepseek-v4.1-flash' }
  const r = resolveRoute(ctx, config, undefined)
  check('配置仍是 workbuddy-xdpool（未被随机 provider 顶掉）', r.provider, 'workbuddy-xdpool')
  check('model 未被顶掉', r.model, 'deepseek-v4.1-flash')
}

console.log('\n== 7. 全都拿不到时才用任意 provider 兜底 ==')
{
  const ctx = ctxWith({ llm: llmWith('only-provider') })
  const r = resolveRoute(ctx, {}, undefined)
  check('兜底用了唯一 provider', r.provider, 'only-provider')
  check('model 不瞎猜，留空', r.model, undefined)
}

console.log('\n== 8. anyProviderRoute 单独行为 ==')
{
  check('有 provider 时返回它', anyProviderRoute(ctxWith({ llm: llmWith('x') })).provider, 'x')
  check('对象形态的 provider 取 id', anyProviderRoute(ctxWith({ llm: llmWith({ id: 'obj-id' }) })).provider, 'obj-id')
  check('无 llm 返回空对象', anyProviderRoute(ctxWith({})), {})
  check('listProviders 抛错不崩', anyProviderRoute(ctxWith({ llm: { listProviders: () => { throw new Error('boom') } } })), {})
  check('空列表返回空对象', anyProviderRoute(ctxWith({ llm: llmWith() })), {})
}

console.log('\n== 9. 入参健壮性 ==')
{
  const ctx = ctxWith({})
  check('config 为 undefined 不崩', resolveRoute(ctx, {}, undefined), { provider: undefined, model: undefined })
  check('body 为 null 不崩', resolveRoute(ctx, { provider: 'p', model: 'm' }, null).provider, 'p')
  // 空字符串的覆盖不应生效
  check('body 空串不算覆盖', resolveRoute(ctx, { provider: 'p', model: 'm' }, { provider: '', model: '' }).provider, 'p')
}

console.log('')
console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
