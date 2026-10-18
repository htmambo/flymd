# flymd 性能分析：启动速度与运行效率（2026-10-18）

**Status**: ✅ 完成
**范围**: 前端启动链路、Rust 后端启动、运行期编辑/渲染/滚动/缓存/监听
**方法**: 纯代码静态分析（三个并行只读调查），未做 GUI benchmark；影响估计基于代码路径与既有 fixture 规模推断
**前置文档**: [startup-bench-2026-09.md](../perf/startup-bench-2026-09.md)（大库启动修复基准，本文不重复其结论）

---

## 一、总体结论

- 前端分包纪律良好：mermaid(6.4MB)、milkdown(464KB)、katex、pdfjs、pinyin(296KB)、jspdf 均未静态进入口，懒加载边界守得住。
- Rust 后端 setup() 干净，无启动期重活；S3/reqwest client 不在启动路径。
- 最大瓶颈集中在三处：① 窗口 reveal 被一条长串行 await 链卡住（首帧时刻）；② watch 事件 → 全树重扫（2026-09 启动卡死的同款成本被挪到了运行期）；③ 预览/所见两条主链路都是全量处理，无增量、无虚拟化。
- 缓存卫生总体不错，多数缓存有上限；残留 `_pdfOutlineCache` 无上限、dotBlink 空转 interval。

---

## 二、启动速度

### P0-1 窗口 reveal 被串行 await 链卡住（全链路最大单一瓶颈）

- 位置：`src/main.ts:8573-8639`（链）、`src/main.ts:3187-3201`（reveal 本体）、`src-tauri/tauri.conf.json:222`（`visible: false`）
- 链路依次：`Store.load` IPC → 动态 import `libraryPrivate` → `refreshLibraryScopeCache` → **动态 import + init extensionsPanel（关键路径上拉取并执行扩展面板 chunk）** → `maybeAutoImportPortableBackup`（2 次 store.get）→ `getCompactTitlebar` → Promise.all×3 → `syncOutlineDockFromStore`（**启动时可能 store.set+save 写盘**，`src/ui/outlineDockUi.ts:211-217`）→ 3 个布局 set → `bindEvents` → 2×RAF → `show()` + `setFocus()` 两次串行 IPC
- 影响：WebView 早已渲染好 DOM，但用户看到窗口前要等 10+ 个串行 await、一次 chunk 加载、可能一次写盘、2 个窗口 IPC。冷启动估计 100–500ms+
- 改进：把 `revealMainWindowOnce` 提前到 `app.innerHTML` + `applySavedTheme` + `bindEvents` 之后（甚至先于 `initStore` 显示骨架）；`initExtensionsPanel` 实质只是 host 赋值（`src/extensions/extensionsPanel.ts:325-327`），可挪首帧后；多个 store.get 合成一个 `Promise.all`；`syncOutlineDockFromStore` 的补齐写盘延后到 idle

### P0-2 非 Windows 平台窗口过早显示（与 P0-1 叠加）

- 位置：`src-tauri/src/main.rs:2508-2512`（Linux/macOS setup 中直接 `show()+set_focus()`）、`main.rs:2496-2507`（Windows 是正确的：只留 2500ms 兜底，显示由前端首帧后触发）
- 影响：非 Windows 用户先看到数百 ms 空窗壳；同时让前端 `revealMainWindowOnce` 形同虚设——前端那条串行链的优化在非 Windows 上收益被部分抵消（窗口已先显示）。两处需一起修：后端改为「前端首帧后发事件显示 + setup 仅留兜底」。

### P1-3 入口体积与 preload 集合（两项白赚）

- 现状：入口 576KB(gzip 172KB) + preload（filetree 120KB、tauri 24KB、yaml 46KB、diff 8.5KB），首帧前解析执行 ~780KB minified JS
- `src/main.ts:772` 静态 import js-yaml，但 `yamlLoad` 只在延迟插件回调用（main.ts:8689）→ 改动态 import
- `src/core/frontMatter.ts:7` 同样静态 import js-yaml；`splitYamlFrontMatter`（纯字符串）与 `parseFrontMatterMeta`（才需要 yaml）拆成两个模块
- `src/dialog.ts:7` → `src/core/diffMerge.ts:13` 静态 import diff（仅文件监听冲突时用）→ dialog 改动态 import
- `src/main.ts:51` 静态 import `./fileTree`（120KB chunk），首个实际使用在 reveal 之后 → 可仿 `extensionsPanelFacade` 做异步门面（9 个 `fileTree.init` 调用点需逐一改）
- 影响估计：yaml+diff 约省 55KB；filetree 异步化再省 120KB 的启动解析

### P2-4 启动 IIFE 内重复 IPC 与可并行点

- `invoke('get_pending_open_path')` 调两次（main.ts:8643、8947）；`invoke('get_cli_args')` 两次（8887、8957）→ 合并复用
- main.ts:8908-8921：`restoreWindowStateBeforeSticky` → `ensureMinWindowSize` → `getFocusMode` → `toggleFocusMode` → `centerWindow()`，5 个串行窗口 IPC 且全部在标签恢复之前 → 并行化或挪首帧后 idle
- `pickRecentSetToOpen`（main.ts:4382-4413）：每个 recent 文件串行 `isDirectoryPath`+`statFileAnySafe`（最多 6 文件 ≈ 12 次串行 IPC）→ `Promise.all`
- `openRecentSetAsTabs`（main.ts:4427-4429）：N 个文件串行 `openFile2` → 首标签优先同步打开，其余后台流式打开

### P3-5 延迟加载覆盖面的残留项

- `prewarmExtensionsPanel`（main.ts:8869-8875，2s 后执行）：有市场缓存时会提前构建整个扩展面板 DOM，而 `showExtensionsOverlay` 本就有 `_extRenderedOnce` 首次打开兜底。用户从不开面板就白付一次 DOM 构建 + 市场索引解析 → 建议删掉或挂到首次点击扩展按钮
- `initOnlineAnnouncements`（main.ts:8654）：reveal 后立即发起官网网络请求，与标签初始化链竞争主线程 → 错后 1–2s
- 启动期日志打点 ~6 处 `logInfo` 排队 IPC（每次一次日志文件 open+write+close，见 `src/core/logger.ts:46-58`）→ 合并为单条
- `initExternalChangeWatcher()`（main.ts:9520）在模块顶层触发 `loadFileWatchPrefsFromStore`（store.get IPC）→ 挪进启动 IIFE

### 启动链路中确认健康的点

- 批量打开用 `openFile2(p, {quiet:true})` 跳过逐文件渲染，最终渲染由 150ms 去抖合并为一次（main.ts:3862-4242-4446）
- pinyin 302KB 首次打开命令面板才加载（`src/ui/commandPalette.ts:201` 动态 import）
- 无 Web 字体阻塞；module script 天然 defer
- CSS 218KB 是唯一 render-blocking 资源；`print.css`、`extensions.css` 等非首屏样式可拆出延迟注入（约省 10–30ms CSS 解析）

---

## 三、运行效率

### P0-6 watch 事件 → 全量缓存失效 → 全树重扫（运行期头号热点）

- 链路：`watch` 回调（`src/fileTree.ts:1681-1684`，250ms 去抖）→ `scheduleRefreshTreeFromWatch` → `refreshTree` → `invalidateDirDocPresenceScan()` 全清 + `prefetchDirDocPresence(root)` → `scan_dirs_doc_presence` 全树 walk（`src-tauri/src/main.rs:1826-2015`，MAX_ENTRIES=50000）
- 问题：库内**任何** create/modify/remove（含用户自己保存）都触发整树重遍历（每个 entry 一次 stat），且 `await prefetchDirDocPresence` 在 `renderRoot` 之前——扫描在渲染关键路径上。大库下外部批量改动（git checkout、导入一批文件）会产生连续多次全树扫描。这是 2026-09 修复的启动卡死同款成本，被 250ms debounce 和 spawn_blocking 掩盖成了运行期卡顿
- 改进：按事件路径做增量失效（`invalidateDirDocPresenceScan(prefix)` 已支持前缀清理但调用方没传）；把 prefetch 移出 `renderRoot` 关键路径（先渲染、扫描结果到了再补 hint，缓存语义本就允许 miss→懒检查）

### P0-7 预览 = 全文渲染 + 全量 DOM 替换，无增量、无虚拟化

- 位置：`src/main.ts:2718-3052` renderPreview（150ms trailing debounce，main.ts:2699-2715）
- 单次调用成本链：所见光标注入 3 趟全文逐行扫描（2743-2828）→ 预处理 4 趟全文扫描（2840-2860）→ `md.render`（全文 tokenize + 每代码块同步 hljs，main.ts:2606-2632）→ `buf.innerHTML = safe` → `scanTaskList` 全文正则（2883-2884，每次渲染都跑）→ `mdHost.innerHTML=''` + appendChild（旧预览 DOM 全量拆除，大文档最疼的一下）→ 之后 3 次全 DOM 遍历（enhanceFootnotes/decorateCodeBlocks/a[href]/img[src]）→ 大纲重建
- 冗余：`decorateCodeBlocks` 在 2906 和 3048 各调一次（靠 `data-codebox=1` 守卫跳过，属于冗余查询）
- 改进：① 块级「源文本哈希 → HTML」缓存，未变块复用；② `scanTaskList` 仅在含 task-list 且签名变化时执行；③ 合并多次 DOM 遍历为一次；④ 删 3048 冗余调用；⑤ 长远做可见区分块挂载

### P0-8 所见模式：每次击键全文序列化 + 多趟全文处理 + 全量回写比对

- 链路：ProseMirror transaction → `lm.markdownUpdated`（`src/wysiwyg/v2/index.ts:830-872`，**每事务触发，无 debounce**）→ 全文图片正则 → 4 个全文转义还原 replace → `restoreEscapedDollars`（最坏 O(k²)）→ `unprotectExcelDollarRefs` + `normalizeTabIndentText` → `combined !== editor.value` **全量字符串比较** + 全量赋值（触发 value hook → rAF commonPrefix/Suffix diff O(n)，`src/modes/sourceLineNumbers.ts:768-772`）
- 即所见模式每敲一个字 ≈ 1 次全文 remark 序列化 + 5~6 趟全文扫描 + 1 次 O(n) 比较。大文档打字手感的首要瓶颈
- 改进：markdownUpdated 后续处理做 rAF/100ms 合并；各 pass 加 `includes` 快跳前置；先比引用/长度再全量比对

### P0-9 含块级 `$$` 的文档：每次编辑后 240ms 整篇 ProseMirror 重建

- 位置：`src/wysiwyg/v2/index.ts:824-828`（每次事务重置定时器）→ `scheduleMathBlockReparse`（2191-2224）：全文序列化 + `tr.replace(0, docSize)` 全量重建 + 手动恢复选区。代码注释自述「任何编辑都触发，表现为光标瞬间跳到底部」
- 改进：用 transactions 的 changed range 定位 math_block 局部 dispatch，仅事务触及 math 节点时触发

### P1-10 S3 命令每次调用重跑 aws-config provider 链 + 丢连接池

- 位置：`src-tauri/src/main.rs:568-585`（upload_to_s3）、`main.rs:816-837`（delete）：每次 `aws_config::defaults(BehaviorVersion::latest()).load().await` + 新建 Client
- 问题：`load()` 每次走默认 provider 链（环境变量、~/.aws 探测、latest 行为下还可能探测 IMDS 169.254.169.254，本机无该路由时超时可放大到数百 ms）；client 不复用 → 每次全新 TCP+TLS
- 改进：按 endpoint+credentials 缓存在 `tauri::State`

### P1-11 多路全库 recursive watch 叠加

- fileTree 自身 1 路整库 watch（`src/fileTree.ts:1681`）+ 每插件可 `watchLibrary` 再加 1 路（`src/extensions/pluginHost.ts:1456-1484`）+ openFileWatcher 每文件 1 路非递归（`src/core/openFileWatcher.ts:249-263`）
- Linux/inotify 下 watch 数随插件数×库规模线性增长；切库时 watch 建立延迟可达数百 ms；事件最终都联动 P0-6 的全树重扫
- 改进：所有消费方复用同一路整库 watcher，前端统一分发

### P1-12 滚动路径两处无节流/每帧全量查询

- 分屏滚动同步（`src/modes/sourcePreviewSplit.ts:274-283`）：scroll 事件里直接读写布局，无 rAF 合帧，scrollHeight 读 + scrollTop 写交叉迫使同步布局
- 所见模式代码块覆盖层（`src/wysiwyg/v2/index.ts:1794-1798` → 1884 起）：每帧 `querySelectorAll('pre')` 全量 + 逐 pre `getBoundingClientRect`。改进：overlay 改纯 CSS 定位或 IntersectionObserver 只处理视口内 pre

### P1-13 reqwest::Client 每个命令新建

- `http_xmlrpc_post`（main.rs:1497）、`flymd_piclist_upload`（main.rs:1726）、`check_update`（main.rs:2712）、`download_file`（main.rs:2807）各自 `Client::builder().build()`，连接池全丢，每次调用多 1-RTT 握手
- 例外：`ai_novel_api`（main.rs:1577-1623）有意 http1_only + 重试时 `std::thread::sleep` 阻塞 async worker → 改 `tokio::time::sleep`

### P2-14 行号栏 remeasure 写读交叉（缩放大文档时爆发）

- `src/modes/sourceLineNumbers.ts:277-284`：`probe.textContent=...; probe.offsetHeight` 在循环里逐行交替写读 = 每行一次强制 reflow。正常打字只测 1 行无碍，但 `remeasureAll` 被 `flymd:uiZoom:changed` 触发，而 Ctrl+滚轮每 tick 都派发该事件（`src/core/uiZoom.ts:96-107`）——大文档缩放手一滑就是几万次强制 reflow。对照 `src/decorate.ts:30-40` 的批量写法就是正确范式

### P2-15 持久化写放大

- 会话自动保存（`src/tabs/integration.ts:32,268-274`）：**每 5s** 把全部标签状态（含 dirty 标签的完整内容快照）`JSON.stringify` 塞 localStorage。多标签 × 大文档易顶到 5–10MB 上限
- docPos（`src/core/docPosition.ts:137-154`）：400ms debounce 后把**整个库**的 docPos map 序列化写 local.json
- 自动保存/复选框（`src/core/autoSave.ts` + main.ts:1692）：全量写盘；连点任务复选框 = 连续全量写。增量写或按 key 写可解

### P2-16 缓存卫生残留

- `_pdfOutlineCache`（`src/modes/outline.ts:83,557`）：`Map<path, items>` 只增不删，无上限无淘汰 → 加 LRU（如 20 条）
- mermaid 缓存按条数（300）而非字节，300 个大图可达几十 MB → 可加字节上限
- dotBlink 的 800ms interval（`src/modes/dotBlink.ts:30-33`）只翻转布尔（闪烁由 CSS 驱动），纯空转 → 删除 interval
- windowsCompositorPoke 的 4 个 Tauri 事件 unlisten 句柄被丢弃（`src/windows/windowsCompositorPoke.ts:152-191`），stop 语义不完整

### P3-17 其他主线程长任务

- highlight.js 同步高亮在 md.render 内（main.ts:2606-2632），大文档多代码块时最重一段 → 按块 rIC 切片后异步补高亮
- mermaid 未缓存图顺序 `await render`（main.ts:432-445），多图首次打开顺序阻塞 → Promise.all 并发
- forPrint KaTeX 一次性同步循环（main.ts:324-336），导出场景可接受
- `refreshStatus` 兜底路径 O(n)（`src/ui/titlebarStatus.ts:93-111`）：fastInfo 缺失（启动 800ms 内或用户关行号）时每帧 `value.slice(0,pos).split('\n')`

### 确认健康的点（保持现状）

- KaTeX 时间切片 + 输入让路（main.ts:339-375）、LRU 1500
- Mermaid SVG LRU 300 + 版本失效
- 行号 gutter 增量 patch + 可见区虚拟化
- 大纲滚动同步 offsetTop 缓存 + 二分 + rAF
- 外部文件监听 mtime+size 快照 + ≤1MB 才 SHA-1 + 200ms 去重 + 自写抑制窗
- PDF 视图缓存 max 4，淘汰时真正释放 iframe
- 预览消毒生产默认关闭、图片懒加载
- scan_dirs_doc_presence 实现本身合格（spawn_blocking、follow_links(false)、skip 名单、MAX_ENTRIES）；问题在调用频率不在命令内部

---

## 四、改进路线建议（按投入产出比）

| 批次 | 内容 | 预期收益 | 改动量 |
|---|---|---|---|
| 1 | yaml/diff 动态 import 移出 preload；合并重复 IPC；`revealMainWindowOnce` 提前 | 首帧 -100~300ms | 小 |
| 2 | watch 事件改前缀增量失效 + prefetch 移出渲染关键路径 | 大库运行期卡顿显著缓解 | 中 |
| 3 | 非 Windows 窗口显示时机与前端首帧对齐（配合批次 1 才完整生效） | 消除空窗壳 | 小 |
| 4 | markdownUpdated 合并 + renderPreview 趟数收敛（scanTaskList 条件化、DOM 遍历合并、删冗余 decorate） | 大文档打字/预览流畅度 | 中 |
| 5 | S3 client 缓存、reqwest 共享 client、watch 合并 | 功能响应延迟 | 中 |
| 6 | math block 局部重解析、块级渲染缓存（长远） | 所见模式长文档体验 | 大 |

注：批次 1+3 需一起上线，否则非 Windows 上窗口早已显示，前端 reveal 提前的收益体现不出来。

## 五、验证方法建议

- 首帧时刻：窗口 `visible:false` 下，用 `performance.measure` 量 `flymd-app-start` → `win.show()` 的间隔；main.ts 已有 `timedStep`/`[启动耗时]` 埋点（main.ts:2686-2694）可直接采样各段耗时
- 运行期：大库 fixture（`/tmp/flymd-perf-bench/library-1000/`，见 9 月基准文档）+ DevTools Performance 录制打字/滚动/外部改动场景
- Rust 命令耗时：`scan_dirs_doc_presence` 已有 eprintln 开发日志；S3 命令可加临时计时
