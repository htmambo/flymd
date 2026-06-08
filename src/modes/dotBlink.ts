// 所见模式光标点闪烁控制(抽离自 main.ts:608-627)
//
// 设计:
//   - 工厂 createDotBlink({ intervalMs }) → { start(), stop(), isOn() }
//   - 闭包持有 _timer(interval id) / _on(可见性状态)
//   - intervalMs 注入便于测试用 fake timer
//   - start() idempotent:已有 timer 时早返
//   - 闪烁由 CSS 动画驱动,本 timer 仅维护状态,按需扩展

export interface DotBlinkDeps {
  intervalMs: number
}

export interface DotBlinkApi {
  start(): void
  stop(): void
  isOn(): boolean
}

export function createDotBlink(deps: DotBlinkDeps): DotBlinkApi {
  const { intervalMs } = deps
  let timer: number | null = null
  let on = true

  return {
    start(): void {
      try {
        if (timer != null) return
        on = true
        timer = window.setInterval(() => {
          on = !on
          // 闪烁由 CSS 动画驱动；此计时器仅用于保持状态，可按需扩展
        }, intervalMs)
      } catch {}
    },
    stop(): void {
      try {
        if (timer != null) {
          clearInterval(timer)
          timer = null
        }
        on = false
      } catch {}
    },
    isOn(): boolean {
      return on
    },
  }
}
