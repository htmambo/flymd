# Batch 10:抽离 windowsCompositorPoke / windowResize 模块

> 状态:✅ 已完成(完成 2026-06-08,经 Codex R3 联合复审 APPROVED)
> 提交:`d011364`(已推送 origin)
> 范围:Phase B 第九批 — main.ts 模块化拆分

---

## 目标(Goals)

继续 Phase B 拆分,把 main.ts 中两个独立的窗口子系统抽到 `src/windows/` 目录,与 Batch 9 的 `windowPlacement` 形成完整的窗口工具归宿。

## 现状分析(Context)

- main.ts 10475 行(拆分前),仍有大量"按主题成块、可独立"的逻辑
- Batch 9 已建 `src/windows/` 目录并落地 `windowPlacement.ts` + `maximizedState.ts`
- 本批聚焦:Windows 拖动残影兜底 + decorations:false 时的窗口边缘 resize

## 子任务清单(Subtasks)

- **T1 ✅** `src/windows/windowsCompositorPoke.ts` 新建:140 行,7 tests
- **T2 ✅** `src/windows/windowResize.ts` 新建:240 行(含 `computeResize` 纯函数),10 tests
- **T3 ✅** main.ts 接线:import + factory 实例化 + 调用站点替换
- **T4 ✅** 验证:tsc 0 错误、test 407/407

## 实施细节

### 模块 1:windowsCompositorPoke

- 抽离自 main.ts 原 `initWindowsCompositorPoke` 块(~135 行)
- factory + start/stop API
- 内部封装 `settleTimer / settling / lastPokeAt / unfocusedTimer` 状态
- Windows 平台 + Tauri runtime 双重守卫
- schedule 节流 80ms + settle 200ms 防抖
- deps 注入:isTauriRuntime / getCurrentWindow / now / setTimeoutFn / clearTimeoutFn

### 模块 2:windowResize

- 抽离自 main.ts 原 `initWindowResize` 块(~165 行)
- factory + init/stop API
- 8 边/角 handle + DPI 感知 `computeResize` 纯函数(独立导出便于单测)
- Linux 走 Tauri 原生 `startResizeDragging`,其他平台自己算
- deps 注入:getCurrentWindow / bindWindowMaximizedState / getWindowScaleFactorSafe / isTauriRuntime

## Codex 3 轮复审

- **R1** REJECTED — 2 个问题:
  - IMPORTANT: 测试不真正覆盖所断言分支(`makeWinDouble` 返回 `{win}` 嵌套,`getCurrentWindow: () => winDouble.win` 拿到的是另一对象,覆盖 `winDouble.isMaximized` 不生效)
  - IMPORTANT: `stop()` 没有清 Tauri listener 绑定(`bindWindowMaximizedState` 返回值丢弃)
- **R2** REJECTED — 1 个问题:
  - IMPORTANT: `bindWindowMaximizedState` 实际返回 `{ dispose(): void }` 对象而非函数,我之前写的 `unbindMaximized()` 调用 `try {}` 吞了错误
- **R3** APPROVED — 0 blocker / 0 important
  - type 签名同步收紧:`Promise<{ dispose: () => void } | null | undefined>`
  - `unbindMaximized` 改名 `maximizedBinding` 反映实际形状
  - `stop()` 调 `maximizedBinding?.dispose()`

## pre-existing 行为保留

`computeResize` 的左/上拖动数学保留原 main.ts 既有语义:

```ts
if (direction.includes('left')) {
  const widthDelta = Math.min(deltaX, startWidth - minW)
  newWidth = startWidth - widthDelta
  newX = startPosX + widthDelta
}
```

deltaX 为负(鼠标左移)时 `widthDelta = 负`,`newWidth = startWidth - 负 = 变宽`。直观上像是"反直觉",但原 main.ts 一直如此,本批严格按 CLAUDE.md "仅对需求做针对性改动" 原则保留,测试期望同步记录此行为。

## 验证(Verification)

- `npx tsc --noEmit` → 0 错误
- `npm test` → **407/407 通过**(原 390 + 新增 17)
- main.ts 净 **-319 行**(10475 → 10156)

## 备注

- 本批 Codex 三轮复审都给出具体的 file:line + unified diff patch,反馈质量极高
- 教训:抽离带 Tauri listener 的模块时,factory 必须捕获并提供 listener 清理路径,否则就是隐性 leak
- 教训:测试 mock 嵌套层次(`{win: ...}`)与生产代码 `getCurrentWindow()` 的访问层次必须一致,否则 mock 不生效
