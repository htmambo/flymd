# 任务：macOS 调整尺寸后所有按钮 + 拖拽失效（attempt 2 已回滚）

**Status**: ❌ Abandoned (2026-06-26,Rust 端改动 stash 在 `wip-rust-emitter-buggy-do-not-pop`,**未 commit**,**不要 pop**)
**类型**: bugfix (失败尝试)
**平台**: macOS

---

## 一、本次任务的目标

解决 42b39f3 修复的残留问题:用户实测反馈"调整尺寸后,所有按钮+拖拽失效"。

42b39f3 修复是 `setTimeout(50ms) + debounce + inFlight guard`——把 Tauri #13199 慢循环降到 20Hz。
**问题**: Cmd+Q 退得出来(IPC 在慢循环间隙挤进去),但所有按钮 click / 拖拽 mousedown 都被慢循环抢通道。

## 二、本次尝试的方案 (已 stash,Rust 端有 bug)

**方案**: Rust 端 macOS 路径也 emit 'flymd://window-maximized-changed',前端 macOS 路径跳过 onResized 监听(只 listen Rust 事件),彻底断开 onResized 调 isMaximized() 的死循环链。

**Rust 端改动** (`src-tauri/src/main.rs`):
- 抽离 `install_maximized_state_emitter` 跨平台函数
- macOS/Linux setup 路径也调 emitter
- emitter 内部:`win.on_window_event(move |_event| { ... sync_state() ... })`

**前端改动** (`src/windows/maximizedState.ts`):
- macOS 路径跳过 onResized 监听(只 listen Rust 事件)

## 三、为什么这个方案是错的

用户实测反馈"**现在**使用 npm run tauri:dev 直接卡死,显示无响应"。

**root cause of new bug**: Rust 端 `on_window_event` 在 macOS 上**频繁触发**(每次 move / resize / focus / show 都会触发),每次事件都调 `is_maximized()`——**这本身在 macOS WKWebView 上就会触发 #13199 描述的 looped resize 死循环**。

Tauri #5812 / #13199 描述的是**JS 端** `isMaximized()` 触发死循环,但**根因是 macOS WKWebView 的 `isMaximized()` 实现**——**JS / Rust 都中招**。

**问题严重性**:
- 42b39f3 (前端 setTimeout 50ms) 把循环频率限制在 < 20Hz
- 本次方案 (Rust 端 on_window_event) **没有节流**——on_window_event 在 macOS 上每次窗口事件都触发,可能 > 100Hz
- **比 42b39f3 更糟**——Rust 端循环更频繁,app 启动期就卡死

## 四、教训

1. **Tauri #5812 / #13199 是 macOS WKWebView 实现 bug**——任何语言层(JS / Rust)调 `isMaximized()` 都会触发
2. **修复方向不是"避开 onResized 回调"**——而是**完全避免调 isMaximized()** 或**降频到 webview 容忍范围内**
3. **Rust 端 on_window_event 比 JS 端 onResized 触发更频繁**——不能简单照搬前端 setTimeout 50ms 模式
4. **cargo check / cargo build 通过 ≠ 运行时安全**——本 bug 在 setup 阶段触发,编译期无法发现

## 五、下一步方向 (待用户决策)

1. **保留 42b39f3 修复**——setTimeout 50ms 把循环限制在 20Hz,Cmd+Q 退得出,只是按钮/拖拽仍卡
2. **考虑彻底放弃 isMaximized 实时同步**——只保留按钮点击 / mousedown 主动路径,完全删除 `onResized`/`on_window_event` 监听 isMaximized 状态变化
3. **升级 wry / tao**——Tauri 2.9 + tao 0.34 可能已修 #13199,但需要 cargo update + 全量测试

## 六、本次未 commit 改动

```bash
# stash 名: wip-rust-emitter-buggy-do-not-pop
# 状态:已 stash,工作区干净
# ⚠️ 警告:不要 git stash pop —— 该改动会引入更严重的卡死
```

---

> OMC trailers:
> Constraint: 仅修改 src-tauri/src/main.rs + src/windows/maximizedState.ts + 测试
> Rejected: Rust 端 on_window_event 调 is_maximized() | 触发频率 > 100Hz,比前端 20Hz 慢循环更严重
> Directive: 用户实测 "tauri:dev 直接卡死" 立即停止改动,stash 保留供事后分析
> Confidence: 高 | on_window_event 在 macOS 上频繁触发,is_maximized() 调 macOS 死循环 = 应用卡死
> Scope-risk: 本次改动已 stash,未污染主干
> Not-tested: 真实 macOS dev 模式下 on_window_event 触发频率(需 Instruments 验证)
