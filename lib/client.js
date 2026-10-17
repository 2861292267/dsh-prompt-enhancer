/**
 * dsh-prompt-forge — Browser half.
 *
 * Renders the 「增强提示词」 (Enhance Prompt) control into the composer and wires
 * it to the Host half. The behaviour mirrors WorkBuddy's own implementation,
 * read out of `/renderer/assets/lib-chat-ui-*.js` in
 * `D:\WorkBuddy\resources\app.asar`:
 *
 *   jsx(fQt, {
 *     loading: an, disabled: xe, onEnhance: tn, onRevert: rn,
 *     hasBackup: on, errorMessage: sn, onCancel: nn, icon,
 *   })
 *
 * So the control has four states rather than one, and the piece most easily
 * missed is `onRevert` / `hasBackup`: after enhancing, WorkBuddy keeps the
 * original draft and offers a one-click revert. That is implemented here.
 *
 * POSITION
 * --------
 * `ui-conversation` renders the composer's trailing controls in this order:
 *
 *   renderSlot('conversation.input.right')     // everything here comes FIRST
 *   renderSlot('conversation.input.model')     // the model selector
 *   renderSlot('conversation.input.activity')  // ...then this
 *
 * WorkBuddy sits its button after the model selector; this plugin is asked to
 * sit BEFORE it, so it registers into `conversation.input.right`, which renders
 * to the left of the model picker.
 *
 * The bundle format is DSH's client-plugin contract: one file calling
 * `window.__ModuleLoader__.load({ id, factory })` and exporting `name`, `inject`,
 * `apply`. No build step.
 */

window.__ModuleLoader__.load({
  // Must equal the package name: client-modules keys graph rows by the browser
  // module id taken from the owning package manifest.
  id: '@local/dsh-prompt-forge',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')

    /** Same-origin endpoint owned by the Host half. */
    const ENHANCE_PATH = '/plugins/dsh-prompt-forge/enhance'
    /** Read-only capability probe: which styles exist and what the default is. */
    const STATUS_PATH = '/plugins/dsh-prompt-forge/status'
    /** Update check for this plugin, proxied to the Market by the Host half. */
    const UPDATE_PATH = '/plugins/dsh-prompt-forge/update'
    /** Runtime configuration, read and written by the settings panel. */
    const CONFIG_PATH = '/plugins/dsh-prompt-forge/config'

    /**
     * Style used until the Host reports its own list.
     *
     * `default` reproduces WorkBuddy's original behaviour exactly, so the
     * first paint behaves identically to the pre-selector version.
     */
    const DEFAULT_STYLE = 'default'

    /**
     * Human labels for the Host's style ids.
     *
     * Only presentation lives here; the ids and the initial selection come from
     * `/status`. An unknown id still works and simply shows its raw name.
     */
    const STYLE_LABELS = {
      default: '原版',
      expand: '扩充',
      concise: '精简',
      structured: '结构化',
    }

    /** Locale namespace owned by this plugin. */
    const NAMESPACE = 'dsh-prompt-forge'

    /**
     * User-facing strings, keyed so the host can pick a language.
     *
     * Every value is also the fallback: when `ctx.locale` is unavailable the
     * component reads the `zh` entry directly, so the control still works in a
     * host build without localisation.
     */
    const DICTIONARIES = {
      zh: {
        enhance: '增强提示词',
        enhanceEmpty: '增强提示词（先输入内容）',
        enhanceBusy: '正在增强…（点此取消）',
        revert: '恢复原文',
        reverted: '已恢复原文',
        revertFailed: '恢复失败',
        enhanced: '已增强（可「恢复原文」）',
        needDraft: '请先输入一点内容',
        locked: '输入框当前被锁定',
        noSetDraft: '当前界面不支持写入输入框',
        noUseInput: '读不到输入框内容（槽位未提供 useInput）',
        draftChanged: '草稿已改动，未覆盖',
        writing: '写入失败，正在复制…',
        copied: '写入失败，结果已复制',
        copyFailed: '写入失败，请手动复制',
        styleLabel: '增强风格',
        updateAvailable: '有新版本可用',
        updateBadge: '有新版本',
        updateHint: '请在 插件市场 面板中执行更新',
        settingsNav: '提示词锻造',
        settingsTitle: '提示词锻造',
        settingsIntro: '输入框旁的一键提示词改写。这里显示当前生效的配置，并可管理自定义风格。',
        settingsProvider: '模型服务',
        settingsModel: '模型',
        settingsDefaultStyle: '默认风格',
        settingsBuiltinStyles: '内置风格',
        settingsUnset: '（未设置）',
        settingsReadonly: '（由 profile 配置决定）',
        settingsFollowing: '→ 跟随会话默认模型',
        settingsFromConfig: '→ 由插件配置固定',
        settingsCustomStyles: '自定义风格',
        settingsCustomHint: '每行一条，格式「名称 | 指令」。名称须以小写字母开头，可含数字、- 和 _；以 # 开头的行是注释。',
        settingsSave: '保存',
        settingsSaving: '保存中…',
        settingsSaved: '已保存。重启 DSH 后生效。',
        settingsSaveFailed: '保存失败',
        settingsNoChange: '没有改动',
        settingsLoading: '加载中…',
        settingsUnavailable: '读不到插件配置（宿主服务不可用）',
        settingsConfigFile: '配置文件',
      },
      en: {
        enhance: 'Enhance prompt',
        enhanceEmpty: 'Enhance prompt (type something first)',
        enhanceBusy: 'Enhancing… (click to cancel)',
        revert: 'Restore original',
        reverted: 'Original restored',
        revertFailed: 'Restore failed',
        enhanced: 'Enhanced (can restore original)',
        needDraft: 'Type something first',
        locked: 'The composer is currently locked',
        noSetDraft: 'This view cannot write to the composer',
        noUseInput: 'Cannot read the composer (slot provides no useInput)',
        draftChanged: 'Draft changed — result discarded',
        writing: 'Write failed, copying…',
        copied: 'Write failed, result copied',
        copyFailed: 'Write failed, please copy manually',
        styleLabel: 'Enhancement style',
        updateAvailable: 'A newer version is available',
        updateBadge: 'Update',
        updateHint: 'Run the update from the Plugin Market panel',
        settingsNav: 'Prompt Forge',
        settingsTitle: 'Prompt Forge',
        settingsIntro: 'One-click prompt rewriting beside the composer. This page shows the effective configuration and manages custom styles.',
        settingsProvider: 'Provider',
        settingsModel: 'Model',
        settingsDefaultStyle: 'Default style',
        settingsBuiltinStyles: 'Built-in styles',
        settingsUnset: '(not set)',
        settingsReadonly: '(set by the profile config)',
        settingsFollowing: '→ following the session default model',
        settingsFromConfig: '→ pinned by the plugin config',
        settingsCustomStyles: 'Custom styles',
        settingsCustomHint: 'One per line as "name | instruction". The name must start with a lowercase letter and may contain digits, - and _; lines starting with # are comments.',
        settingsSave: 'Save',
        settingsSaving: 'Saving…',
        settingsSaved: 'Saved. Restart DSH to apply.',
        settingsSaveFailed: 'Save failed',
        settingsNoChange: 'Nothing changed',
        settingsLoading: 'Loading…',
        settingsUnavailable: 'Cannot read plugin config (host service unavailable)',
        settingsConfigFile: 'Config file',
      },
    }

    /**
     * Look up a string.
     *
     * Prefers the host translator when one bound; otherwise reads the bundled
     * dictionary, and finally falls back to the key itself so a missing entry
     * shows up as text rather than `undefined`.
     *
     * @param t - bound host translator, or `null`.
     * @param key - dictionary key.
     * @returns the localised string.
     */
    function msg(t, key) {
      if (t) {
        try {
          const value = t(key)
          if (typeof value === 'string' && value !== '' && value !== key) return value
        } catch { /* Fall through to the bundled dictionary. */ }
      }
      return DICTIONARIES.zh[key] ?? key
    }

    /** WorkBuddy's minimum before the control becomes usable. */
    const MIN_TEXT_LENGTH = 1

    /** Stable browser-plugin name. */
    const name = 'dsh-prompt-forge-client'
    /** The slot service is the only hard dependency. */
    const inject = ['slots']

    /**
     * The sparkle glyph, drawn inline.
     *
     * Inlining keeps `react` the bundle's only `require`, so there is no second
     * module-graph row that has to resolve before the control can render.
     */
    function SparkIcon(props) {
      const size = (props && props.size) || 15
      return React.createElement(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        React.createElement('path', { d: 'M10.9 1.6 12 4.6l3 1.1-3 1.1-1.1 3-1.1-3-3-1.1 3-1.1z' }),
      )
    }

    /** The undo glyph shown while a backup exists. */
    function RevertIcon(props) {
      const size = (props && props.size) || 15
      return React.createElement(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        React.createElement('path', { d: 'M3 8h7a3 3 0 0 1 0 6H7' }),
        React.createElement('path', { d: 'M5.5 5.5 3 8l2.5 2.5' }),
      )
    }

    /**
     * Call the Host rewrite endpoint.
     *
     * Every failure is reported rather than thrown: the button renders the
     * message, so a rejected promise would only lose it.
     *
     * @param draft - raw composer draft.
     * @param style - requested style.
     * @param signal - abort signal owned by the click.
     * @returns `{ ok, prompt?, error? }`.
     */
    async function requestEnhance(draft, style, signal) {
      try {
        const response = await fetch(ENHANCE_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ draft, style }),
          signal,
        })
        if (!response.ok) return { ok: false, error: `服务返回 ${response.status}` }
        const data = await response.json()
        if (!data || data.ok !== true) {
          return { ok: false, error: (data && data.error) || '增强失败' }
        }
        return { ok: true, prompt: data.prompt }
      } catch (error) {
        if (error && error.name === 'AbortError') return { ok: false, error: '已取消' }
        return { ok: false, error: '无法连接增强服务，请重启 DSH 后重试' }
      }
    }

    /**
     * Ask the Host which styles it supports.
     *
     * The Host owns the style list, so it is read rather than duplicated here —
     * the previous duplication is exactly how the control came to hardcode
     * `'default'` while the Host supported four styles.
     *
     * Failure is non-fatal: the control falls back to `DEFAULT_STYLE`, which is
     * always valid.
     *
     * @returns `{ styles, defaultStyle }`, or `undefined` when unavailable.
     */
    async function fetchStyles() {
      try {
        const response = await fetch(STATUS_PATH, { method: 'GET' })
        if (!response.ok) return undefined
        const data = await response.json()
        if (!data || data.ok !== true) return undefined
        return data
      } catch {
        return undefined
      }
    }

    /**
     * Ask the Host whether a newer version of this plugin exists.
     *
     * The Host proxies the Market's documented update API, so this half never
     * talks to the Market directly and never spawns anything. Every outcome is a
     * state to display, including "cannot be updated because this is a local
     * link install" — that is normal, not an error.
     *
     * @returns the status object, or `undefined` when the Host is unreachable.
     */
    async function fetchUpdateStatus() {
      try {
        const response = await fetch(UPDATE_PATH, { method: 'GET' })
        if (!response.ok) return undefined
        const data = await response.json()
        return data && typeof data.kind === 'string' ? data : undefined
      } catch {
        return undefined
      }
    }

    /**
     * Turn an update status into a short, human-readable delta.
     *
     * The Market reports git installs as raw commit ids, so the naive rendering —
     * `current → latest` — paints two 40-character hashes across the toolbar. That
     * is what this exists to prevent: a commit id is an identity, not a version,
     * and nobody reads it at a glance.
     *
     * Three cases matter:
     *
     *   - both sides are semver → show both, which is genuinely informative;
     *   - commits differ → show the abbreviated short ids, which stay scannable
     *     and still let someone compare against `git log`;
     *   - anything else → fall back to naming only the short target, so an
     *     unexpected shape degrades to something short rather than something huge.
     *
     * @param status - the update status from the Host.
     * @returns a compact description for a tooltip.
     */
    function describeDelta(status) {
      const short = (value) => {
        if (typeof value !== 'string' || value === '') return ''
        // A full git sha (or a long hex id) abbreviates to the usual 7 chars.
        return /^[0-9a-f]{12,}$/i.test(value) ? value.slice(0, 7) : value
      }
      const from = short(status.current)
      const to = short(status.latest)
      if (to === '') return from
      if (from === '') return to
      return `${from} → ${to}`
    }

    /**
     * Load the settings panel's config payload.
     *
     * The Host sends the effective values plus the user's own style map; when it
     * is unreachable the panel renders an explicit "unavailable" state rather
     * than an empty form, so a broken Host never looks like "everything is
     * unset".
     *
     * @returns the payload, or `undefined`.
     */
    async function loadPanelConfig() {
      try {
        const res = await fetch(CONFIG_PATH, { method: 'GET' })
        if (!res.ok) return undefined
        const data = await res.json()
        if (!data || data.ok !== true || !data.config) return undefined
        return {
          ok: true,
          config: data.config,
          configFile: data.configFile,
          // The Host sends ids; the panel needs the text to edit, so the user's
          // own entries are re-read from their file.
          customStylesMap: (data.userConfig && data.userConfig.styles) || {},
        }
      } catch {
        return undefined
      }
    }

    /**
     * Persist a settings change.
     * @param patch - the keys to write.
     * @returns `{ ok, error? }`.
     */
    async function savePanelConfig(patch) {
      try {
        const res = await fetch(CONFIG_PATH, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        })
        if (!res.ok) return { ok: false, error: `服务返回 ${res.status}` }
        const data = await res.json()
        return data && data.ok === true ? { ok: true } : { ok: false, error: (data && data.error) || '保存失败' }
      } catch {
        return { ok: false, error: '无法连接插件服务' }
      }
    }

    /**
     * Extract the draft text from an input-store snapshot.
     *
     * The authoritative field is **`draft`**. `ui-conversation` itself tests it
     * as `inputState.draft === ""` (`lib/client.js:16405`), and reading any
     * other name returns `undefined` for every keystroke — which is exactly how
     * this plugin came to claim "请先输入一点内容" over a filled composer.
     *
     * A couple of historical spellings are still probed so a rename degrades to
     * another candidate rather than to a silently empty string; `text` is last
     * because it was the wrong guess.
     *
     * @param state - the input store snapshot, possibly undefined.
     * @returns the draft text, or an empty string when none can be found.
     */
    function readDraftFrom(state) {
      if (state === undefined || state === null) return ''
      if (typeof state === 'string') return state
      if (typeof state !== 'object') return ''
      for (const key of ['draft', 'text', 'value', 'content']) {
        if (typeof state[key] === 'string') return state[key]
      }
      return ''
    }

    /**
     * Read the current draft imperatively, for use after an await.
     *
     * The authoritative source is the hook read inside `EnhanceButton`
     * (`useInput((state) => readDraftFrom(state))`), NOT `props`. Reading props
     * was the original bug: `ui-conversation` projects only
     * `hooks: ['conversation', 'input']` + `props: ['inputActions']` into this
     * slot (host `client.js:18126-18142`), so `props.inputSource` and
     * `props.input` are both `undefined` on every render. The old code therefore
     * always fell through to the pre-enhancement `original`, which made the
     * freshness guard at the call site permanently unreachable — a result that
     * arrived after the user had typed more would silently overwrite them.
     *
     * The live value is passed in because the hook re-runs on every render; the
     * caller must list `draft` in its `useCallback` dependency array for the
     * passed value to stay current.
     *
     * @param live - the draft as read by `useInput` during this render.
     * @param fallback - value to use when the live read is not a usable string.
     * @returns the live draft text.
     */
    function readLiveDraft(live, fallback = '') {
      return typeof live === 'string' ? live : fallback
    }

    /**
     * The composer control.
     *
     * States, in priority order: busy (a rewrite is in flight) → error → revert
     * available → idle. This matches WorkBuddy's `loading` / `errorMessage` /
     * `hasBackup` / default rendering.
     */
    function EnhanceButton(props) {
      const { inputActions, useInput, t } = props

      /**
       * Read the draft from the input store.
       *
       * The field is `draft`, NOT `text`. `ui-conversation` itself reads it as
       * `inputState.draft === ""`, and getting the name wrong makes every read
       * return an empty string — which made the control say "先输入一点内容"
       * while the composer visibly held a full prompt.
       *
       * The hook is called defensively. It used to be invoked unconditionally,
       * which crashed the component before `canReadDraft` below could report the
       * unsupported-slot case — the guard existed but was unreachable. Falling
       * back to `undefined` lets that path produce its intended message instead
       * of a render error.
       *
       * Several spellings are tried for the field so a rename degrades to
       * another candidate rather than to silently-empty.
       */
      const draft = typeof useInput === 'function'
        ? useInput((state) => readDraftFrom(state))
        : undefined

      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState('')
      /** The pre-enhancement draft, kept so it can be restored. */
      const [backup, setBackup] = React.useState(null)

      /**
       * The style sent to the Host.
       *
       * This used to be the literal `'default'` at the call site, which meant the
       * Host's `expand` / `concise` / `structured` modes — all implemented and
       * all advertised in `GET /status`, and all reachable from `/enhance` —
       * could not be reached from this control at all.
       *
       * The list and the initial value both come from the Host's `/status` so the
       * two halves cannot drift apart again; the local fallback is only for the
       * first paint before that response lands.
       */
      const [styles, setStyles] = React.useState([DEFAULT_STYLE])
      const [style, setStyle] = React.useState(DEFAULT_STYLE)

      /**
       * Latest update status, or `null` before the first answer.
       *
       * Checked once on mount. A background poller would be noise: the answer
       * changes when a release lands, not while the user is typing.
       */
      const [updateState, setUpdateState] = React.useState(null)

      React.useEffect(() => {
        let cancelled = false
        void (async () => {
          const status = await fetchUpdateStatus()
          if (!cancelled && status) setUpdateState(status)
        })()
        return () => { cancelled = true }
      }, [])

      React.useEffect(() => {
        let cancelled = false
        void (async () => {
          const info = await fetchStyles()
          if (cancelled || !info) return
          if (Array.isArray(info.styles) && info.styles.length > 0) setStyles(info.styles)
          if (typeof info.defaultStyle === 'string' && info.defaultStyle !== '') {
            setStyle(info.defaultStyle)
          }
        })()
        return () => { cancelled = true }
      }, [])

      const aliveRef = React.useRef(true)
      const abortRef = React.useRef(null)
      const timerRef = React.useRef(null)
      const draftRef = React.useRef('')

      /**
       * A synchronous in-flight latch.
       *
       * `if (busy) return` alone is not a gate: React batches state updates, so
       * two clicks in the same tick both read the `busy` captured by the current
       * closure — still `false` for the second one. The second click would then
       * overwrite `abortRef.current`, leaving the first request unabortable, and
       * both results could be written back over each other.
       *
       * This ref flips synchronously, so the second click sees it immediately.
       */
      const busyRef = React.useRef(false)

      /**
       * The session the in-flight request belongs to.
       *
       * `conversation.input.right` is session-scoped, but the Host may reuse the
       * component instance across sessions (it resets `activity` on `sessionId`
       * change, which suggests reuse). Without this guard, switching sessions
       * mid-rewrite would let the old session's result land in the new session's
       * composer — and `aliveRef` would not catch it, because the component was
       * never unmounted.
       */
      const sessionRef = React.useRef(props.sessionId)

      React.useEffect(() => {
        // Any session change invalidates an in-flight rewrite.
        if (sessionRef.current !== props.sessionId) {
          sessionRef.current = props.sessionId
          if (abortRef.current) abortRef.current.abort()
          busyRef.current = false
          setBusy(false)
        }
      }, [props.sessionId])

      /**
       * Keep the ref current on every render.
       *
       * This is the mechanism that makes the freshness guard work. An `await`
       * inside `onEnhance` continues inside the closure that started the request,
       * so any value *captured* by that closure — including the `draft` local —
       * is frozen at click time no matter what the dependency array says.
       *
       * The ref is a stable object whose `.current` is rewritten on every render,
       * so reading `draftRef.current` after the await yields the draft as of the
       * most recent render. That is what makes "did the user type while we were
       * waiting?" answerable at all.
       *
       * Assigning during render is safe here: the value is only compared and
       * written after an explicit await, never during the render pass itself.
       */
      draftRef.current = draft

      /**
       * The value this plugin last wrote into the composer.
       *
       * `backup` is only meaningful while the composer still holds what the
       * enhancement produced. Once anything else changes the draft — the user
       * typing, or the host clearing it after a send — the stored original is
       * stale, and offering "restore original" would overwrite whatever is there
       * now with text from an earlier round.
       *
       * Reported symptom: type → enhance → send (host clears the composer) → the
       * button still said 恢复原文 → type something new → click it → the new text
       * was replaced by the previous round's original. A silent way to lose work.
       */
      const enhancedRef = React.useRef(null)

      /**
       * Invalidate the revert offer as soon as the draft stops being ours.
       *
       * Runs on every render, so it also catches host-driven clears (a send) that
       * never involve this plugin's own callbacks.
       */
      React.useEffect(() => {
        if (backup === null) return
        if (draft !== enhancedRef.current) {
          // Something other than this plugin changed the composer; drop the offer.
          setBackup(null)
          enhancedRef.current = null
        }
      }, [draft, backup])

      React.useEffect(() => () => {
        aliveRef.current = false
        if (abortRef.current) abortRef.current.abort()
        if (timerRef.current) clearTimeout(timerRef.current)
      }, [])

      React.useEffect(() => {
        if (notice === '') return undefined
        timerRef.current = setTimeout(() => setNotice(''), 4500)
        return () => clearTimeout(timerRef.current)
      }, [notice])

      const hasDraft = typeof draft === 'string' && draft.trim().length >= MIN_TEXT_LENGTH
      const canEnhance = hasDraft && !busy && !props.locked
      /**
       * Reverting needs a stored backup, an editor that will take a write, AND a
       * composer that still holds what we wrote.
       *
       * That last condition is the fix for a reported data-loss bug. The offer used
       * to survive any later change to the composer, so after a send (which clears
       * the draft) the button still read 恢复原文; pressing it then restored the
       * *previous* round's original over whatever the user had just typed.
       *
       * Checking here rather than only in an effect matters: this is a derived
       * value recomputed on every render, so it cannot lag behind the composer the
       * way a scheduled effect can.
       */
      const canRevert = backup !== null && !busy && !props.locked
        && draft === enhancedRef.current
        && typeof inputActions?.setDraft === 'function'

      /**
       * Whether the draft can be read at all.
       *
       * When `useInput` is missing the control cannot know what is typed, and a
       * disabled button with no explanation is indistinguishable from a broken
       * one. That case is reported instead.
       */
      const canReadDraft = typeof useInput === 'function'

      /** Write text into the editor, reporting whether the editor accepted it. */
      const writeDraft = React.useCallback((text) => {
        if (typeof inputActions?.setDraft !== 'function') return false
        try {
          inputActions.setDraft(text)
          return true
        } catch {
          return false
        }
      }, [inputActions])

      const onEnhance = React.useCallback(async () => {
        /**
         * Always give feedback, even when the action cannot proceed.
         *
         * A silently disabled control reads as "the plugin is broken", which is
         * exactly how this plugin was reported. Every refusal now says why.
         */
        if (!canReadDraft) {
          setNotice(msg(t, 'noUseInput'))
          return
        }
        if (!hasDraft) {
          setNotice(msg(t, 'needDraft'))
          return
        }
        if (props.locked) {
          setNotice(msg(t, 'locked'))
          return
        }
        /**
         * The synchronous latch, not `busy`.
         *
         * `busy` is React state, and two clicks inside one tick both observe the
         * value captured when the handler was created. `busyRef` flips in the
         * same statement, so a double click cannot start two rewrites and cannot
         * orphan the first request's AbortController.
         */
        if (busyRef.current) return
        if (typeof inputActions?.setDraft !== 'function') {
          setNotice(msg(t, 'noSetDraft'))
          return
        }

        // Stash the draft before it is replaced; this is what revert restores.
        const original = draftRef.current
        /** The session this rewrite belongs to; checked before writing back. */
        const startedIn = sessionRef.current
        const controller = new AbortController()
        abortRef.current = controller
        busyRef.current = true
        setBusy(true)
        setNotice('')

        try {
          const result = await requestEnhance(original, style, controller.signal)
          if (!aliveRef.current) return

          if (!result.ok) {
            setNotice(result.error)
            return
          }
          /**
           * Refuse to write into a different session.
           *
           * The Host may reuse this component across sessions, in which case
           * `aliveRef` stays true and the check below would happily drop the old
           * session's text into the new session's composer. Comparing the session
           * captured at click time against the live one closes that path.
           */
          if (sessionRef.current !== startedIn) return
          /**
           * Re-read before writing. The model call took time; if the user typed
           * in the meantime their newer text wins and the result is dropped.
           *
           * Read from `draftRef.current`, not from the `draft` local. This runs
           * inside the closure that started the request, and an await resumes in
           * that same closure — so the local is frozen at click time, however the
           * dependency array is written. The ref is a stable object whose
           * `.current` is refreshed on every render, so this reads the draft as
           * of the latest render: exactly what the check needs.
           *
           * Passing `original` as the fallback keeps a genuinely unreadable store
           * from reporting a phantom edit.
           */
          const current = readLiveDraft(draftRef.current, original)
          if (current.trim() !== original.trim()) {
            setNotice(msg(t, 'draftChanged'))
            return
          }
          if (writeDraft(result.prompt)) {
            setBackup(original)
            // Remember exactly what we wrote, so the guard above can tell an
            // untouched composer from one the user (or a send) has changed.
            enhancedRef.current = result.prompt
            setNotice(msg(t, 'enhanced'))
          } else {
            /**
             * Writing failed, so the result goes to the clipboard instead.
             *
             * The message is only shown once the clipboard actually accepts it —
             * claiming success before the promise settles is how the old code
             * could report "已复制" while nothing was copied.
             */
            setNotice(msg(t, 'writing'))
            const copied = await copyToClipboard(result.prompt)
            if (!aliveRef.current) return
            setNotice(msg(t, copied ? 'copied' : 'copyFailed'))
          }
        } finally {
          busyRef.current = false
          if (aliveRef.current) setBusy(false)
          abortRef.current = null
        }
        /**
         * `draft` MUST be in this list.
         *
         * Without it, `onEnhance` keeps the closure captured at click time, so
         * `draftRef.current` inside the callback still points at the ref object
         * but the callback itself is never rebuilt — the freshness check then
         * compares the pre-flight draft against itself and always passes.
         * That dependency is the actual fix; changing only how the value is read
         * (props vs ref) does not help, which is why this was missed twice.
         */
      }, [canReadDraft, hasDraft, busy, props, writeDraft, draft, style])

      const onRevert = React.useCallback(() => {
        if (!canRevert) return
        if (writeDraft(backup)) {
          setBackup(null)
          // The composer no longer holds our enhancement, so nothing is ours to
          // restore any more.
          enhancedRef.current = null
          setNotice(msg(t, 'reverted'))
        } else {
          setNotice(msg(t, 'revertFailed'))
        }
      }, [canRevert, backup, writeDraft])

      const onCancel = React.useCallback(() => {
        if (abortRef.current) abortRef.current.abort()
        // Release the synchronous latch too, or the next click would be refused
        // by a gate that React state has not yet cleared.
        busyRef.current = false
        if (aliveRef.current) setBusy(false)
        setNotice('')
      }, [])

      /**
       * Label, icon and mode for the current state.
       *
       * The button is never `disabled`: a disabled control with no explanation
       * is what made this feature look broken. Every state is clickable and
       * every refusal explains itself through `onEnhance`'s notice path.
       */
      let label
      let icon
      let onClick
      let mode
      if (busy) {
        label = msg(t, 'enhanceBusy')
        icon = React.createElement('span', { className: 'dsh-pe-spinner' }, '⋯')
        onClick = onCancel
        mode = 'busy'
      } else if (canRevert) {
        label = msg(t, 'revert')
        icon = React.createElement(RevertIcon, { size: 14 })
        onClick = onRevert
        mode = 'revert'
      } else {
        label = hasDraft ? msg(t, 'enhance') : msg(t, 'enhanceEmpty')
        icon = React.createElement(SparkIcon, { size: 14 })
        onClick = onEnhance
        mode = 'idle'
      }

      /**
       * The update badge.
       *
       * Shown only when the Host reports a newer version. Everything else —
       * "already current", "local link install", "market absent" — stays quiet,
       * so the composer is only noisy when there is something to act on.
       *
       * Deliberately no one-click "update" button: the Market owns mutation and
       * its own same-origin guards. Pointing the user at the Market panel keeps
       * this plugin from reimplementing (and mis-guarding) an install path.
       */
      const update = updateState && updateState.kind === 'available'
        ? React.createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-pe-update',
            'data-dsh-part': 'update-badge',
            'data-dsh-update': 'available',
            'aria-label': msg(t, 'updateAvailable'),
            title: `${msg(t, 'updateAvailable')}\n${describeDelta(updateState)}\n${msg(t, 'updateHint')}`,
            onMouseDown: (event) => event.preventDefault(),
            onClick: () => setNotice(msg(t, 'updateHint')),
          },
          // A short human label, never a raw commit id — see `describeDelta`.
          msg(t, 'updateBadge'),
        )
        : null

      /**
       * The visible text: a live notice wins, otherwise the mode label.
       *
       * `aria-label` follows `text`, not `label`. The two previously disagreed —
       * the accessible name was always the mode label while the screen showed the
       * notice — which breaks WCAG 2.5.3 (Label in Name) and made a screen reader
       * announce something different from what a sighted user reads.
       */
      const text = notice !== '' ? notice : label
      /** Dim the idle control when there is nothing to enhance yet. */
      const idleDim = mode === 'idle' && !hasDraft

      /**
       * Announce notices to assistive technology.
       *
       * The host renders its own notices as `role="status"`; this follows that
       * convention. `aria-live="polite"` so a progress message does not interrupt
       * whatever the user is reading. Rendered only while a notice exists, so the
       * region is genuinely a change signal rather than constant empty text.
       */
      const liveRegion = React.createElement(
        'span',
        {
          className: 'dsh-pe-status',
          role: 'status',
          'aria-live': 'polite',
          'data-dsh-part': 'status',
        },
        notice,
      )

      /**
       * The style selector.
       *
       * A native `<select>` keeps the primary interaction unchanged — the main
       * button is still a single click that runs the current style — while making
       * the Host's other styles reachable. Chosen over a long-press or a context
       * menu because those are undiscoverable, collide with text selection, and
       * are not reachable by keyboard or screen readers.
       *
       * Hidden while a rewrite is in flight so the busy state stays unambiguous.
       */
      const stylePicker = styles.length > 1 && !busy
        ? React.createElement(
          'select',
          {
            className: 'dsh-pe-style',
            'data-dsh-part': 'style-select',
            value: style,
            'aria-label': msg(t, 'styleLabel'),
            title: msg(t, 'styleLabel'),
            // Never steal the caret from the composer.
            onMouseDown: (event) => event.stopPropagation(),
            onChange: (event) => {
              setStyle(event.target.value)
              setNotice('')
            },
          },
          styles.map((id) => React.createElement(
            'option',
            { key: id, value: id },
            STYLE_LABELS[id] ?? id,
          )),
        )
        : null

      return React.createElement(
        'span',
        { className: 'dsh-pe-group', 'data-dsh-plugin': 'dsh-prompt-forge' },
        stylePicker,
        update,
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-prompt-forge-button',
            'data-dsh-plugin': 'dsh-prompt-forge',
            'data-dsh-part': 'enhance-button',
            'data-dsh-mode': mode,
            'data-dsh-ready': hasDraft ? 'true' : 'false',
            'data-dsh-style': style,
            // Keep the accessible name equal to the visible text (WCAG 2.5.3).
            'aria-label': text,
            // The full label stays discoverable on hover even when the visible
            // text has been replaced by a notice or truncated by max-width.
            title: label,
            'aria-busy': busy ? 'true' : 'false',
            style: idleDim ? { opacity: 0.6 } : undefined,
            // Keep the caret in the editor: this control must never steal focus.
            onMouseDown: (event) => event.preventDefault(),
            onClick,
          },
          React.createElement('span', { className: 'dsh-pe-icon' }, icon),
          React.createElement('span', { className: 'dsh-pe-text' }, text),
        ),
        liveRegion,
      )
    }

    /**
     * The settings panel.
     *
     * Shows the configuration that is actually in force and lets the user change
     * the parts this plugin owns. Deliberately small: it edits style selection,
     * the slash command toggle, and custom style templates — the things a user
     * would otherwise have to hand-edit `cordis.patch.yml` and restart for.
     *
     * `provider` / `model` are shown read-only: they come from the profile's
     * patch file, and letting a settings form repoint every rewrite at a
     * different model is a footgun with no upside here.
     */
    function SettingsPanel(props) {
      const { t } = props
      const [state, setState] = React.useState(null)
      const [status, setStatus] = React.useState('')
      const [draftStyles, setDraftStyles] = React.useState(null)
      const [busy, setBusy] = React.useState(false)

      /** Load once on mount. */
      React.useEffect(() => {
        let cancelled = false
        void (async () => {
          const data = await loadPanelConfig()
          if (cancelled) return
          setState(data ?? { ok: false })
          setDraftStyles(textareaFrom(data))
        })()
        return () => { cancelled = true }
      }, [])

      const onSave = React.useCallback(async () => {
        if (busy || state === null) return
        setBusy(true)
        setStatus('')
        const patch = {}
        // Only send what changed, so the panel's blind spots cannot overwrite
        // values written elsewhere.
        const parsed = parseStyleLines(draftStyles ?? '')
        if (parsed.error) {
          setBusy(false)
          setStatus(parsed.error)
          return
        }
        /**
         * Detect a change by comparing the two maps as SETS of entries.
         *
         * `JSON.stringify` comparison was wrong for a real case: it is sensitive to
         * key ORDER, so re-saving an unchanged style list whose keys came back in a
         * different order would look like an edit and rewrite the file — and a
         * rewrite is exactly when a user-visible style can appear to vanish.
         *
         * Normalising through `JSON.stringify` per entry rather than joining with a
         * separator avoids a second trap: a style text containing the separator
         * would otherwise make two different maps compare equal.
         */
        const sameStyles = (a, b) => {
          const norm = (o) =>
            Object.entries(o && typeof o === 'object' ? o : {})
              .map(([k, v]) => JSON.stringify([k, v]))
              .sort()
              .join(',')
          return norm(a) === norm(b)
        }
        if (!sameStyles(parsed.styles, state.customStylesMap)) {
          patch.styles = parsed.styles
        }
        if (Object.keys(patch).length === 0) {
          setBusy(false)
          setStatus(msg(t, 'settingsNoChange'))
          return
        }
        const res = await savePanelConfig(patch)
        setBusy(false)
        if (res.ok) {
          setStatus(msg(t, 'settingsSaved'))
          const data = await loadPanelConfig()
          if (data) { setState(data); setDraftStyles(textareaFrom(data)) }
        } else {
          setStatus(res.error ?? msg(t, 'settingsSaveFailed'))
        }
      }, [busy, state, draftStyles, t])

      if (state === null) {
        return React.createElement('div', { className: 'dsh-forge-settings' },
          React.createElement('div', { className: 'dsh-forge-muted' }, msg(t, 'settingsLoading')))
      }
      if (state.ok === false) {
        return React.createElement('div', { className: 'dsh-forge-settings' },
          React.createElement('div', { className: 'dsh-forge-error' }, msg(t, 'settingsUnavailable')))
      }

      /**
       * The route rows show what a rewrite would ACTUALLY use, plus where that came
       * from. The panel used to echo the config value, which stopped being the
       * whole truth once the agent's own selection started leading — a user would
       * read a stale provider here while rewrites ran on a different one.
       */
      const fromConfig = state.config.source === 'config'
      const routeNote = fromConfig ? msg(t, 'settingsFromConfig') : msg(t, 'settingsFollowing')
      const rows = [
        [msg(t, 'settingsProvider'), state.config.provider ?? msg(t, 'settingsUnset'), routeNote],
        [msg(t, 'settingsModel'), state.config.model ?? msg(t, 'settingsUnset'), routeNote],
        [msg(t, 'settingsDefaultStyle'), state.config.defaultStyle, msg(t, 'settingsReadonly')],
        [msg(t, 'settingsBuiltinStyles'), state.config.styles.join(' / '), msg(t, 'settingsReadonly')],
      ]

      return React.createElement(
        'div',
        { className: 'dsh-forge-settings', 'data-dsh-part': 'settings-panel' },
        React.createElement('h3', { className: 'dsh-forge-h' }, msg(t, 'settingsTitle')),
        React.createElement('p', { className: 'dsh-forge-muted' }, msg(t, 'settingsIntro')),

        React.createElement('table', { className: 'dsh-forge-table' },
          React.createElement('tbody', null,
            rows.map(([k, v, note]) => React.createElement('tr', { key: k },
              React.createElement('th', null, k),
              React.createElement('td', null,
                React.createElement('code', null, String(v)),
                React.createElement('span', { className: 'dsh-forge-muted' }, '  ' + note)))))),

        React.createElement('h4', { className: 'dsh-forge-h4' }, msg(t, 'settingsCustomStyles')),
        React.createElement('p', { className: 'dsh-forge-muted' }, msg(t, 'settingsCustomHint')),
        React.createElement('textarea', {
          className: 'dsh-forge-textarea',
          'data-dsh-part': 'settings-styles',
          value: draftStyles ?? '',
          spellCheck: false,
          rows: 6,
          placeholder: 'prd | 按我们的 PRD 模板组织：背景 / 目标 / 非目标 / 验收标准。',
          onChange: (event) => setDraftStyles(event.target.value),
        }),

        React.createElement('div', { className: 'dsh-forge-actions' },
          React.createElement('button', {
            type: 'button',
            className: 'dsh-forge-save',
            'data-dsh-part': 'settings-save',
            disabled: busy,
            onClick: onSave,
          }, busy ? msg(t, 'settingsSaving') : msg(t, 'settingsSave'))),

        status !== ''
          ? React.createElement('div', { className: 'dsh-forge-status', role: 'status' }, status)
          : null,

        React.createElement('p', { className: 'dsh-forge-muted dsh-forge-path' },
          msg(t, 'settingsConfigFile') + ': ' + (state.configFile ?? '—')),
      )
    }

    /**
     * Turn stored custom styles into the textarea's line format.
     * @param data - the config response.
     * @returns one `id | text` line per style.
     */
    function textareaFrom(data) {
      const map = (data && data.customStylesMap) || {}
      return Object.entries(map).map(([id, text]) => `${id} | ${text}`).join('\n')
    }

    /**
     * Parse the textarea back into a styles map.
     *
     * Format is `id | guidance`, one per line; blank lines and `#` comments are
     * ignored so a user can annotate their own file.
     *
     * Validation matches the Host's: a bad line is reported here rather than
     * silently dropped on save, because the user is looking at this form and can
     * fix it.
     *
     * @param text - textarea contents.
     * @returns `{ styles }` or `{ error }`.
     */
    function parseStyleLines(text) {
      const styles = {}
      const lines = String(text).split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        if (line === '' || line.startsWith('#')) continue
        const sep = line.indexOf('|')
        if (sep === -1) return { error: `第 ${i + 1} 行缺少 "|" 分隔符` }
        const id = line.slice(0, sep).trim()
        const guide = line.slice(sep + 1).trim()
        if (!/^[a-z][a-z0-9_-]{0,31}$/.test(id)) return { error: `第 ${i + 1} 行的风格名不合法：${id}` }
        if (guide === '') return { error: `第 ${i + 1} 行没有内容` }
        if (Object.prototype.hasOwnProperty.call(styles, id)) return { error: `风格名重复：${id}` }
        styles[id] = guide
      }
      return { styles }
    }

    /**
     * Copy text through the clipboard API.
     *
     * Returns whether the copy actually succeeded. The previous version fired the
     * promise with `void` and returned nothing, so a rejected clipboard write
     * (permission denied, non-secure context, document not focused) still produced
     * a "已复制" notice — a success message for an operation that never happened.
     *
     * @param text - text to copy.
     * @returns `true` only when the clipboard accepted the text.
     */
    async function copyToClipboard(text) {
      try {
        if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
          return false
        }
        await navigator.clipboard.writeText(text)
        return true
      } catch {
        return false
      }
    }

    /** Inject the control's styling once, at plugin scope. */
    function installStyles() {
      const id = 'dsh-prompt-forge-style'
      if (document.getElementById(id)) return
      const style = document.createElement('style')
      style.id = id
      style.textContent = `
.dsh-pe-group{display:inline-flex;align-items:center;gap:4px;min-width:0;position:relative}
.dsh-pe-style{height:28px;padding:0 4px;border:1px solid var(--dsh-border,rgba(127,127,127,.32));border-radius:8px;background:rgba(127,127,127,.06);color:inherit;font-size:12px;line-height:1;cursor:pointer;font-family:inherit;outline:none;transition:background .15s ease}
.dsh-pe-style:hover{background:rgba(127,127,127,.16)}
.dsh-pe-style:focus-visible{outline:2px solid #3b82f6;outline-offset:1px}
.dsh-prompt-forge-button{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 10px;border:1px solid var(--dsh-border,rgba(127,127,127,.32));border-radius:8px;background:rgba(127,127,127,.06);color:inherit;font-size:12px;line-height:1;cursor:pointer;transition:background .15s ease,opacity .15s ease;white-space:nowrap;max-width:260px;overflow:hidden;font-family:inherit}
.dsh-prompt-forge-button:hover{background:rgba(127,127,127,.16)}
.dsh-prompt-forge-button:active{background:rgba(127,127,127,.24)}
.dsh-prompt-forge-button:focus-visible{outline:2px solid #3b82f6;outline-offset:1px}
.dsh-prompt-forge-button[data-dsh-ready="true"]{border-color:rgba(59,130,246,.45);background:rgba(59,130,246,.08)}
.dsh-prompt-forge-button[data-dsh-ready="true"]:hover{background:rgba(59,130,246,.18)}
.dsh-prompt-forge-button[data-dsh-mode="busy"]{color:#3b82f6;border-color:rgba(59,130,246,.45)}
.dsh-prompt-forge-button[data-dsh-mode="revert"]{color:#b45309;border-color:rgba(180,83,9,.45)}
.dsh-pe-icon{display:inline-flex;align-items:center;justify-content:center}
.dsh-pe-text{overflow:hidden;text-overflow:ellipsis}
.dsh-pe-status{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
/* The badge must never grow the toolbar: cap it and clip, so an unexpected
   version string degrades to an ellipsis instead of pushing the model
   selector off the row. The full text stays available in the tooltip. */
.dsh-pe-update{display:inline-flex;align-items:center;height:28px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 8px;border:1px solid rgba(59,130,246,.5);border-radius:8px;background:rgba(59,130,246,.1);color:#3b82f6;font-size:11px;line-height:1;font-variant-numeric:tabular-nums;cursor:pointer;font-family:inherit;transition:background .15s ease}
.dsh-pe-update:hover{background:rgba(59,130,246,.2)}
.dsh-pe-update:focus-visible{outline:2px solid #3b82f6;outline-offset:1px}
.dsh-pe-spinner{display:inline-block;animation:dsh-pe-spin 1s linear infinite}
@keyframes dsh-pe-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
/* Settings panel. Uses host design tokens with fallbacks so it still renders
   in themes that do not define them, rather than collapsing to invisible text. */
.dsh-forge-settings{padding:4px 2px;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-primary,inherit);max-width:640px}
.dsh-forge-h{margin:0 0 4px;font-size:15px;font-weight:600}
.dsh-forge-h4{margin:16px 0 4px;font-size:13px;font-weight:600}
.dsh-forge-muted{color:var(--dsw-alias-label-secondary,#888);font-size:12px;margin:0 0 8px}
.dsh-forge-error{color:var(--dsw-alias-state-error-primary,#dc2626)}
.dsh-forge-table{width:100%;border-collapse:collapse;margin:8px 0 4px}
.dsh-forge-table th{text-align:left;font-weight:500;color:var(--dsw-alias-label-secondary,#888);padding:4px 12px 4px 0;white-space:nowrap;vertical-align:top;width:110px}
.dsh-forge-table td{padding:4px 0;word-break:break-all}
.dsh-forge-table code{font-family:var(--dsw-font-family-mono,ui-monospace,monospace);font-size:12px}
.dsh-forge-textarea{width:100%;box-sizing:border-box;font-family:var(--dsw-font-family-mono,ui-monospace,monospace);font-size:12px;line-height:1.5;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.32));border-radius:6px;background:var(--dsw-alias-bg-layer-2,transparent);color:inherit;resize:vertical;outline:none}
.dsh-forge-textarea:focus-visible{border-color:#3b82f6;outline:2px solid rgba(59,130,246,.35);outline-offset:1px}
.dsh-forge-actions{margin-top:8px}
.dsh-forge-save{border:1px solid rgba(59,130,246,.45);background:rgba(59,130,246,.1);color:#3b82f6;border-radius:6px;padding:5px 14px;font-size:12px;font-family:inherit;cursor:pointer}
.dsh-forge-save:hover:enabled{background:rgba(59,130,246,.2)}
.dsh-forge-save:disabled{opacity:.55;cursor:default}
.dsh-forge-save:focus-visible{outline:2px solid #3b82f6;outline-offset:1px}
.dsh-forge-status{margin-top:8px;font-size:12px;color:var(--dsw-alias-brand-primary,#3b82f6)}
.dsh-forge-path{margin-top:14px;word-break:break-all;font-size:11px}
`
      document.head.appendChild(style)
    }

    /**
     * Plugin entry point.
     *
     * Registers into `conversation.input.right`, which `ui-conversation` renders
     * immediately BEFORE the model selector — the left-hand side the user asked
     * for. A high `order` keeps it adjacent to the model seat rather than ahead
     * of anything else that contributes to the same list.
     *
     * @param ctx - client Cordis context.
     */
    function apply(ctx) {
      /**
       * Localisation is best-effort and must never block mounting.
       *
       * `ctx.locale` is a sibling service and may be absent, and `register` may
       * throw. Both are caught here and degrade to the built-in Chinese strings,
       * because the alternative — bailing out of `apply` — would leave the
       * stylesheet installed with no control, which is worse than untranslated
       * text. This ordering is deliberate: the slot is registered regardless.
       */
      let t = null
      try {
        if (ctx.locale && typeof ctx.locale.register === 'function') {
          ctx.locale.register(NAMESPACE, DICTIONARIES)
          if (typeof ctx.locale.bind === 'function') t = ctx.locale.bind(NAMESPACE)
        }
      } catch (error) {
        console.warn('[dsh-prompt-forge] locale unavailable; using built-in strings:', error)
      }

      try {
        installStyles()
        ctx.slots.inject('conversation.input.right', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.right',
              id: 'prompt-enhancer',
              order: 100,
              // Only advertise the namespace when it actually bound, so the host
              // does not try to translate against a missing dictionary.
              ...(t ? { locale: NAMESPACE } : {}),
            },
            (props) => EnhanceButton({ ...props, t }),
          ),
        )
      } catch (error) {
        console.error('[dsh-prompt-forge] failed to mount the composer control:', error)
      }

      /**
       * The settings panel.
       *
       * A separate try/catch from the composer control on purpose: these are two
       * independent surfaces, and a failure to register one must not take the
       * other down. The host reads this slot to build the settings navigation
       * (`ctx.slots.entries('settings.section')`), ordered by `order`.
       */
      try {
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'prompt-forge',
              // After the built-in sections, before plugin-management UIs.
              order: 50,
              label: () => msg(t, 'settingsNav'),
              ...(t ? { locale: NAMESPACE } : {}),
            },
            (props) => SettingsPanel({ ...props, t }),
          ),
        )
      } catch (error) {
        console.error('[dsh-prompt-forge] failed to mount the settings panel:', error)
      }
    }

    exports.apply = apply
    exports.inject = inject
    exports.name = name
    return module.exports
  },
})
