// 所见模式光标点闪烁控制(抽离自 main.ts:608-627)
//
// 设计:
//   - 工厂 createDotBlink({ intervalMs }) → { start(), stop(), isOn() }
//   - 闪烁由 CSS 动画驱动,本模块只维护"开启/关闭"状态
//   - 历史上的 setInterval 空转已移除:interval 回调仅翻转布尔,
//     纯 CPU/定时器开销且无任何驱动 CSS 的副作用(FR-5)
//   - intervalMs 保留在签名中仅为兼容既有调用方,不再使用
//   - start() idempotent:已开启时早返

export interface DotBlinkDeps {
  /** 兼容保留:闪烁由 CSS 动画驱动,不再使用 JS interval,此值被忽略 */
  intervalMs: number
}

export interface DotBlinkApi {
  start(): void
  stop(): void
  isOn(): boolean
}

export function createDotBlink(deps: DotBlinkDeps): DotBlinkApi {
  // intervalMs 仅为兼容旧签名保留,刻意不使用
  void deps
  let started = false
  let on = true

  return {
    start(): void {
      if (started) return
      started = true
      on = true
    },
    stop(): void {
      started = false
      on = false
    },
    isOn(): boolean {
      return on
    },
  }
}
