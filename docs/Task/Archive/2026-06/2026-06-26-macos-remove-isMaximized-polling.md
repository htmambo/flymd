# 任务：彻底删除 macOS isMaximized 实时同步（修复调整尺寸后按钮/拖拽失效）

**Status**: ✅ Completed (2026-06-26 用户实测验证通过)
**类型**: bugfix / 平台适配
**平台**: 全平台（macOS 重点，Windows/Linux 同步删除轮询路径）
**Commit**: (TBD — 即将 commit)

---

## 一、问题复述

用户报告（在 macOS 上）：
- 调整窗口尺寸（手动 resize、跨屏、最大化/还原都触发）后：
  - 拖拽 tabbar-row 失效，窗口立即回弹到原位置
  - 右上三个控制按钮（min/max/close）全部失效
  - Cmd+Q 退不出
- 只能 `kill` 进程

## 二、根因（已通过 Tauri 已知 issue + 用户实测双重确认）

**Tauri #5812 (closed via tao#1182) / #13199 (closed as dup of #5812)**：

> macOS WKWebView 上**任何**调 `isMaximized()`（JS / Rust 都会）会触发 looped resize events，
> 表现为 100% CPU + 内存爆炸 + webview IPC 全部挂起

**触发条件**：在 `onResized` / `on_window_event` 回调里调 `isMaximized()` → 触发新一轮 resize → 回到 onResized → 无限循环。

## 三、修复尝试历程

### 3.1 第一轮（commit 42b39f3）：setTimeout 50ms + debounce + inFlight guard

- 想法：把循环频率从 100% CPU 降到 < 20Hz
- **结果**：用户实测 Cmd+Q 退得出（IPC 在慢循环间隙挤进去），但**所有按钮 + 拖拽仍失效**（慢循环仍抢 IPC 通道）
- **结论**：失败，慢循环不够

### 3.2 第二轮（已 stash 放弃）：Rust 端跨平台 emit + 前端 macOS 跳过 onResized

- 想法：让 Rust 后端主动 emit 状态变化，前端不再轮询
- **结果**：用户实测 `npm run tauri:dev` **直接卡死**
- **原因**：Rust `on_window_event` 在 macOS 上**频繁触发**（每次 move/resize/focus/show），每次都调 `is_maximized()`，**比 42b39f3 慢循环更严重**
- **结论**：放弃，stash 标记 `wip-rust-emitter-buggy-do-not-pop`（已 drop）

### 3.3 第三轮（当前 commit）：彻底删除 isMaximized 实时同步

- 想法：**避开**触发条件——任何路径**都不**监听 resize 然后调 isMaximized
- **结果**：用户实测 `tauri:dev` 启动正常 + 调整尺寸后按钮/拖拽/Cmd+Q 全部正常
- **trade-off**：键盘/系统菜单（非自定义按钮）最大化时，按钮图标不实时更新——只点自定义最大化按钮时才更新（`syncNow` 公开 API 供 click handler 调用）

## 四、修复实施

### 4.1 Rust 端 (`src-tauri/src/main.rs`)

**修改**：`install_windows_maximized_resizable_workaround` 简化为 baseline-only。

```rust
// 跨平台:窗口初始化时同步一次 is_maximized 作为前端初始状态 baseline。
// 注意:这里**不**注册 on_window_event 循环监听,因为 macOS WKWebView 上
// 任何调 is_maximized() 都会触发 Tauri #5812/#13199 描述的 looped resize
// 死循环,导致调整尺寸后拖拽 / 按钮 / Cmd+Q 全部失效。
fn sync_initial_maximized_state(win: &tauri::WebviewWindow) {
  let _ = win.is_maximized();  // 只调一次,无 emit,无回调注册
}

#[cfg(target_os = "windows")]
fn install_windows_maximized_resizable_workaround(win: &tauri::WebviewWindow) {
  sync_initial_maximized_state(win);
}
```

**删除**：
- `install_maximized_state_emitter` 函数（带 on_window_event 循环的 emitter）
- macOS/Linux setup 路径的 emitter 调用
- `last_maximized` Arc<Mutex<...>> 状态
- `sync_state` 嵌套函数
- `sync_state` 中的 emit 调用

### 4.2 前端 (`src/windows/maximizedState.ts`)

**修改**：`bindWindowMaximizedState` 简化为 baseline + 公开 API。

**删除**：
- `onResized` 监听（全平台）
- `flymd://window-maximized-changed` listen（全平台）
- `scheduleSync` debounce 机制
- `inFlight` / `pending` re-entrancy guard
- `syncTimer` 状态 + dispose 清理
- `MACOS_RESIZE_DEFER_MS` 常量（不再需要 debounce）

**保留**：
- 初始化时 `await syncNow()` 一次 baseline
- 公开 API `syncNow()` 供点按钮时主动调
- 公开 API `dispose()`

### 4.3 测试 (`src/windows/maximizedState.test.ts`)

**重写**：从 10 个测试（覆盖 scheduleSync / inFlight / macOS 分支等）简化为 5 个测试（覆盖简化版 API）。

- 不再订阅 onResized
- 不再 listen 'flymd://window-maximized-changed'
- 公开 syncNow 仍可用
- dispose 后不再触发 applyState

## 五、用户实测验证

> "测试过了，正常。"

- ✅ `tauri:dev` 启动正常
- ✅ 调整窗口尺寸后所有按钮 + 拖拽 + Cmd+Q + 关闭按钮全部正常
- ✅ 自定义最大化/还原按钮图标切换正常

## 六、文件变更

- 修改:src-tauri/src/main.rs(-29 行,Windows 路径简化为 baseline-only)
- 修改:src/windows/maximizedState.ts(-82 行,删 onResized/listen/scheduleSync/inFlight)
- 修改:src/windows/maximizedState.test.ts(-94 行,重写为 5 个简洁测试)
- 移动:docs/Task/Active/2026-06-26-macos-rust-emitter-abandoned.md → docs/Task/Archive/2026-06/
- 新增:docs/Task/Archive/2026-06/2026-06-26-macos-remove-isMaximized-polling.md(本文件)

## 七、测试状态

- [x] 单元测试通过(5/5 新增 + 全量 607/607 通过)
- [x] cargo check 通过(5 个 pre-existing dead_code warning 与本修复无关)
- [x] 用户 macOS 桌面实测验证

## 八、相关 Issue / 文档

- Tauri #5812 https://github.com/tauri-apps/tauri/issues/5812
- Tauri #13199 https://github.com/tauri-apps/tauri/issues/13199
- 上一轮(已 commit 42b39f3):docs/Task/Archive/2026-06/2026-06-26-macos-resize-deadlock-fix.md
- 失败尝试(已放弃):docs/Task/Archive/2026-06/2026-06-26-macos-rust-emitter-abandoned.md

---

> OMC trailers:
> Constraint: 仅修改 src-tauri/src/main.rs + src/windows/maximizedState.{ts,test.ts} + 任务文档
> Rejected: 用 setTimeout 50ms debounce 慢慢循环 | 慢循环仍抢 IPC;Rust 端 on_window_event 调 is_maximized | 触发频率 > 100Hz 比慢循环更严重
> Directive: 用户决策"实施 B 方案",且 macOS 实测验证"测试过了,正常"
> Confidence: 高 | root cause 已被 Tauri 官方 issue 确认;修复避开触发条件;用户实测通过
> Scope-risk: 键盘/系统菜单最大化时按钮图标不实时更新(可接受 trade-off)
> Not-tested: Linux 实测(本修复同时删除 Linux 路径,理论上不受影响);Windows 实测
