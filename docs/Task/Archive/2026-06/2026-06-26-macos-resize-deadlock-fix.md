# 任务：macOS 改变窗口尺寸后窗口无响应（onResized + isMaximized 死循环）

**Status**: ✅ Completed (2026-06-26 完成并归档)
**类型**: bugfix / 平台适配
**平台**: macOS（重点）
**Commit**: 42b39f3 — `fix(macos): onResized 中 isMaximized() 死循环导致窗口无响应`
**Review**: coding-bridge `f5ae2eb1-...`;采纳 2 项高优先级 #1 #2 + 1 项中优先级 #3

---

## 一、问题复述

用户报告（在 macOS 上）：
- 拖动窗口到另一屏幕后，**顶部所有交互失效**（拖拽、关闭、最大化按钮）
- **Cmd+Q 也不能退出**应用，只能 `kill` 进程
- 进一步测试：只**改变窗口尺寸**（不一定跨屏）就复现——手动 resize、跨屏、最大化/还原都会触发

注：本任务仅处理"改变尺寸后失效"这一症状；用户在同一会话报告的"拖拽后窗口回弹到屏幕左侧"是独立的位置持久化问题，留作新任务（见 §五）。

---

## 二、根因（基于 Tauri 已知 issue）

**Tauri issue #5812 (closed via tao#1182) / #13199 (closed as dup of #5812)**：

> macOS 上在 `tauri://resize` 事件回调里**同步**调 `isMaximized()` 会触发 looped resize events
> 表现为 100% CPU + 内存爆炸 + webview IPC 全部挂起

**为什么 webview IPC 挂起会导致 Cmd+Q 退不出**：
- Cmd+Q 在 macOS 是 NSApplication 级事件，先于 webview 触发
- Rust `on_menu_event` 收到后调 `win.emit("flymd://request-exit")` 到 webview
- webview IPC 通道已被死循环占满 → emit 卡住 → 前端 `listen` 回调收不到
- 关闭按钮也是同样路径：`emit('flymd://request-close')` → 前端 listen → 同样卡住

**根因代码**（修复前 `src/windows/maximizedState.ts`）：

```ts
try {
  const off = await win.onResized(() => {
    void syncNow()              // ← 同步路径调 isMaximized(),触发 #13199 死循环
  })
}
```

`void syncNow()` 内部 → `await win.isMaximized()` → macOS 上会触发新一轮 resize → 新一轮 onResized → 又一次 `void syncNow()` → 无限循环。

---

## 三、修复

`src/windows/maximizedState.ts`：

1. **异步隔离（主防线）**：onResized 回调从 `void syncNow()` 改为 `scheduleSync()` → `setTimeout(50ms)` 异步调度
2. **scheduleSync debounce**：已有 pending timer 时不再排新的，避免堆积
3. **re-entrancy guard**：`inFlight` + `pending` 标志，in-flight 期间合并请求，完成后补一次
4. **dispose 清理**：显式 `clearTimeout(syncTimer)` 避免 dispose 后还 fire
5. **MACOS_RESIZE_DEFER_MS = 50**：非零值，即使 isMaximized() 触发额外 resize 事件，异步循环频率限制在 < 20Hz，不再造成 100% CPU

---

## 四、用户实测确认

> "现在，调整尺寸后可以使用 cmd+q 退出" — 确认主防线有效

---

## 五、相关但未处理的独立症状

用户在 commit 42b39f3 后报告：

> "拖拽后会迅速回到屏幕的左侧（可能是启动时的位置）"

这是**窗口位置持久化/恢复**问题，与本 commit 的"死循环"完全无关。需要查：

- `tauri-plugin-window-state` 的 save 行为
- 是否有别处代码主动调 `setPosition` 覆盖用户拖拽结果
- macOS 上窗口跨屏时是否触发"位置 reset"事件

**留作独立任务**（见下条任务）。

---

## 六、Review 反馈处理（coding-bridge `f5ae2eb1-...`）

- **高优先级 #1**（异步循环 + 频率限制）→ **采纳**：`MACOS_RESIZE_DEFER_MS` 从 `0` 改为 `50`，并加 debounce
- **高优先级 #2**（dispose 未清除 setTimeout）→ **采纳**：保存 `syncTimer` ID，dispose 时 `clearTimeout`
- **中优先级 #3**（scheduleSync 缺防抖）→ **采纳**：用 `syncTimer !== null` 判空做 debounce
- **中优先级 #4**（常量命名）→ **不采纳**：保留 `MACOS_RESIZE_DEFER_MS` 平台标识，未来跨平台差异化时方便
- **低优先级 #5**（in-flight 真实异步测试）→ **不采纳**：jsdom + Promise.resolve 限制，文档已说明
- **低优先级 #6**（applyState 路径）→ **不采纳**：原代码已正确

---

## 七、测试

- `src/windows/maximizedState.test.ts` 新增 7 用例 jsdom，全部通过
- `npx vitest run` 全量 609/609 通过（web/server 2 个 failed suites 是 pre-existing openai/dotenv 未装，与本修复无关）
- 关键测试：`onResized callback does NOT synchronously call isMaximized (defers to setTimeout)`

---

## 八、未做事项

- ❌ **未在 macOS 桌面实测**"位置回弹"——见 §五
- ❌ **未升级 wry/tao**——属于依赖管理范围，留作独立任务
- ❌ **未在 Rust 侧 macOS 路径 emit `flymd://window-maximized-changed`**——目前只有 Windows 路径发此事件，macOS 路径未发（见 `src-tauri/src/main.rs:1917-1930`）。长期方案可让前端只 listen 不轮询，但需要先在 Rust 侧补全 macOS 路径的事件源

---

> OMC trailers:
> Constraint: 仅修改 src/windows/maximizedState.ts + 新增对应测试
> Rejected: 升级 wry/tao | 跨版本影响大;改用 listen 'flymd://window-maximized-changed' 全替代 | macOS 路径未发此事件,改需要同时改 Rust 侧
> Directive: 用户实测确认 "现在 Cmd+Q 可以退出",修复有效
> Confidence: 高 | Tauri #5812 / #13199 根因在社区可查;修复模式与 issue 用户提供的 workaround 一致
> Scope-risk: MACOS_RESIZE_DEFER_MS=50 引入 50ms 延迟,UI 按钮图标更新慢一点点(用户几乎无感);Windows 路径不受影响
> Not-tested: 真实 macOS 桌面环境的拖拽体感;位置回弹独立症状
