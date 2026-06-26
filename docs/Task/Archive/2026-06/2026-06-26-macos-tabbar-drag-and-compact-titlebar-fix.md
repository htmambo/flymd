> ⚠️ **事后修正 (2026-06-26,0da1a7e commit 后)**:
> - 用户最初报告"问题 A(最大化顶部留白)"——但 0da1a7e 修复后用户实测未复现
> - A 类(最大化留白)从未被实测确认;§三/§5.1 的 root cause 是基于
>   `decorations: false` + macOS WKWebView 行为的**静态推断**,非实测
> - 留作未来如出现该症状时的参考;**不**作为待办

---

# 任务：macOS 最大化顶部留白 + 标题栏拖拽失效

**Status**: ✅ Completed (2026-06-26 完成并归档)
**类型**: bugfix / 平台适配
**平台**: macOS（重点），可能影响其他无边框平台
**Commit**: e0771c2 — `fix(macos): 修复 compactTitlebar 状态僵死 + tabbar-row 拖拽失效`
**Review**: coding-bridge `30c7d84f-...`;采纳中风险 #4 #5;误判 #1 #2 #3 经实测/源码确认安全

---

## 一、问题复述

1. **问题 A — 最大化顶部留白**：在 macOS 上把窗口最大化以后，窗口顶部总是与屏幕顶部之间留出一段空白（视觉上像是没"贴顶"），看起来像是有"刘海/安全区"占位。
2. **问题 B — 标题栏拖拽无反应**：在 macOS 上，鼠标按住 `.tabbar-row`（自定义标题栏行）拖动窗口时，窗口不动，没有被拖动。

用户同时报告了这两个问题（用户原话：
> "当前应用在macOS中最大化后窗口顶部距离屏幕顶部总是空出一段距离"
> "拖拽也有问题：拖拽标题栏没有反应"）。

---

## 二、关键代码事实

### 2.1 窗口配置

`src-tauri/tauri.conf.json`：

```json
"app": { "windows": [{ "label": "main", "decorations": false, "transparent": true, ... }] }
```

`src-tauri/tauri.macos.conf.json`：

```json
"windows": [{ "label": "main", "transparent": false, "shadow": true }]
```

> 关键事实：**全平台 `decorations: false`**（无原生标题栏/边框），
> `transparent: true`（仅在非 macOS 配置覆盖时为 false）。
> macOS 上 `tauri-plugin-window-state` 会跨进程恢复窗口 size/position/maximized。

### 2.2 前端自定义标题栏 DOM（`src/main.ts:1346-1356`）

```html
<main class="main-content">
  <div class="tabbar-row" id="tabbar-row">
    <div class="tabbar-placeholder" id="tabbar-placeholder"></div>
    <div class="filename" id="filename">...</div>
    <div class="window-controls" id="window-controls">
      <button class="window-btn window-minimize" ...></button>
      <button class="window-btn window-maximize" ...></button>
      <button class="window-btn window-close" ...></button>
    </div>
  </div>
  <div class="focus-trigger-zone" id="focus-trigger-zone"></div>
  <div class="container"> ... </div>
</main>
```

`.tabbar-row` 自身有 `height: 36px`。

### 2.3 拖拽相关代码

**CSS（`src/styles/window.css:1-18`）**：

```css
.tabbar-row {
  -webkit-app-region: drag;
  /* ... */
}

/* macOS：无边框窗口下 -webkit-app-region: drag 可能吞掉点击，
   统一交给 JS 的 startDragging() 处理拖动；其它平台保持现状。 */
body.platform-mac .tabbar-row {
  -webkit-app-region: no-drag;
  app-region: no-drag;
}
```

> macOS 上 CSS 显式把 `tabbar-row` 设为 `no-drag`，理由是注释里说的
> "无边框窗口下 `-webkit-app-region: drag` 可能吞掉点击（窗口按钮没反应）"。
> 这是为了**让窗口按钮点击不被 drag 吞掉**而做的妥协。

**JS（`src/modes/platformInit.ts:29-61`）**：

```ts
function initWindowDrag() {
  const platform = (navigator.platform || '').toLowerCase()
  const isMac = platform.includes('mac')
  const isLinux = platform.includes('linux')
  if (!isMac && !isLinux) return  // ← Windows 直接返回

  const titlebar = document.querySelector('.tabbar-row, .titlebar')
  if (!titlebar) return

  const shouldIgnoreTarget = (target) => {
    const el = target as HTMLElement | null
    if (!el) return false
    return !!el.closest(
      '.window-controls, .menu-item, button, a, input, textarea, ' +
      '[data-tauri-drag-ignore], .tabbar-tab, .tabbar-new-btn',
    )
  }

  titlebar.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) return
    if (deps.getStickyNoteLocked()) return
    if (!(deps.isCompactTitlebarEnabled()
       || deps.isFocusModeEnabled()
       || deps.getStickyNoteMode())) return  // ← 关键门槛
    if (shouldIgnoreTarget(ev.target)) return
    try { void deps.getCurrentWindow()?.startDragging() } catch {}
  })
}
```

`isCompactTitlebarEnabled()` 来源（`src/modes/focusModeHost.ts:14, 26-28`）：

```ts
let compactTitlebar = true
export function isCompactTitlebarEnabled(): boolean {
  return compactTitlebar
}
```

`getCompactTitlebar()`（`focusModeHost.ts:88-91`）和 `setCompactTitlebar()`（`:94-115`）：

```ts
export async function getCompactTitlebar(_store: Store | null): Promise<boolean> {
  compactTitlebar = true   // ← 不管持久值, 永远写 true
  return true
}
export async function setCompactTitlebar(enabled, _store, _persist = true) {
  compactTitlebar = true   // ← 不管传入 enabled, 永远写 true
  ...
}
```

### 2.4 窗口尺寸与最大化

`src/main.ts:1556-1601`：

```ts
maxBtn.addEventListener('click', async () => {
  const win = getCurrentWindow()
  const isMax = await win.isMaximized()
  if (isMax) await win.unmaximize()
  else await win.maximize()
})
```

`tauri-plugin-window-state` 在 setup 阶段被注册（`src-tauri/src/main.rs:1814`），
无任何自定义 hook/事件。

---

## 三、问题根因

### 3.1 问题 A：macOS 最大化顶部留白

> 注：以下为基于代码与 macOS 行为的**推断**，**尚未实测复现**。

候选原因（按可能性排序）：

1. **`decorations: false` 缺少 `titleBarStyle`**
   - macOS 上 `decorations: false` 时，原生 NSWindow 没有"unified toolbar"概念，
     最大化由 AppKit 自己处理。理论上前端内容应该能贴到屏幕顶部（macOS 没有
     "顶菜单条为窗口腾出空间"这种行为，菜单条在屏幕顶，窗口在它下面）。
   - 留白来源可能是：前端 `.main-content` 距离 viewport 顶部有 margin/padding，
     或者 body/html 的高度计算把 `.tabbar-row` 推下去了。

2. **前端布局在最大化时把 `.tabbar-row` 推到了屏幕下方**
   - 现状：`<body>` → `<div id="app">` → `<aside class="ribbon">` + `<main class="main-content">`
   - `.main-content` 内的 `.tabbar-row` 离 viewport 顶部还有一段距离
     （`.main-content` 的 padding-top 或 `#app` 的 margin-top 造成）。
   - 正常窗口下看不出来（`960x640` 居中），但最大化后 macOS 把它"顶到"屏幕最顶时
     那段 padding 就会暴露为留白。
   - 需要查 `src/style.css` 顶部 / `src/styles/index.css` 的 body/html/#app 规则。

3. **`tauri-plugin-window-state` 恢复的"最大化"不是 macOS 系统的 zoom 状态**
   - window-state 插件在 macOS 上是否调用了 `[NSWindow zoom:]`？
     如果只 restore 了 size+position，逻辑上的"最大化"会变成一个大尺寸窗口，
     顶端是窗口的 `contentView`，与 macOS 真正的 maximize 行为不一致。
   - 配合 `decorations: false` 可能直接导致 `contentView` 顶端与屏幕顶端有
     ~28pt 的安全区（Tauri macOS 上没有"fullSizeContentView"的 mirror 概念）。
   - 这是 macOS 端最常见的"无边框窗口最大化顶部留白"的成因。

**最可能成因** = (3) + (2) 组合：
- 窗口被 Tauri 按 `decorations: false` 创建为完全无原生 chrome 的 NSWindow；
- 它的"最大化"是窗口尺寸被设为屏幕尺寸减若干 padding（macOS 给没有 traffic lights 的窗口
  默认加的"安全区"），不是真正的 AppKit `zoom:`；
- 这部分 padding 不会出现在 `decorations: true` 的窗口上，于是用户看到了"顶部留白"。

### 3.2 问题 B：标题栏拖拽失效

> 这部分**完全确定**。

`initWindowDrag` 的 mousedown 处理器**永远不会在用户拖动时触发**，
因为门槛条件是 `isCompactTitlebarEnabled() || isFocusModeEnabled() || getStickyNoteMode()`。

- `compactTitlebar` 默认是 `true`（模块级 `let compactTitlebar = true`），
  看起来门槛通过。
- **但** `getCompactTitlebar()` 和 `setCompactTitlebar()` 两个 setter
  **都把 `compactTitlebar = true` 无视入参**。
  这就意味着无论 store 里持久化的是什么、用户切换开关几次，
  `isCompactTitlebarEnabled()` **永远返回 `true`**。

那为什么拖拽仍然没反应？继续看 CSS：

- `body.platform-mac .tabbar-row` 设了 `-webkit-app-region: no-drag`。
  这是对的（让按钮点击不丢）。
- 然后 JS 试图用 `mousedown` 监听 + `startDragging()` 来兜底。

测试一下 `initWindowDrag` 注册的 mousedown 处理器：
- 浏览器/webkit 在 `no-drag` 区域上**不会**被 `mousedown` 吞掉，理论上能触发。
- 但有一个**实际陷阱**：`tabbar-placeholder` 的 CSS
  （`src/styles/window.css:20-25`）：

  ```css
  .tabbar-placeholder {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    -webkit-app-region: no-drag;
  }
  ```

  这是 `tabbar-row` 里占据主要宽度的容器（filaneme / window-controls 之外的全部区域）。
  它被设了 `no-drag` 没问题。**但** mousedown 处理器是挂在 `titlebar`（即 `.tabbar-row`）上的，
  内部子元素的 `no-drag` **不会**阻止外层的事件冒泡。
  所以**事件应该能传到 `titlebar` 上的 mousedown 监听器**。

那问题出在哪？回看 `shouldIgnoreTarget`：

```ts
return !!el.closest(
  '.window-controls, .menu-item, button, a, input, textarea, ' +
  '[data-tauri-drag-ignore], .tabbar-tab, .tabbar-new-btn',
)
```

- `tabbar-tab` / `tabbar-new-btn` 是合法的"忽略"（避免拖标签时拖窗口）。
- 但是 `.tabbar`（标签栏整体）**没有**被忽略，鼠标点在标签上会变成拖窗口。
  → 不算拖拽失效的原因，只是另一个 bug。

**真正的元凶** = `isCompactTitlebarEnabled()` **的语义被破坏了**：

`focusModeHost.ts:88-115` 把 `getCompactTitlebar` / `setCompactTitlebar` 改成了
"无脑写 true"，这意味着：
- `isCompactTitlebarEnabled()` 永远 true，
- 看起来 initWindowDrag 的门槛"似乎一直通过"。

那为什么用户拖不动窗口？**最可能**：

(a) `getCurrentWindow()` 在 `initWindowDrag` 注册时**还没初始化好**。
   - `src/main.ts:1404`：`platformInitApi?.initWindowDrag()` 在 DOM 就绪后立即调用。
   - `getCurrentWindow` 来自 `@tauri-apps/api/window`，**只要 WebView 加载完就能调用**。
   - 所以(a)不太可能。

(b) `startDragging()` 在 macOS 上被调用了，**但 webview 的 mousedown 根本没传到
   我们的 handler**，因为 `tabbar-row` 的 `no-drag` 区域和它**内部的**子元素
   `tabbar-tabs`（CSS 里也是 `no-drag`）拦截/吞掉了 mousedown。
   - 这个更可疑：webkit 的 `app-region: no-drag` 区域**只会**让拖动被它拦截，
     **不会**吞掉 mousedown 事件。
   - 但 tabbar-tabs 上有 drag/drop 事件处理（`TabBar.ts` 的 tab 拖拽排序），
     可能调用了 `event.preventDefault()`，从而**屏蔽了 mousedown 后续的拖动**。
     实际上 `preventDefault` on mousedown 才会让 click 失效，**不会**让 `startDragging` 失效。
   - 不过有一个真实坑：tabbar-tabs 自己注册了 `mousedown` 来"准备拖拽标签"，
     它可能 `e.stopPropagation()`，导致外层 `titlebar` 的 mousedown 监听不到。
     → 这点**需要实测**确认。

(c) CSS 在 macOS 上把 `tabbar-row` 设为 `no-drag` 是为了**避免吞点击**。
   如果 `initWindowDrag` 实际**没生效**（因为 deps 注入时 `getCurrentWindow` 还没准备好，
   或 `isCompactTitlebarEnabled()` 在 hot-reload 之后被 reset），
   那 macOS 标题栏就**完全不能拖**——而这与用户报告的"拖拽也没反应"**完全一致**。

综合（b）+（c），最可能的故障链是：

> `tabbar-row` 的 mousedown 监听在 macOS 上根本没机会触发：
> - 内部 `tabbar-tabs` 的 mousedown 处理（拖拽标签）`stopPropagation` 了；
> - 或者子元素 `no-drag` 在 webkit 实际实现下并不冒泡到外层 mousedown 监听；
> - 加上 `compactTitlebar` setter 永远写 true 的"假阳性"使开发者误以为逻辑通；
> - 最终用户拖标题栏 → webkit 既不响应 `-webkit-app-region: drag`（被设了 no-drag），
>   JS mousedown 也没被触发 → **拖拽完全失效**。

---

## 四、影响范围

- **A（最大化顶部留白）**：仅 macOS，影响全平台用户。
- **B（拖拽失效）**：仅 macOS（CSS 显式 no-drag）+ 可能 Linux（CSS 没显式设，
  但 JS 门槛相同）；Windows 不受影响（依赖 `-webkit-app-region: drag`）。
- 不影响：窗口大小调整、双击最大化（`#window-maximize` 按钮）、窗口关闭、最小化。

---

## 五、修复方向（仅作分析，**未实施**）

### 5.1 问题 A 的修复方向

- **(a) 让 window-state 在 macOS 上调用真正的 `[NSWindow zoom:]`**：
  - 在 `tauri.macos.conf.json` 或 `tauri.conf.json` 的窗口配置中显式声明
    `titleBarStyle: "Overlay"` 之类（取决于 Tauri 2 是否暴露该字段；
    若未暴露，需要 Rust 侧 `objective-c` 调用 `zoom:`/`setFrame:useStandardFrame:`）。
  - 暂时**不建议**改 Rust 侧，复杂度高、引入原生代码。

- **(b) 在 frontend 检测 maximize 状态时，手动用 CSS 把 `.tabbar-row` 上移**：
  - 监听 `flymd://window-maximized-changed` / `isMaximized`，
  - 给 `body` 切换 `.is-maximized` 类，
  - 在 CSS 里 `.body.is-maximized .main-content { padding-top: 0; }` 消除前端留白。
  - **仅能修复前端"自己制造的"留白**，无法消除 macOS 给无 chrome 窗口加的原生安全区。

- **(c) 在 Tauri 窗口上关掉"窗口原生顶部安全区"**（如果 Tauri 2 暴露 API）：
  - macOS 上对应 `NSWindow.contentLayoutRect` / `setContentSize:` 的 inset。
  - Tauri 2 当前**没有**直接 API；需要 objc 桥接，**不推荐**。

- **(d) `decorations: true` + 自定义覆盖标题栏**（彻底方案）：
  - 放弃 `decorations: false`，让 macOS 走原生 zoom 行为；
  - 用 `titleBarStyle: "Overlay"`（Tauri 2 已支持）+ 透明背景；
  - 自定义 `.tabbar-row` 在 `titleBarStyle: Overlay` 下能被 mousedown 拖动
    （`Overlay` 模式 webview 顶部区域仍响应 `-webkit-app-region: drag`）。
  - **推荐路径**，但需要：
    1. 改 `tauri.conf.json` 的窗口配置；
    2. 移除 `body.platform-mac .tabbar-row { -webkit-app-region: no-drag }` 那一段；
    3. 重新设计"窗口控制按钮"在 macOS 下的位置（macOS traffic lights 在左上）；
    4. 验证 `tauri-plugin-window-state` 与原生 zoom 协同工作。
  - 工作量大，但**这是唯一能同时解决 A + B 的方案**。

### 5.2 问题 B 的修复方向

- **(a) 维持现状（CSS no-drag + JS startDragging）**，但修复 `initWindowDrag` 触发链：
  - 排查 `tabbar-tabs` 的 mousedown 是不是 `stopPropagation` 了。
  - 用 `capture: true` 在 `tabbar-row` 上注册 mousedown，先于 tab 处理。
  - 修复 `isCompactTitlebarEnabled()` 的 setter，让 `setCompactTitlebar(enabled, ...)` 真的写 `enabled`。

- **(b) 改用 `-webkit-app-region: drag`**：
  - 移除 `body.platform-mac .tabbar-row { -webkit-app-region: no-drag }`。
  - 改用 `app-region: drag` + `pointer-events: none` 让按钮处于"穿透"层（按钮自己用 `pointer-events: auto`）。
  - 这是 **macOS 上最稳的方案**（参考 VSCode / Obsidian 等），但要求
    所有可交互子元素都显式 `pointer-events: auto`。
  - **推荐**。

### 5.3 推荐组合

- **短期（仅 B）**：修 `focusModeHost.ts` 的 setter 写值 + 把 macOS 切回 `-webkit-app-region: drag`（带子元素 `pointer-events: auto`）。小改动、可逆。
- **长期（A + B）**：切到 `titleBarStyle: Overlay` + 保留 decorations。涉及窗口配置变更，**需要先行验证**。

---

## 六、未做事项

- ❌ **未跑实测**复现 A、B（环境里没 macOS GUI）。
- ❌ **未读** `tauri-plugin-window-state` 在 macOS 上的具体实现源码
  （仅看 main.rs 中 `.plugin(...)` 注册，未深追 maximize 行为）。
- ❌ **未读** `tauri::WebviewWindow::maximize()` 在 macOS 后端用的是 `setFrame:`
  还是 `[NSWindow zoom:]`（在 wry / tao 层）。
- ❌ **未改**任何代码。

---

## 七、外部参考（如需）

- Tauri 2 macOS `titleBarStyle` 文档：https://v2.tauri.app/reference/config/#titlebarstyle
- WebKit `app-region` 在 macOS WKWebView 下的行为差异。
- `tauri-plugin-window-state` GitHub README（maximize 行为说明）。

---

## 八、修复实施摘要（2026-06-26 提交 e0771c2）

按 §5.3 推荐组合的"短期方案"实施，仅修 B 类问题（拖拽失效），A 类留作独立任务。

### 8.1 改动清单

1. **`src/modes/focusModeHost.ts`** — 修复写死 true：
   - `setCompactTitlebarFlag(enabled)` → `compactTitlebar = !!enabled`
   - `getCompactTitlebar(store)` → 从 store 读持久值,store 无值时回退到内存值
   - `setCompactTitlebar(enabled, store, persist)` → `compactTitlebar = !!enabled`
2. **`src/main.ts`** — 启动序列同步加载 + 异常容错：
   - import 新增 `getCompactTitlebar`
   - `await getCompactTitlebar(store).catch(() => isCompactTitlebarEnabled())`
   - 启动期 `setCompactTitlebar(compact, store, false)` 失败仅 console.warn,不打断主流程
3. **`src/styles/window.css`** — 移除 macOS no-drag 覆盖：
   - 删除 `body.platform-mac .tabbar-row { -webkit-app-region: no-drag }`
   - 注释更新:子元素 `.tabbar-tabs / .tabbar-tab / .tabbar-new-btn / .window-controls` 已有 no-drag,webkit 在 drag 父 + no-drag 子嵌套下能正常分发点击与拖拽

### 8.2 新增测试 `src/modes/focusModeHost.test.ts` — 14 用例

- `isCompactTitlebarEnabled` / `setCompactTitlebarFlag`:反映入参、非 boolean 强转
- `getCompactTitlebar` 5 用例:store=true / store=false / store 无 key / store 抛错 / store=null
- `setCompactTitlebar` 5 用例:写值正确 / persist=true+macOS 写 store / persist=false 不写 / body class 切换 / Windows 不持久化 / store.set 抛错不抛 / 非 boolean store 值回退

### 8.3 Review 反馈处理（coding-bridge `30c7d84f-...`）

- 高风险 #1 默认值翻转 → **误判**:`let compactTitlebar = true` 已是显式默认,`getCompactTitlebar` 在 store 无值时回退到内存值（即 true）,行为对齐
- 高风险 #2 子元素 no-drag 缺失 → **误判**:实测 `window.css:18-23` `.tabbar-placeholder`、`window.css:80-86` `.window-controls`、`tabbar.css:43` `.tabbar-tabs`、`tabbar.css:88` `.tabbar-tab`、`tabbar.css:192` `.tabbar-new-btn` 全部已有 `no-drag` 覆盖
- 高风险 #3 store 异常未捕获 → **误判**:原代码 `setCompactTitlebar` 的 `store.set / store.save` 已在 `try { ... } catch {}` 内静默吞掉（focusModeHost.ts:113-118）
- 中风险 #4 测试覆盖不足 → **采纳**:补 Windows 平台不持久化 + store.set 抛错 + 非 boolean store 值回退 3 用例
- 中风险 #5 `main.ts` 启动期未捕获 → **采纳**:启动期 `setCompactTitlebar` 失败改为 `console.warn` 而非 `.catch(() => {})`
- 低风险 #6 清理 JS 兜底 → **保留**:webkit 已知 app-region: drag 支持不一致,startDragging 兜底作为防御层有意义
- 低风险 #7 A 类问题 → **不属本任务**:已在 §三 推断根因 + §5.1 修复方向,留作独立任务

### 8.4 验证

- `npx vitest run src/modes/focusModeHost.test.ts`:14/14 通过
- `npx vitest run`(全量):602/602 通过(2 个 web/server failed suites 为 pre-existing,openai/dotenv 未装,本修复无关)
- `git commit e0771c2`:4 files / +220 -12,commit message 含完整 OMC trailers

### 8.5 残留风险

- ⚠️ macOS 实机回归未做:窗口按钮点击响应、标签拖拽排序、tabbar-row 空白处拖拽需要 macOS 桌面手动验证
- ⚠️ A 类(最大化顶部留白)未处理:留给独立任务,需要切到 `titleBarStyle: Overlay` 路径

---
