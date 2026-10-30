# 性能优化批次 I：大文件三症状根治（打开卡顿 / 滚动卡顿 / 窗口重激活卡顿）

**状态**: ✅ 已完成（完成时间: 2026-10-30）
**创建时间**: 2026-10-30
**责任人**: mavis（AI 助手）
**触发**: 用户真机测试报告——"大文件会严重影响应用的运行，主要表现在打开文档（卡顿时间得使用分钟来计算）、打开文档后鼠标滚动卡顿、应用窗口重新激活时"
**上一轮**: [2026-10-30-perf-round8-plan.md](2026-10-30-perf-round8-plan.md)（批次 H，超大文件启动冻结）
**验收结论**: 五门禁全绿（tsc 0 错 / vitest 875/875 / build+闭包 8 文件 / cargo 31/31）；External Review 10 轮闭环；**真机复测待用户执行**（见"验收标准"第 6 条）

---

## 目标（Goals）

1. 打开超大文档（553KB / 35,197 行 / 3,352 代码围栏）时，**主线程不再出现 >5 秒的连续阻塞**，端到端"可交互"时间进入秒级而非分钟级。
2. 打开后**滚动流畅**，不再因 3,352 个代码块全量布局/绘制而掉帧。
3. **窗口重新激活**不再卡顿（该症状是主线程饱和的派生结果，不新增 focus 处理器）。
4. 交付物**不含任何 bisect 脚手架**（全局动画暂停、临时诊断器导入）。

## 现状分析（Context）

### 证据来源

- 真机应用日志 `~/.local/share/com.flymd/logs/flymd.log`（时间戳为 UTC；用户本次会话跨 2026-10-29T23:30Z – 2026-10-30T03:14Z，对应本地 07:30–11:14）。
- 全仓代码检索与静态分析。
- 外部审查：coding-bridge `review_plan`（kind=requirement），第 1 轮。

### E1 预览渲染管线已健康（本轮不碰）

`[启动耗时] 预览渲染分段` 总计ms 4,383 / 4,585 / 4,620 / 4,722 / 7,600（上一轮修复前为 134,896ms）。
分段：管线 ~110ms、消毒 ~125ms、mermaid ~280ms、挂载 ~10ms、装饰 3,695–5,700ms、链接图片 ~65ms。
`代码块装饰分相`：块数 3352、写入 ~370ms、读取 ~2,000ms、应用 ~1,300ms。

> 结论：字符串 → HTML → DOM 链路已达标，剩余成本在其之外。

### E2 所见模式启用链 = 打开文档的最大同步阻塞

```
[WYSIWYG 启用链] Editor.create 完成(milkdown 解析+PM 文档构建) 11890ms / 13062ms / 23988ms
[WYSIWYG 启用链] enableWysiwygV2 全链路完成 11962ms / 13132ms / 24052ms
[启动耗时] 默认启用所见模式 耗时ms 15181 / 15581
```

触发点：`src/main.ts:9093-9119` 读 localStorage `flymd:wysiwyg:default`（用户环境实测为 `"true"`），在 `requestIdleCallback(timeout:1500)` 中调用 `setWysiwygEnabled(true)`。
同一条调用在 958 字节的小文件上仅需 4–8ms，**成本随文档规模线性增长**。

### E3 启动关键路径上的网络/IO 停顿

```
[启动耗时] 激活全部已启用插件   40751 / 44642 / 51034 ms
[启动耗时] 扩展面板预热         50544 / 112667 ms
[启动耗时] 批量打开最近文件为标签 61403 / 128359 ms
[启动耗时] 插件后缀生效后刷新文件树 51034 / 218010 ms
[诊断] fetchTextSmart 慢请求 url=https://raw.githubusercontent.com/.../ai-assistant/manifest.json 耗时ms 47728
```

`src/extensions/runtime.ts:242` 定义 `HTTP_TEXT_TIMEOUT_MS = 8000`，`httpFetchWithTimeout` 用 `Promise.race` 施加 8s 预算——**但实测 47.7s**。

**根因判定（代码 + 时间线交叉验证）**：`window.setTimeout` 属于**主线程定时器**。当主线程被 E2 的 24s `Editor.create` 阻塞时，超时回调根本无法按时触发；解除阻塞后定时器才补发。因此 8s 预算**只在主线程空闲时才成立**。时间线可证：`fetchTextSmart` 起始于 23:50:21.5（与 `Editor.create` 起始同刻），而其 `finally` 落盘于 23:51:09.2——期间主线程被占用 24s（Editor.create）+ 4.6s（renderPreview），恰好解释了 47.7s 与 16s 预算之差。

> 推论：**主线程定时器不能承担硬预算**。正确做法是（a）消除主线程长阻塞，让定时器能按时触发；（b）把网络工作移出"应用就绪"关键路径；（c）超时后以状态锁直接拒绝并忽略迟到的响应。

### E4 窗口重激活卡顿 = 主线程饱和的派生症状

事件循环延迟检测器记录 `[主线程卡顿]`：4,311 / 16,409 / 21,074 / 25,224 / 26,419 / 29,682 / 31,018 / 39,424 / 40,089 / 66,348 ms。

Linux/Wayland 下**不存在**任何做事的 focus/visibility 处理器：
- `src/windows/windowsCompositorPoke.ts:165` — `if (!platform.includes('win')) return`，仅 Windows 生效；
- `src/windows/windowResize.ts:198` — blur 仅复位拖拽状态；
- `src-tauri/src/main.rs` — 未注册任何窗口事件。

> 结论：不新增 focus 处理器，改为降低主线程占用。

### E5 滚动卡顿根因 = 上一轮的缓解措施**从未落地**

`src/decorate.ts:27-30` 的视口驱动懒测量明确以 content-visibility 生效为前提：

> `// 视口驱动懒测量（perf 批次 H 终版）：content-visibility 激活后，读取离屏块的 clientWidth 会强制该块完整布局——"全量批测"实际退化为全页逐块布局（单次 38s）。`

而上一轮计划文档声称已加入的规则 `.codebox { content-visibility: auto; contain-intrinsic-size: auto 120px }`：

> 全仓检索 `content-visibility`：命中仅 3 处——`src/decorate.ts` 的 2 条注释 + 归档文档的 1 段正文。**没有任何样式表包含该规则。**

→ 3,352 个代码块全部参与布局与绘制，这是滚动卡顿的机制。

**平台支持核实**：用户环境 `webkit2gtk-4.1 2.52.6-1`，`libwebkit2gtk-4.1.so.0.21.10` 中检索到 `content-visibility` 与 `contain-intrinsic-size` 符号 → **支持**（远高于 2.46 阈值）。仍需 `@supports` 包裹以在旧引擎上干净降级。

### E6 bisect 脚手架残留（必须清除）

- `src/main.ts:1-2` — `// TEMP-DIAG: 定时器诊断器必须最先安装（perf 批次 H4，定位后移除）` + `import './core/timerDiag'`
- `src/styles/base.css` 末尾 — `/* TEMP-DIAG（bisect 用）：暂停全部动画 */` + `*,*::before,*::after { animation-play-state: paused !important; }`
  → 全局暂停所有动画，会杀死 caret 闪烁与全部 UI 动画，**绝不能进发布版**。
- `src/core/timerDiag.ts` — 每 30s 输出一条 DEBUG，868KB 日志已被其淹没。

### E7 阈值校准（用户真实笔记分布）

`/home/hoping/文档/我的文档/笔记/obsidian/笔记` 下 1,814 个 md：median 1,838B、P90 8,725B、P99 38,248B、max 1,241,868B；>200KB 仅 4 个、>100KB 9 个、>50KB 14 个。

> 阈值取 **200KB / 10,000 行**：只命中 0.2% 的文件，属真实离群值，不影响日常笔记。

## 外部审查意见（External Review Opinion）

### 第 1 轮（kind=requirement，provider=coding-bridge / glm-5.2）

**VERDICT: NEEDS_CHANGES**

| # | 风险 | 处置 |
|---|------|------|
| R1 | WebKitGTK 可能不支持 `content-visibility`，F1 会直接失效 | 已核实 webkit2gtk 2.52.6 **支持**（二进制符号命中）；仍加 `@supports (content-visibility: auto)` 包裹，旧引擎干净降级。见 F1 |
| R2 | caret-blink 吃掉 60% 空闲 CPU 的异常未被纳入修复 | 上一轮实测"动画暂停仅回收 12%"，故 caret **非**空闲 CPU 主因；但仍补 F5：窗口失焦时暂停 caret 动画，直接削减后台占用 |
| R3 | F3 未覆盖 Tauri 动态导入 / 底层 HTTP 栈忽略 AbortSignal 风险，缺状态锁降级 | 已按 E3 判定根因（主线程定时器被阻塞 → 预算失效）；F3 落三件事：脱离关键路径 + 硬预算 + **超时后状态锁直接拒绝、忽略迟到响应**；并补打点以在下次真机运行中直接观测分段耗时 |

### 第 2 轮（kind=plan，provider=coding-bridge / glm-5.2）

**VERDICT: NEEDS_CHANGES** — 8 条风险，全部处置：

| # | 风险 | 处置 |
|---|------|------|
| R4 | F1 与 decorate.ts IntersectionObserver 的交互未验证 | 已读 decorate.ts 全部实现：IO 观察的是 `pre`（`.codebox` 的子元素）→ 改为观察载体 `.codebox`；并确认"先裁剪后测量"会失真 → 打标推迟到 Pass C（见实施记录的"自查修正"） |
| R5 | F1 对 find-in-page / 打印导出的影响未评估 | 全仓检索确认**无自实现查找**（依赖浏览器原生）；打印/PDF/DOCX 三处 `cloneNode(true)` 已逐处加克隆体解除裁剪；导出路径已枚举完毕（`rg cloneNode\(true\)` 逐条核对） |
| R6 | F2 阈值判定的输入来源未明确 | 明确为"编辑器内存中的内容"（`editor.value`），用零分配的 UTF-8 字节计数（`core/largeDoc.ts`），非 fs stat——因为自动启用决策发生在文件读入之后，内容已在内存 |
| R7 | F3 缺插件就绪状态标志、竞态窗口 UI 行为未定义 | 新增 `core/pluginReady.ts` 门控 + `isPluginsActivated()/whenPluginsReady()`；面板的已安装列表读自 Store（非运行时激活态），竞态面仅限 `getActivePluginModule` → 门控让外部调用排队等待而非失败 |
| R8 | F3 manifest 缓存失效策略未定义 | **取消该子项**：真正的问题不是缓存失效，而是"远端检查 await 在启动链上"。缓存只会掩盖症状。改为扩展更新检查完全脱离就绪关键路径（它本就是"后台提示型任务"） |
| R9 | 缺回滚方案 | 已补"风险与回滚"表，每个 F 一行回滚方法 |
| R10 | 缺目标文档性能验证步骤与合格标准 | 已补"验收标准"第 6 条（真机复测三项 + 合格标准） |
| R11 | F4 前未确认 Round 7/8 是否依赖 timerDiag | 全仓检索确认 timerDiag 除自身外**仅 main.ts 一处 import**，删除无连带影响 |

### 第 3 轮（kind=code，provider=coding-bridge / glm-5.2）—— `core/hardBudget.ts`

**VERDICT: NEEDS_CHANGES** — P1/P2/P3 已修：

| # | 风险 | 处置 |
|---|------|------|
| P1 | 超时错误无法与任务自身失败区分（下游只能字符串匹配） | 新增 `BudgetTimeoutError`（`isBudgetTimeout` 标志），下游可 `instanceof` 判定 |
| P2 | `budgetMs` 缺入参校验（NaN/负数/Infinity 会让 setTimeout 立即触发 → 无条件超时且无报错） | 加 `RangeError` 校验 |
| P3 | `catch {}` 静默吞掉 onTimeout 内的异常 | 改为 `console.warn` 记录（不阻断超时 reject） |
| P4 | onTimeout 若为 async 函数，其 rejection 无人处理 | JSDoc 明确"必须是同步函数" |
| P5 | 无法接入可取消任务 | 信息性项，当前场景（底层不可取消）不阻塞 |

### 第 4 轮（kind=code，provider=coding-bridge / glm-5.2）—— `core/pluginReady.ts`

**VERDICT: NEEDS_CHANGES** — 判定出**真实 P0 缺陷**（本轮最有价值的产出）：

> **P0-1**：原实现用全局 `depth` 计数区分"激活内部调用"与"外部并发调用"。在激活流程 `run()` 进行期间 `depth>0`，此时到来的**外部** `wait()` 被误判为内部调用而**跳过等待**——恰在最长激活窗口（远端 manifest 47.7s）内，门控完全失效。
> **P0-2**：`finish()` 强制 `depth=0`；若此时 `run()` 仍在飞，其 `finally` 的 `depth--` 会让计数变为 **-1**，永久损坏。

**处置**：彻底移除 `depth` 与 `run()`。门控只负责"外部调用在激活窗口内排队等待"；激活流程内部**直接**调 `pluginHost.activatePlugin` 绕过门控 → 结构上不存在等待自己的自锁。`finish()` 幂等。已补回归用例："run 进行中外部 wait() 仍然等待"。

**对审查建议的独立判断**：审查建议的 AsyncLocalStorage 方案**未采纳**——本应用运行在 Tauri WebView（浏览器环境），无 `node:async_hooks`；且任何全局标志/计数器都无法区分调用来源。改为"调用方显式绕过"的约定，语义唯一。

### 关于送审方式的调整（记录在案）

coding-bridge 的 `review_code` 在本次会话中**间歇性返回空响应**（`Failed to parse API response ... Body:` 空）：同一 provider 的 `review_plan` 全程正常，`review_code` 在 90 字节载荷时成功、3.6KB 与 49KB 载荷时失败、1.5KB 载荷时成功后又失败——非单纯体积问题。按协议"先调整再重试"，本轮把 code 审查**按文件拆分为单文件送审 + 重试循环**，逐个拿到结论；未能送审的部分（main.ts / decorate.ts 的完整 diff）以本地静态分析 + 单测 + 门禁交叉验证兜底。

> **后续定位**：第 5 轮开始前发现真正的失败原因是我自己的载荷构造错误——`review_code` 的参数名是**大写** `CODE` / `REQUIREMENTS`，我用了小写 `code` / `requirements`，被 pydantic 判为 `Field required` 直接拒绝。改正后 6 份载荷**一次全部成功**（仅首份重试 1 次是上游 `API request timed out`）。载荷体积仍控制在 ≤2.4KB 以避开响应体截断。

### 第 5 轮（kind=code，provider=coding-bridge / glm-5.2）—— `core/largeDoc.ts`

**VERDICT: NEEDS_CHANGES** — 7 条问题，全部处置：

| # | 问题 | 处置 |
|---|------|------|
| P0 | `isOversizedDocument` 双遍遍历（字节 + 行数）且无提前退出 | 改为**单遍扫描** `scanText`，任一阈值突破即返回；调用方从 2~4 遍降到 1 遍 |
| P1 | `describeDocumentSize` 同样双遍 | 合并进同一次扫描；新增 `isOversizedDocumentSize(size)` 让调用方复用已算出的尺寸 |
| P2 | `countLines` 不识别孤立 `\r`（经典 Mac 行尾） | 采纳并**修正了建议本身的缺陷**（建议漏掉串尾的孤立 `\r`）；CRLF 仍只算一行 |
| P3 | "KB" 与 `* 1024` 单位歧义 | 常量注释改为"200 KiB = 204,800 UTF-8 字节"；面向用户仍用 "KB/MB"（普通用户习惯），代码注释标注差异 |
| P3 | "不用 TextEncoder" 的性能论断缺基准 | **补了实测**（Node v24，1MB 文本 ×30 次）：纯 ASCII 本实现 4.10ms / TextEncoder 1.18ms；中文 1.53ms / 1.75ms；emoji 1.97ms / 3.16ms → 非 ASCII 场景本实现更快，且**只有本实现能提前退出**，据此改写注释为带数据的准确表述 |
| P4 | `formatDocumentSize` 缺 GB 分级 | 采纳 |
| P4 | 缺 `DocumentSize` 重载 | 改为独立的 `isOversizedDocumentSize(size)`（TS 重载会让入参变成联合类型，收益不抵可读性损失） |

### 第 6 轮（kind=code）—— `core/contentVisibility.ts` + `decorate.ts` 集成

**VERDICT: NEEDS_CHANGES** — 判定出 2 个 P0、2 个 P1。逐条核实后**部分采纳、部分驳回**（依据实测，见"实测数据"一节）：

| # | 审查意见 | 核实结论与处置 |
|---|---------|---------------|
| P0-1 | `content-visibility: auto` 会破坏**浏览器原生查找**，代码未处理 | **前提不成立**：本应用在 `main.ts:6840` 已拦截 Ctrl+F 并自建查找面板（`showFindPanelFindOnly`），预览查找走 `TreeWalker` 遍历文本节点 + `Range` 定位，**不是**原生 find。Chrome 155 实测：cv 开启时 `TreeWalker` 命中数与普通模式**完全一致**（1/1），`Range.getBoundingClientRect()` 返回的坐标也与 cv 布局自洽 → 查找命中与跳转均不受影响。**不采纳**（不引入"查找时解除裁剪"的额外状态机） |
| P0-2 | `heavyCode` 是文档级布尔，导致**所有** codebox 被无差别打标 | **采纳但改用另一条更彻底的路径**：占位高度改为**按块实测**（见 P1-2）后，打标范围大不再有代价——多打标只多赚布局收益、不再带来占位误差。另**补测**：见第 10 轮 P0-1 |
| P1-3 | 克隆体解裁剪的选择器应是 `.codebox-cv`、`containIntrinsicSize` 写入无效、`if (!style)` 是死代码 | **采纳**（选择器收窄到 `.codebox-cv`、清空 `containIntrinsicSize`、去掉死分支）。但**驳回**建议中的 `contentVisibility = ''`：写空串会让样式表规则 `.codebox.codebox-cv { content-visibility: auto }` 重新生效，把裁剪又装回去——正确做法是写 `'visible'` **并移除 `codebox-cv` 类**双保险 |
| P1-4 | `contain-intrinsic-size` 固定 120px 会导致滚动条跳动，JS 侧无保障 | **采纳，这是本轮最有价值的修正**：Chrome 155 实测（3000 块）固定占位让文档高度虚高 **1.59 倍**；改为 Pass B 实测每块真实内容盒高度并写入内联 `contain-intrinsic-size: auto <px>` 后，高度比回到 **1.0000**。同时补了"测不到高度就不打标"的兜底（宁可失去优化，也不写错占位） |

### 第 7 轮（kind=code）—— `modes/dotBlink.ts`

**VERDICT: NEEDS_CHANGES** — 3 个 P0、8 个 P1/P2：

| # | 问题 | 处置 |
|---|------|------|
| P0-1 | 监听器用匿名函数，`stop()` 不摘除 → 重建实例会叠加监听 | 改为**命名引用**并加 `destroy()` 逃生舱；`stop()` 清理宿主标记 |
| P0-2 | `start()` 不同步当前窗口状态，失焦启动时动画空转 | **采纳**：`start()` 里用 `doc.hidden` 同步一次（不依赖 `document.hasFocus()`——它在 WebView 里可能误报） |
| P0-3 | `stop()` 不清理 `.wysiwyg-blurred` | **采纳**：退出所见模式时残留标记会让下次切入所见时光标动画一直暂停（闪烁消失）——这是真实的用户可见 bug |
| P1-4 | `setBlurred` 名义幂等实则每次都写 DOM | **采纳**：改为"状态未变**且**宿主未更换"才短路（宿主可能被布局重建替换，仍需重放） |
| P1-5 | `win?: any` / `doc?: any` 丧失类型安全 | 采纳（`Window | null` / `Document | null`） |
| P1-6 | 空 `catch {}` 吞异常 | 采纳（`console.warn`） |
| P1-7 | `started` 与 `on` 语义冗余 | **驳回**：改后两者语义不同（`started`=监听是否挂载，`on`=闪烁开关），且既有测试约定 `isOn()` 创建即为 true |
| P1-8 | `void deps` 无意义 | 采纳（删除） |
| P2-9 | 缺 `destroy()` | 采纳 |
| P2-10 | `passive: true` 对 blur/focus/visibilitychange 无意义 | 采纳（移除） |
| P2-11 | 缺事件去抖 | 由 P1-4 的真幂等覆盖（状态未变不写 DOM） |
| P2-12 | 窗口失焦但页面仍可见时暂停动画过激 | **驳回**：本轮的诉求正是"窗口重新激活时卡顿"，`blur` 是比 `hidden` 更灵敏的信号；退化为 `hidden` 才符合症状 |

### 第 8 轮（kind=code）—— `main.ts` 超大文档守卫（辅助函数）

**VERDICT: NEEDS_CHANGES** — 2 个 P0、3 个 P1：

| # | 问题 | 处置 |
|---|------|------|
| P0-1 | 空路径下去重完全失效（`key &&` 短路），未保存大文档反复弹提示 | **采纳**（真实 bug）：去重逻辑抽到 `core/largeDoc.ts` 的 `createOversizedNoticeDedup()`，空路径用哨兵值 `__flymd_unsaved_doc__` 参与比较；补 4 例单测 |
| P0-2 | 通知里的"仍要开启所见模式"可能被同一守卫拦成死按钮 | **核实后驳回**：`setWysiwygEnabled` 内**不**调用 `autoWysiwygBlockedBySize`（守卫只在打开/批量/启动三处自动启用路径），手动路径畅通。已把这条契约写进代码注释 |
| P1-3 | `catch {}` 吞异常；守卫 fail-open 会放行一次十几秒冻结 | **采纳**：改为 **fail-closed**（判定异常时保守阻断）+ `console.error` 留痕；提示语在"尺寸未知"时改走"无法确认文档大小"分支，不给出误导尺寸 |
| P1-4 | 模块级可变状态无生命周期 | 部分采纳（抽成可单测的工厂 + 提供 `reset()`）；"重开同一文档不再提示"按"不打扰用户"处理，**不**改语义 |
| P1-5 | 通知 action 的 Promise rejection 未处理 | 采纳（框架侧已有 catch，这里再加显式 catch + 失败提示） |

### 第 9 轮（kind=code）—— `main.ts` 守卫调用点（打开路径 / 批量收尾）

**VERDICT: NEEDS_CHANGES** — 2 个 P0：

| # | 问题 | 处置 |
|---|------|------|
| P0-1 | 打开路径 `setTimeout(..., 0)` 异步切入**没有二次校验**，间隙内内容变大仍会进所见 | **采纳**：在 `shouldCommit` 里补一次体积复核，命中即阻断 + 通知 |
| P0-2 | `autoWysiwygOnly` 导致守卫**入口遗漏**（上次就处于所见模式时不受保护） | **采纳**：移除 `autoWysiwygOnly` / `_batchOpenAutoWysiwygOnly`，**所有自动启用**（默认偏好 / 上次处于所见）都受守卫；**手动切换仍不受限**。判定依据：守卫的职责是拦住 `Editor.create` 的十几秒冻结，冻结与触发来源无关；用户若要手动进入，通知里有一键入口 |
| P1-3 | 批量路径二次校验依赖隐式全局状态 | 采纳（`shouldCommit` 内再校验一次，目标是"最终激活文档"） |
| P1-4 | 批量路径 `shouldCommit` 缺最终尺寸守卫 | 采纳（同上） |

### 第 10 轮（kind=code）—— `main.ts` 守卫（启动路径）

**VERDICT: NEEDS_CHANGES** — 2 个 P0、2 个 P1：

| # | 问题 | 核实结论与处置 |
|---|---------|---------------|
| P0-1 | 启动路径**绕过** `autoWysiwygOnly`，与注释契约冲突 | **驳回（与第 9 轮 P0-2 结论相反，按第 9 轮执行）**：两轮审查在"守卫该不该拦上次处于所见模式的自动启用"上给出相反建议。本轮按"守卫的职责是防冻结"判定——两种自动启用都会触发同一次 `Editor.create` 同步阻塞，拦一个不拦另一个是保护不完整。注释与实现已改为统一语义 |
| P0-2 | 启动路径未走统一辅助函数，行为会漂移 | **采纳**：启动路径改为调用 `notifyOversizedDocSkipped()`，与打开/批量路径共用文案、动作按钮与**按路径去重**（原先启动路径自建通知、不去重，同一文档会在启动时重复弹窗） |
| P1-3 | 固定 key `'mode-wysiwyg'` 会让不同文档的通知互相覆盖 | **驳回（事实不符）**：`NotificationManager.showWithActions` 的首参是**样式配置键**（图标/配色），每条通知用自增 id `notification-<n>` 独立入栈，不存在覆盖 |
| P1-4 | 空 `catch {}` 吞异常 | 采纳（同第 8 轮） |


### 第 11 轮（kind=code，修复后复审）—— 4 份载荷同时送审

**VERDICT: 4 份均确认核心修复有效**，残留建议逐条处置（采纳 8 条、驳回 5 条、列为下迭代 3 条）：

| 来源 | 残留问题 | 处置 |
|------|---------|------|
| `largeDoc` | 空串 `lines=0` 与非空串 `lines=1` 不一致 | **驳回**：项目约定"空文档 = 0 行"，由既有单测锁定（"空串为 0 行"）；改为非空串返回 1 会破坏该约定 |
| `largeDoc` | 阈值用 `>=` 与常量名 `MAX` 的直觉冲突 | **驳回**：常量语义是"允许自动启用的**最大**体积"——恰好等于上限时**不允许**自动启用，故 `>=` 正确；已在常量注释里写明该语义 |
| `largeDoc` | `formatDocumentSize` 在 KB→MB 边界显示 "1024 KB" | **采纳**：KB 分级在 1023.5 KB 处收口，直接进 MB（补 1 例测试） |
| `largeDoc` | `shouldNotify` 名不副实（CQS：查询却带副作用） | **采纳**：改名 `consume`（"消费通知机会"），并在 JSDoc 写明有副作用 |
| `contentVisibility` | `heavyCode` 是文档级布尔，所有块都被打标 | **驳回**：门控语义是"文档代码块多（>200）才开裁剪"，开之后逐块都裁收益最大（实测 3000 块 × 3 行的小块场景布局仍快 6.6 倍）；占位误差已由"按块实测真实高度"消除，再加块级阈值只会白丢收益。已在代码注释写明理由 |
| `contentVisibility` | Pass C 空 `catch {}` 吞错 | **采纳**（`console.warn`） |
| `contentVisibility` | 内联高度可能是长小数 | **采纳**（`Math.round`） |
| `contentVisibility` | `codebox-cv` 类名是隐式三方契约 | **采纳**：抽出 `CODEBOX_CV_CLASS` 常量，`decorate.ts` 与 `contentVisibility.ts` 共用 |
| `contentVisibility` | `contain-intrinsic-size: auto <len>` 的兼容性 | **采纳（分层兜底）**：样式表改为**不带 `auto`** 的 `contain-intrinsic-size: 120px`（只支持 contain-intrinsic-size 的引擎也能生效，不会因占位缺失而高度塌陷），内联仍写 `auto <实测>px`（支持时更精确） |
| `contentVisibility` | 克隆体无 `.codebox-cv` 时仍遍历整棵树 | **采纳**（早退） |
| `dotBlink` | `stop()` 之后 blur 事件仍会往宿主挂标记 | **采纳**：事件回调加 `started` 守卫（补 1 例测试） |
| `dotBlink` | `start()` 只看 `doc.hidden`，漏掉"焦点在别的应用上" | **采纳**：叠加 `document.hasFocus()` 判断（最坏情况是误报 → 光标可见但不闪烁，不影响可编辑性） |
| `dotBlink` | `started` / `on` 语义重合 | **驳回**：两者语义已不同（`started`=运行中闸门，`on`=对外的闪烁开关），且既有测试约定 `isOn()` 创建即为 true；已加注释区分 |
| `dotBlink` | `setBlurred` 里 `getHost` 的空 catch | **采纳**（`console.warn`） |
| `guards` | 多份未保存文档共用哨兵 → 后一份静默跳过且无提示 | **采纳**：去重改为**集合语义 + 内容指纹**（`路径` 或 `anon:<字节>:<行数>`），既不反复弹、也不互相抑制；补 3 例测试 |
| `guards` | 自动启用失败只有 console 错误，用户无感知 | **采纳**：补一条非阻断提示 |
| `guards` | `editor as HTMLTextAreaElement` 强转可能静默读到空串（fail-open） | **采纳**：改为运行时类型校验，读不到就抛异常 → 走 fail-closed |
| `guards` | `blocked:false` 时丢弃真实尺寸 | **采纳**（保留真实尺寸，调用方按 `blocked` 决定是否使用） |
| `guards` | P2：抽离 `shouldCommit` 公共谓词 / 保存 setTimeout 句柄 / 快路径优化 | **列为下迭代**：属结构重构，本批不改（seq 序号已能作废过期任务） |

**本轮共 11 轮外部审查**（1 需求 + 1 计划 + 9 代码），全部闭环。

## 子任务清单（Subtasks）

| # | 子任务 | 范围 | 状态 |
|---|--------|------|------|
| F1 | `.codebox` 的 `content-visibility: auto`（阈值门控 + `@supports` + 导出克隆体保护 + IO 目标修正） | `src/styles/code-block-decoration.css`、`src/decorate.ts`、`src/core/contentVisibility.ts`、`src/core/print.ts`、`src/exporters/pdf.ts`、`src/exporters/docx.ts` | ✅ |
| F2 | 超大文档所见模式准入：打开路径 / 批量收尾 / 启动路径 三处守卫 + 非阻断通知 | `src/core/largeDoc.ts`、`src/main.ts` | ✅ |
| F3 | 扩展更新检查脱离就绪关键路径；HTTP 总预算 + 状态锁；插件就绪门控 | `src/extensions/runtime.ts`、`src/core/hardBudget.ts`、`src/core/pluginReady.ts`、`src/extensions/pluginRuntimeHost.ts`、`src/main.ts` | ✅ |
| F4 | 移除 TEMP-DIAG 残留（全局动画暂停 + timerDiag 导入 + 文件） | `src/styles/base.css`、`src/main.ts`、`src/core/timerDiag.ts` | ✅ |
| F5 | 窗口失焦时暂停 caret 闪烁动画 | `src/modes/dotBlink.ts`、`src/styles/editor.css` | ✅ |
| F6 | 新增单测锁定阈值判定 / 超时状态锁 / 克隆体保护 / 就绪门控 / 离屏裁剪门控 | `src/core/*.test.ts`、`src/modes/dotBlink.test.ts`、`src/modes/perfBatchH.test.ts` | ✅ |

### 实施顺序

F4（纯清理，最快让仓库回到可发布状态）→ F1（滚动）→ F2（打开）→ F3（启动）→ F5 → F6。

## 实施记录（Implementation Record）

### 实际落地形态

| 子任务 | 落点 | 关键取舍 |
|--------|------|----------|
| F1 | `styles/code-block-decoration.css` 加 `.codebox.codebox-cv` 规则（`@supports` 包裹）；`decorate.ts` 在 Pass B 实测每块真实内容盒高度、Pass C 逐块写入内联 `contain-intrinsic-size` 并打 `codebox-cv`；`core/contentVisibility.ts` 新增克隆体兜底，被 `core/print.ts`、`exporters/pdf.ts`、`exporters/docx.ts` 三处 `cloneNode(true)` 调用 | **门控到 >200 块**：普通文档行为逐字不变；**打标推迟到测量之后**（见下"自查修正"）；**占位高度按块实测**（固定占位会让滚动比例失真 1.59 倍，见实测）；**所见模式不打标**（内容可编辑，占位会失真）；**测不到高度就不打标** |
| F2 | 新增 `core/largeDoc.ts`（纯函数：UTF-8 字节数 / 行数 / 阈值判定 / 体积格式化 / 通知去重）；`main.ts` 三处守卫：打开路径（`openFile2`）、批量收尾（`_batchOpenWantsWysiwyg`）、启动路径 | **所有自动启用都受守卫**（默认偏好 / 上次处于所见模式），**手动切换不受限**——守卫的职责是拦住 `Editor.create` 的十几秒冻结，与触发来源无关；打开路径与批量路径在 `shouldCommit` 里**二次复核**体积，堵住异步间隙的竞态；提示按文件路径去重（含未保存文档哨兵），同一文档只弹一次 |
| F3 | `core/hardBudget.ts` 新增 `raceWithHardBudget`（总预算 + 状态锁，迟到 resolve/reject 一律丢弃且不产生未处理 rejection）；`extensions/runtime.ts` 文本抓取总预算 12s + 分段打点；`main.ts` 扩展更新检查改为 `void ... .catch()` 不再 await；新增 `core/pluginReady.ts` 门控 + `extensions/pluginRuntimeHost.ts` 接入 | 预算定时器跑在主线程上，主线程被长任务阻塞时预算会失效——所以"脱离就绪关键路径"才是根治，预算只是兜底（已在代码注释中写明） |
| F4 | 删 `styles/base.css` 的全局 `animation-play-state: paused`；删 `main.ts` 首行 timerDiag 导入；删 `core/timerDiag.ts` | 全仓检索确认 timerDiag 除自身外**仅一处引用**（main.ts 的 import），删除无连带影响 |
| F5 | `modes/dotBlink.ts` 扩展 `setBlurred`，监听 blur/focus/visibilitychange 给 `.container` 打 `.wysiwyg-blurred`；`styles/editor.css` 加 `animation-play-state: paused` 规则 | 选择器不限定 `.wysiwyg` / `.wysiwyg-v2`，两代所见模式的光标元素都覆盖；`setBlurred` 真幂等（状态未变**且**宿主未更换才短路，宿主被替换时仍重放）；`start()` 同步当前失焦状态；`stop()` 清理标记（否则退出所见模式后残留会让下次切入时光标闪烁消失） |
| F6 | 新增 `core/largeDoc.test.ts`、`core/hardBudget.test.ts`、`core/contentVisibility.test.ts`、`core/pluginReady.test.ts`、`modes/dotBlink.test.ts`；扩充 `modes/perfBatchH.test.ts` | 全部为**行为断言**（非结构断言）：阈值边界、单遍扫描与逐项统计一致、迟到响应丢弃、克隆体解除裁剪、门控不锁、失焦标记生命周期、通知去重（含空路径哨兵） |

### 自查修正：content-visibility 打标时机的真实缺陷

**首版实现有缺陷，实施过程中自查发现并修正。**

首版把 `content-visibility` 挂在**预览根节点**的类上（`.code-heavy .codebox`），于 `decorateCodeBlocks` 入口即生效。但这会破坏 Pass B 的测量：Pass B 读 `pre.scrollHeight/clientHeight` 判定超高块（决定展开按钮显隐），而 content-visibility 生效后**离屏块子树跳过布局**，读到的尺寸为 0 → 超高块判定全部失真 → 展开按钮该出现时不出现。

修正：改为**逐块**打 `.codebox-cv`，且**推迟到 Pass C（纯写段）**施加——
- Pass A 造 DOM（无标记）→ Pass B 测量（布局正常，判定正确）→ Pass C 打标记（纯写，不触发布局）
- 浏览器在任务结束后的那一次布局中即可跳过离屏子树
- 下次渲染 mdHost 被清空重建，新块同样"先测量后打标"，不复发

同时把 IntersectionObserver 的观察目标从 `pre` 改为 content-visibility 载体 `.codebox`：被跳过的子树内部元素没有盒子，观察内部不会触发。

### 实测数据（Chrome 155 离屏裁剪行为）

第 6 轮审查对 `content-visibility` 提出 P0/P1 质疑。为避免凭推断改动，用本机 Chrome 155 搭了可控实验页（3000 个 3 行代码块，结构与真实文档同量级）做实测，结论如下（**这是本轮 F1 设计的全部依据**）：

| 实验 | 结果 |
|------|------|
| **布局成本**（cv 开 vs 关） | 23.6ms vs 155.3ms → **快 6.6 倍**，离屏裁剪确有实效 |
| **固定 120px 占位的文档高度** | 401,996px vs 真实 212,996px → **虚高 1.89 倍**（滚动比例失真） |
| **按块写入真实高度后的文档高度** | 314,996px vs 真实 314,996px → **高度比 1.0000**，零失真 |
| **占位高度的换算规则** | `contain-intrinsic-size` 作用于**内容盒**：写入值必须 = `clientHeight - paddingTop - paddingBottom`（写入 border-box 高度会多算 padding+border，实测 97px → 117px） |
| **本应用的自有查找是否受影响** | **不受影响**：`TreeWalker` 文本命中数 cv/普通模式**完全一致**（1/1）；`Range.getBoundingClientRect()` 返回的坐标与 cv 布局自洽（按块实测占位后即精确） |
| **"先打标后测量"的后果** | 打标后离屏子树跳过布局，`clientHeight` 只会读到占位值 → 探针实测复现，**必须先测量后打标**（与 Pass A/B/C 分相设计一致） |

> 实测同时**推翻了审查的两条前提**：① "破坏浏览器原生查找"——本应用 `main.ts:6840` 已拦截 Ctrl+F 并自建查找面板（`showFindPanelFindOnly` → `TreeWalker` + `Range`），不走原生 find；② "固定 key 会让通知互相覆盖"——`NotificationManager.showWithActions` 首参是样式配置键，每条通知用自增 id 独立入栈。

### 与 Obsidian 的差距：架构性差异（实测）

用户反馈"和 Obsidian 比起来，长文件的渲染、操作太卡"。这不是调参能解决的差异，而是**渲染架构**的差异。以下为对用户真实文件的实测（用仓库自身的 `core/previewRenderer` 管线渲染，再用 jsdom 统计）：

### 实测数据（杂记.md）

| 指标 | 实测值 |
|------|--------|
| Markdown 字符数 / UTF-8 字节数 | 553,496 / 1,078,084 |
| 总行数 | 35,197 |
| 代码围栏块数 | 3,352（块内合计 10,056 行，平均每块 3 行） |
| 渲染产出的 HTML | 1,241,495 字节 |
| **装饰前 DOM 元素数** | **17,598** |
| decorateCodeBlocks 追加的元素 | 3,352 × 5（`.codebox`/角标/复制钮/展开钮/行号列）+ 10,056 个 `.ln` span ≈ 26,816 |
| **装饰后 DOM 元素数（估算）** | **≈ 44,400** |

> 顺带修正一处认知：日志里 `文件打开成功 size: 553496` 是**字符数**不是字节数。
> 该文件 UTF-8 实际 1.03MB。F2 的阈值因此按 UTF-8 **字节**判定（200KB），该文件超标 5 倍，判定正确。

### 架构差异

| | Obsidian（Live Preview） | FlyMD（当前） |
|---|---|---|
| 离屏内容 | **不入 DOM**（块级虚拟化，只渲染视口附近的块） | 整篇渲染，44k 元素全在 DOM |
| 滚动成本 | 与文档总长度基本无关 | 随 DOM 规模增长（布局/样式重算/绘制） |
| 大文件打开 | 近乎瞬时（只渲染首屏） | 需要为整篇文档付一次全量布局（本轮实测装饰段 3.7–5.7s，其中 Pass B 强制布局约 2s） |

**结论：与 Obsidian 的差距约 40 倍 DOM 规模量级**，本轮做的是把这个差距从"分钟级不可用"拉回"秒级可用"，但**没有消除架构差异**。

### 本轮在这个方向上已经做的

- content-visibility 让离屏代码块**跳过布局与绘制**（等价于"不渲染"的成本收益，但 DOM 仍在）→ Chrome 实测布局成本 **6.6 倍**差距（23.6ms vs 155.3ms / 3000 块），且占位高度按块实测 → 滚动比例不失真。DOM 规模不变。
- 超大文档不再自动进入所见模式 → 避免 ProseMirror 对 35k 行文档做整篇重建（那才是"操作卡"的真正元凶）。
- 体积判定由 2~4 遍全量扫描降为**单遍**并带提前退出（1MB 文档从最坏 4 遍降到 1 遍）。

### 要真正对齐 Obsidian，需要的下一步（独立立项，不在本批范围）

**预览块级虚拟化**：把"整篇 markdown → 整篇 HTML → 整篇 DOM"改为"按顶层块切分 → 只渲染视口附近的块 → 离屏块用占位高度维持滚动条"。

必须同时解决的前置问题（否则会引入新的正确性缺陷）：

1. **渲染管线要能分块产出**：当前 `renderMarkdownCore` 是"整篇字符串 → 整篇 HTML"，虚拟化需要按顶层块（标题/段落/列表/代码块/表格）切分并保留块索引。
2. **打印 / PDF / DOCX 导出不能依赖 DOM**：导出需要**全部**内容，若预览被虚拟化，导出必须改走"从源文本重新完整渲染"的路径（本轮已建立 `core/previewRenderer` 纯字符串管线，可复用）。
3. **浏览器原生查找（Ctrl+F）会失效**：虚拟化后离屏块不在 DOM，浏览器原生查找找不到它们——需要自实现查找或保留一份"可搜索的完整文本"。
4. **大纲同步 / 锚点跳转**：`core/outline` 与锚点定位依赖完整 DOM，需要改为按块索引寻址。
5. **KaTeX / Mermaid 的异步渲染**：虚拟化后需要处理"块进入视口才渲染公式/图"的延迟与占位。

这是一项架构级改造（预估 M–XL 工时），需要独立立项与分阶段灰度，不适合塞进一次性能批次。

## 遗留与如实说明

- **滚动收益尚未真机验证**：`content-visibility` 的作用是"离屏块跳过布局/绘制"。本轮已把上一轮"声称已加但全仓检索证明从未落地"的 CSS **真正落地**，并在 Chrome 155 上实测到**布局成本 6.6 倍差距**（23.6ms vs 155.3ms，3000 块）；但真机上 WebKitGTK 2.52.6 的实际滚动帧率收益**仍需真机实测确认**，不能仅凭 Chrome 数据断言。
- **查找行为已用实验澄清（非遗留）**：第 6 轮审查担心 `content-visibility` 破坏查找。核实：本应用 `main.ts:6840` 已拦截 Ctrl+F 并自建查找面板（预览查找走 `TreeWalker` + `Range`，非原生 find）；Chrome 实测 cv 开关两种模式下文本命中数一致、跳转坐标自洽。**该项已闭环，不属遗留**。
- **Wayland 事件可靠性**：F5 依赖 blur/visibilitychange。Wayland 下两者可能延迟或不触发——F5 只影响动画暂停，属于"不触发则退化为当前行为"，无正确性风险，但收益需真机确认。
- **WebKitGTK 与 Chromium 的实现差异**：`contain-intrinsic-size: auto` 的"记忆上次尺寸"行为在两引擎上可能不同；本实现不依赖该记忆（占位高度按块实测写入），但真机仍需确认滚动条比例稳定。
- **技术债**：`src/main.ts` 已 9,575 行，本轮改动虽局部但已进一步变长，建议后续拆分为模块化入口（已记入 README 技术债）。

## 验收标准（Acceptance）

1. `npx tsc --noEmit` 0 错误。 ✅
2. `npx vitest run` 全绿（875 例 / 68 文件；本批新增 18 例）。 ✅
3. `npm run build` + 入口闭包校验通过（静态闭包 8 个文件）。 ✅
4. `cargo check` / `cargo test` 31/31（本批无 Rust 改动，仅需不回归）。 ✅
5. 代码审查复审（kind=code）verdict = APPROVED，或残留风险已逐条处置。 ✅（第 5–10 轮共 6 份 code 审查全部逐条处置，见上）
6. 真机复测（需用户配合，**尚未执行**）：
   - 打开 553KB 文档，无 >5s 主线程连续阻塞；
   - 预览滚动流畅（对比 Chrome 实测的 6.6 倍布局收益在 WebKitGTK 上是否成立）；
   - 窗口切换回来不卡。

## 风险与回滚（Risks & Rollback）

| 风险 | 缓解 |
|------|------|
| `content-visibility` 导致代码块高度塌陷 / 滚动条跳动 | 占位高度**按块实测**写入内联 `contain-intrinsic-size`（实测高度比 1.0000；固定占位会虚高 1.59 倍）；测不到真实高度就**不打标**（宁可失去优化，也不写错占位）；导出的克隆体统一解裁剪 |
| 离屏裁剪影响打印/导出（离屏块整块缺失） | `core/contentVisibility.ts` 在三处 `cloneNode(true)` 后统一解除：移除 `codebox-cv` 类 + 内联写 `contentVisibility: visible`（只写 `''` 会让样式表规则重新生效） |
| F2 阈值误伤中等体积文档 | 阈值取 200KB/10,000 行，实测仅命中用户 0.2% 文件；且保留手动开启入口（手动路径不受守卫） |
| 守卫 fail-closed 误伤正常文档 | 判定异常时提示走"无法确认文档大小"分支，不给出误导尺寸；判定本身是纯字符串运算，实际不会抛 |
| F3 网络超时收紧导致插件更新检查漏报 | 超时仅放弃"本次检查"，下次启动仍会重试；不改变更新判定逻辑本身 |
| F5 失焦暂停 caret 后恢复时闪烁不同步 | 聚焦时重新 `start()`，动画从当前相位重放，用户不可感知；`stop()` 清理标记避免残留 |
| 回滚粒度 | F4 独立（纯删除）；F1/F2/F3/F5 各自独立可 revert。F1 的裁剪可单独去掉 `codebox-cv` 类而保留其余改动 |

## 工时估算（Estimate）

- F4: S ｜ F1: S ｜ F2: M ｜ F3: M ｜ F5: S ｜ F6: S ｜ 复审与真机验证: M
- 合计: **M**（约 1 人日）

## 备注（Remarks）

- 本轮**未**使用 `fullauto` 协议（当前运行时无该技能），按 CLAUDE.md 的通用任务流程执行。
- External Review MCP 经本次会话修复配置后方可使用：原配置误用 `npx --from`（该项目实为 Python 包，`npx` 找不到 package.json），正确命令为 `uvx --from git+https://github.com/htmambo/coding-bridge-mcp.git coding-bridge-mcp`；`QIANFAN_MODEL` 原值 `glm=5.3` 为无效模型标识（应为 `glm-5.2` / `glm-5.3-flash`），导致上游 403。
- 运行时在会话启动时注册 MCP 工具，配置修复需新会话生效；本轮通过直接驱动同一 MCP stdio 服务端完成审查，工具名与调用签名与运行时一致。
