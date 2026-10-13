/**
 * 插件配置的持久化层（Host 半）。
 *
 * 为什么不只用 `cordis.patch.yml` 的静态 config：
 * 静态 config 改一次要改文件 + 重启，而「优化参数」「模型链」这类东西
 * 用户希望当场改当场生效。所以这里加一层**运行时可写的配置**，
 * 存到磁盘，下次启动时与静态 config 合并。
 *
 * 为什么存磁盘而不是 localStorage：DSH Desktop 每次启动**动态分配端口**，
 * Chromium 按 Origin（协议://域名:端口）隔离存储 —— 端口一变，localStorage
 * 就是空的，配置看起来"丢了"。（这是同类插件踩过的坑，值得照学。）
 *
 * 写入用**原子替换**（写临时文件再 rename）：中途崩溃不会留下半个 JSON。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 用户级配置文件。放在 ~/.dsh 下，与其它插件一致。 */
export const CONFIG_FILE = path.join(os.homedir(), '.dsh', 'dsh-prompt-forge.config.json')

/** 配置体积上限，防止异常写入撑爆磁盘或内存。 */
const MAX_CONFIG_BYTES = 256 * 1024

/**
 * 读磁盘配置。
 *
 * 任何异常（文件不存在、JSON 损坏、内容不是对象）都返回 `{}`——
 * 配置读不出来只该让用户回到默认值，不该让插件起不来。
 *
 * @returns 配置对象，永不抛错。
 */
export function readUserConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {}
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * 写入配置。
 *
 * **顶层键级 merge**，不是整体替换：将来若有多处写配置（比如设置面板 +
 * 某个快捷开关），整体替换会让后写的一方清空先写的一方。
 *
 * @param patch - 要合并进去的顶层键。
 * @returns `{ ok, error? }`。
 */
export function writeUserConfig(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, error: 'config must be an object' }
  }
  try {
    const merged = { ...readUserConfig(), ...patch }
    const text = JSON.stringify(merged, null, 2)
    if (Buffer.byteLength(text, 'utf8') > MAX_CONFIG_BYTES) {
      return { ok: false, error: '配置过大' }
    }
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
    // 原子替换：先写同目录下的临时文件，再 rename。
    // 同目录保证 rename 是同一文件系统内的原子操作。
    const tmp = `${CONFIG_FILE}.${process.pid}.tmp`
    fs.writeFileSync(tmp, text, 'utf8')
    fs.renameSync(tmp, CONFIG_FILE)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) }
  }
}

/**
 * 合并静态 config 与用户配置。
 *
 * 优先级：**用户配置 > 静态 config > 默认值**。
 * 这样设置面板里改过的值能盖住 patch 文件里的初始值，符合直觉。
 *
 * @param raw - 来自 cordis.patch.yml 的静态配置。
 * @returns 合并后的配置。
 */
export function mergeConfig(raw) {
  const base = raw && typeof raw === 'object' ? raw : {}
  const user = readUserConfig()
  return { ...base, ...user }
}
