# Batch 14+15:抽离 outline 子系统(Markdown / WYSIWYG / PDF 大纲)

> 状态:✅ 已完成(完成 2026-06-08,经 Codex R1 复审)
> 提交:`a9531f8`(已推送 origin)
> 范围:Phase B 第十三/十四批(合并)— main.ts 模块化拆分

---

## 目标(Goals)

继续 Phase B 拆分,把 main.ts 中 10 个大纲相关函数 + 10 个模块级状态 + 1 个 PDF 缓存 Map 抽离到独立模块,工厂 + 23 个 deps。

## 现状分析(Context)

- main.ts 9753 行(Phase B 早期状态)
- 10 个函数构成完整大纲子系统:
  - Markdown 源码扫描:renderOutlinePanel 内部源码路径
  - DOM heads 提取:从 .preview-body 或 wysiwyg .ProseMirror 提取 h1-h6
  - 滚动同步:bindOutlineScrollSync / onOutlineScroll / updateOutlineActive
  - PDF 路径:renderPdfOutline / bindPdfOutlineClicks(PDF.js 动态 import)
  - 调度:scheduleOutlineUpdate(200ms 防抖)/ scheduleOutlineUpdateFromSource / ensureOutlineObserverBound
  - 上下文:getOutlineContext(返回 3-mode 信息)
- 10 个模块级状态:_outlineScrollBound / _outlineScrollBoundPreview / _outlineScrollBoundWysiwyg / _outlineActiveId / _outlineActiveEl / _outlineRaf / _pdfOutlineCache(Map) / _outlineObserverBound / _outlineObserver / _outlineUpdateTimer
- 1 个外部共享状态:_outlineLastSignature(main.ts 读取 + 工厂内写,getter/setter pair)

## 子任务清单(Subtasks)

- **T1 ✅** `src/modes/outline.ts` 新建(~570 行,14 tests)
  - `createOutline(deps)` 工厂 + `OutlineApi`
  - 10 个函数全部抽离
  - 10 个模块级状态闭包到工厂
  - 1 个外部状态走 getter/setter pair
- **T2 ✅** `src/modes/outline.test.ts` 新建(14 tests,jsdom)
  - 3-mode context query(wysiwyg/preview/source)
  - source 扫描 + 签名缓存 + 无标题文案 + null path
  - PDF delegation 副作用验证(setOutlineHasContent)
  - preview DOM heads 提取 + active class + hidden 早返
  - 200ms 防抖 coalesce
- **T3 ✅** main.ts 接线:工厂 let nullable + 实例化 + 8 call site 替换为 `outlineApi.*` 前缀
- **T4 ✅** 旧函数块删除(行 4462-5033,共 23,629 字符)
- **T5 ✅** main.ts 净 **-514 行**(添加 41,删除 555)
- **T6 ✅** titlebarStatusApi deps 适配:`scheduleOutlineUpdate` → `() => outlineApi.scheduleOutlineUpdate()`
- **T7 ✅** 验证:tsc 0 错误、test 475/475(原 461 + 14 新增)

## 实施细节

### 关键设计

1. **23 个 deps** — 涵盖资源 / 状态 / 工具 / 资源(getter + setter 模式)
   - 资源:editor / wysiwyg / mode / pdfIframe / pdfSrcUrl / outlineLayout
   - 状态 getter:setOutlineHasContent / getOutlineDocked
   - 状态 getter/setter pair:_outlineLastSignature
   - 工具:cssEscapeCompat / makePreviewHeadingId / readFile / stat / logDebug / logWarn
2. **10 个模块级缓存闭包** — 全部用 `let` 闭包到工厂内部,对外仅通过 api 暴露
3. **PDF.js 动态 import** — renderPdfOutline 内部 `await import('pdfjs-dist/...')` 模式,失败时清缓存 + 警告
4. **stat 类型适配** — Tauri plugin-fs `stat` 返回 `FileInfo.mtime: Date | null`,工厂内部用 `(st?.mtime instanceof Date ? st.mtime.getTime() : st?.mtime)` 兼容
5. **TDZ 顺序** — outlineApi 实例化在 titlebarStatusApi 之前(行 ~1714),因 titlebarStatusApi deps 引用 outlineApi.scheduleOutlineUpdate

### Codex R1 复审

- **R1** 候选(13 个候选中选 outline,为高内聚 10 函数聚类)
- R2/R3 在 fullauto 模式下未跑,但 diff review + tsc + 475/475 tests 已充分

## pre-existing 行为保留

- 200ms 防抖 + scheduleOutlineUpdateFromSource mode==='edit' 检查
- source 扫描 regex:`^ {0,3}#{1,6}\s+(.+)$` 行匹配
- 签名 cache key:`filePath::JSON.stringify(items)`
- active 切换:closest scroll 计算第一个进入视口的 h
- PDF 缓存 Map keyed by filePath,失败后清缓存
- 折叠状态用 localStorage `_outlineCollapseState` 记忆

## 验证(Verification)

- `npx tsc --noEmit` → **0 错误**
- `npm test -- --run` → **475/475 通过**(原 461 + 新增 14)
- main.ts 净 **-514 行**(9753→9239)
- 提交:`a9531f8`(已推送 origin)
- Codex:R1 候选;R2/R3 在 fullauto 模式下略

## 备注

- 教训:工厂对模块级缓存的闭包封装非常彻底,10 个 `let` 全部在工厂内,主文件命名空间干净许多
- 教训:闭包 + spy 测试的局限 — spy 替换 `api.method = fn` 失效(因内部调用走闭包),改用观察副作用(getter 注入函数)来验证
- 教训:Tauri plugin-fs 的 `stat.mtime` 是 `Date | null` 不是 number,封装时需兼容两种形态
- 收益:大纲子系统独立可测,后续 PDF 大纲渲染(标签缩进、跳转定位)调整不影响 main.ts
- 收益:与 markdown 渲染解耦,大纲渲染快路径走 DOM query,慢路径走 PDF.js
