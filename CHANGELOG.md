# Changelog

本项目记录了两轮质量审查加一次用户反馈后修复的 13 个真实缺陷。其中若干属于
"代码和测试犯同一个错，所以一直全绿"的类型，保留细节是为了避免后人重走。

## [1.4.0] - 2026-10-13

### 新增：设置面板

- 注册进宿主 `settings.section` 槽位，在 DSH 设置对话框里成为一个独立页面。
  显示当前生效的配置（模型服务 / 模型 / 默认风格 / 内置风格），
  并提供自定义风格的编辑入口 —— 不必再手改 `cordis.patch.yml` 后重启。
- 支撑它的运行时可写配置层 `lib/config.js`：
  - 持久化到 `~/.dsh/dsh-prompt-forge.config.json`，**不用 localStorage**
    （DSH Desktop 每次启动分配新端口，Chromium 按 Origin 隔离存储，端口一变配置就"丢"）；
  - **顶层键 merge** + **原子替换**（tmp + rename）；
  - 读取路径永不抛错：损坏 / 只读 / 截断一律退回默认值；
  - 优先级 用户配置 > 静态 config。
- `provider` / `model` 在面板里**故意只读**：它们来自 profile 的 patch 文件。

### 移除：多风格对比

- 按用户要求移除 `/compare` 路由、对比引擎、客户端面板与其测试套件。
- 同一次提交里的「自定义风格模板」不受影响，保持完整。
## [1.3.0] - 2026-10-13

### 新增（独有功能）

- （曾实现「多风格对比」，后于 1.4.0 按用户要求移除；详见该版本条目。）
- **自定义风格模板**：风格从硬编码改为数据驱动。`styles` 配置可追加自己的
  风格指令，下拉与 `/enhance --你的风格` 都能用。内置不可覆盖，非法条目静默跳过。

### 改名

- `dsh-prompt-enhancer` → **`dsh-prompt-forge`**。原名与一个更早、更大的无关项目
  重名（Fishsb/dsh-prompt-enhancer，2026-08-13 首发）。详见 [docs/RENAME.md](docs/RENAME.md)。

### 修复

- **更新徽标显示原始 commit id**：市场对 git 安装返回 40 位 commit，徽标直接渲染成
  `旧 → 新`，两个 hash 铺满整条工具栏。现改为短标签 + 缩写 id 的 tooltip，
  并用 CSS 限宽，任何未来值都撑不大工具栏。
## [1.2.1] - 2026-10-13

### 文档与工程

- 新增 **[docs/UPDATE-FLOW.md](docs/UPDATE-FLOW.md)**：完整更新机制说明。
  包含为什么把更新交给市场而不是自己实现、`github:` 与 `link:` 的区别、
  用户的两条更新路径与失败码解读、作者发版流程、以及每一环的可复现验证命令。
- 新增 **GitHub Actions CI**：
  - 在 Node 22 与 24 上跑全部测试；
  - **校验 `package.json` 的 `version` 与 `lib/index.js` 的 `PACKAGE_VERSION`
    一致**。二者漂移会让插件向市场报告错误的版本号，所以做成门禁而不是靠自觉。

### 端到端验证（实测，非模拟）

把依赖从 `link:` 切到 `github:` 后，完整链路已跑通：

| 环节 | 证据 |
|---|---|
| 真正从 GitHub 下载 | `pnpm-lock.yaml` 的 `version:` 为 `https://codeload.github.com/.../tar.gz/743884d` |
| 市场识别来源 | `"source": "github"`（切换前是 `"linked"`） |
| 检测到新提交 | 推入 `1dc5c28` 后 `"updateAvailable": true`，`latest=1dc5c28` |
| 市场汇总可见 | `updatable` 计数递增，该包出现在 `packages` 列表 |
| 市场拒绝在错误时机更新 | 在 agent 回合内请求更新返回 `AGENTS_RUNNING`，`retryable: true` |

最后一条是市场**正确行为**而非缺陷：更新会就地替换插件文件，
运行中的 agent 可能读到半新半旧的文件，因此被稳妥拒绝。

## [1.2.0] - 2026-10-13

### 修复（用户反馈：撤销覆盖新输入）

- **「恢复原文」会删掉用户后来输入的内容（数据丢失）**。
  复现时序：输入 → 增强 → **发送**（宿主清空输入框）→ 按钮仍显示「恢复原文」
  → 用户输入新内容 → 点它 → 新内容被上一轮的旧原文覆盖。

  根因：备份一旦写入就再不清除，撤销的可用性没有跟草稿绑定。

  修法：新增 `enhancedRef` 记录"本插件最后写进输入框的内容"，并把撤销可用性
  改为**每帧重新计算的派生值**（`draft === enhancedRef.current`），
  而不是只靠一个调度型 effect —— 派生值不会像 effect 那样滞后于宿主清空。

  回归测试 `test/revert-scope.mjs` 覆盖三条路径：发送清空后撤销必须失效、
  未改动的草稿撤销必须保留（反向验证，防止修过头）、用户手改结果后撤销失效。
  该测试的桩**故意不回放 effect**，以此证明守卫不依赖 effect 是否跑过。

### 新增（远程更新）

- **更新检查**：新增 `GET /plugins/dsh-prompt-forge/update`，
  经 `dshmarket` 的公开更新 API（`dsh-market/update-api/v1`）查询本插件版本。
  结果都是可解释状态而非异常：
  `available` / `current` / `linked` / `unavailable` / `unknown`。
- **界面徽标**：有新版本时按钮旁显示 `旧 → 新`，点击提示去插件市场执行更新。
- **不提供一键更新**：市场拥有变更权与同源守卫，本插件只做"报告"，
  不重新实现（也不错误实现）安装路径。
- **切换为可更新安装**：`tools/switch-to-github.mjs` 把 profile 依赖从
  `link:` 改为 `github:`。市场对 `link:` 只会报 `source: "linked"`，
  `latestVersion: null`，没有可更新的对象。默认 dry run，需 `--apply` 才执行，
  并自动备份原 package.json。

### 新增测试

- `test/revert-scope.mjs` —— 撤销作用域（10 项）
- `test/update-check.mjs` —— 更新检查全分支，含缺失市场 / schema 不匹配 /
  超时 / 边界入参（26 项）

## [1.1.0] - 2026-10-12

### 修复（数据丢失与状态机）

- **防覆盖护栏恒不生效（数据丢失）**：改写期间用户继续输入，旧结果会覆盖新内容。
  根因不在读取来源，而在于 **`await` 恢复时仍在发起请求的闭包内** ——
  闭包捕获的局部变量永远是点击那一刻的值，因此补依赖数组、换 `props` 读取都无效。
  正确做法是每次渲染刷新一个 ref，await 之后读该 ref。
  配套测试 `test/f1-guard.mjs` 用真实重渲染时序驱动，并做**反向验证**
  （破坏 ref 刷新机制时测试必须转红），确保断言有鉴别力。
- **双击竞态**：`if (busy) return` 不是门闩。React 批处理状态下同 tick 的两次点击
  读到同一个闭包里的 `false`，第二个请求会覆盖 `abortRef`，使第一个请求永远无法取消。
  改为同步 `busyRef`。
- **跨会话串台**：宿主可能复用组件实例，切换会话时旧会话的结果会写入新会话输入框。
  增加发起时的 sessionId 记录，写回前比对。
- **剪贴板假成功**：`void navigator.clipboard.writeText(...)` 丢弃 Promise，
  复制失败也提示"已复制"。改为 `await` 并返回真实结果。

### 修复（功能性）

- **风格入口未打通**：宿主支持 `default` / `expand` / `concise` / `structured`
  四种风格，`/status` 也如实通告，但控件把 `'default'` 写死在调用处，
  导致另外三种在界面上完全不可达。改为从 `/status` 读取风格列表并新增选择器。
- **`/enhance --default` 被当成正文**：命令的 flag 正则只列了三种风格，
  而风格表有四项。改为由风格表派生正则，消除两处硬编码。
- **`commands` 服务延迟挂载导致斜杠命令未注册**：兄弟插件挂载晚于 `apply()`，
  原实现把 `undefined` 当终局直接返回。改为双路径（即时注册 + `ctx.inject` 延迟回调）。
- **`useInput` 缺失时先崩后检查**：hook 被无条件调用，使其后的防御分支不可达。

### 改进（体验与规范）

- **i18n**：接入 `ctx.locale.register`，提供 zh/en 字典。
  注册失败时降级为内置中文，**绝不因本地化问题阻断控件挂载**。
- **无障碍**：新增 `role="status"` live region 播报提示；`aria-label` 与可见文本同步
  （原实现两者不一致，违反 WCAG 2.5.3）；补 `:focus-visible` 焦点环。
- **对比度**：撤销态琥珀色 `#f59e0b` 在浅色主题下约 2.1:1，改为 `#b45309` 达 AA。
- **完成提示**：`已增强` → `已增强（可「恢复原文」）`，让撤销入口更可发现。
- **契约声明**：`package.json` 补 `dsh.client.inject`，与生态内其它插件一致。

### 新增测试

- `test/f1-guard.mjs` —— 防覆盖护栏时序回归 + 反向验证（2 项）
- `test/flag-regex.mjs` —— 命令 flag 正则覆盖全部风格（9 项）
- `test/p1-state.mjs` —— 双击竞态 / 跨会话 / 剪贴板 / 无障碍 / i18n（13 项）

## [1.0.0] - 2026-10-12

首个可用版本。从 WorkBuddy 的「增强提示词」逐字提取提示词与交互逻辑，
实现为 DeepSeek Harness 原生插件。

### 特性

- 输入框旁的增强按钮（注册在模型选择器左侧）
- 一键改写草稿并写回输入框
- 「恢复原文」撤销
- 进行中可取消
- `/enhance` 斜杠命令（共享同一改写引擎）

### 加载期踩坑（已在 README 记录）

- `Config` 必须是 Standard Schema，否则 cordis 抛 TypeError、插件静默不激活
- `inject` 是硬依赖，声明了但服务未就绪会让 `apply()` 永久挂起且无日志
- patch 的 `name` 必须用包名，文件路径只在 `--patch` 覆盖层场景正确
- 新增 entry 只能用 `- insert:`；`- id:` 找不到条目只发 warning 后跳过
