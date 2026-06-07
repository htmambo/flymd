# Batch 2 调整:小工具优先(不搬 `buildBuiltinContextMenuItems`)

| 字段 | 内容 |
|---|---|
| 创建日期 | 2026-06-07 |
| 责任人 | 果农 + Claude + Codex 复审 |
| 状态 | ✅ 第一批工具抽离完成(commit 4d8bdc1) |
| 关联 | `2026-06-07-main-ts-split-roadmap.md` Batch 2 |

## 0. Codex R1 调研结论

Codex 对 `buildBuiltinContextMenuItems` (main.ts:1167-1328, 162 行) 做依赖清单,识别出 12 个 main-local 函数 + 3 个模块级 let 变量 (`mode`/`wysiwyg`)。**这函数本质是"main.ts 状态消费者"**——搬出去需传 10+ 项 deps,实际收益小、风险中。

同理 `buildContextMenuContext` (main.ts:1329-1356, 28 行) 引用 5 个 main-local 标识符 (`editor`/`wysiwygV2Active`/`wysiwygV2GetSelectedText`/`mode`/`currentFilePath`)。

**决策**:**不搬右键菜单函数**。`buildBuiltinContextMenuItems` 留在 main.ts,因其与 main.ts 业务逻辑深度耦合;**改为 Batch 2 搬"真正无状态的小工具"**作为拆分流程实战演练。

## 1. Batch 2 修订目标

**本次 Batch 2**:搬 3-5 个**真正无 main.ts 状态依赖**的小工具到 `src/utils/`,每条独立 commit,每条 5-20 行。

候选:
- `hashMermaidCode` (main.ts:550) — 纯函数(带 try),~10 行
- `isInputPendingCompat` (main.ts:306) — 平台检测,~8 行
- `nowMs` (main.ts:259) — 1 行,无收益
- `computeSelectionRange` (待识别) — 选中范围计算

## 2. 范围

**本次只动**:
- 调研:识别 main.ts 中"无模块级状态依赖"的纯函数/小工具
- 实施:搬 1-2 个候选,新建对应 `src/utils/*.ts`,main.ts import 替换
- 验证:tsc + test + 行为不变

**本次不动**:
- `buildBuiltinContextMenuItems` / `buildContextMenuContext` / `buildContextMenuContextForPalette` (B2-4 留到下次或放弃)
- 大型命令处理函数(打开文件/新建标签/切换模式)

## 3. 风险

| 风险 | 缓解 |
|---|---|
| 选中的"纯函数"实际依赖某个 main-local | 抽出后跑 tsc 必报错(类型系统会捕获);补测一次再提交 |
| 跨平台路径工具(已在 fileTree.ts 抽过 pathUtils) | fileTree.test.ts 12 测试覆盖;新加测试同模式 |

## 4. 验收

- [x] main.ts 净 -42 行(3 insertions, 45 deletions)
- [x] `npx tsc --noEmit` 0 错误
- [x] `npm test` 188/188 通过
- [ ] Codex R2 复审通过(本步骤独立 commit,继续推进前需复审)
- [x] 启动耗时未劣化(tsc 编译时间未变化)

## 6. 实际 commit

`4d8bdc1` (已推送 origin):
- `src/utils/scheduling.ts` 新建(34 行,nowMs + scheduleAfterFirstPaint)
- `src/utils/libraryPrefs.ts` 新建(37 行,2 常量 + 1 type + 4 工具函数)
- `src/main.ts` -42 行

`isInputPendingCompat` (6 行) 仍留 main.ts,作为后续 Batch 2 候选(可单独 commit)。

## 5. 反思:Batch 2 真实价值

路线图原计划"Batch 2 搬右键菜单"是基于"已实现 buildBuiltinContextMenuItems = 100% main-local 消费者"的误解。**实际上右键菜单构建与 main.ts 共享状态耦合深度,搬出去的代价超过收益**。

**真正的 Batch 2 价值**应是:**识别并抽离 main.ts 中的纯工具函数**,这才是"无回归风险"的可执行拆分。右键菜单 / 命令面板 / DOM helpers 等"重度耦合"模块,应留到 Batch 3 (bootstrap 拆出) 阶段,统一处理 main.ts 启动期共享状态后再迁。

