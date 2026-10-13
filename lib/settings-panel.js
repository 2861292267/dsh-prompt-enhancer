/**
 * 设置面板（浏览器半）。
 *
 * 挂到宿主的 `settings.section` 槽位 —— DSH 设置对话框按 `order` 读取该槽位
 * 的所有条目生成左侧导航。契约（读自宿主 `dsh-client-ui-settings-general`）：
 *
 *   ctx.slots.inject('settings.section', () => ctx.slots.register(
 *     { name: 'settings.section', id, order, label: () => string, locale? },
 *     Component,
 *   ))
 *
 * 面板本身只做三件事：显示当前生效值、允许改、写回 Host。
 * 不做模型链、不做语音 —— 那些不在本插件范围。
 */

/** 面板读写的配置端点。 */
export const CONFIG_ENDPOINT = '/plugins/dsh-prompt-forge/config'

/**
 * 读取当前配置。
 * @returns 配置对象，或 `undefined`（Host 不可达）。
 */
export async function loadConfig() {
  try {
    const res = await fetch(CONFIG_ENDPOINT, { method: 'GET' })
    if (!res.ok) return undefined
    const data = await res.json()
    return data && data.ok === true ? data : undefined
  } catch {
    return undefined
  }
}

/**
 * 写入部分配置。
 *
 * 只发送真正改动的键 —— 整体回传会把面板没显示的字段也写进磁盘，
 * 等于让 UI 的盲区覆盖掉磁盘上已有的值。
 *
 * @param patch - 要保存的键值。
 * @returns `{ ok, error? }`。
 */
export async function saveConfig(patch) {
  try {
    const res = await fetch(CONFIG_ENDPOINT, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) return { ok: false, error: `服务返回 ${res.status}` }
    const data = await res.json()
    return data && data.ok === true ? { ok: true, saved: data.saved } : { ok: false, error: (data && data.error) || '保存失败' }
  } catch {
    return { ok: false, error: '无法连接插件服务' }
  }
}
