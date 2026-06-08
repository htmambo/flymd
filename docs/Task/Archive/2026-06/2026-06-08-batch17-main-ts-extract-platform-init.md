# Batch 17:抽离 platformInit 工厂(平台 class + 窗口拖动 init)

> 状态:✅ 已完成(完成 2026-06-08,经 Codex R1 复审 APPROVED)
> 提交:`7db551f`(已推送 origin)
> 范围:Phase B 第十六批 — main.ts 模块化拆分

---

## 目标(Goals)

继续 Phase B 拆分,把 main.ts 中 2 个平台 init 函数
抽离到独立模块,工厂 + 5 个 get-only deps(无 setter,因工厂仅读不写)。

## 现状分析(Context)

- main.ts 9146 行(Batch 16 拆分后)
- `initPlatformClass` 在 1374 调用(顶层 init,启动时一次性)
- `initWindowDrag` 在 1398 调用(顶层 init,启动时一次性)
- 函数体在 5247-5296 共 50 行
- 依赖:isCompactTitlebarEnabled / isFocusModeEnabled(Tauri 风格),stickyNoteMode/Locked(闭包),getCurrentWindow(Tauri)
- 工厂无写入需求,5 deps 全部 get-only

## 子任务清单(Subtasks)

- **T1 ✅** `src/modes/platformInit.ts` 新建(~60 行,9 tests)
  - `createPlatformInit(deps)` 工厂 + `PlatformInitApi`
  - 2 个函数:initPlatformClass / initWindowDrag
- **T2 ✅** `src/modes/platformInit.test.ts` 新建(9 tests,jsdom)
  - 4 platform class cases(win/mac/linux/unknown)
  - 5 initWindowDrag cases(Win 早返/Mac 绑定 focus mode/sticky 锁定/无 mode 早返/button 排除)
- **T3 ✅** main.ts 接线:工厂 `let` nullable + 实例化挪到 line 705(stickyNote 状态声明后,首次调用前)
- **T4 ✅** 2 call site 加 `platformInitApi?.` 前缀
- **T5 ✅** 2 函数体删除(~50 行 → 2 行注释)
- **T6 ✅** main.ts 净 **-33 行**(添加 12,删除 45)
- **T7 ✅** Codex R1 复审 APPROVED
- **T8 ✅** 验证:tsc 0 错误、test 496/496(原 487 + 9 新增)

## 实施细节

### 关键设计

1. **5 个 get-only deps** — 无 setter,工厂仅读取不写入
   - 2 个 import 引用:`isCompactTitlebarEnabled, isFocusModeEnabled`
   - 2 个闭包 getter:`getStickyNoteMode, getStickyNoteLocked`(因 stickyNote 是 `let` 变量)
   - 1 个资源 getter:`getCurrentWindow`(Tauri 可能在非 Tauri 运行时 throw,try/catch 兜底返 null)
2. **TDZ 顺序** — 工厂实例化必须早于 call sites(1374/1398)
   - 把工厂实例化从 1764 挪到 705(stickyNoteMode/Locked 声明后)
   - 原因:可选链 `platformInitApi?.x` 在 factory 实例化前推断为 never,tsc 报错
3. **CSS 平台适配** — `initPlatformClass` 写入 `body.platform-{windows,mac,linux}` class,CSS 通过这个 class 走平台差异规则
4. **拖动排除** — shouldIgnoreTarget selector(`.window-controls, .menu-item, button, a, input, textarea, [data-tauri-drag-ignore], .tabbar-tab, .tabbar-new-btn`)严格保留,防止把标签栏交互变成拖动

### Codex R1 复审

- **R1** APPROVED(高置信度)
- 验证点:行为 verbatim、TDZ 顺序(纯对象字面量无异步)、scope 不溢出、模块级状态零泄漏
- 沙箱限制:read-only 模式无法跑 vitest(Vite 尝试写 config),但 diff review + tsc 已充分覆盖
- 0 blocker / 0 nit

## pre-existing 行为保留

- platform 字符串 `toLowerCase()` 后再 `includes()`
- `if win` else if `mac` else if `linux` 顺序
- Windows 早返(无 mousedown 绑定)
- selector 字符串、try/catch 包裹、`button === 0` 检查、stickyNoteLocked 早返、isCompactTitlebarEnabled || isFocusModeEnabled || stickyNoteMode 三选一

## 验证(Verification)

- `npx tsc --noEmit` → **0 错误**
- `npm test -- --run` → **496/496 通过**(原 487 + 新增 9)
- main.ts 净 **-33 行**(9146→9113)
- 提交:`7db551f`(已推送 origin)
- Codex:R1 APPROVED(高置信度,0 blocker)

## 备注

- 教训:工厂实例化顺序至关重要。可选链 `?.` 在 factory 未实例化时推断为 never,即使运行时安全也会 tsc 报错 → 工厂挪到 call sites 之前
- 教训:工厂 deps 何时用 getter/setter pair、何时只用 get — 取决于工厂是否写入该状态。`isCompactTitlebarEnabled` 等只是读取,get 已足够,setter 会增加噪声
- 收益:平台 init 独立可测,后续 mac/linux 平台特性差异调整(滚动条、字体)只需改本模块
