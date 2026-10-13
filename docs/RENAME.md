# 改名记录：dsh-prompt-enhancer → dsh-prompt-forge

> 日期：2026-10-13

## 为什么改

原名 `dsh-prompt-enhancer` 与一个**更早、更大**的无关项目重名：

| | Fishsb/dsh-prompt-enhancer | 本项目（改名前后） |
|---|---|---|
| 首次发布 | **2026-08-13** | 2026-10-12 |
| 版本 | 3.4.2 | 1.2.1 |
| Stars | 90 | — |
| 功能 | 提示词增强 + 语音识别 + 服务重启 | 提示词增强 |
| 规模 | `plugin-host.js` 单文件 314 KB | 全部 68 KB |
| 许可 | **无 LICENSE 文件** | MIT |

结论：**不是被抄，是撞名**。对方先做且做得大得多。

### 为什么没有"把对方功能搬过来"

对方仓库**没有 LICENSE 文件**，即默认保留全部权利，复制其代码属于侵权。
此外两边架构不同（对方 CJS + 314 KB 构建产物，本项目原生 ESM 极简结构），
硬合并只会破坏现有实现。

功能创意本身不受版权保护，因此正确做法是**借鉴方向、独立实现**——
见下方的差异化功能。

## 改了什么

### 包标识

| 项 | 旧 | 新 |
|---|---|---|
| npm 包名 | `@local/dsh-prompt-enhancer` | `@local/dsh-prompt-forge` |
| 仓库名 | `2861292267/dsh-prompt-enhancer` | `2861292267/dsh-prompt-forge` |
| 本地目录 | `插件推荐\dsh-prompt-enhancer` | `插件推荐\dsh-prompt-forge` |
| 浏览器模块 id | `@local/dsh-prompt-enhancer` | `@local/dsh-prompt-forge` |

### **没有**改的东西（重要）

**`- id: prompt-enhancer` 保持不变。**

它是 cordis 的 **entry id**，由插件自己的 `cordis.patch.yml` 定义，
profile 通过 `- id:` 定位它。它与包名是两个独立概念：

- 包名：模块从哪来（`@local/dsh-prompt-forge`）
- entry id：装配树里这一行的身份（`prompt-enhancer`）

改 entry id 需要同时改两份 patch 文件，属于**无关的破坏性变更**，收益为零。

同理，`lib/client.js` 里的 CSS 类名前缀 `.dsh-pe-*` 也保持不变——
`pe` 是旧名的缩写，但它只是样式命名空间，不影响任何契约。

### 同步过的地方

```
package.json            name / displayName / description
cordis.patch.yml        name（包名）
lib/index.js            包名常量、日志前缀、HTTP 路由
lib/client.js           模块 id、槽位 id、路由
test/*.mjs              断言里的包名
README.md / CHANGELOG.md / docs/UPDATE-FLOW.md
tools/switch-to-github.mjs
```

`lib/client.js` 里的 HTTP 路由随之变成 `/plugins/dsh-prompt-forge/*`——
路由前缀由包名派生，所以两半必须同时改，否则客户端调不到宿主。

## 怎么验证改名成功

```powershell
$profile = "$env:USERPROFILE\.dsh\profiles\desktop"

# 1) 包已按新名安装，且来源是 GitHub 而非本地 link
node -e "const j=require(process.env.USERPROFILE+'/.dsh/profiles/desktop/node_modules/@local/dsh-prompt-forge/package.json');console.log(j.name, j.version)"

# 2) lockfile 指向新仓库
node -e "const t=require('fs').readFileSync(process.env.USERPROFILE+'/.dsh/profiles/desktop/pnpm-lock.yaml','utf8');const i=t.indexOf('@local/dsh-prompt-forge');console.log(t.slice(i,i+220))"
```

期望看到 `https://codeload.github.com/2861292267/dsh-prompt-forge/tar.gz/<commit>`。

## 回滚

```powershell
cd "$env:USERPROFILE\.dsh\profiles\desktop"
copy package.json.bak-before-forge-rename package.json
pnpm install
```

同时把 GitHub 仓库名改回，并把本地目录名改回。

## 踩到的坑：pnpm 不认"同名不同 commit"

改名过程中遇到一次：`pnpm install` 反复说 `Already up to date`，
但包内 `name` 仍是旧名。原因：

GitHub 依赖在 lockfile 里被解析成
`'@local/dsh-prompt-forge': version: '@local/dsh-prompt-enhancer@https://codeload...tar.gz/<旧commit>'`
——**框架记的是"名字@commit"的组合**，我只改了名字、commit 未变，
pnpm 便认为已满足，不去拉新的 commit。

**修法**（不要手改 lockfile，pnpm 会检测到并拒绝重解析）：

```powershell
cd "$env:USERPROFILE\.dsh\profiles\desktop"
pnpm remove "@local/dsh-prompt-forge"     # 让 pnpm 自己清 lockfile 条目
pnpm add "github:2861292267/dsh-prompt-forge#main"
```

**教训**：改 GitHub 依赖的**包名或仓库地址**时，光改 `package.json` 不够，
必须走 `remove` + `add`，否则 lockfile 里的旧解析会一直生效。
