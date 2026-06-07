# Batch 11:抽离 titlebarStatus 状态镜像层

> 状态:✅ 已完成(完成 2026-06-08,经 Codex R2 复审 APPROVED)
> 提交:`743ec6c`(已推送 origin)
> 范围:Phase B 第十批 — main.ts 模块化拆分

---

## 目标(Goals)

继续 Phase B 拆分,把 main.ts 中 8 个"状态→DOM/OS 标题"同步函数聚类抽离到独立模块。共享 deps 注入模式,工厂先声明为 let null,DOM 查询就绪后再实例化,所有调用站点走可选链。

## 现状分析(Context)

- main.ts ~10050 行(本批拆分前),158 个顶层函数
- 候选 8 个函数共享 main-local 引用(editor/preview/mode/wysiwyg/.../lastScrollPercent),
  但自身不挂 DOM 事件,纯 getter/setter 注入即可独立测试
- 3 个 last* 缓存(标题/提示/OS 标题)需要闭包封装

## 子任务清单(Subtasks)

- **T1 ✅** `src/ui/titlebarStatus.ts` 新建:200 行,20 tests
  - refreshTitle / refreshStatus / syncToggleButton / setUpdateBadge
  - getScrollPercent / setScrollPercent / saveScrollPosition / restoreScrollPosition
- **T2 ✅** main.ts 接线:import + 工厂延迟实例化 + 90+ 调用站点 `?.` 可选链替换
- **T3 ✅** Codex R2 复审 + 4 个 nit 修复
- **T4 ✅** 验证:tsc 0 错误、test 427/427

## 实施细节

### 关键设计

1. **工厂延迟实例化** — `let titlebarStatusApi: ReturnType<...> | null = null`,等 4 个 DOM 元素
   (filenameLabel/status/editor/preview) 查询完成后再 `= createTitlebarStatus(...)`。
2. **可选链调用** — 所有 90+ 调用站点用 `titlebarStatusApi?.xxx()`,init 前调用静默跳过,
   无 null guard 噪声。比 `if (api)` 包装更轻量。
3. **依赖注入 contract** — getCurrentFilePath/getDirty/getMode/getWysiwyg getter + DOM 元素 + 
   t/fmtStatus/scheduleOutlineUpdate + getCurrentWindow(可选,只为 setTitle)。
4. **闭包封装** — 3 个 lastRendered 缓存 let 在 factory 内部,外部无感。
5. **三模式滚动** — edit/preview/wysiwyg 用 element 不同(preview/editor vs #md-wysiwyg-root .scrollView)。

### Codex R2 复审

- **R2** APPROVED — 0 blocker / 0 important
- 4 个 nit 全部修复:
  - editor 类型 `HTMLElement` → `HTMLTextAreaElement`(refreshStatus 依赖 textarea 接口)
  - `scheduleOutlineUpdate` 从可选改必填(refreshTitle 始终调用,降为可选是无意义的)
  - main.ts:1217 `titlebarStatusApi!` → `titlebarStatusApi?.`(与其他 90+ 处统一)
  - main.ts:9857 注释 typo 修复

## pre-existing 行为保留

- `refreshStatus` 状态栏:行/列/字数,fastInfo 优先 → slice 回退,clamp row/col 到 ≥1
- `setUpdateBadge(true, '发现新版本 v${resp.latest}')` 中文提示原样保留
- `setScrollPercent` clamp 到 [0,1] 范围
- `restoreScrollPosition` 重试机制:retries=3 delay 50/100/200ms 指数退避
- `syncToggleButton` 模式映射 edit→"预览" / preview→"编辑"(用 \u 转义符)

## 验证(Verification)

- `npx tsc --noEmit` → 0 错误
- `npm test` → **427/427 通过**(原 407 + 新增 20)
- main.ts 净 **-105 行**(10050 → 9945)

## 备注

- 教训:工厂模式 + DOM 依赖时,如果工厂想放在顶层,要么延后实例化(本批做法),要么用 lazy getter
- 教训:re.sub 批量替换前缀时要小心 `titlebarStatusApi.refreshStatus` 已被前缀的字段(wrapper),会产生 `titlebarStatusApi.titlebarStatusApi?.xxx` 双重 prefix
- 教训:`titlebarStatusApi` 在 line 100 时引用 line 1700+ 才声明的 DOM 元素,挪到 DOM 查询之后即可
- 收益:8 个状态镜像函数统一了缓存策略、滚动位置三模式分派、restore 重试机制,后续要在
  WYSIWYG 模式加第 4 种滚动元素只需改 1 处
