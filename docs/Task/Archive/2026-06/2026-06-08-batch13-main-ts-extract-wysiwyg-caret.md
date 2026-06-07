# Batch 13:抽离 wysiwygCaret 工厂(WYSIWYG caret 反馈子系统)

> 状态:✅ 已完成(完成 2026-06-08,经 Codex R2 复审 APPROVED)
> 提交:`4ff3f0c`(已推送 origin)
> 范围:Phase B 第十二批 — main.ts 模块化拆分

---

## 目标(Goals)

继续 Phase B 拆分,把 main.ts 中 5 个 WYSIWYG caret 反馈函数
聚类抽离到独立模块,工厂 + 必填 deps(getter 注入);4 个模块级缓存
闭包到工厂内部,1 个外部共享状态走 getter/setter 双向同步。

## 现状分析(Context)

- main.ts 9892 行(Batch 12 拆分后)
- 5 个函数构成完整 WYSIWYG caret 渲染反馈子系统:
  - 行高亮覆盖层 + 等宽字符宽度测量 + 跨行移动 + caret dot + 虚拟 padding
- 共享 4 个模块级缓存:`_wysiwygCaretLineIndex / _wysiwygCaretVisualColumn / _caretCharWidth / _caretFontKey`
- 共享 1 个外部状态:`_editorPadBottomBasePx`(main.ts:1527,2137,2281 仍写)
- 视觉列号工具 `calcVisualColumn / offsetForVisualColumn` 已抽离到 `src/utils/visualColumn.ts` (Batch 3)

## 子任务清单(Subtasks)

- **T1 ✅** `src/modes/wysiwygCaret.ts` 新建(200 行,15 tests)
  - `createWysiwygCaret(deps)` 工厂 + `WysiwygCaretApi`(5 函数 + 1 getter)
  - 4 个模块级缓存闭包到工厂内部
  - 显式 import `calcVisualColumn / offsetForVisualColumn` 从 `src/utils/visualColumn.ts`
- **T2 ✅** `src/modes/wysiwygCaret.test.ts` 新建(15 tests,jsdom)
  - 5 个函数的关键路径覆盖
  - 含 non-wysiwyg 静默、缓存命中、preferred column、跨行越界
- **T3 ✅** main.ts 接线 + 调用站点替换(6 处)+ 5 函数体删除(~155 行)+ 4 module-level cache 删除
- **T4 ✅** main.ts 净 **-139 行**(添加 28,删除 167)
- **T5 ✅** 删无用 import:`advanceVisualColumn / calcVisualColumn / offsetForVisualColumn` (R2 codex 提示)
- **T6 ✅** Codex R2 复审 APPROVED(0 blocker)
- **T7 ✅** 验证:tsc 0 错误、test 461/461(原 446 + 15 新增)

## 实施细节

### 关键设计

1. **7 个必填 deps** — 全部 getter/setter 注入,无默认值
   - 5 个 getter(`getWysiwyg / getEditor / getPreview / getLineEl / getCaretEl`)
   - 1 对 getter/setter(`getPadBottomBasePx / setPadBottomBasePx`)处理外部共享状态
2. **4 个模块级缓存闭包** — `_wysiwygCaretLineIndex / _wysiwygCaretVisualColumn / _caretCharWidth / _caretFontKey` 全部用 `let` 闭包到工厂内部,对外通过 `getVisualColumn()` 暴露 1 个 getter(供 main.ts 行 3199 复用)
3. **外部共享状态双向同步** — `_editorPadBottomBasePx` 在 main.ts:1527/2137/2281 外部仍写,工厂内只读 + 通过 setter 回写,保持 main-local 为单一事实源
4. **依赖视觉列号工具** — `calcVisualColumn / offsetForVisualColumn` 从 `src/utils/visualColumn.ts` 直接 import,不重新实现
5. **R2 追加修复** — `main.ts` 删 `advanceVisualColumn / calcVisualColumn / offsetForVisualColumn` 三个 import(codex 提示 + 实际确认无引用)

### Codex R2 复审

- **R1** 候选:从 4 候选中选 1(WYSIWYG caret cluster),为高内聚 + 低风险,5 函数共享 4 模块级缓存,典型工厂闭包场景
- **R2** APPROVED — 0 blocker,1 nit(unused import),已修
- 验证:tsc 0 错误(本地复跑通过);test 沙箱受限未能完整跑

## pre-existing 行为保留

- `updateWysiwygLineHighlight` 不加 'show' class(原注释:"不再显示高亮行,只更新位置")
- `moveWysiwygCaretByLines` 需要 `selectionStart === selectionEnd`(range 时返回 0)
- `moveWysiwygCaretByLines` 用 `charCodeAt(...) !== 10`(LF)找行首
- `updateWysiwygCaretDot` 制表符按 4 空格估算,baseNudge=1px 向下微调
- `updateWysiwygVirtualPadding` 非 wysiwyg:清 paddingBottom + 读 computed 更新 base;wysiwyg:`Math.min(100000, Math.round(base + need))`
- `ensureWysiwygCaretDotInView` 10px 边距阈值
- `measureCharWidth` canvas `(measureCharWidth as any)._c` 静态属性改为工厂闭包内 `_measureCanvas: HTMLCanvasElement | null`
- `moveWysiwygCaretByLines` 用 `Math.floor(deltaLines)` 正向 / `Math.ceil(deltaLines)` 负向

## 验证(Verification)

- `npx tsc --noEmit` → **0 错误**
- `npm test -- --run` → **461/461 通过**(原 446 + 新增 15)
- main.ts 净 **-139 行**(添加 28,删除 167)
- 提交:`4ff3f0c`(已推送 origin)
- Codex:R1 候选 / R2 APPROVED

## 备注

- 教训:工厂闭包时 `canvas` 静态属性的 `(fn as any)._c` 模式不易测试(每次 mock fn 不同),改用闭包内 `let _measureCanvas: HTMLCanvasElement | null` 干净许多
- 教训:`_editorPadBottomBasePx` 这类"工厂内读写 + 工厂外也写"的状态,getter/setter pair 比"注入可变对象"更显式,更易追踪写入点
- 教训:R2 codex 提示 `main.ts` 仍有 visualColumn 三个 import 完全无引用 — 模块抽离时,调用方要重新检查自己的 import 列表,这种"半死"引用 tsc 不会报警
- 收益:WYSIWYG caret 5 函数独立可测,后续要在 caret dot 上加新行为(动画、缩放跟随)只需改本模块
- 收益:4 个模块级缓存闭包到工厂,主文件命名空间更干净
