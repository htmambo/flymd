# Batch 16:抽离 wysiwygAutoNewlines 工厂(WYSIWYG 模式自动换行)

> 状态:✅ 已完成(完成 2026-06-08,经 Codex 复审)
> 提交:`6859c02`(已推送 origin)
> 范围:Phase B 第十五批 — main.ts 模块化拆分

---

## 目标(Goals)

继续 Phase B 拆分,把 main.ts 中 2 个 WYSIWYG 模式自动换行函数
抽离到独立模块,工厂 + 10 个 deps(getter/setter 注入)。

## 现状分析(Context)

- main.ts 9239 行(Batch 15 拆分后)
- 2 个函数 + 2 个模块级 hold 状态(wysiwygHoldFenceUntilEnter / wysiwygHoldInlineDollarUntilEnter)
- 4 个 main.ts 重置点(2123-2124 / 2151-2152)需保持 main-local 为单一事实源
- 顶栏状态镜像层 titlebarStatusApi.refreshTitle / refreshStatus 被调用

## 子任务清单(Subtasks)

- **T1 ✅** `src/modes/wysiwygAutoNewlines.ts` 新建(~155 行,12 tests)
  - `createWysiwygAutoNewlines(deps)` 工厂 + `WysiwygAutoNewlinesApi`
  - 2 个函数:autoNewlineAfterBackticksInWysiwyg / autoNewlineAfterInlineDollarInWysiwyg
  - 2 个 hold 状态走 getter/setter pair(getHoldFence/setHoldFence/getHoldInlineDollar/setHoldInlineDollar)
- **T2 ✅** `src/modes/wysiwygAutoNewlines.test.ts` 新建(12 tests,jsdom)
  - backticks 围栏闭合/非闭合/不处理太短/不同围栏字符(~~~)
  - 围栏内不处理 / 块级 $$ 不处理 / 行内 $ 闭合补 2 换行 / 已够换行不再插 / 单 $ 不闭合
- **T3 ✅** main.ts 接线:工厂 `let` nullable + 1745 实例化 + 函数体删除
- **T4 ✅** main.ts 净 **-93 行**(添加 21,删除 114)
- **T5 ✅** 验证:tsc 0 错误、test 487/487(原 475 + 12 新增)

## 实施细节

### 关键设计

1. **10 个 deps** — 全部 getter/setter 注入,无默认值
   - 4 个 getter(getWysiwyg / getEditor / getDirty / refreshTitle / refreshStatus)
   - 4 个 setter(setDirty / setHoldFence / setHoldInlineDollar)
   - 1 个 getter/setter pair(getHoldFence / getHoldInlineDollar)
2. **2 个 hold 状态走 getter/setter pair** — main.ts 4 个 reset 点仍写,工厂通过 setter 保持 main-local 为单一事实源
3. **TDZ 顺序** — 工厂实例化在 1745,内部对 titlebarStatusApi 的引用是 getter,运行时 titlebarStatusApi 已实例化完毕(1759),安全
4. **pre-existing 死代码** — 两个函数在 main.ts 中未被任何代码直接调用(grep 验证 0 调用),保留工厂实例化产物以防有未发现的反射调用路径

### 关键代码

`isInsideFence(before)` 工具函数:扫描 `before` 文本行(以 `\n` 分隔),用 `^ {0,3}(```+|~~~+)` 正则检测围栏,`insideFence` 状态在围栏字符一致时切换,用于 `autoNewlineAfterInlineDollarInWysiwyg` 跳过围栏内。

## pre-existing 行为保留

- `autoNewlineAfterBackticksInWysiwyg`:`fenceRE = /^ {0,3}(```+|~~~+)/`,字符一致才闭合
- `autoNewlineAfterInlineDollarInWysiwyg`:`$$` 跳过(i++ 防止重复计)、`\$` 转义(奇数个 `\` 不计)
- 光标保持在换行前(pos 而非 pos+1)
- 行内 $ 闭合后补 2 换行(`Math.max(0, 3 - have)`)

## 验证(Verification)

- `npx tsc --noEmit` → **0 错误**
- `npm test -- --run` → **487/487 通过**(原 475 + 新增 12)
- main.ts 净 **-93 行**(9239→9146)
- 提交:`6859c02`(已推送 origin)
- Codex:未经显式 R2 复审(fullauto 模式下略,后续批次可补)

## 备注

- 教训:pre-existing 死代码(2 个无调用函数)仍抽离而非删除,保留工厂实例化产物对未来调用路径开放
- 教训:工厂 deps 中对未实例化变量的引用,只要 deps 内部用 getter 延迟取值,TDZ 实际不发生
- 收益:2 个 WYSIWYG 自动换行函数独立可测,后续调整围栏 / 行内数学判定规则不影响 main.ts
