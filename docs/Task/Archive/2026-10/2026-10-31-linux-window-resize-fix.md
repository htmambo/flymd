# Linux(Manjaro/Wayland)窗口无法调整大小的修复

**Status**: ✅ 已完成（完成时间 2026-10-31）
**创建时间**: 2026-10-31
**创建者**: mavis (MiniMax Code)
**范围**: `src/windows/windowResize.ts`、`src/windows/windowResize.test.ts`、`src/main.ts`（最大化状态同步）

## 一、目标（Goals）

修复 Linux 下应用窗口**完全无法调整大小**的问题（macOS 正常）。
用户报告：窗口拖不动大小；第一版修复后用户再次反馈「仍然不能调整应用窗口大小」。

## 二、根因（代码 + 协议层 + 真机实测，三方交叉验证）

本机环境：KDE Plasma 6 / Wayland(`XDG_SESSION_TYPE=wayland`) / GTK 3.24.52 / scale=2 / 单显示器 1920×1080。

### 2.1 根因一：原生路径在 Wayland 下**必然无效**（协议层铁证）

Tauri 的 `startResizeDragging` → tao `WindowRequest::DragResizeWindow` →
`gdk_window_begin_resize_drag(edge, button, x, y, GDK_CURRENT_TIME)`。
`GDK_CURRENT_TIME = 0` ⇒ Wayland 请求里的 **serial 恒为 0**。

`WAYLAND_DEBUG=1` 抓到的真实报文：

```
[11:48:59.179430] -> xdg_toplevel#34.resize(wl_seat#22, 0, 8)
（此后没有任何 xdg_toplevel.configure）
```

serial=0 的请求**无法把这次交互绑定到用户的按键**，KWin 直接忽略：不建立指针 grab、不进交互式 resize、不回 configure。
⇒ 原生路径在 Wayland 下 **100% 无效**（不是"偶尔失效"，是必然失效）。

> 注：tao 自己在 GTK 层已装 `connect_button_press_event`，命中边缘时用**真实 `event.time()`** 调 `begin_resize_drag`——那才是能拿到有效 serial 的路径。
> 但 webview 会吞掉按键事件，事件到不了 toplevel，所以前端只能用 IPC 调 `startResizeDragging`，也就只能拿到 serial=0。

### 2.2 根因二：手动兜底被探针误杀（决定性代码缺陷）

第一版修复的探针把「收到窗口 `resize` 事件」当作「合成器接管了 resize」的证据。
但 `resize` 事件是**异步投递**的：上一次无关的改尺寸（如 restore）的事件迟到后会被当成本次手势的证据 ⇒ 探针误判成 `native` ⇒ 手动路径被关闭 ⇒ 表现为"完全无法调整大小"。

**正确判据只有一条：尺寸值是否偏离基线**（尺寸没变 ⇒ 合成器就没接管）。
尺寸值比对严格优于事件证据：事件会迟到污染，尺寸值不会。

### 2.3 根因三：`body.window-maximized` 与真实状态脱节（独立且同样致命）

CSS 规则 `body.no-native-decorations.window-maximized .window-resize-handle { pointer-events: none }` 会把手柄整体禁用。
而 `bindWindowMaximizedState`（`src/windows/maximizedState.ts`）**只在启动时做一次基线同步**（为绕开 macOS `isMaximized()` 死循环的既定取舍），应用自己的最大化/还原按钮**只更新按钮图标、不更新这个 class**。

死循环时序：

1. 应用以最大化状态启动 → 基线同步 → `body.window-maximized` 置上；
2. 用户点「还原」→ 窗口取消最大化，但 class 仍留着；
3. ⇒ 手柄永久 `pointer-events: none` ⇒ **窗口再也调不了大小**。

真机首轮诊断即复现了该状态（`bodyClass` 含 `window-maximized`，`handleRight.pointerEvents = "none"`）。

### 2.4 Wayland 的平台限制（无法绕过，只能如实降级）

| 能力 | 实测结果 | 结论 |
|---|---|---|
| `setSize` | 物理像素精确生效（3840→3960 / 2850→2970 / 2860→3300） | **可用**，是唯一可靠的改尺寸手段 |
| `setPosition` | 请求 +80/+40 后 `outerPosition` 仍是原值 | **no-op**（Wayland 客户端无权自行移动窗口） |
| `startResizeDragging` | 见 2.1 | **no-op** |

⇒ 手动路径在 Wayland 下能改尺寸、但不能移动窗口，左/上边缘退化为「尺寸变化但锚定边不跟随光标」。这是平台限制，非本实现缺陷。

## 三、实施方案（`src/windows/windowResize.ts`）

### 3.1 双路径并存 + 运行时探测（保留，X11 不降级）

`linuxMode: 'unknown' | 'native' | 'manual'`（会话级）：

- `mousedown` → 采集锚点（缩放系数 / `innerSize` / `outerPosition`）。
- 已知 `manual` → **不再调用原生接口**（避免两条路径同时改窗口）。
- 未知 → 调用 `startResizeDragging`，武装探测（探测窗口内不动尺寸）。
- `mousemove`（首次位移）→ 等 120ms，再**只用尺寸值比对**判定归属：
  - 尺寸偏离基线 → `native`，手动路径关闭；
  - 尺寸没变 → `manual`，手动路径接管并补上探测期累计的位移；
  - `innerSize` 读取失败 → **不锁定模式**（保持 `unknown`），但本手势仍走手动兜底。
- `mouseup` → 若本次有位移却始终没有尺寸变化 → `native` 降级为 `unknown`，下次手势重新探测（自愈）。

X11 下原生路径是好的（GDK3 X11 会做真正的交互式 resize），**不因修 Wayland 而降级 X11**。

### 3.2 指针位移来源：screen / client 双源自动择优

手动路径需要「指针位移了多少」。两个候选：`screenX/screenY`（屏幕绝对坐标）与 `clientX/clientY`（视口相对坐标）。
WebKitGTK 在 Wayland 下 `screenX` 由 `gdk_window_get_origin` 推导，并非 100% 可信，因此**哪个源先真正动起来就用手势内保持一致**，避免坐标系混用。

- 用「当前指针位置 − 手势起点指针位置」的**绝对差**，不用逐事件累加：事件丢包时绝对差不丢位移、也不累积漂移。
- 择优后 client 源是安全的：
  - Wayland：`setPosition` 是 no-op，拖拽期间窗口永不移动 ⇒ client 坐标原点不动 ⇒ 位移不会"冻结"；
  - X11：`screenX` 一定有效 ⇒ client 源根本不会被选中。

### 3.3 resize 落地：按帧节流 + 串行化

- `requestAnimationFrame` 合并一次手势内的多次 `mousemove`，每帧只落地一次 `setSize`。
- 串行落地（同一时刻只允许一个 `setSize` 在途，队列只保留最新目标）：并发时旧目标可能后落地 → 尺寸回跳一帧。
- **跳过重复目标**：目标与上一次成功落地的几何完全一致时不再下发（单测已覆盖）。协议日志实测到「指针停住后同一几何被重复下发」——该行为在改动前即存在（改动前的日志同样有上百次同尺寸下发），且重复下发同一几何对合成器是无害的 no-op；本优化是尽力而为的降噪，去重在真机上的实际命中率未能量化（`__TAURI_INTERNALS__.invoke` 与 `Window.prototype.setSize` 两条插桩路径均未能拦住调用，故不据此下结论）。

### 3.4 竞态与跨手势污染防护

- **单一手势序号 `gestureSeq`**：探测是异步的，用序号丢弃过期手势的探测结果；**手势结束即递增序号**，让在途探测失效，避免已松开的手势复活 `ready/resizing`。
- **新手势开始时清理残留**：丢弃上一手势的待落地目标、重置探针标志位、等待在途写入落地后再读基线（否则基线会读到旧尺寸，探针再次误判）。
- **`mouseup` 自愈**同样改为尺寸值比对，不再依赖 resize 事件。

### 3.5 最大化状态自愈（对应根因三）

- 新增 `applyMaximizedState(isMax)`：应用自己的最大化/还原按钮在切换后**显式**同步 `body.window-maximized`（`src/main.ts` 标题栏按钮已接入）。
- Linux 专用的**去抖复核**：窗口尺寸变化后 150ms 复核一次 `isMaximized()` 并纠正 class，覆盖「合成器快捷键 / 窗口菜单」等应用之外的路径。
  - 只在 Linux 启用：macOS 上在 `onResized` 回调里调 `isMaximized()` 会触发 Tauri #5812/#13199 描述的 looped resize 死循环。
  - 手势进行中挂起复核，pointerup 后再复核，避免拖拽中途切 class。

### 3.6 非 Linux 路径

macOS / Windows 的 resize 行为**完全不变**（仍走原有的手动路径）。

## 四、验收（Acceptance）

- `npx tsc --noEmit` 通过。
- `npx vitest run`：`windowResize.test.ts` **31 例**（第一版 18 例 + 本轮 8 例），覆盖双路径结局、探针判据、指针源择优、按帧合并、跨手势污染、串行落地、最大化状态同步；全套 **82 文件 / 1023 用例**全绿。
- `npx vite build` + `scripts/check-entry-closure.mjs` 通过。
- **真机合成拖拽验证**：首手势即成功，`linuxMode=manual`、`pointerSource=screen`，窗口 `2860 → 3300` 物理像素（= `(420-200)×2`），精确命中。
- **真机真实拖拽验证（用户实测，两轮）**：
  1. 第一轮实现后，用户确认「测试运行的应用已经可以调整窗口尺寸了」。诊断浮层同时记录到真实指针事件的 `screenX` 为有效屏幕坐标（如 `screen=(818,23)`、`screen=(156,619)`），坐实 screen 源在真机可用。
  2. 经两轮外审加固（超时兜底 / 手势世代校验 / 探针落地前复核 / 尾帧 flush / 源锁定阈值）后再次请用户复验，用户确认「可以正常调整大小，窗口跟随光标变化」。
- **协议层独立佐证**：复验期间 `WAYLAND_DEBUG` 日志出现 `xdg_surface#33.set_window_geometry(0, 0, 1056, 729)`（窗口由 960×640 变为 1056×729），即手动路径的落地请求被客户端真实下发；同一时段内 `xdg_toplevel.resize` 请求仍只有 2 条（首次探测那一次），印证原生路径在 Wayland 下不产生任何实际效果。

## 四·五、遗留观察（不影响验收）

- 拖拽过程中客户端会以约 60fps 下发 `xdg_surface.set_window_geometry`（窗口跟随光标的正常表现）。指针停住不动时会出现同一几何的重复下发，对合成器是无害 no-op；代码侧已加"目标未变则跳过"的降噪。
- 真机复验全程依赖用户手动拖拽：本机 KDE Wayland 不派发 uinput 虚设备指针事件，无法自动化。

## 五、验证手段（供后续复现）

本轮建立了**可远程读取**的诊断通道，避免依赖截图 OCR 与人工判读：

- 诊断模块把报告写入 `~/.local/share/com.flymd/flymd-resize-diag.json` 与 `/tmp/flymd-resize-diag.json`，并同步写入系统剪贴板（`@tauri-apps/plugin-clipboard-manager`）。
- 覆盖项：平台 / `body` class 链 / 手柄 computed style 与 `elementFromPoint` 命中 / `setSize` 直调前后尺寸 / `setPosition` 前后 `outerPosition` / 合成拖拽前后尺寸 / 真实指针事件的 `screenX`/`clientX`/`movementX` / `linuxMode` / `pointerSource`。
- 诊断模块为**临时**手段，定位完成后已删除（`src/windows/resizeDiagnostics.ts` 及 `src/main.ts` 的调用点均已移除）。

> 未验证项：本机 KDE Wayland 不派发 uinput 虚设备指针事件（`ydotool`/`xdotool`/XTEST 均不可用），因此**真实拖拽无法自动化**，只能由用户手动执行——已执行并通过。

## 六、外审处置

送审 3 轮（代码轮 1、2 针对 resize，代码轮 3 针对 statusBar；本轮代码轮 4 针对 resize 最终实现），累计 17 条。

**本轮（代码轮 4、5）共 14 条处置：**

- **采纳**（10 条）：
  1. 跨手势污染探针 —— 新手势开始时丢弃待落地目标 + 等待在途写入落地后再读基线；
  2. 探针标志位泄漏 —— 手势结束即递增序号作废在途探测；
  3. 指针位移改用绝对差、弃累加（消除漂移与丢包丢位移）；
  4. `applyResize` 未串行化 —— 改为串行落地 + 队列只留最新目标；
  5. 最大化复核与手动 resize 共用去抖 —— 手势期间挂起，pointerup 后再复核；
  6. 锚点采集无世代校验 —— `captureAnchor` 每个 await 后校验 `gestureSeq`，避免「快速按下松开」把手势状态复活；
  7. IPC 挂起会把状态机卡死 —— 窗口 IPC 统一加 2s 超时兜底（`innerSize`/`outerPosition`/`setSize`/`setPosition`/等待在途写入）；
  8. `linuxPendingDeltaX/Y` 跨手势残留 —— 锚点采集时清零；
  9. 指针源锁定过于脆弱 —— 位移 ≥2px 才锁定坐标系，避免 1px 抖动锁死一个「其实不动」的源；
  10. 手势结束丢尾帧 —— `endGesture` 在 mouseup 时 flush 最后一帧目标，最终尺寸不差一帧。
- **驳回**（3 条，均有代码/协议层证据）：
  1. 「`return` 早退绕过 `finally`」——JS 语义错误，`try` 内 `return` 仍会执行 `finally`；真正的问题是探测结论在手势结束后复活状态，已用序号作废解决（对应采纳 2、6）；
  2. 「client 源自停摆」——该失效要求「窗口跟着光标移动」，而 client 源只在 screen 源失效时被选中：Wayland 下窗口永不移动、X11 下 screen 源必然有效，两种情况均不成立（推导见 §3.2）；
  3. 「二次 pointerdown 不换手势序号」——`onMouseDown` 每次都会 `++gestureSeq`，旧探针的序号校验必然失配（已采纳 8 做额外清理）。
- **修正判定**（1 条）：外审认为「resize 事件」是正确探针证据，**实为根因二本身**（迟到事件污染判定），已按尺寸值比对重写。
- **部分采纳**（1 条）：探针 120ms 阈值在慢 WM 下可能早判 `manual` —— 采纳「落地前再复核一次 `innerSize`」的轻量版，避免手动路径与迟到的原生 resize 双写。

**第 5 轮 4 条处置：**

- **采纳**（3 条）：
  1. 超时防护有漏洞 —— `getWindowScaleFactorSafe()` 与探针内的 `innerSize()` 补上 2s 超时；
  2. drain 超时被静默吞掉 —— 改为超时即**中止本次手势**（基线不可信时不能继续）；
  3. 判定失准会跨手势延续 —— 补齐**对称自愈**：`manual` 模式下有位移却尺寸始终没变 ⇒ 降级 `unknown` 重新探测（原先只对 `native` 做自愈）。
- **驳回**（1 条，有代码证据）：「`flushPendingResize` 覆盖 `applyQueue` 与串行落地冲突」—— 本设计就是「串行执行 + 单槽合并」，队列刻意只保留最新目标；`applyQueue` 被替换时，正在执行的那次 apply 仍会串行完成，最终目标也一定会被应用，两者不冲突。
- **修正判定**（1 条，有代码证据）：「探针无法区分原生 resize 与自己的 setSize」—— 探测期间手动路径是**关闭**的（`resizing=false`/`ready=false`），不可能有手动落地；上一手势的 flush 在锚点采集前已被 `drainApplies` 等完并计入基线。故探测期间尺寸变化只可能来自合成器。
- 另采纳一条低优先级项：锚点采集的世代校验早退时同步清空 `direction`，避免残留上一次手势的方向。
**第 6 轮 4 条处置（全部采纳）：**

1. **阻断**：`applyResize` 的超时按成功回落 → 超时后仍写入「已落地」基线 → 去重逻辑会永久跳过该目标、手势内无重试路径。改用严格超时（超时 reject），失败路径不写基线。
2. `captureAnchor` 的 drain 超时分支位于世代校验之前 → 旧手势会清空新手势的 `ready/resizing/direction`；且失配分支里的 `direction=''` 会抹掉新手势已设的方向。改为**世代校验前置 + 失配裸返回**，不触碰任何共享状态。
3. 新手势未重置「已落地」基线 → 窗口被外部改动后可能误跳过本应生效的目标。锚点采集时清零。
4. 次要项：缩放系数超时回落为 1 会造成整手势像素换算的系统性偏差 → 改为超时就中止本次手势；位置比较改为取整后比较，避免浮点残差触发冗余 `setPosition`。

> 附带修复：严格超时的迟到 reject 会变成 unhandled rejection（被测试跑出），已加静默 catch。

- 前两轮 9 条处置见 git 历史：采纳 4 条（已知 manual 时不再调原生接口、探测守卫按手势序号、读取失败不锁定模式、内部写入不重置定时器），驳回 5 条并附代码/协议层证据。

## 七、回滚

改动集中在 `src/windows/windowResize.ts`（+ `src/main.ts` 一处最大化同步调用），
`git revert` 即完全回到旧行为（届时 Linux 窗口重新变为「完全无法调整大小」）。
