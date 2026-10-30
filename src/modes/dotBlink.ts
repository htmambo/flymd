// 所见模式光标点闪烁控制(抽离自 main.ts:608-627)
//
// 设计:
//   - 工厂 createDotBlink({ intervalMs }) → { start(), stop(), isOn() }
//   - 闪烁由 CSS 动画驱动,本模块只维护"开启/关闭"状态
//   - 历史上的 setInterval 空转已移除:interval 回调仅翻转布尔,
//     纯 CPU/定时器开销且无任何驱动 CSS 的副作用(FR-5)
//   - intervalMs 保留在签名中仅为兼容既有调用方,不再使用
//   - start() idempotent:已开启时早返
//
// perf 批次 I:窗口失焦时暂停闪烁动画。
// 闪烁是 1s 周期的 opacity 动画,窗口不可见时它仍在跑,白白占用主线程,
// 直接加重"窗口重新激活"的迟滞感(真机:所见模式下 WebKitWebProcess 空闲
// 仍有 60% CPU)。因此失焦时给宿主加 .wysiwyg-blurred,由 CSS 规则
// animation-play-state: paused 暂停动画;聚焦时移除,动画从当前相位继续。

export interface DotBlinkDeps {
  /** 兼容保留:闪烁由 CSS 动画驱动,不再使用 JS interval,此值被忽略 */
  intervalMs: number
  /** 宿主元素(通常是 .container),用于挂 .wysiwyg-blurred 标记 */
  getHost?: () => HTMLElement | null
  /** 注入 window(默认全局 window) */
  win?: Window | null
  /** 注入 document(默认全局 document) */
  doc?: Document | null
}

export interface DotBlinkApi {
  start(): void
  stop(): void
  /** 彻底解绑全局监听并清理宿主标记(工厂目前全局只创建一次,此为逃生舱) */
  destroy(): void
  isOn(): boolean
  /** 失焦/聚焦时切换暂停标记 */
  setBlurred(blurred: boolean): void
  isBlurred(): boolean
}

export function createDotBlink(deps: DotBlinkDeps): DotBlinkApi {
  const win = deps.win ?? (typeof window !== 'undefined' ? window : null)
  const doc = deps.doc ?? (typeof document !== 'undefined' ? document : null)
  // intervalMs 仅为兼容旧签名保留,刻意不使用
  // started = "正在所见模式运行中"（事件响应与 DOM 写入的闸门）
  // on      = "闪烁功能已启用"（对外语义：创建即为 true，stop() 后为 false）
  let started = false
  let on = true
  let blurred = false
  // 上一次写入标记的宿主:宿主被替换(布局重建)时需要把标记搬到新宿主上
  let lastHost: HTMLElement | null = null

  function applyBlurred(): void {
    try {
      const host = deps.getHost?.() ?? null
      if (!host?.classList) {
        lastHost = null
        return
      }
      host.classList.toggle('wysiwyg-blurred', blurred)
      lastHost = host
    } catch (e) {
      // 不阻断主流程,但留痕便于回归定位
      try { console.warn('[dotBlink] applyBlurred failed:', e) } catch {}
    }
  }

  // 真正幂等:状态未变**且**宿主未更换 → 不写 DOM。
  // (宿主更换时要重放一次,否则新建的宿主拿不到标记)
  function setBlurred(next: boolean): void {
    let host: HTMLElement | null = null
    try {
      host = deps.getHost?.() ?? null
    } catch (e) {
      try { console.warn('[dotBlink] getHost failed:', e) } catch {}
    }
    if (blurred === next && host === lastHost) return
    blurred = next
    applyBlurred()
  }

  // 命名引用:可被 destroy() 摘除(匿名函数无法摘除,重建实例会叠加监听)
  const onBlur = () => { if (started) setBlurred(true) }
  const onFocus = () => { if (started) setBlurred(false) }
  const onVisibilityChange = () => {
    // 停止状态下不响应:退出所见模式后不应再往宿主上挂任何模式标记
    if (!started) return
    try { setBlurred(!!doc?.hidden) } catch {}
  }
  try {
    // blur/focus/visibilitychange 都不是可阻塞滚动的事件,passive 无意义
    win?.addEventListener?.('blur', onBlur)
    win?.addEventListener?.('focus', onFocus)
    doc?.addEventListener?.('visibilitychange', onVisibilityChange)
  } catch {}

  return {
    start(): void {
      if (started) return
      started = true
      on = true
      // 同步当前窗口状态:监听器自工厂创建起就在跟踪,但停止期间不响应事件,
      // 所以这里必须补一次——否则失焦期间切入所见模式会漏挂标记、动画继续空转。
      // 两个信号都要看:doc.hidden = 标签页/窗口被隐藏;hasFocus = 焦点在别的应用上。
      // (最坏情况是 hasFocus() 误报 false → 光标可见但不闪烁,不影响可编辑性)
      try {
        if (doc?.hidden) blurred = true
        else if (typeof doc?.hasFocus === 'function' && !doc.hasFocus()) blurred = true
      } catch {}
      applyBlurred()
    },
    stop(): void {
      started = false
      on = false
      // 清理宿主上的失焦标记:否则退出所见模式后 .wysiwyg-blurred 残留,
      // 再次切入所见模式时光标动画会一直保持暂停(闪烁消失)。
      blurred = false
      applyBlurred()
    },
    destroy(): void {
      try {
        win?.removeEventListener?.('blur', onBlur)
        win?.removeEventListener?.('focus', onFocus)
        doc?.removeEventListener?.('visibilitychange', onVisibilityChange)
      } catch {}
      started = false
      on = false
      blurred = false
      applyBlurred()
    },
    isOn(): boolean {
      return on
    },
    setBlurred,
    isBlurred(): boolean {
      return blurred
    },
  }
}
