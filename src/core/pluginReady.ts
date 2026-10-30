// 插件就绪门控（perf 批次 I）
//
// 背景：启动期的插件激活链被移出"应用就绪"关键路径后（否则一次 47.7s 的远端
// manifest 拉取会把应用就绪拖到分钟级），用户可能在激活链跑完之前就触发插件
// 命令。此时不应让命令失败（用户会以为插件坏了），而应**排队等待**激活完成。
//
// 设计（经外部审查修正）：
//   门控只做一件事——外部调用在"激活窗口"内排队等待。
//   激活流程内部**不经过**本门控（调用方直接调 pluginHost.activatePlugin），
//   因此不存在"等待自己"的自锁。
//
// 为什么不用 AsyncLocalStorage 之类的上下文标记来区分内外：
//   那类方案要靠"调用来源"来判断是否跳过等待。但本应用运行在 Tauri WebView
//   （浏览器环境），没有 node:async_hooks；且任何"全局计数器/标志"都无法
//   区分"激活内部调用"与"外部并发调用"——外部审查已实测该误判会在最长激活
//   窗口内让门控完全失效。改用"调用方显式绕过"的约定，语义唯一且无歧义。

export interface PluginReadyGate {
  /** 打开激活窗口（幂等） */
  begin(): void
  /** 关闭激活窗口 → 就绪（幂等；失败路径也应调用，避免永久阻塞外部调用） */
  finish(): void
  /** 外部调用：在激活窗口内排队等待就绪后再执行 */
  wait<T>(fn: () => Promise<T>): Promise<T>
  /** 是否已完成过激活 */
  isReady(): boolean
}

export function createPluginReadyGate(): PluginReadyGate {
  let pending: Promise<void> | null = null
  let resolvePending: (() => void) | null = null
  let ready = false

  function begin(): void {
    if (pending || ready) return
    pending = new Promise<void>((resolve) => { resolvePending = resolve })
  }

  function finish(): void {
    ready = true
    const resolve = resolvePending
    pending = null
    resolvePending = null
    resolve?.()
  }

  async function wait<T>(fn: () => Promise<T>): Promise<T> {
    if (!ready) {
      const cur = pending
      if (cur) await cur
    }
    return fn()
  }

  function isReady(): boolean {
    return ready
  }

  return { begin, finish, wait, isReady }
}
