# 阅读模式大文档增量预览更新

**状态**: ✅ 已完成 (完成时间: 2026-11-28)
**创建**: 2026-11-28
**创建者**: Claude Code

## 任务目标

阅读模式下编辑 Markdown 时，避免每次击键都销毁并重建整个虚拟预览 DOM。保持预览正确性、滚动稳定性和图表的加载状态。

## 问题分析

`renderPreview` → `renderVirtualPreview` → `VirtualPreview.setDocument(model)`：

- `setDocument` 只在 `model.source` 完全相同时跳过重建；只要文档有任何改动（每次击键），就走 `mountShell()` —— `host.replaceChildren(root)` 销毁整个预览 shell。
- 结果是所有已挂载块（含 mermaid SVG、KaTeX、远程图片）重新创建、重新加载/渲染，并重新触发测高；这正是此前滚动串扰的同类根因。
- `render()` 已具备按 `data-block-key` 复用区间内 DOM 的能力（见上一个提交），但 shell 被销毁后复用无从谈起。

Markdown 解析层的局部重解析风险过高（markdown-it 的列表/围栏/脚注/引用链接有跨块上下文），不纳入本任务；保留按文档长度分级的防抖作为解析侧策略。

## 子任务列表

- ✅ 1. 设计低风险方案：复用已有 shell 与 DOM，按 block key 只重建变化的块
- ✅ 2. `setDocument` 在同文档更新时跳过 mountShell，保留已挂载 DOM
- ✅ 3. 复用块时同步更新 index/源码范围元数据、heading id、task id，保留已测得高度
- ✅ 4. 单测与验证：同文编辑复用 DOM、换文档重建、typecheck/test/build

## 每个子任务的改动内容

### 1. 设计（已完成）
判断"同文档更新" vs "换文档"：新旧模型存在共同 block key 时视为编辑，否则重建 shell。block key 由起始行 + token 类型 + 内容哈希组成，编辑未触及的块 key 稳定。

### 2. `setDocument`
同文档更新时更新 `model`/`heights`/`prefix`、重置查找与脚注缓存，将 `lastRange = null` 强制 `render()` 按 key 重新协调（复用未变块，新建变化块），不销毁 shell。换文档或首次挂载仍走 `mountShell()`。

### 3. 复用块元数据
`render()` 的复用分支更新 `dataset.blockIndex` / `originalStart` / `originalEnd`，重新应用 heading id 与 task id，保证 `measureMounted` 的高度记录与滚动定位正确。

### 4. 测试
`virtualPreview.test.ts` 新增：同文编辑后未变块 DOM 节点保持同一实例；换文档后 shell 重建；复用块索引更新正确。跑 typecheck、vitest、build。

## 预期效果和 acceptance criteria

- 单块内编辑：未变块的 DOM 节点（含 mermaid/KaTeX/图片）保持同一实例，不重新加载。
- 变化块按新内容重建；`blocks`/`headings`/测高/滚动定位与全量重建一致。
- 换文档、模式切换、打印/导出仍走完整重建，不引入回归。
- `pnpm typecheck`、全量 `pnpm test`、`pnpm build` 通过。

## 风险评估和缓解措施

- 风险：换文档时碰巧有相同 key（例如两个文档都以相同标题开头）导致误复用。缓解：key 含行号与内容哈希，单块巧合概率低；即使复用，块内容相同，仅更新 index 元数据后行为等价。
- 风险：复用块的 heading id 因全局重复标题顺序变化而不同。缓解：复用分支按新模型重新应用 heading id。
- 风险：编辑时锚点校正引起滚动跳动。缓解：`measureMounted` 的锚点校正仅在滚动空闲 ≥100ms 时执行，且复用块高度不变时校正量接近 0；真机复测确认。

## 实施顺序和依赖关系

1 → 2 → 3 → 4；2 和 3 都必须完成后 DOM 复用才正确，4 验证等价性。

## 外部审核意见

- review_plan 调用失败：`coding-bridge` HTTP 429（月度配额耗尽），`codex` 未连接。
- 本次未经过 External Review MCP 审查，以 typecheck / 单测 / build / 真机实测交叉验证。
