# 插件更新机制（完整流程）

> 版本：v1.2.1 起支持
> 适用：`@local/dsh-prompt-enhancer`

本插件把更新交给宿主已装的 **`dshmarket`** 处理，自己不实现安装逻辑。
本文档说明**为什么这样设计**、**用户怎么更新**、**作者怎么发版**、以及**每一环怎么验证**。

---

## 一、为什么用市场的 API 而不是自己写

宿主 `dshmarket` 提供了一套**版本化、同源**的公开更新 API
（`dsh-market/update-api/v1`，其自带 `UPDATE-API-V1.md`）。

本插件用它，换来三件事：

| 自己做 | 用市场 API |
|---|---|
| 要 spawn 包管理器 | 不用 |
| 要复刻市场的安装算法 | 不用 |
| 要自己处理同源守卫、回滚、版本校验 | 市场已做，且做得更严 |
| 出错时容易把插件装成半新半旧 | 市场有 `DOWNGRADE_DETECTED` 等稳定失败码，并会从恢复点还原 |

**本插件只做"报告"，不做"变更"。** 这是刻意的边界：
安装路径一旦自己实现，就得同时自己实现它的所有守卫，而守卫做漏的代价是插件损坏。

---

## 二、前提：安装方式必须是 `github:`，不能是 `link:`

这是**能否远程更新的决定性因素**。实测：

| 依赖写法 | 市场报告 | 能否更新 |
|---|---|---|
| `link:D:/...` | `source: "linked"`, `latestVersion: null` | ❌ **不能** |
| `github:owner/repo#sha` | `source: "github"`, `latestVersion` = 分支 HEAD | ✅ 能 |

`link:` 指向本地目录，背后没有远端可比对，所以"更新"无意义。

### 切换到 github 源

仓库自带迁移脚本，**默认预演，不改任何东西**：

```powershell
cd "D:\DeepSeek Harness工作区\插件推荐\dsh-prompt-enhancer"
node tools/switch-to-github.mjs            # 只看计划
node tools/switch-to-github.mjs --apply    # 执行（自动备份 package.json）
```

执行后：

```powershell
cd "$env:USERPROFILE\.dsh\profiles\desktop"
pnpm install
```

**验证真的走了 github**（关键，别只看 install 成功）：

```powershell
# pnpm-lock.yaml 里应出现 codeload.github.com，而不是 link:
node -e "const t=require('fs').readFileSync('pnpm-lock.yaml','utf8');const i=t.indexOf('dsh-prompt-enhancer');console.log(t.slice(i,i+200))"
```

正确输出形如：

```yaml
'@local/dsh-prompt-enhancer':
  specifier: github:2861292267/dsh-prompt-enhancer#main
  version: https://codeload.github.com/2861292267/dsh-prompt-enhancer/tar.gz/<commit>
```

> ⚠️ `pnpm install` 的输出里可能出现
> `@local/dsh-prompt-enhancer is linked to C:\...\node_modules from D:\...`。
> 那是 pnpm 在描述"把包装到 node_modules 的哪个位置"，
> **不代表依赖仍是 link**。判据只看 lockfile 的 `version:` 字段。

### 回滚

```powershell
cd "$env:USERPROFILE\.dsh\profiles\desktop"
copy package.json.bak-before-github package.json
pnpm install
```

---

## 三、用户怎么更新（两条路）

### 路线 A：从插件市场面板（推荐）

1. 打开 **插件市场** 面板
2. 搜索或进入「已安装」
3. 本插件出现 `有新版本` 时点更新
4. 等进度走完
5. 按提示重启

### 路线 B：按钮旁的徽标

有新版本时，输入框的增强按钮旁会出现 `旧 → 新` 徽标，
点击后提示去市场执行更新——**本插件不提供一键安装**，理由见第一节。

### 更新被拒绝时怎么看

市场的拒绝是**有意义的状态**，不是故障。常见两类：

| 失败码 | 含义 | 怎么办 |
|---|---|---|
| `AGENTS_RUNNING` | 有 agent 正在跑（含当前会话本身） | 等它结束或取消后再更新。**这不是 bug**——更新会就地替换插件文件，运行中的 agent 可能读到半新半旧的文件 |
| `RELEASE_TOO_FRESH` | 目标版本太新，未过注册表等待期 | 稍后重试，或带 `force` 重试 |

`AGENTS_RUNNING` 是实测遇到的：在 agent 回合内发起更新会被稳妥拒绝，
`retryable: true`。

---

## 四、作者怎么发版

```powershell
# 1. 改代码
# 2. 同步两个版本号（必须一致，否则更新检查会误报）
#    package.json 的 version
#    lib/index.js 的 PACKAGE_VERSION

# 3. 跑测试
npm test          # 等价于 node test/run.mjs

# 4. 提交并推送
git add -A
git commit -m "release: vX.Y.Z"
git push
```

推送后，市场下一次检查（或 `force=1` 强制检查）就会看到新 commit。

> **两个版本号必须同步**：`package.json` 的 `version` 与
> `lib/index.js` 的 `PACKAGE_VERSION`。前者给包管理器，后者用于在
> 市场返回的 commit 之外提供一个人可读的版本号。不一致会让报告失真。

---

## 五、每一环怎么验证（都可复现）

```powershell
$base = "http://127.0.0.1:19387"

# 1) 市场是否可用、支持哪些能力
curl.exe -s "$base/dsh-market/api/v1/capabilities"

# 2) 本插件的更新状态（UI 的数据源）
curl.exe -s "$base/plugins/dsh-prompt-enhancer/update"

# 3) 绕过缓存强制检查
curl.exe -s "$base/dsh-market/api/v1/updates?name=%40local%2Fdsh-prompt-enhancer&force=1"

# 4) 市场汇总里本插件是否在可更新列表
curl.exe -s "$base/dsh-market/api/v1/updates/summary"
```

### 期望输出对照

**已是最新**：
```json
{"ok":true,"kind":"current","source":"github",
 "current":"<commit>","latest":"<commit>","updateAvailable":false}
```

**有新版本**：
```json
{"ok":true,"kind":"available","source":"github",
 "current":"<旧commit>","latest":"<新commit>","updateAvailable":true}
```

**本地 link 安装**（无法更新）：
```json
{"ok":true,"kind":"linked","latest":null,
 "reason":"当前为本地 link 安装，无法远程更新"}
```

**市场未安装**：
```json
{"ok":false,"kind":"unavailable","reason":"市场更新接口不可用（未安装 dshmarket，或版本过旧）"}
```

### 端到端验证（真的推一个新 commit）

```powershell
# 本地装的 commit
node -e "const t=require('fs').readFileSync(process.env.USERPROFILE+'/.dsh/profiles/desktop/pnpm-lock.yaml','utf8');const m=/dsh-prompt-enhancer[\s\S]{0,200}?tar\.gz\/([a-f0-9]+)/.exec(t);console.log('installed:',m&&m[1])"

# 远端 HEAD
git ls-remote --heads https://github.com/2861292267/dsh-prompt-enhancer.git

# 两者不同时，市场应报 updateAvailable:true
```

---

## 六、`kind` 的完整语义

UI 只对 `available` 显示徽标，其余状态静默——但每个都有明确定义，
便于排错时一眼定位。

| kind | 含义 | UI 行为 |
|---|---|---|
| `available` | 有新版本 | **显示徽标** `旧 → 新` |
| `current` | 已是最新 | 静默 |
| `linked` | 本地 link 安装，无远端可比 | 静默（可更新则需切 `github:`） |
| `unavailable` | 市场服务不可达 / 版本过旧 | 静默 |
| `unknown` | 市场可达但未收录本包 | 静默 |

---

## 七、已知限制

| 项 | 说明 |
|---|---|
| 重启按钮不提供 | `capabilities.restart.supported` 在 Desktop 托管下为 `false`，重启由宿主 shell 负责。本插件**如实透传**该能力，不假装自己能重启 |
| 检查时机 | 组件挂载时检查一次。不做轮询——版本不会在用户打字期间变化 |
| 缓存 | 市场有短时缓存；需要立刻确认时用 `force=1` |
| 版本号双写 | 见第四节，`package.json` 与 `PACKAGE_VERSION` 必须同步 |
