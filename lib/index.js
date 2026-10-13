/**
 * dsh-prompt-enhancer — Host half.
 *
 * Brings WorkBuddy's "增强提示词" (Enhance Prompt) capability to DeepSeek Harness.
 *
 * What it does: takes the raw draft the user typed into the composer, asks a
 * model to rewrite it into a clearer, more complete, better-structured prompt,
 * and hands the result back so the browser half can drop it into the draft.
 *
 * The Host owns everything that needs a model:
 *   - the rewrite engine (`enhance()`), built on `ctx.llm.stream()`
 *   - three styles: 'expand' (default), 'concise' and 'structured'
 *   - an HTTP route the browser half POSTs the draft to
 *   - a `/enhance` slash command so the same engine works without the button
 *
 * The route is plugin-owned and mounted on the Host's same-origin web server,
 * so the browser half reaches it with a plain same-origin fetch and never needs
 * to know the port.
 *
 * This module deliberately imports NOTHING from other packages — only Node
 * built-ins. A third-party plugin lives outside the profile's `node_modules`
 * tree, so a bare specifier such as `@deepseek-ai/schemastery` would fail module
 * resolution and take the whole plugin down with it. The configuration surface
 * is therefore a plain object, which the loader accepts exactly like a Schema
 * instance.
 *
 * @module dsh-prompt-enhancer
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Plugin-owned rewrite endpoint consumed by the browser half. */
export const ENHANCE_PATH = '/plugins/dsh-prompt-enhancer/enhance'
/** Read-only capability probe: which styles exist and what the default is. */
export const ENHANCE_STATUS_PATH = '/plugins/dsh-prompt-enhancer/status'
/** Update check for this plugin, served through the Market's public API. */
export const UPDATE_PATH = '/plugins/dsh-prompt-enhancer/update'
/** Identifier this plugin is installed under, as the Market sees it. */
export const PACKAGE_NAME = '@local/dsh-prompt-enhancer'
/** This build's version, mirrored from package.json for the update check. */
export const PACKAGE_VERSION = '1.2.0'
/** Market's documented public update API. Versioned; see UPDATE-API-V1.md. */
const MARKET_API = '/dsh-market/api/v1'
/** Cap on how long a market call may take before the check is abandoned. */
const MARKET_TIMEOUT_MS = 8000
/**
 * The instruction that turns a rough draft into a stronger prompt.
 *
 * These two strings are WorkBuddy's own enhance-prompt instructions, recovered
 * verbatim from `/main/server.js` inside `D:\WorkBuddy\resources\app.asar`.
 *
 * WorkBuddy splits the instruction in two, which is easy to get wrong:
 *
 *   - `systemPrompt` gets only the one-line role sentence (`WB_SYSTEM`)
 *   - `userPrompt`   gets the whole instruction with the draft substituted
 *                     into `{input}` (`WB_PROMPT.replace('{input}', text)`)
 *
 * The rules below are load-bearing and were each added upstream for a reason:
 * the language-consistency block stops the model from answering a Chinese draft
 * in English, and the "no language labels" rule stops it from emitting
 * `User input is in Chinese → Response must be in Chinese.` as the result.
 */

/** WorkBuddy's `Xo`: the one-line role passed as the system prompt. */
export const WB_SYSTEM = 'You are a prompt enhancement assistant. Improve the user prompt while preserving its intent and language.'

/**
 * WorkBuddy's `Zo`: the full instruction, with `{input}` as the draft slot.
 *
 * Kept byte-identical to the shipped text, including its leading indentation,
 * so behaviour matches the original rather than an approximation of it.
 */
export const WB_PROMPT = `You are a prompt enhancement assistant. Improve the user prompt while preserving its intent and language.

    USER INPUT:
    {input}
    
    TASK:
    Rewrite the user input into a clearer, more specific prompt for the target AI assistant.

    CRITICAL PRIORITY - LANGUAGE CONSISTENCY:
    1. You MUST detect the language of the user input above and write the enhanced prompt in that same language.
    2. If the user writes in Chinese, the enhanced prompt MUST be entirely in Chinese.
    3. If the user writes in English, the enhanced prompt MUST be entirely in English.
    4. If the user writes in any other language, the enhanced prompt MUST use that exact same language.
    5. If the user mixes languages, keep a natural matching mix. Do not translate the user's intent into a single language.
    6. These language rules are behavior instructions only; never include language analysis or language labels in the output.
    
    ENHANCEMENT REQUIREMENTS:
    1. Return only the enhanced prompt text; do not add explanations, prefaces, markdown fences, labels, or analysis.
    2. Do not include language labels or meta notes such as "User input is in Chinese" or "Response must be in Chinese".
    3. Preserve the user's original intent, topic, constraints, and target output type. Do not answer the request.
    4. Always make a substantive enhancement when possible: clarify the task, scope, constraints, and expected output.
    5. If the original prompt is already clear, lightly polish it instead of returning it unchanged.
    6. Keep the enhanced prompt complete and concise. Do not end with an unfinished list, dangling conjunction, or trailing colon.
    7. Do not add unrelated requirements, unsupported facts, or unnecessary sections.

    EXAMPLES:
    User input (Chinese): "请帮我解释这段代码的功能"
    Enhanced prompt: "请解释这段代码的主要功能、执行流程和关键逻辑，并指出可能需要注意的边界情况。"

    User input (English): "Please explain what this code does"
    Enhanced prompt: "Explain what this code does, including its main purpose, key control flow, and any important edge cases."

    User input (Mixed): "这段代码有 bug，can you help me fix it?"
    Enhanced prompt: "请分析这段代码中的 bug，explain the root cause, and provide a minimal fix with necessary verification steps."

    BAD OUTPUT EXAMPLE:
    User input is in Chinese → Response must be in Chinese.
    请解释这段代码的主要功能

    GOOD OUTPUT EXAMPLE:
    请解释这段代码的主要功能、执行流程和关键逻辑，并指出可能需要注意的边界情况。
    `

/** WorkBuddy's `Xo` and `Zo` were both defined; the runtime call sites use `Xo`. */
const BASE_SYSTEM = WB_SYSTEM

/**
 * Fill the draft into WorkBuddy's `{input}` slot.
 * @param draft - the raw composer draft.
 * @returns the complete user message.
 */
export function buildWorkBuddyPrompt(draft) {
  return WB_PROMPT.replace('{input}', draft)
}

/**
 * Style-specific guidance appended to the instruction.
 *
 * WorkBuddy ships exactly one style; these are additive refinements offered by
 * this plugin. `default` reproduces the original behaviour with no addition at
 * all, so the out-of-the-box result is byte-for-byte what WorkBuddy produces.
 */
const STYLE_GUIDE = {
  default: '',
  expand: `

    ADDITIONAL STYLE - EXPAND:
    Make the implicit explicit: state the goal, the expected deliverable, the constraints and the acceptance criteria the draft implies but leaves unstated.`,
  concise: `

    ADDITIONAL STYLE - CONCISE:
    Tighten the result. Remove filler, hedging and repetition, resolve vague pronouns, and make the request unmistakable. Do not add requirements.`,
  structured: `

    ADDITIONAL STYLE - STRUCTURED:
    Organize the result as a short engineering brief with the labeled sections 目标 / 交付物 / 约束 / 验收标准（omit a section the draft gives nothing for）.`,
}

/** Default style: the original WorkBuddy behaviour, unmodified. */
const DEFAULT_STYLE = 'default'
/** Every style this plugin accepts. */
const STYLES = Object.keys(STYLE_GUIDE)

/**
 * Normalize an incoming style name.
 * @param value - caller-supplied value, possibly absent or unknown.
 * @returns a style guaranteed to exist in `STYLE_GUIDE`.
 */
export function normalizeStyle(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STYLE_GUIDE, value)
    ? value
    : DEFAULT_STYLE
}

/**
 * Build the user message exactly as WorkBuddy does.
 *
 * WorkBuddy's runtime call is:
 *
 *     runAgent({ systemPrompt: Xo, userPrompt: Qo(text), agentName, model })
 *     const Qo = (e) => Zo.replace('{input}', e)
 *
 * So the draft goes into the instruction's `{input}` slot rather than being
 * fenced separately, and a style refinement is appended after it (the `default`
 * style appends nothing, reproducing the original byte for byte).
 *
 * @param draft - the raw composer draft.
 * @param style - the requested style.
 * @returns the complete user-message text.
 */
export function buildUserMessage(draft, style) {
  const normalized = normalizeStyle(style)
  return WB_PROMPT.replace('{input}', draft) + STYLE_GUIDE[normalized]
}

/**
 * Join the assistant's streamed text deltas.
 *
 * `ctx.llm.stream()` yields blocked chunks; only `text-delta` carries visible
 * prompt text. Tool-call and reasoning deltas are ignored.
 *
 * @param chunks - async iterable of `StreamChunk`.
 * @returns the concatenated text.
 */
export async function collectText(chunks) {
  let out = ''
  for await (const chunk of chunks) {
    if (chunk && chunk.type === 'text-delta' && typeof chunk.text === 'string') out += chunk.text
  }
  return out
}

/**
 * Clean the model's answer exactly as WorkBuddy does.
 *
 * WorkBuddy's `$o` is a single regex over the trimmed text:
 *
 *     const $o = (e) => e.trim().replace(/^["'“”‘’]|["'“”‘’]$/g, '')
 *
 * It strips one leading and one trailing quote character, which the model adds
 * because both few-shot examples in the instruction are quoted. That first pass
 * is reproduced verbatim; the extra fence removal below is defensive, for the
 * case where a model wraps the whole answer in a code block even though rule 1
 * forbids it.
 *
 * @param text - raw model output.
 * @returns cleaned prompt text.
 */
export function cleanPrompt(text) {
  // Verbatim port of WorkBuddy's `$o`.
  let out = String(text).trim().replace(/^["'“”‘’]|["'“”‘’]$/g, '')

  // Defensive: an outer fence survives the quote strip above.
  const fence = /^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/.exec(out.trim())
  if (fence) out = fence[1].trim()

  // Defensive: a leading label line the instruction explicitly forbids.
  out = out.replace(/^(?:enhanced\s+prompt|rewritten\s+prompt|增强后的?提示词|优化后的?提示词)\s*[:：]\s*/i, '')

  return out.trim()
}

/**
 * Turn a provider failure chunk into a user-facing sentence.
 *
 * Failure `code`s are the stable contract; message text is not. The codes below
 * are the ones a user can actually do something about.
 *
 * @param failure - the terminal `finish` failure.
 * @returns a short actionable message.
 */
export function describeFailure(failure) {
  const code = failure && failure.code ? String(failure.code) : 'UNKNOWN'
  const detail = failure && failure.message ? `（${failure.message}）` : ''
  switch (code) {
    case 'NO_ADAPTER': return `没有为该模型注册任何适配器${detail}`
    case 'MISSING_CREDENTIAL': return `该模型缺少凭据，请先在设置中登录${detail}`
    case 'AUTH': return `认证失败，请检查账号凭据${detail}`
    case 'RATE_LIMIT': return `请求过于频繁或额度耗尽，稍后重试${detail}`
    case 'QUOTA': case 'ACCOUNT_QUOTA': return `额度已耗尽${detail}`
    case 'CONTEXT_WINDOW_EXCEEDED': return `草稿过长，超出模型上下文窗口${detail}`
    default: return `模型调用失败：${code}${detail}`
  }
}

/**
 * Run one rewrite.
 *
 * Consumes `ctx.llm.stream()` to completion and returns either the improved
 * prompt or a reason it could not be produced. Never throws for an ordinary
 * model failure — the caller renders the message, and a throw would lose it.
 *
 * @param ctx - the Cordis context carrying `llm`.
 * @param options - `draft`, `style`, optional `provider`/`model` overrides and `signal`.
 * @returns `{ ok: true, prompt }` or `{ ok: false, error }`.
 */
export async function enhance(ctx, options) {
  const { draft, style, provider, model, signal } = options
  if (typeof draft !== 'string' || draft.trim() === '') {
    return { ok: false, error: '草稿为空，没有可增强的内容' }
  }

  // Acquired lazily rather than through `inject`, so a missing service reports
  // itself here instead of silently parking the whole plugin (see `inject` above).
  const llm = service(ctx, 'llm')
  if (!llm || typeof llm.stream !== 'function') {
    return { ok: false, error: 'llm 服务不可用，无法调用模型（插件已加载，但宿主未提供 llm）' }
  }

  /**
   * Refuse early when no provider could be resolved.
   *
   * `ctx.llm.stream()` would otherwise fail deeper down with
   * `no adapter registered for provider "undefined"`, which says nothing about
   * how to fix it. This message names the config key that resolves it.
   */
  if (typeof provider !== 'string' || provider === '') {
    return {
      ok: false,
      error: '未能确定要使用的模型。请在插件配置里显式指定 provider 与 model，'
        + '或确认当前会话已选中模型。',
    }
  }

  let finish
  let text = ''
  try {
    const stream = llm.stream({
      provider,
      model,
      /**
       * `system` — not `systemPrompt`. The latter is an internal variable name
       * inside the pi-ai adapter; `GenerateOptions` itself spells the field
       * `system`. Passing the wrong key would silently drop the rewriter
       * instruction and let the model answer the draft instead of improving it.
       */
      system: BASE_SYSTEM,
      messages: [{ role: 'user', content: [{ type: 'text', text: buildUserMessage(draft, style) }] }],
      temperature: 0.3,
      maxTokens: 4096,
      ...(signal === undefined ? {} : { signal }),
    })
    for await (const chunk of stream) {
      if (!chunk) continue
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
        text += chunk.text
      } else if (chunk.type === 'finish') {
        finish = chunk
      }
    }
  } catch (error) {
    return { ok: false, error: `模型调用异常：${error && error.message ? error.message : String(error)}` }
  }

  const reason = finish && finish.reason
  if (reason && reason.kind && reason.kind !== 'stop') {
    if (reason.kind === 'aborted') return { ok: false, error: '已取消' }
    return { ok: false, error: describeFailure(reason.failure) }
  }

  const prompt = cleanPrompt(text)
  if (prompt === '') return { ok: false, error: '模型返回了空结果，请重试' }
  return { ok: true, prompt }
}

/**
 * Plugin configuration — a Standard Schema, built inline.
 *
 * Cordis validates a plugin's config through `Config["~standard"].validate(raw)`
 * before the plugin starts:
 *
 *     function resolveConfig(runtime, config) {
 *       if (!runtime.Config) return config
 *       const result = runtime.Config["~standard"].validate(config)
 *       if (result.issues) throw new ValidationError(result.issues)
 *       return result.value
 *     }
 *
 * A plain object has no `~standard`, so claiming one as `Config` makes cordis
 * throw `TypeError: Cannot read properties of undefined (reading 'validate')`
 * and the entry never activates — silently, apart from a
 * `warning: N entries did not activate` line.
 *
 * Implementing the (tiny) Standard Schema interface here keeps the plugin free
 * of runtime imports while satisfying that contract exactly: any input is
 * accepted, and the result is always a complete, normalized config.
 */
const CONFIG_SCHEMA = {
  '~standard': {
    version: 1,
    vendor: 'dsh-prompt-enhancer',
    /**
     * Normalize any raw config.
     * @param value - whatever the profile supplied, possibly partial or absent.
     * @returns `{ value }` with a complete config; never returns issues, because
     *   every field has a safe default and rejecting config would only disable a
     *   feature the user asked for.
     */
    validate(value) {
      return { value: normalizeConfig(value) }
    },
  },
}

export const Config = CONFIG_SCHEMA

/**
 * Fill in a partial configuration.
 *
 * The loader hands `apply` whatever the profile supplied, which may omit any
 * field, so every consumer reads configuration through this normalizer instead
 * of guarding each access.
 *
 * @param raw - configuration as supplied by the loader.
 * @returns a complete configuration object.
 */
function normalizeConfig(raw) {
  const value = raw && typeof raw === 'object' ? raw : {}
  return {
    provider: typeof value.provider === 'string' && value.provider !== '' ? value.provider : undefined,
    model: typeof value.model === 'string' && value.model !== '' ? value.model : undefined,
    defaultStyle: normalizeStyle(value.defaultStyle),
    slashCommand: value.slashCommand !== false,
  }
}

export const name = 'prompt-enhancer'

/**
 * No `inject` — and that is deliberate.
 *
 * Cordis treats `inject` as a hard dependency: a plugin whose injected service
 * never appears stays parked and its `apply` is never called, with no error and
 * no log line. That failure is indistinguishable from "the plugin was never
 * loaded", which is exactly the trap this plugin fell into: declaring
 * `inject: ['llm']` left `apply()` unvisited forever, so the route never
 * registered and the composer button had nothing to fetch.
 *
 * Every service this plugin needs is therefore acquired lazily, at the moment
 * it is used, through `ctx.get(name)` — and each only through an optional child
 * context via `ctx.inject([...], fn)`, which defers the callback instead of
 * parking the plugin. A missing service then degrades one feature rather than
 * disabling the whole plugin.
 */
export const inject = []

/**
 * Resolve a service from the context, tolerating every shape Cordis exposes.
 *
 * `ctx.get(name)` is the documented accessor; some surfaces also carry the
 * service directly as a property. Both are tried so the plugin works across
 * versions without pinning an exact accessor.
 *
 * @param ctx - the Cordis context.
 * @param serviceName - the service name, e.g. `llm`.
 * @returns the service, or `undefined` when it is not available yet.
 */
function service(ctx, serviceName) {
  try {
    const viaGet = typeof ctx.get === 'function' ? ctx.get(serviceName) : undefined
    if (viaGet !== undefined && viaGet !== null) return viaGet
  } catch {
    /* Fall through to the property access below. */
  }
  try {
    const direct = ctx[serviceName]
    if (direct !== undefined && direct !== null) return direct
  } catch {
    /* Neither accessor worked; the caller reports the feature as unavailable. */
  }
  return undefined
}

/**
 * Write one JSON response.
 * @param res - the HTTP response.
 * @param status - HTTP status code.
 * @param body - JSON-serializable payload.
 */
function json(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  })
  res.end(text)
}

/**
 * Read a bounded JSON request body.
 *
 * The bound matters: this endpoint accepts text from the browser, and an
 * unbounded read would let a large or hostile body exhaust memory. 1 MiB is far
 * above any realistic prompt draft.
 *
 * @param req - the HTTP request.
 * @param limit - maximum accepted bytes.
 * @returns the parsed body, or `undefined` when it is absent, oversized or malformed.
 */
async function readJson(req, limit = 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) return undefined
    chunks.push(chunk)
  }
  if (size === 0) return undefined
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return undefined
  }
}

/**
 * Query the Market's public update API for this plugin.
 *
 * `dshmarket` exposes a versioned, same-origin JSON API for plugin-owned update
 * surfaces (documented in its `UPDATE-API-V1.md`). Using it means this plugin
 * never has to spawn a package manager or copy the Market's install algorithm —
 * it asks and reports, and the Market performs any mutation.
 *
 * Two things are handled carefully:
 *
 *   1. **Discovery first.** `capabilities` is consulted before advertising any
 *      mutation control, and `features.restart` decides whether a restart
 *      button is honest. On a Desktop-supervised host `restart.supported` is
 *      false and the shell owns restarts, so the UI must not offer one.
 *   2. **A linked install cannot be updated.** For a `link:` dependency the
 *      Market reports `source: "linked"` and `latestVersion: null`, because
 *      there is no registry entry behind it. That is a normal, explainable
 *      state rather than an error, so it is surfaced as `kind: 'linked'`.
 *
 * @param base - same-origin base URL of the Host, e.g. `http://127.0.0.1:19387`.
 * @returns a status object; never throws.
 */
export async function checkForUpdate(base) {
  if (typeof base !== 'string' || base === '') {
    return { ok: false, kind: 'unavailable', reason: 'no host base URL' }
  }

  const get = async (path) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), MARKET_TIMEOUT_MS)
    try {
      const response = await fetch(base + path, { signal: controller.signal })
      if (!response.ok) return undefined
      const data = await response.json()
      // Every response is stamped with the API schema; refuse anything else so a
      // future incompatible server cannot be misread as v1.
      if (!data || data.schema !== 'dsh-market/update-api/v1') return undefined
      return data
    } catch {
      return undefined
    } finally {
      clearTimeout(timer)
    }
  }

  const capabilities = await get(`${MARKET_API}/capabilities`)
  if (!capabilities) {
    return {
      ok: false,
      kind: 'unavailable',
      reason: '市场更新接口不可用（未安装 dshmarket，或版本过旧）',
      current: PACKAGE_VERSION,
    }
  }

  const info = await get(`${MARKET_API}/updates?name=${encodeURIComponent(PACKAGE_NAME)}`)
  const pkg = info && info.package ? info.package : undefined

  if (!pkg) {
    return {
      ok: true,
      kind: 'unknown',
      current: PACKAGE_VERSION,
      marketVersion: capabilities.marketVersion,
      restartSupported: Boolean(capabilities.restart && capabilities.restart.supported),
      reason: '市场未收录该插件（本地 link 安装不会出现在市场中）',
    }
  }

  // A linked dependency has no registry behind it, so there is nothing to fetch.
  if (pkg.source === 'linked') {
    return {
      ok: true,
      kind: 'linked',
      current: pkg.installedVersion ?? PACKAGE_VERSION,
      latest: null,
      updateAvailable: false,
      marketVersion: capabilities.marketVersion,
      restartSupported: Boolean(capabilities.restart && capabilities.restart.supported),
      reason: '当前为本地 link 安装，无法远程更新',
    }
  }

  return {
    ok: true,
    kind: pkg.updateAvailable ? 'available' : 'current',
    current: pkg.installedVersion ?? PACKAGE_VERSION,
    latest: pkg.latestVersion ?? null,
    source: pkg.source ?? null,
    updateAvailable: Boolean(pkg.updateAvailable),
    marketVersion: capabilities.marketVersion,
    restartSupported: Boolean(capabilities.restart && capabilities.restart.supported),
  }
}

/**
 * Resolve the provider/model a rewrite should use.
 *
 * Explicit plugin config wins. Otherwise the request may name a route, and
 * otherwise the agent's own default is resolved through the agent service so
 * the rewrite follows whatever model the user is actually talking to.
 *
 * @param ctx - Cordis context.
 * @param config - plugin configuration.
 * @param body - request body, possibly naming a route.
 * @returns a `{ provider, model }` pair, possibly with undefined members.
 */
function resolveRoute(ctx, config, body) {
  const provider = config.provider ?? (typeof body?.provider === 'string' ? body.provider : undefined)
  const model = config.model ?? (typeof body?.model === 'string' ? body.model : undefined)
  if (provider !== undefined && model !== undefined) return { provider, model }
  const fallback = currentAgentRoute(ctx)
  return {
    provider: provider ?? fallback.provider,
    model: model ?? fallback.model,
  }
}

/**
 * Read the model the user is actually talking to.
 *
 * `dsh-agent-default-model` owns this as the `agentDefaultModel` service:
 *
 *     super(ownerContext, 'agentDefaultModel')
 *     currentSelection() { return { provider, model, reasoningEffort? } }
 *
 * Calling `ctx.llm.stream()` with `provider: undefined` fails immediately with
 * `no adapter registered for provider "undefined"`, so this lookup is what makes
 * a rewrite work without the user configuring a model by hand.
 *
 * Several fallbacks are tried because the service name is the one thing this
 * plugin cannot verify at build time, and a wrong name must degrade to another
 * source rather than to `undefined`:
 *
 *   1. `agentDefaultModel.currentSelection()` — the authoritative service
 *   2. `agentDefaultModel.config` — its raw reactive config refs
 *   3. `ctx.get('agent')` / `agents.list()` — the agent surface, if present
 *   4. `ctx.llm.listProviders()` — as a last resort, the first registered route
 *
 * @param ctx - Cordis context.
 * @returns a `{ provider, model }` pair; members may be undefined.
 */
function currentAgentRoute(ctx) {
  // 1. The dedicated service.
  try {
    const svc = service(ctx, 'agentDefaultModel')
    if (svc && typeof svc.currentSelection === 'function') {
      const picked = svc.currentSelection()
      if (picked && typeof picked.provider === 'string' && picked.provider !== '') {
        return {
          provider: picked.provider,
          model: typeof picked.model === 'string' && picked.model !== '' ? picked.model : undefined,
        }
      }
    }
  } catch { /* Fall through to the next source. */ }

  // 2. Its raw config, whose entries are reactive refs with `.get()`.
  try {
    const svc = service(ctx, 'agentDefaultModel')
    const cfg = svc && svc.config
    if (cfg) {
      const provider = typeof cfg.provider?.get === 'function' ? cfg.provider.get() : cfg.provider
      const model = typeof cfg.model?.get === 'function' ? cfg.model.get() : cfg.model
      if (typeof provider === 'string' && provider !== '') {
        return { provider, model: typeof model === 'string' && model !== '' ? model : undefined }
      }
    }
  } catch { /* Fall through. */ }

  // 3. The agent surface.
  try {
    const agents = service(ctx, 'agents') ?? service(ctx, 'agent')
    if (agents) {
      const list = typeof agents.list === 'function' ? agents.list() : undefined
      const first = Array.isArray(list) ? list[0] : undefined
      const route = first && (first.model ?? first.selection)
      if (route && typeof route === 'object') {
        const provider = route.provider
        const model = route.model ?? route.id
        if (typeof provider === 'string' && provider !== '') {
          return { provider, model: typeof model === 'string' ? model : undefined }
        }
      }
    }
  } catch { /* Fall through. */ }

  // 4. Last resort: any registered provider, so the call is not sent with an
  //    undefined route. The model is left undefined for the service to default.
  try {
    const llm = service(ctx, 'llm')
    if (llm && typeof llm.listProviders === 'function') {
      const providers = llm.listProviders()
      const first = Array.isArray(providers) ? providers[0] : undefined
      const name = typeof first === 'string' ? first : first && (first.id ?? first.provider)
      if (typeof name === 'string' && name !== '') return { provider: name, model: undefined }
    }
  } catch { /* Nothing else to try. */ }

  return {}
}

/**
 * Register the HTTP route the browser half calls.
 *
 * The web server may not be mounted yet when this plugin applies — it is a
 * sibling service, and activation order between plugins is not guaranteed. So
 * the route is attached through BOTH paths:
 *
 *   1. `ctx.get('webServer')` — used when the service is already live, which
 *      keeps the common case synchronous.
 *   2. `ctx.inject(['webServer'], ...)` — defers the callback until the service
 *      appears. This is what the working local plugins do, and it cannot park
 *      this plugin because `inject` here is a child context, not the plugin's
 *      own hard dependency list.
 *
 * Getting only the first path wrong was worth 20 minutes of "route mounted but
 * 404": `apply` ran, `register` was never called, and nothing said so.
 *
 * @param ctx - Cordis context.
 * @param webServer - the web server service to register on.
 * @param config - plugin configuration.
 * @returns whether both routes were registered.
 */
function registerRoutes(ctx, webServer, config) {
  if (!webServer || typeof webServer.register !== 'function') return false

  const attach = (definition) =>
    typeof ctx.effect === 'function'
      ? ctx.effect(() => webServer.register(definition))
      : webServer.register(definition)

  attach({
    kind: 'exact',
    path: ENHANCE_STATUS_PATH,
    handler: async (req, res) => {
      if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
      json(res, 200, {
        ok: true,
        styles: STYLES,
        defaultStyle: normalizeStyle(config.defaultStyle),
        slashCommand: config.slashCommand,
      })
    },
  })

  attach({
    kind: 'exact',
    path: ENHANCE_PATH,
    handler: async (req, res) => {
      if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
      const body = await readJson(req)
      if (!body) return json(res, 400, { error: '无效的请求体' })
      const draft = typeof body.draft === 'string' ? body.draft : ''
      if (draft.trim() === '') return json(res, 400, { error: '草稿为空' })

      const style = normalizeStyle(body.style ?? config.defaultStyle)
      const route = resolveRoute(ctx, config, body)
      const result = await enhance(ctx, { draft, style, ...route })
      if (!result.ok) return json(res, 200, { ok: false, error: result.error, style })
      json(res, 200, { ok: true, prompt: result.prompt, style })
    },
  })

  /**
   * Update check for this plugin.
   *
   * The Host asks the Market on the browser's behalf: the Market's API is
   * same-origin and the page could call it directly, but routing it through here
   * keeps the plugin's own update surface on one documented path and lets the
   * check degrade to a clear message when the Market is absent.
   */
  attach({
    kind: 'exact',
    path: UPDATE_PATH,
    handler: async (req, res) => {
      if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
      const host = req.headers && req.headers.host ? String(req.headers.host) : ''
      const status = await checkForUpdate(host ? `http://${host}` : '')
      json(res, 200, status)
    },
  })

  trace('HTTP routes mounted: ' + ENHANCE_STATUS_PATH + ', ' + ENHANCE_PATH + ', ' + UPDATE_PATH)
  return true
}

/**
 * Attach the routes now if the web server is live, and again when it arrives.
 *
 * Activation order between plugins is not guaranteed, so neither path alone is
 * reliable: the eager one misses a server that mounts later, and the deferred
 * one alone would leave a already-live server unpatched if `inject` fires
 * asynchronously. `attach` is idempotent for a given server instance, and a
 * server that appears once registers once.
 *
 * @param ctx - Cordis context.
 * @param config - plugin configuration.
 */
function mountRoutesDeferred(ctx, config) {
  const attached = new Set()
  /**
   * Attach once per web-server instance.
   * @param candidate - the service, from either access path.
   * @returns whether the routes are now mounted on it.
   */
  const attachOnce = (candidate) => {
    if (!candidate || typeof candidate.register !== 'function') return false
    if (attached.has(candidate)) return true
    const ok = registerRoutes(ctx, candidate, config)
    if (ok) attached.add(candidate)
    return ok
  }

  // Path 1: a server that is already live.
  const eager = service(ctx, 'webServer')
  if (eager) {
    try { attachOnce(eager) } catch (error) {
      trace('eager route registration failed: ' + (error && error.message ? error.message : String(error)))
    }
    if (attached.has(eager)) return
  }

  // Path 2: a server that appears later. A child context defers this callback
  // without parking the plugin itself.
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['webServer'], (childCtx) => {
        const late = service(childCtx, 'webServer')
        if (!late) {
          trace('webServer injected but not readable from the child context')
          return
        }
        try { attachOnce(late) } catch (error) {
          trace('deferred route registration failed: ' + (error && error.message ? error.message : String(error)))
        }
      })
    } catch (error) {
      trace('ctx.inject(webServer) threw: ' + (error && error.message ? error.message : String(error)))
    }
  } else if (!eager) {
    trace('webServer service unavailable and ctx.inject missing; HTTP routes not mounted')
  }
}

/**
 * Register the `/enhance` slash command.
 *
 * The registry is `@deepseek-ai/dsh-commands`, which publishes itself as the
 * `commands` service:
 *
 *     super(ctx, "commands")
 *     register(definition)   // → disposer
 *
 * Name and call shape were confirmed against the shipped source rather than
 * guessed.
 *
 * TIMING is the trap here, and it is the same one the HTTP routes hit: the
 * `commands` service is mounted by a sibling plugin, so activation order is not
 * guaranteed and a plain `ctx.get('commands')` returns `undefined` on the
 * normal startup path. The original code took that `undefined` as final and
 * returned, which is why every boot logged
 * `commands service unavailable; /enhance not registered` even though the
 * button and the routes worked perfectly.
 *
 * So this mirrors `mountRoutesDeferred`: attach now when the service is already
 * live, and otherwise defer through `ctx.inject(['commands'], ...)` — a child
 * context, which asks to be called when the service appears instead of parking
 * the plugin. Registration is idempotent per service instance.
 *
 * @param ctx - Cordis context.
 * @param config - plugin configuration.
 */
function mountCommand(ctx, config) {
  if (config.slashCommand === false) {
    trace('slashCommand disabled by config')
    return
  }

  const registered = new Set()
  /**
   * Define the command on one registry instance, at most once.
   * @param candidate - the commands service, from either access path.
   * @returns whether the command is now registered on it.
   */
  const registerOnce = (candidate) => {
    if (!candidate || typeof candidate.register !== 'function') return false
    if (registered.has(candidate)) return true
    candidate.register({
      name: 'enhance',
      description: '把当前参数中的草稿改写为更强的提示词（可加 --expand / --concise / --structured）',
      input: { hint: '输入要增强的提示词草稿' },
      async handler(invocation) {
        const raw = invocation.rawInput.trim()
        if (raw === '') {
          return { kind: 'error', text: '用法：/enhance [--default|--expand|--concise|--structured] <提示词草稿>' }
        }
        let style = config.defaultStyle
        let draft = raw
        /**
         * Accept every style this plugin declares, not a hand-written subset.
         *
         * The pattern used to be the literal `expand|concise|structured`, which
         * omitted `default` — so `/enhance --default <草稿>` failed to match and
         * the flag was pasted into the prompt body as literal text. Deriving it
         * from `STYLES` keeps this in step with what `/status` advertises and
         * what `normalizeStyle` accepts; there is now one list, not three.
         */
        const flag = new RegExp('^--(' + STYLES.join('|') + ')\\s+').exec(raw)
        if (flag) {
          style = flag[1]
          draft = raw.slice(flag[0].length)
        }
        const route = resolveRoute(ctx, config, undefined)
        const result = await enhance(ctx, { draft, style, ...route })
        if (!result.ok) return { kind: 'error', text: result.error }
        return { kind: 'success', text: result.prompt }
      },
    })
    registered.add(candidate)
    return true
  }

  // Path 1: a registry that is already live.
  const eager = service(ctx, 'commands')
  if (eager) {
    try {
      if (registerOnce(eager)) {
        trace('/enhance command registered')
        return
      }
    } catch (error) {
      trace('eager /enhance registration failed: ' + (error && error.message ? error.message : String(error)))
    }
  }

  // Path 2: a registry mounted later. A child context defers this callback
  // without parking the plugin itself.
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['commands'], (childCtx) => {
        const late = service(childCtx, 'commands')
        if (!late) {
          trace('commands injected but not readable from the child context')
          return
        }
        try {
          if (registerOnce(late)) trace('/enhance command registered (deferred)')
        } catch (error) {
          trace('deferred /enhance registration failed: ' + (error && error.message ? error.message : String(error)))
        }
      })
    } catch (error) {
      trace('ctx.inject(commands) threw: ' + (error && error.message ? error.message : String(error)))
    }
  } else if (!eager) {
    trace('commands service unavailable and ctx.inject missing; /enhance not registered')
  }
}

/**
 * Leave a durable breadcrumb proving the Host half was mounted.
 *
 * Without this, a plugin that never loads is indistinguishable from a plugin
 * that loads and fails: both look like "no route". The file either appears or it
 * does not, which turns the whole question into a single binary fact.
 *
 * @param detail - what happened, for the breadcrumb body.
 */
function trace(detail) {
  try {
    const dir = path.join(os.homedir(), '.dsh')
    fs.mkdirSync(dir, { recursive: true })
    // The pid disambiguates a real DSH run from a test harness writing the same
    // file: only the host's own pid can produce a line with its services ready.
    fs.appendFileSync(
      path.join(dir, 'prompt-enhancer-boot.log'),
      `${new Date().toISOString()} [pid ${process.pid}] ${detail}\n`,
      'utf8',
    )
  } catch {
    /* A breadcrumb failure must never break plugin activation. */
  }
}

export function apply(ctx, rawConfig) {
  trace('apply() entered')
  const config = normalizeConfig(rawConfig)
  try {
    mountRoutesDeferred(ctx, config)
    mountCommand(ctx, config)
    trace('apply() finished')
  } catch (error) {
    trace('apply() FAILED: ' + (error && error.message ? error.message : String(error)))
    throw error
  }
}
