# 内容区底部常驻状态栏

**Status**: ✅ 已完成（完成时间 2026-10-31）
**创建时间**: 2026-10-31
**创建者**: mavis (MiniMax Code)
**范围**: `src/ui/statusBar.ts`、`src/ui/titlebarStatus.ts`、`src/main.ts`、`src/i18n.ts`、`src/styles/{editor,notifications,sticky-note}.css`

## 一、目标（Goals）

在文档内容区最底部新增一条常驻状态栏：

- 左侧：文件路径
- 中槽：瞬态消息
- 右侧：四项常驻状态（行/列、字数、未保存标记、缩放%）

用户已定的三项参数：右侧四项内容、**挤压式**占位（内容区让出高度、状态栏贴底边）、**源码/阅读/所见三种模式都显示**。
追加要求：状态栏顶部要有可见分隔线。

## 二、现状分析（Context）

1. 路径显示在左下角悬浮徽章 `.filepath-badge`（`bottom: calc(var(--workspace-bottom-gap, 0px) + 50px)`），不贴合内容区底边。
2. `.filepath-badge` 同时是紧凑标题栏模式下路径的唯一出口（`src/ui/titlebarStatus.ts` 的 `filenameLabel`）。
3. `#status` 不是状态栏，而是**共享临时消息总线**：10+ 个写入方、3 种恢复语义。
4. 状态栏在阅读/所见模式被隐藏，用户阅读时看不到字数。

### 2.1 `#status` 的写入方与恢复语义

- 常驻内容：行/列 + 字数（`refreshStatus()`）。
- 临时消息 + 定时恢复：`main.ts` 保存成功 / PDF 导出 / 打印 / DOCX 导出 / 另存为等 6 处，`setTimeout(() => refreshStatus(), 2000)` 回填。
- 临时消息 + 清空字符串：`src/extensions/webdavSync.ts` 两处（1500ms / 1200ms）。
- 临时消息 + 永不恢复：`main.ts` 的 `showError()`、`src/core/updateUtils.ts` 的 `upMsg()`。

**关键设计**：保持 `#status` 这个 DOM id 不变，只把它从「整条状态栏」变成「状态栏内的中槽消息元素」——10+ 个写入方一行都不用改，自动从「覆盖常驻统计」变成「显示在消息槽」。

### 2.2 几何：内容区底边有 8 个消费者

`--workspace-bottom-gap = var(--dock-bottom-gap)`，消费点：`editor.css` 的 161 / 182 / 219 / 239 / 250 / 324 / 330 + `modes/cm6Editor.css:9`。

**关键设计**：重定义为 `calc(var(--dock-bottom-gap, 0px) + var(--statusbar-height))`，8 个消费者全部自动上移，**零处改动**。

### 2.3 四项信号的来源

- 行/列：`refreshStatus()` 已有计算（快路径 O(log n)，关行号时 O(n) 回退）。
- 字数：`fastInfo.chars ?? ed.value.length`（O(1)）；所见模式下 `_onChange` 会把 markdown 全量写回 textarea，故与源码同步。
- 未保存标记：`getDirty()`，与标题星号同源。
- 缩放%：`getUiZoom()` + `flymd:uiZoom:changed` 事件（`src/core/uiZoom.ts:96`）。

行/列只在源码编辑器可见时有意义（阅读 / 所见无光标语义），其余三项三种模式都显示。

## 三、实施方案与落地

### T2 状态栏 DOM（`src/main.ts`）

```html
<div class="statusbar" id="statusbar">
  <div class="statusbar-left" id="statusbar-left"><div class="filepath-badge" id="filepath-badge"></div></div>
  <div class="statusbar-msg" id="status" role="status" aria-live="polite"></div>
  <div class="statusbar-right" id="statusbar-right" aria-hidden="true">
    <span class="statusbar-item" id="statusbar-pos"></span>
    <span class="statusbar-item" id="statusbar-chars"></span>
    <span class="statusbar-item" id="statusbar-dirty" data-dirty="0"></span>
    <span class="statusbar-item" id="statusbar-zoom"></span>
  </div>
</div>
```

### T3 状态栏模块（新增 `src/ui/statusBar.ts`）

状态栏槽位的**唯一写入方**：`setMessage` / `clearMessage` / `setPosition` / `setChars` / `setDirty` / `setZoom` / `dispose`。

- **单一 timer 句柄**：任何新写入都取消上一个待清除定时器，消除「后写消息被前一个定时器提前清掉」的竞态。
- **MutationObserver 兜底**：外部写入方直接改 `#status` 的 `textContent`，观察器统一按 TTL 清除（覆盖原本「永不恢复」的 `showError` / `upMsg`）。
- **内部写入不重置定时器**：记录 `lastWritten`，观察器据此区分「自己写的」与「外部写入」，避免内部写入触发观察器后把刚设的定时器取消再重设。

### T4 接线

- `src/ui/titlebarStatus.ts`：`refreshStatus()` 改为写 `slots`（行/列 / 字数 / 未保存标记），不再直接持有 DOM 元素；deps 改为 `TitlebarStatusSlots` 接口。
- `src/main.ts`：8 处消息写入改走 `statusBar.setMessage()`；6 处恢复点改为「清中槽消息 + 刷新统计」；缩放走 `statusBar.setZoom()`。
- **模式切换刷新**：`notifyModeChange()` 追加 `refreshStatus()`——原先切到阅读/所见后行/列仍是源码模式的旧值（浏览器实测复现并修复）。

### T5 布局（`src/styles/`）

- `notifications.css`：`.statusbar` 绝对定位贴内容区底边，`border-top: 1px solid var(--border)`（分隔线；最初误用不可见的 `var(--bg)`）；新增 `.statusbar-left/msg/right/item`；`.filepath-badge` 去掉绝对定位改为栏内 flex 项（保留 `direction: rtl` 截断与 `max-width: 40vw`）；**未新增 `:has()`**（Safari 13/14 兼容底线）。
- `editor.css`：`.container` 新增 `--statusbar-height: 26px`，`--workspace-bottom-gap` 重定义。
- `sticky-note.css`：便签模式 `--statusbar-height: 0px !important`（否则内容区留白）。
- 窄窗降级：`@media (max-width: 640px)` 隐藏缩放%；`@media (max-width: 460px)` 再隐藏字数；路径保留省略号。
- 打印：`src/styles/print.css` 已含 `.statusbar`，无需改动。

### T6 i18n（`src/i18n.ts`）

新增 `status.chars`（zh `字 {count}` / en `{count} chars`）与 `status.unsaved`（zh `未保存` / en `Unsaved changes`）。
原先 `字 N` 是硬编码中文、`status.unsaved` 键根本不存在（tooltip 会显示成字面量键名），本轮一并修掉。

## 四、验收（Acceptance）

- `npx tsc --noEmit` 通过。
- `npx vitest run`：**82 文件 / 1010 用例**全绿（新增 `src/ui/statusBar.test.ts` 8 例、`windowResize.test.ts` +8 例）。
- `npx vite build` + `scripts/check-entry-closure.mjs` 通过。
- 浏览器实测（Vite dev server + headless Chrome 窄视口）：
  - 源码模式：右下 `行 1, 列 1 · 字 0 · 100%`，顶部分隔线可见，内容区被挤压上移。
  - 阅读模式 / 所见模式：行/列**正确隐藏**，字数与缩放仍在。
  - 未保存：输入后出现 `●`，标题同步 `未命名 *`。
  - 600px 宽：缩放%隐藏；440px 宽：字数也隐藏。

## 五、外审处置（逐条）

需求轮 R1 `REQS_CHANGES` 8 条全采纳；需求轮 R2 `APPROVED` 5 条建议全落实；计划轮 `APPROVED` 6 条全采纳。
本轮代码轮 3 次送审，处置如下：

- **代码轮 1（Linux resize）**：`!nativeStarted` 分支「不可达」——驳回（该 catch 覆盖 IPC 拒绝 / 非 Tauri 运行时，非仅 tao 通道失败）；「manual 模式仍调原生接口」——**采纳**（已改为已知 manual 时直接走手动路径）；「probePending 置位过晚」——驳回（探测只能由 `onMouseMove` 进入，`gestureSeq` 已挡住过期结果）；`dir` 强转未校验——驳回（调用点已用 `dir in resizeDirMap` 把关）。
- **代码轮 2（探测逻辑）**：「旧探测吞掉新探测、pending 永久悬挂」——部分采纳（改为按手势序号区分的探测守卫）；「固定 100ms 误分类 / innerSize 异常被当成 manual」——**采纳**（优先用 resize 事件作首要证据，读取失败不再锁定模式）；「delta 中间态」——驳回（增量每次都从锚点重算，最新值才正确）；「applyResize 异常未捕获」——驳回（函数内部已整体 try/catch）。
- **代码轮 3（状态栏模块）**：「observer 未 disconnect」——已在重构中修掉（本轮补 `dispose()` 并在重复观察前断开旧实例）；「内部写入触发观察器把定时器取消再重设」——**采纳**（`lastWritten` 区分内外写入）；「两处定时器回调重复」——**采纳**（抽 `armTimer(expected)`）。

## 六、风险与回滚（Risks & Rollback）

| 风险 | 等级 | 应对 |
|---|---|---|
| 消息槽拆分回归 | 中 | `#status` id 不变，10+ 写入方零改动；补 8 例单测 |
| 6 处恢复点语义漂移 | 中 | 改写为「清消息槽 + 刷新统计」，逐一核对 |
| 行/列 O(n) 回退开销 | 低 | 仅源码编辑器可见时计算位置 |
| 窄窗口挤压 | 低 | 路径省略号 + 640/460px 逐级隐藏低优先级项 |
| 消息永不恢复 | 低 | 中槽统一加自动清除定时器（TTL 4000ms） |

回滚：状态栏为纯增量，`git revert` 本轮提交即可完全移除；`--statusbar-height` 归零后几何自动回到原状。
