# Phase B2-B7 — main.ts 拆分路线图（B1.2 调研产物）

| 字段 | 内容 |
|---|---|
| 创建日期 | 2026-06-07 |
| 责任人 | 果农 + Claude（协作）+ Codex 复审 |
| 状态 | 📋 调研完成，等待用户决策启动 B2 |
| 关联 | `2026-06-07-p0-tech-debt-batch-1.md`、`main-ts-inventory.md` |

## 0. 现状快照

| 指标 | 数值 |
|---|---|
| 总行数 | 12,025 |
| 顶层函数（`^function` 开头）| 208 个 |
| import 语句 | 102 |
| `addEventListener` | 144 处 |
| `register*` | 5 处 |
| `invoke` | 22 处 |
| `listen` | 4 处 |

## 1. 已完成的部分

main.ts 已从 `src/utils/*` 导入以下剥离模块（说明项目**已经在做拆分**）：

- `utils/image`（图片处理）
- `utils/excelFormula`（Excel 公式保护）
- `utils/localImagePath`（本地图片路径猜测）
- `utils/localImageSrcResolve`（图片 src 解析）
- `utils/tabIndent`（Tab 缩进）
- `theme`（主题）
- `i18n`（国际化）
- `core/*`（核心工具）
- `wysiwyg/v2/*`（所见模式）
- `windows/*`（窗口管理）
- `fileTree`（库树）
- `extensions/*`（扩展）
- `uploader/*`（图床）

**估计 main.ts 当前 12,025 行中，~70% 是命令处理 + DOM 事件 + 业务编排，~30% 是可继续剥离的辅助函数。**

## 2. 可继续拆分的模块

### 2.1 已识别可独立候选

按"调用频率高 + 无状态依赖"筛选：

| 函数 | 位置（line）| 性质 | 建议目标文件 |
|---|---|---|---|
| `hashMermaidCode` | 550 | 纯函数（带 try） | `utils/mermaidHash.ts` |
| `nowMs` | 259 | 1 行 | 留 main.ts（无收益） |
| `readLibraryDockedFromLocalStorage` | 863 | localStorage 工具 | `utils/libraryStorage.ts` |
| `writeLibraryDockedToLocalStorage` | 871 | 同上 | 同上 |
| `readLibrarySideFromLocalStorage` | 874 | 同上 | 同上 |
| `writeLibrarySideToLocalStorage` | 881 | 同上 | 同上 |
| `escapeAttrValue` | 1439 | 纯函数 | `utils/htmlEscape.ts` |
| `isInputPendingCompat` | 306 | 平台检测 | `utils/platform.ts` |
| `yieldToUi` | 314 | microtask 工具 | `utils/scheduler.ts` |
| `scheduleAfterFirstPaint` | 263 | 同上 | 同上 |
| `scheduleDeferredStartupWork` | 281 | 同上 | 同上 |

### 2.2 中等风险

- **DOM helpers**（`getElementById` 包装、节点创建）：散落 200+ 处，难剥离
- **命令处理函数**（"打开文件" / "新建标签" / "切换模式"）：有闭包内共享状态，拆分需识别"共享状态"再迁出

### 2.3 高风险

- `addEventListener` 144 处中绝大部分**与 main.ts 模块级 let 变量共享状态**（如 `currentFilePath`, `tabs[]`, `isDirty` 等）
- `invoke` 22 处：分散在命令处理中，需识别"哪些 invoke 属于窗口级、哪些属于文件级"
- `listen` 4 处：Tauri 事件订阅

## 3. 拆分策略（推荐渐进式）

### 3.1 不推荐

- **一刀切式拆分**：把 main.ts 中 477 个函数全部迁出。**风险极高**（闭包共享、循环依赖、初始化顺序）
- **大刀阔斧做 modules 重构**：会引发 1 周+ 的大 diff，几乎必然引入回归

### 3.2 推荐路线图

按风险/收益从低到高分 4 批：

**Batch 1（低风险，~1-2 天）**：纯函数 + localStorage 工具
- 提取 hashMermaidCode、escapeAttrValue、nowMs、isInputPendingCompat、yieldToUi、scheduleAfterFirstPaint、scheduleDeferredStartupWork
- 提取 readLibrary*Docked/Side + write*（4 个 localStorage 工具）
- 预期效果：main.ts → 11,500 行（-500 行）
- 收益：低（少量瘦身），但**为后续拆分打基础**

**Batch 2（中风险，~3-4 天）**：UI 子组件逻辑
- "右键菜单"上下文构建（line 1380-1450）→ `src/menus/contextMenu.ts`
- "命令面板"命令注册 → `src/menus/commandPalette.ts`
- 预期效果：main.ts → 10,500 行（-1000 行）

**Batch 3（中高风险，~5-7 天）**：bootstrap 拆出
- `bootstrap/initDom.ts`（DOM 元素查询）
- `bootstrap/initTauri.ts`（invoke / listen / 单实例）
- `bootstrap/initShortcuts.ts`（快捷键注册）
- `bootstrap/initExtensions.ts`（扩展宿主）
- `main.ts` 收敛为 ≤ 800 行入口
- 预期效果：main.ts → 800 行（-11,200 行）

**Batch 4（高风险，单独评估）**：
- 内部扩展系统迁移到 `pluginHost`（P3 级工作）
- 见 `2026-06-02-flymd-quality-baseline.md` Phase G

## 4. 启动建议

**不建议立即启动 B2-B7 完整流程**。理由：

1. 当前 E2 CSS 拆分已完成 24.7% 瘦身，main.ts 拆分后还能再瘦 90%+ 但工作量 L 级
2. main.ts 内部 477 函数相互依赖密集，**任何大规模拆分都需要 5-7 天独立 PR review**
3. 用户的"健康检查 9 项"中 P0/P1 关键项已完成，剩余 F（@ts-ignore/console.log）依赖 main.ts 拆分

**推荐执行顺序**：

1. ✅ Phase A-C-D-E-F 立即修复（已完成）
2. ✅ Phase B E1+E2 CSS 拆分（已完成 24.7%）
3. ⏳ **Batch 1** main.ts 纯函数剥离（1-2 天，下次会话启动）
4. ⏳ Batch 2 UI 子组件（3-4 天）
5. ⏳ Batch 3 bootstrap 拆出（5-7 天）
6. ⏳ Phase F（@ts-ignore/console.log 清理）放在 Batch 3 之后

## 5. 验收标准

- `main.ts` ≤ 800 行
- `bootstrap/init*.ts` 每个 ≤ 400 行
- `npm test` 188/188 通过
- `npx tsc --noEmit` 0 错误
- 启动耗时不劣于拆分前
- 库树 / PDF 导出 / 主题切换 / 模式切换 / 便签 / 专注 行为不变

## 6. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 闭包共享状态迁移 | 每个 batch 单 commit；Batch 1 纯函数最安全，先做 |
| Tauri IPC 调用顺序 | 依赖识别"命令处理函数"位置，按现顺序迁移 |
| 启动顺序敏感 | 引入 `src/bootstrap/__golden__/` 记录拆分前各模块对外暴露的全局副作用清单 |
| 回滚 | 按 commit 粒度 revert |

## 7. 下一步

1. 等用户拍板：是否启动 Batch 1（纯函数剥离）
2. 如果启动，按本路线图执行，每 batch 单独立 PR
3. 如果不启动，记录本路线图到 docs/Task/Archive 等用户后续决定
