# Batch 23: 抽离 dotBlink(所见模式光标点闪烁控制)

> 状态: ✅ 已完成(完成 2026-06-08,经 Codex R1 复审 APPROVED)
> 提交: `0e5ca4f`(已推送 origin)
> 范围: Phase B 第二十三批 — main.ts 模块化拆分

---

## 目标(Goals)

继续 Phase B 拆分。把 main.ts 中 dot-blink 状态机(timer + on flag)
抽离到独立模块 `src/modes/dotBlink.ts`(工厂模式)。

## 现状分析(Context)

- main.ts 8972 行(Batch 22 拆分后)
- module-level 状态:
  - `_dotBlinkTimer: number | null = null`
  - `_dotBlinkOn = true`
- 2 个函数: `startDotBlink()` (~9 行) / `stopDotBlink()` (~6 行)
- 周期 800ms 硬编码
- 3 个 call site: L2042 (start), L2063 (stop), L2877 (start)

## 子任务清单(Subtasks)

- **T1 ✅** `src/modes/dotBlink.ts` 新建(44 行,6 tests)
  - 工厂 `createDotBlink({ intervalMs })` → `{ start(), stop(), isOn() }`
  - 闭包持有 timer id + on boolean
- **T2 ✅** `src/modes/dotBlink.test.ts` 新建(6 tests, jsdom + vi.useFakeTimers)
  - start 后 isOn=true
  - start idempotent(只 setInterval 一次)
  - stop 后 isOn=false + clearInterval 被调
  - stop 在未 start 时不 throw
  - intervalMs 注入生效(fake timer 验证状态翻转)
  - start→stop→start 复活
- **T3 ✅** main.ts:
  - 删除 2 module-level let + 2 函数 + 1 stale 注释 (22 行)
  - 加 import + factory 实例化 + 改 3 call site
- **T4 ✅** main.ts 净 **-21 行**(8972→8951)
- **T5 ✅** Codex R1 复审 APPROVED(0 blocker)
- **T6 ✅** 验证: tsc 0 错误、test 547/547(原 541 + 6 新增)

## 实施细节

### 关键设计

1. **工厂闭包替代 module-level state** — timer id 和 on 标志都私有
2. **intervalMs 注入** — 800ms 从硬编码变成 deps,便于测试用 fake timer
3. **isOn() 暴露读访问** — 未来扩展点,虽然现在没有外部读
4. **闪烁由 CSS 驱动** — setInterval 回调只翻状态,不操作 DOM
   (原始注释明确说"此计时器仅用于保持状态,可按需扩展")

### Codex R1 复审

- **R1** APPROVED
- 验证点: 状态机 1:1 verbatim、闭包私有 timer/on、intervalMs 注入
  正确、call site 顺序合理、tsc 0 错误
- nit 1: L609 stale 注释残留 — **已删**
- nit 2: stop() 测试加 clearInterval spy 验证 timer 实际清理 — **已采纳**

## pre-existing 行为保留

- start idempotency: `if (timer != null) return`
- setInterval 回调: `on = !on` 状态翻转
- stop: clearInterval + on=false
- 800ms 周期(通过 intervalMs 注入)
- try/catch 包裹 start 和 stop 主体

## 验证(Verification)

- `npx tsc --noEmit` → **0 错误**
- `npm test -- --run` → **547/547 通过**(原 541 + 新增 6)
- main.ts 净 **-21 行**(8972→8951)
- 提交: `0e5ca4f`(已推送 origin)
- Codex: R1 APPROVED(0 blocker,2 nit 已采纳)

## 备注

- 教训: setInterval/setTimeout 类 timer 状态机抽离时,fake timer 测试是
  关键 — Codex 抓的"stop 只验证 on=false 但没验 clearInterval 调用"很到位
- 教训: 抽离时删除 stale 注释(指向已移除状态的描述),保持代码自解释
- 收益: 闪烁控制逻辑独立可测,800ms 周期可调,扩展点(亮度/颜色)不再
  牵动 main.ts
