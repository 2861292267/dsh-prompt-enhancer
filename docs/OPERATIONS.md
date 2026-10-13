# 运维注意事项

本文件记录**维护这个插件时容易踩的坑**，尤其是造成过真实损失的那些。

---

## 一、改 profile 的 `cordis.patch.yml`：只动 config 块

profile 里这条覆盖层长这样：

```yaml
- id: prompt-enhancer
  config:
    provider: workbuddy-xdpool
    model: deepseek-v4.1-flash
    defaultStyle: default
    slashCommand: true
```

**规则**：

1. **只改 `config:` 以下的键**，不要整段重写、不要按行号截断。
2. **改前必须备份**：`copy cordis.patch.yml cordis.patch.yml.bak`。
3. 该文件很长（约 730 行），前面是历史说明注释。
   按内容定位即可，**不要用行号偏移去改**——行号会随注释变动而漂移。

> **曾经的事故**：修编码乱码时改写了这个文件，把 `provider` / `model` /
> `styles` 一起删掉，只剩 `defaultStyle` 与 `slashCommand`。
> 使用者的感受就是"配置都没了"。

---

## 二、自定义风格：只从设置面板管理

有**两个地方**能声明配置，优先级不同：

| 位置 | 谁来写 | 优先级 |
|---|---|---|
| profile 的 `cordis.patch.yml` | 手工编辑 | 低（作为默认值） |
| `~/.dsh/dsh-prompt-forge.config.json` | **设置面板** | **高** |

**键级合并的后果**：如果 patch 里写了 `styles`，用户又在面板里存过 `styles`，
**用户的那份会整个盖掉 patch 的那份**（`styles` 是整体替换，不是逐条合并）。

所以约定是：

- **patch 里不写 `styles`**，只留 `provider` / `model` / `defaultStyle` / `slashCommand`。
- **自定义风格一律从「设置 → 提示词锻造」加**。

否则会出现"我在 patch 里配了 prd，怎么不见了"这类困惑。

---

## 三、依赖必须用 `github:`，不能用 `link:`

| 写法 | 市场报告 | 能否远程更新 |
|---|---|---|
| `link:D:/...` | `source: "linked"`, `latestVersion: null` | ❌ |
| `github:owner/repo#main` | `source: "github"`, 可比对 HEAD | ✅ |

改依赖时**光改 `package.json` 不生效**：lockfile 记的是「名字@commit」组合，
必须走标准命令让 pnpm 重新解析：

```powershell
cd "$env:USERPROFILE\.dsh\profiles\desktop"
pnpm remove "@local/dsh-prompt-forge"
pnpm add "github:2861292267/dsh-prompt-forge#main"
```

**验证**（别只看 install 成功）：

```powershell
node -e "const t=require('fs').readFileSync(process.env.USERPROFILE+'/.dsh/profiles/desktop/pnpm-lock.yaml','utf8');const i=t.indexOf('@local/dsh-prompt-forge');console.log(t.slice(i,i+220))"
```

期望看到 `https://codeload.github.com/.../tar.gz/<commit>`，
而不是 `link:`。

---

## 四、读文件用 Node / read 工具，不要用 `Get-Content` 看中文

PowerShell 控制台按 GBK 渲染 UTF-8 内容，**文件没问题却显示成乱码**。

曾经因为这个误判"插件把配置写坏了"，实际用 Node 读出来完全正确。

判断文件是否真损坏，用：

```powershell
node -e "console.log(require('fs').readFileSync('<路径>','utf8').slice(0,200))"
```

---

## 五、重启 DSH

配置改动、插件更新都需要重启才生效。

**如果维护者就是当前会话的 agent，不要用 `Stop-Process` 杀 DSH** ——
它会把正在进行的会话一并打断。请让使用者手动重启。

---

## 六、出问题时的回滚点

| 备份文件 | 对应操作 |
|---|---|
| `cordis.patch.yml.bak-restore-config` | 恢复被删的插件配置段 |
| `package.json.bak-before-github2` | 回滚依赖改写 |
| `package.json.bak-before-forge-rename` | 回滚改名 |
| `package.json.bak-before-github` | 回滚首次切 github |
