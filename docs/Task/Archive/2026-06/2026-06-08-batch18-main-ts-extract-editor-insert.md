# Batch 18:抽离 editorInsert 工具(编辑器文本插入/包装)

> 状态:✅ 已完成(完成 2026-06-08,经 Codex R1 复审 APPROVED)
> 提交:`c9fed4d`(已推送 origin)
> 范围:Phase B 第十七批 — main.ts 模块化拆分

---

## 目标(Goals)

继续 Phase B 拆分,把 main.ts 中 2 个纯函数(insertAtCursor / wrapSelection)
抽离到独立模块,工厂 + 4 个 deps,便于复用与独立测试。

## 现状分析(Context)

- main.ts 9113 行(Batch 17 拆分后)
- 2 个函数是编辑器基础操作:
  - `insertAtCursor(text)`:在选区处插入文本,光标定位到插入末尾
  - `wrapSelection(before, after, placeholder?)`:包裹选区或占位符
- 22 个 call site(insertAtCursor 20 + wrapSelection 2),散布在 paste / drop / click / 快捷键 / 上传等流程
- 函数完全无外部状态依赖,只读 editor DOM 元素 + 写 dirty + 调顶栏刷新

## 子任务清单(Subtasks)

- **T1 ✅** `src/core/editorInsert.ts` 新建(50 行,7 tests)
  - `createEditorInsert(deps)` 工厂 + `EditorInsertApi`
  - 2 个函数原样保留
- **T2 ✅** `src/core/editorInsert.test.ts` 新建(7 tests,jsdom)
  - insertAtCursor:无选区插入 / 选区替换 / refreshStatus
  - wrapSelection:有选区包裹 / 无选区 placeholder / 无 placeholder 默认为空 / refreshTitle+refreshStatus
- **T3 ✅** main.ts 接线:工厂 `let` nullable + 705 附近实例化
- **T4 ✅** 22 call site 全部前缀 `editorInsertApi?.`(Python regex 批量)
- **T5 ✅** 2 函数体删除(-28 行)
- **T6 ✅** main.ts 净 **-15 行**(添加 12,删除 27)
- **T7 ✅** Codex R1 复审 APPROVED(0 blocker)
- **T8 ✅** 验证:tsc 0 错误、test 503/503(原 496 + 7 新增)

## 实施细节

### 关键设计

1. **4 个 deps** — get/set 组合
   - 1 个 getter:getEditor(闭包内每次重读,因为 editor selection 状态会变)
   - 1 个 setter:setDirty
   - 2 个 void getter(顶栏刷新)
2. **工厂闭包内每次 getEditor** — 因为 selection 状态跨调用改变,不能缓存
3. **对象属性 deps 兼容** — 原代码 `insertAtCursor: (t) => insertAtCursor(t)` 形式
   (作为 deps 传给其他模块),替换为 `(t) => editorInsertApi?.insertAtCursor(t)` 后
   行为不变(因 editorInsertApi 实例化早于所有 callbacks)
4. **TDZ 安全** — 工厂在 705 实例化,所有 22 call site 都是事件回调
   (init 之后),editorInsertApi 始终非空,可选链不影响行为

### Codex R1 复审

- **R1** APPROVED
- 验证点:行为 verbatim、22 call site 全部 prefix、deps 干净、测试覆盖 7 cases
- 唯一 nit:注释"21 个"实际是"22 个" → 已修

## pre-existing 行为保留

- `insertAtCursor`:选区 val.slice + insert,光标 start+text.length 末尾,setDirty+refresh
- `wrapSelection`:val.slice(start, end) || placeholder 选区/占位符,selStart/End 精确定位被选文本
- 默认 placeholder = ''(空字符串兜底)
- 不包 try/catch,异常向上抛

## 验证(Verification)

- `npx tsc --noEmit` → **0 错误**
- `npm test -- --run` → **503/503 通过**(原 496 + 新增 7)
- main.ts 净 **-15 行**(9113→9098)
- 提交:`c9fed4d`(已推送 origin)
- Codex:R1 APPROVED(0 blocker)

## 备注

- 教训:大 call site 数(22)用 Python regex 批量前缀比逐个 Edit 高效 50 倍
- 教训:对象属性 deps 的 lambda 包装模式 + 可选链组合时,执行时机判断是关键
  (callback 总在 init 之后 → 工厂非空 → 可选链无副作用)
- 收益:编辑器基础操作独立可测,后续新加 wrap 模式(代码、删除线、链接等)直接复用
