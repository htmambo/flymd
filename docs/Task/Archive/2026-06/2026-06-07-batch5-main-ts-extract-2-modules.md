# Batch 5:main.ts 拆分(第四批)

**状态**: ✅ 已完成 (完成时间: 2026-06-07)
**提交**: `6e8c495` (已推送 origin)

## 背景

Batch 4 完成时 main.ts 仍 11359 行。Batch 5 调研挑出 2 个 shippable 候选
(callout 事件 handler / 右键菜单 context 构建器),其中 contextMenu 需参数化 5 个
main-local 闭包状态。

## 任务清单

- **T1 ✅** `src/plugins/calloutPreviewEvents.ts` 新建(54 行,2 事件 handler)+ 8 tests(jsdom)
- **T2 ✅** `src/ui/contextMenuContext.ts` 新建(85 行,2 builder + type)+ 10 tests(jsdom)
- **T3 ✅** main.ts 移除对应定义,改 import 引用
- **T4 ✅** 参数化 `buildContextMenuContext(e, deps)` / `buildContextMenuContextForPalette(deps)`(替代 5 个闭包全局)
- **T5 ✅** main.ts 新增 `getContextMenuDeps()` 顶层 helper(8 行)封装 deps
- **T6 ✅** 类型复用:从 `src/ui/contextMenus.ts` 导入 `ContextMenuContext`(避免重复定义 + 模式不兼容)
- **T7 ✅** 4 处 call site(3 buildContextMenuContext + 1 buildContextMenuContextForPalette in plugin runtime)补传 deps
- **T8 ✅** Codex R2 复审 APPROVED
- **T9 ✅** `npx tsc --noEmit` 0 错误
- **T10 ✅** `npm test` 308/308 通过(原 290 + 新增 18)
- **T11 ✅** commit + push

## 关键决策

### 决策 1:callout 放 `plugins/` 而非 `ui/`
**Why**:
- DOM shape 由 `src/plugins/markdownItCallout.ts:274` 产生,与该插件形成"产 + 销"对子
- 事件处理是"预览增强"语义,和 plugins/ 同级
- 放 `ui/` 会让人误以为是通用 UI 组件,实际强耦合 callout DOM 结构
**How to apply**: 插件产生的 DOM 节点 + 它的交互 handler 应在同一目录。

### 决策 2:ContextMenuContext **复用** 而非重复定义
- **选项 A**: 新建模块内独立定义 `ContextMenuContext` type
- **选项 B**: 从 `src/ui/contextMenus.ts` 导入(本次采用)

**Why 选 B**:
- 已有 type 是 `showContextMenu` 消费者的契约
- mode 字面量集合是 `'edit' | 'preview' | 'wysiwyg'`(严格 3 元)
- 选项 A 会让"上游产 → 下游消费"出现 type structural 不兼容错误
- 暴露给插件的 API 表面不变

**How to apply**: 抽离 type 之前,先 grep 仓库内同名 type,优先复用,避免平行定义。

### 决策 3:5 个 deps 用**对象**合并传,非 5 个独立参数
- **选项 A**: `buildContextMenuContext(e, editor, mode, currentFilePath, wysiwygV2Active, wysiwygV2GetSelectedText)`
- **选项 B**: `buildContextMenuContext(e, { editor, mode, currentFilePath, wysiwygV2Active, wysiwygV2GetSelectedText })`(本次采用)

**Why 选 B**:
- 5 个位置参数太难读,顺序错位会引发静默错误
- 对象可扩展(后续新增字段不影响 call site)
- `getContextMenuDeps()` 单一封装点,deps 字段集中管理
**How to apply**: 参数 ≥ 3 个相关字段时,改用对象传;`null` 时静默降级比"必填且 5 个"更友好。

## 验证(Codex R2 实测)

| 项目 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ 0 errors |
| `npm test` | ✅ 308/308(290+8+10) |
| callout handlers 纯净 | ✅ Codex 确认无 main.ts 闭包引用 |
| ContextMenuContext 复用 | ✅ 从 contextMenus.ts 导入,与下游契约一致 |
| 4 处 deps 参数化 | ✅ 3 buildContextMenuContext + 1 plugin runtime 暴露全补传 |
| `mode as ContextMenuMode` cast | ✅ Codex:可接受(底层 Mode 已可赋值,cast 仅是文档性) |
| getContextMenuDeps 位置 | ✅ Codex:贴近 listener 设置区,合理 |
| @ts-ignore 数量 | 10(未变) |
| main.ts 净行数 | -91(11359→11268) |

## 关联

- Batch 1 (`d49c182/3cc28b8/139208f`)
- Batch 2 (`4d8bdc1`)
- Phase F 第三步 (`08b144c`)
- Batch 3 (`75ef51a` + `bbbddb9`)
- Batch 4 (`e4309f8` + `23829cf`)
- **Batch 5 (`6e8c495`): 本批**

## Codex 复审记录

**R1 调研**: 给出 3 个候选(callout / contextMenu / previewMeta),Claude 选前 2 个稳妥的,
previewMeta 因 DOM 风险+参数化改动大暂缓。

**R2 提交前**: Code review workflow,验证 7 项,均通过:
- A) callout handlers 无 main.ts 闭包
- B) ContextMenuContext 复用是正确决策
- C) `mode as ContextMenuMode` cast 可接受
- D) plugin runtime `getContextMenuContext` 仍工作
- E) 4 处 call site 全更新
- F) `getContextMenuDeps` 位置合理
- G) 安全提交

R2 结论:**APPROVED** (0 blocker / 0 important / 0 nit)
