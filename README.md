# dsh-prompt-forge

把 **WorkBuddy 的「增强提示词」** 功能做成 DeepSeek Harness 原生插件。

在输入框旁边点一下，把你随手写的草稿改写成结构完整、要求明确的提示词，再自动写回输入框。

> **提示词与交互逻辑来自 WorkBuddy 本体**，不是复刻近似版：
> 从 `D:\WorkBuddy\resources\app.asar` 的 `/main/server.js` 和
> `/renderer/assets/lib-chat-ui-*.js` 里逐字提取，并用测试锁死一致性
> （见第六节的 `_test_workbuddy.mjs`）。

---

## 一、它做什么

| 功能 | 说明 |
|---|---|
| **增强按钮** | 挂在**模型选择器左边**（`conversation.input.right` 槽，该槽渲染在 model 之前） |
| **一键改写** | 读取当前草稿 → 调模型改写 → 写回输入框 |
| **恢复原文** | 增强后按钮变为「恢复原文」，一键退回改写前的内容（对应 WorkBuddy 的 `onRevert` / `hasBackup`） |
| **可取消** | 增强进行中再点一次即取消请求（对应 `onCancel`） |
| **预设风格** | `default` 原版行为（默认）、`expand` 扩充、`concise` 精简、`structured` 工程简报 |
| **斜杠命令** | `/enhance [--concise\|--structured] <草稿>`，键盘直达同一引擎 |
| **安全护栏** | 空草稿不调用模型；改写期间你若继续打字，结果自动丢弃，绝不覆盖新内容 |
| **撤销作用域** | 「恢复原文」只在草稿仍是改写结果时可用；你一旦改动、或发送清空了输入框，它自动失效——避免用旧原文覆盖你新写的内容 |
| **多风格对比** | `⇄` 一次跑最多 4 个风格，并排看结果后选用；单个风格失败不影响其它结果 |
| **自定义风格** | 配置里加 `styles` 即可追加自己的风格，无需改代码 |
| **更新提醒** | 以 `github:` 安装时，有新版本会在按钮旁显示徽标 |

## 更新

从插件市场更新即可。完整机制、发版流程与验证命令见
**[docs/UPDATE-FLOW.md](docs/UPDATE-FLOW.md)**。

**一个前提**：必须用 `github:` 安装，`link:` 安装无法远程更新
（市场对 `link:` 只报 `source: "linked"`、`latestVersion: null`）。
仓库自带迁移脚本：

```powershell
node tools/switch-to-github.mjs            # 预演，不改动
node tools/switch-to-github.mjs --apply    # 执行，自动备份
```

## 测试

```powershell
npm test
```

无需安装任何依赖——测试自己重建宿主的运行环境。
当前 **167 项断言 / 8 套 / 0 失败**。

> 其中 `test/revert-scope.mjs` 与 `test/f1-guard.mjs` 带**反向验证**：
> 破坏修复机制时它们必须转红。只测"该拦住的拦住了"是不够的，
> 还要测"不该拦的没拦住不了"。

## 二、位置与结构

```
D:\DeepSeek Harness工作区\插件推荐\dsh-prompt-forge\
├── lib\index.js          Host 半：改写引擎 + HTTP 路由 + /enhance 命令
├── lib\client.js         浏览器半：模型选择器左侧的增强控件
├── package.json          声明 dsh.client 与 exports["./client"]
├── cordis.patch.yml      插件自身的加载声明
└── README.md
```

**为什么按钮在模型左边**

`ui-conversation` 渲染输入框尾部控件的顺序是固定的：

```
renderSlot('conversation.input.right')      ← 注册到这里的最先渲染
renderSlot('conversation.input.model')      ← 模型选择器
renderSlot('conversation.input.activity')   ← 注册到这里的在模型右边
```

WorkBuddy 自己把按钮放在模型**之后**；本插件按要求注册进
`conversation.input.right`，因此显示在模型**左侧**。


加载方式（本机 `@local` 插件范式，与 `pj-mode-preset`、`approval-auto-grant` 一致）：

| 环节 | 位置 |
|---|---|
| 插件实体 | `D:\DeepSeek Harness工作区\插件推荐\dsh-prompt-forge` |
| Junction | `profiles\desktop\node_modules\@local\dsh-prompt-forge` → 指向上面那个实体目录 |
| bundle 登记 | `profiles\desktop\package.json` 的 `dsh.profile.bundles` |
| link 依赖 | `profiles\desktop\package.json` 的 `dependencies` 写 `link:<实体路径>` |
| 挂载声明 | **profile 的 `cordis.patch.yml` + 插件自己的 `cordis.patch.yml`（双份）** |

### ⚠️ 排障记录：为什么一开始「重启了也没反应」

症状：配置写好、DSH 重启、但 `/plugins/dsh-prompt-forge/status` 始终 404，
界面上什么也没多出来。逐层排查后确认了**四个原因**，前三个是配置问题，
**第四个才是真正致命的那个**。

**根本原因：`Config` 不是 Standard Schema（真凶）**

我一度把配置声明成普通对象（为了"零依赖"）：

```js
export const Config = { provider: '', model: '', defaultStyle: 'expand', slashCommand: true }
```

而 cordis 在插件启动前会走这一段（`cordis/lib/index.js:958`）：

```js
function resolveConfig(runtime, config) {
  if (!runtime.Config) return config
  const result = runtime.Config['~standard'].validate(config)   // ← 就是这里
  if (result.issues) throw new ValidationError(result.issues)
  return result.value
}
```

普通对象**没有 `~standard`** → `undefined.validate` → **抛 TypeError → 插件激活失败，
`apply()` 永不执行**。而且这个错误只在直接跑 `dsh` 时打印一行
`warning: N entries did not activate`；Desktop 版把它收进了 Electron 的 crash log，
所以界面上完全看不出问题。

**修法**：`Config` 实现标准 Standard Schema 接口（`~standard.version / vendor /
validate`），仍不加任何依赖。

> 📌 附带发现：profile 里的 `@local/dsh-approval-auto-grant` 犯了**同样的错误**，
> 也一直没激活——所以需要审批的操作从来没被自动批准过。已一并修好
> （原文件备份为 `lib/index.js.bak-before-standardschema`）。

**原因一：`inject` 把插件永久挂起**

原先写了 `export const inject = ['llm']`。Cordis 把 `inject` 当**硬依赖**：
被注入的服务没就绪时 `apply()` **永不执行**，且不报错、不打日志。

**修法**：改为 `inject = []`，所有服务**惰性获取**（`ctx.get(name)`），
哪个不在就降级那一个功能，不拖死整个插件。

**原因二：patch 的 `name` 用了文件路径**

原先插件 patch 里写的是
`name: 'D:/.../dsh-prompt-forge/lib/index.js'`（绝对路径）。

profile 里**所有能正常工作的条目**（`dsh-rotakit`、`dsh-mnemon`、
`@nanmicoder/dsh-agent-teams` …）用的都是**包名**。文件路径只在
`--patch` 覆盖层场景是对的写法，bundle 场景下不是。

**修法**：`name` 改回包名 `@local/dsh-prompt-forge`——它通过 package.json 的
`link:` 依赖挂在 node_modules 下，loader 能解析。

**原因三：patch 分层语义搞反了**

读 `cordis-plugin-include` 源码的 `applyEntryPatches()` 才确认：
patch 是**一层一个来源**组合的（每个 bundle 一层，profile 一层）。

- **新增 entry 只能用 `- insert:`** —— bundle 层从空树开始，必须 insert
- **insert 进去的行会被索引**，`- id:` 定位它 —— 这是 profile 层**覆盖配置**用的
- `- id:` 找不到对应 entry 时**只发一条 warning 然后跳过**，不报错、不挂载

**修法**：插件 patch 用 `- insert:`（新增），profile patch 用 `- id:`（覆盖），
两者的 `id` 必须一致。

`_test_composition.mjs` 直接调用**真实的 `applyEntryPatches`** 跑完整分层组合来验证这点。

**原因四：`webServer` 服务取不到就直接放弃**

修好 `Config` 之后 `apply()` 终于跑了，但探针显示：

```
apply() entered
webServer service unavailable; HTTP routes not mounted    ← 路由根本没挂上
```

我原来只写了一条路——`ctx.get('webServer')` 取不到 `register` 就直接 return。
但**插件之间的激活顺序没有保证**，webServer 完全可能在这之后才挂载。

**修法**：双路径挂载——服务已在就立即注册；不在就用 `ctx.inject(['webServer'], ...)`
挂一个延迟回调（`dsh-rotakit` 用的正是这个方式），并做去重避免重复注册。

> 注意：这里的 `ctx.inject` 是**子上下文**，与插件自己的 `inject = []` 不冲突——
> 前者是「服务来了再调我」，后者是「服务不来我就不启动」，语义完全不同。

`_test_mounting.mjs` 覆盖四种情况：服务已就绪 / 服务后到 / 完全没有服务 / 不重复注册。

## 三、启用 / 停用

**启用**（已完成，重启 DSH 即可）：

```jsonc
// profiles\desktop\package.json
"dependencies": {
  "@local/dsh-prompt-forge": "link:D:/DeepSeek Harness工作区/插件推荐/dsh-prompt-forge"
},
"dsh": { "profile": { "bundles": [
  "@local/dsh-prompt-forge"
] } }
```

**临时停用**：把 `dsh.profile.bundles` 里那一行删掉，重启 DSH。
**改配置**：编辑插件目录下的 `cordis.patch.yml`，重启 DSH。

## 四、配置项

| 键 | 本机当前值 | 说明 |
|---|---|---|
| `provider` | `workbuddy-xdpool` | 改写用的 provider 路由 |
| `model` | `deepseek-v4.1-flash` | 改写用的模型 id |
| `defaultStyle` | `default` | 未指定风格时使用 |
| `slashCommand` | `true` | 是否注册 `/enhance` |

> ⚠️ **`provider` 必须显式配置**。留空时插件会去读宿主的默认模型服务
> （`agentDefaultModel`），但实测该服务在此环境拿不到，请求会带着
> `provider: undefined` 发出去并立刻失败：
> `no adapter registered for provider "undefined"`。
> 显式写死最稳——与 profile 里 `agent-default-model` 用同一个。

风格取值：

| 风格 | 行为 |
|---|---|
| `default` | **WorkBuddy 原版行为**，不加任何额外指令 |
| `expand` | 在原文基础上追加「把隐含的显式化」要求 |
| `concise` | 追加「收紧、去冗余、不加需求」要求 |
| `structured` | 追加「按 目标/交付物/约束/验收标准 分节」要求 |

**实测效果**（本机 2026-10-12）：

```
输入  写个爬虫脚本
输出  请编写一个完整的爬虫脚本，明确说明目标网站或页面类型、需要抓取的数据字段、
      翻页与去重逻辑、请求频率控制，以及数据保存格式（如 CSV、JSON 或数据库），
      并附上必要的异常处理和反爬应对说明。
```

中文进、中文出——语言一致性规则生效。

## 五、实现要点（与 WorkBuddy 对照）

### 1. 提示词：原版分两段，容易搞错

WorkBuddy 在 `/main/server.js` 里定义了两个模板字符串：

```js
// Xo —— 只有一句角色说明，作为 systemPrompt 传
// Zo —— 完整指令，含 {input} 占位符，作为 userPrompt 传
const Qo = (e) => Zo.replace('{input}', e)

await client.runAgent({
  systemPrompt: Xo,        // ← 短句
  userPrompt: Qo(text),    // ← 完整指令 + 草稿
  agentName: Yo,
  model,
})
```

**关键点**：完整指令（含全部规则和示例）走的是 **userPrompt**，systemPrompt 只有一句话。
只把指令塞进 systemPrompt 也能work，但就和原版行为不一致了。

本插件逐字复刻这 2425 字符的指令，`_test_workbuddy.mjs` 会把它与从 asar 重新提取的原文
做**全等比较**（差异为 0 才通过）。

### 2. 输出清理

WorkBuddy 只有一个正则：

```js
const $o = (e) => e.trim().replace(/^["'“”‘’]|["'“”‘’]$/g, '')
```

它去掉**首尾各一个引号字符**——因为指令里的 few-shot 示例都是带引号的，
模型有样学样会给结果加引号。本插件先做同一遍，再额外处理模型无视规则包上代码块的情况。

### 3. 控件状态（四个，不是一个）

WorkBuddy 的控件拿到这些 props：

```jsx
jsx(fQt, { loading: an, disabled: xe, onEnhance: tn,
           onRevert: rn, hasBackup: on, errorMessage: sn, onCancel: nn, icon })
```

对应到本插件：

| 状态 | 表现 |
|---|---|
| 空闲 | ✦ 增强提示词（草稿为空时禁用） |
| 进行中 | ⋯ 正在增强…（点击 = 取消） |
| 可恢复 | ↺ 恢复原文（点一下退回增强前内容） |
| 出错 | 显示错误文字 |

**「恢复原文」是最容易漏掉的一环**：增强前先存一份草稿，之后随时可退回。

### 4. 写回输入框

```js
inputActions.setDraft(text)          // 整体替换，走编辑器撤销栈
inputActions.captureInsertion()      // 取光标位置 + draftRev
inputActions.insertText(text, span)  // 在指定位置插入
```

### 5. 调模型

```js
ctx.llm.stream({
  provider, model,
  system: WB_SYSTEM,        // ← 字段名是 system，不是 systemPrompt
  messages: [{ role: 'user', content: [{ type: 'text', text: buildUserMessage(draft, style) }] }],
  temperature: 0.3,
  maxTokens: 4096,
})
```

> ⚠️ `systemPrompt` 只是 pi-ai 适配器内部的局部变量名，`GenerateOptions` 的正确字段是 **`system`**。

### 6. 浏览器半的 bundle 格式

```js
window.__ModuleLoader__.load({
  id: '@local/dsh-prompt-forge',   // 必须与包名一致
  factory: (require) => { /* ... */ return module.exports },
})
```

只 `require('react')`，其余零依赖——图标内联 SVG，避免外部模块解析风险。

### 7. WorkBuddy 有哪些是没搬过来的

诚实说明，避免以为功能丢了：

| WorkBuddy 有 | 本插件 | 原因 |
|---|---|---|
| `sessionId` 传参 | 未传 | 由 DSH 的模型池按当前会话选择模型，不需要显式指定 |
| 侧车（sidecar）endpoint | 用 `ctx.llm` | DSH 没有 sidecar 概念，走宿主自己的 LLM 服务 |
| 错误码 `sidecar_unavailable` | 等价为服务不可用提示 | — |
| 按钮在模型**右**侧 | 在模型**左**侧 | 按大哥要求 |
| 右下角字符计数等周边 | 未搬 | 与「增强提示词」无关 |

## 六、测试

工程根目录（`D:\DeepSeek Harness工作区\破甲软件`）下十套测试，共 **214 项断言**：

| 文件 | 覆盖 | 结果 |
|---|---|---|
| `_test_enhancer.mjs` | 纯函数、风格归一、失败路径、请求结构 | 34 passed |
| `_test_client.mjs` | bundle 契约、**槽位在模型左侧**、四态渲染、撤销 | 31 passed |
| `_test_route.mjs` | **provider 解析链**（配置 → 服务 → 原始 config → agent → 兜底） | 14 passed |
| `_test_e2e.mjs` | 真实 HTTP 往返、入参校验、`GenerateOptions` 字段名 | 35 passed |
| `_test_workbuddy.mjs` | **提示词与 WorkBuddy 原文全等**、引号清理、语言规则 | 27 passed |
| `_test_resolution.mjs` | `@local` 装载范式（Junction → bundles → link 依赖 → patch） | 33 passed |
| `_test_preflight.mjs` | 重启前门禁：文件、清单、解析链、host 半可导入 | 25 passed |
| `_test_activation.mjs` | **无 inject 时的激活行为**（裸 ctx 也必须跑到 apply） | 19 passed |
| `_test_bootsynthetic.mjs` | **干跑 DSH 装配链**（解析 → 清单 → patch → 导入） | 18 passed |
| `_test_composition.mjs` | **真实 `applyEntryPatches` 分层组合**（bundle insert → profile 覆盖） | 12 passed |
| `_test_config.mjs` | **cordis 的 `resolveConfig`**：Config 必须是 Standard Schema | 14 passed |
| `_test_mounting.mjs` | **双路径路由挂载**：服务已就绪 / 后到 / 缺失 / 去重 | 16 passed |

合计 **278 项断言**（12 套）。

运行：

```powershell
cd "D:\DeepSeek Harness工作区\破甲软件"
node _test_enhancer.mjs
node _test_client.mjs
node _test_e2e.mjs
node _test_route.mjs
node _test_workbuddy.mjs
node _test_resolution.mjs
node _test_preflight.mjs
node _test_activation.mjs
node _test_bootsynthetic.mjs
node _test_composition.mjs
node _test_config.mjs
node _test_mounting.mjs
```

**提示词一致性怎么复现**：`_test_workbuddy.mjs` 的基准文件是
`破甲软件\_wb\prompt-exact.txt`，它由提取脚本从
`D:\WorkBuddy\resources\app.asar` 的 `/main/server.js` 里扫描 `Zo=` 模板字符串
（直到未转义的结束反引号）并解码 `\uXXXX` 得到。要重新提取：

```powershell
# 见 README 附带的提取思路，或直接对比：
#   基准长度应为 2425 字符
```

## 七、验证插件已加载

插件路由无需 GUI 鉴权，可直接探测：

```powershell
curl.exe -s http://127.0.0.1:19387/plugins/dsh-prompt-forge/status
```

加载成功返回：

```json
{"ok":true,"styles":["expand","concise","structured"],"defaultStyle":"expand"}
```

未加载返回 `404`（对比：已安装的 `dsh-rotakit` 同路径返回 200）。

## 八、排错

| 现象 | 原因 | 处理 |
|---|---|---|
| **重启后路由仍 404、界面无变化** | **`Config` 不是 Standard Schema**，cordis 在 apply 前就拒掉（只在 crash log 里可见） | 确认 `Config['~standard'].validate` 存在；查 crash log |
| | 或 **`inject` 导致 apply 被永久挂起** | 确认 `export const inject = []`；查 `~/.dsh/prompt-enhancer-boot.log` |
| 按钮不出现 + 路由 404 | 未重启 DSH，或 bundle 未登记 | 重启；按第七节探测路由 |
| 路由 404 但配置看着没问题 | profile patch 里缺挂载行，或 `name` 用了文件路径 | 见第二节「排障记录」 |
| 按钮灰掉 | 草稿为空，或输入框被锁定 | 输入内容即可 |
| 点击无反应 | 槽位未提供 `inputActions` | 见下节「已知限制」 |
| 提示「无法连接增强服务」 | webserver 未挂载 | 按第七节探测路由 |
| 提示「llm 服务不可用」 | 宿主没提供 llm | 检查模型池配置 |
| 提示额度/凭据类错误 | 模型侧问题 | 检查模型池账号额度 |
| 提示「草稿已改动，未覆盖」 | 改写期间你继续打字了（**这是保护**） | 重新点一次 |

**加载状态怎么看**：插件每次 `apply` 都会往 `~/.dsh/prompt-enhancer-boot.log` 追加一行（带 pid）。

```powershell
Get-Content "$env:USERPROFILE\.dsh\prompt-enhancer-boot.log" -Tail 10
```

- 有 `[pid N] apply() entered` → 插件被挂载了
- 有 `HTTP routes mounted` → 路由挂上了（**关键行**）
- 有 `webServer service unavailable` → 宿主没给 webserver（插件本身活着）
- **文件不存在** → 插件根本没被挂载（问题在 `Config`、`inject` 或装载配置）

**Electron 崩溃日志**（比界面信息准得多）：

```powershell
Get-ChildItem "$env:APPDATA\@deepseek-ai\dsh-desktop\logs" -Filter "crash-*.log" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1 |
  ForEach-Object { Get-Content $_.FullName }
```

看到 `warning: N entries did not activate` 就是插件激活失败的铁证。

## 九、已知限制

**按钮位置**：注册进 `conversation.input.right`，渲染在**模型选择器左侧**。这是槽位决定的，
`ui-conversation` 的渲染顺序固定为 `input.right` → `input.model` → `input.activity`。

**写入依赖 `inputActions`**：该槽位为 session scope，若某个 DSH 版本的 `input.right`
没有投影 `inputActions`，按钮会退化为「复制到剪贴板」并提示，而不会静默失败。

**「恢复原文」只在同一次会话内有效**：备份存在组件状态里，切换会话或重载页面后消失
（与 WorkBuddy 的 `hasBackup` 行为一致——它是组件级状态，不是持久化数据）。
