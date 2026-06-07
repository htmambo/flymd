# Phase B2-B7 — main.ts 拆分路线图（B1.2 调研产物）

| 字段 | 内容 |
|---|---|
| 创建日期 | 2026-06-07 |
| 责任人 | 果农 + Claude（协作）+ Codex 复审 |
| 状态 | 🔄 Batch 1 完成，Batch 2 调研完成，待启动 |
| 关联 | `2026-06-07-p0-tech-debt-batch-1.md`、`main-ts-inventory.md` |

## 0. 现状快照(2026-06-07 末)

| 指标 | 路线图初始 | 当前(实测) | 差值 |
|---|---|---|---|
| 总行数 | 12,025 | 11,893 | -132 |
| 顶层函数（`^function` 开头）| 208 | 207 | -1 |
| import 语句 | 102 | 102 | 0 |
| `addEventListener` | 144 | 142 | -2 |
| `register*` | 5 | 5 | 0 |
| `invoke` | 22 | 22 | 0 |
| `listen` | 4 | 4 | 0 |

**实际已发生的拆分**(路线图未列):
- `src/ui/contextMenus.ts`（`showContextMenu` 183 行）— 路线图误以为还在 main.ts
- `src/core/commandPalette.ts`（依赖注入 `buildBuiltinContextMenuItems`）— 项目正在用 DI 模式拆分
- `src/fileTree.ts`（已加 `pathUtils` 导出）+ `src/fileTree.test.ts`（12 个跨平台测试）

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
| `escapeAttrValue` | ~~1439~~ ❌已删 | 纯函数 | 已在 `src/utils/escape.ts:3` 独立存在,副本已删(d49c182) |
| `isInputPendingCompat` | 306 | 平台检测 | `utils/platform.ts` |
| `yieldToUi` | ~~314~~ ❌已删 | microtask 工具 | 已在 `ui/quickSearch.ts:68` 独立存在,副本已删(3cc28b8) |
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
- **进展(2026-06-07)**：已删除 10 个死代码/重复定义函数（-102 行实际削减,无 main.ts 行为变化）。包括 escapeAttrValue、yieldToUi、getPluginOrder、newFolderSafe、resolvePluginInstallAbsolute、toPluginAssetUrl、shouldDeferWysiwygRender、importPortableBackupSilent、maybeAutoExportPortableBackup、setDefaultPasteDir、resetStickyModeFlags。codex 复审 d49c182/3cc28b8/139208f 全部 APPROVED。

**Batch 2（中风险，~3-4 天）**：UI 子组件逻辑
- "右键菜单"上下文构建（line 1167-1378）→ `src/menus/contextMenu.ts`(~282 行)
  - `buildBuiltinContextMenuItems` (line 1167-1328, 162 行)
  - `buildContextMenuContext` (line 1329-1358, 30 行)
  - `buildContextMenuContextForPalette` (line 1359-1378, 20 行)
- 右键菜单监听器（line 1380-1450, 70 行）→ `src/menus/contextMenuListeners.ts`
- "命令面板"命令注册 → 已在 `core/commandPalette.ts`，**已用 DI 模式接入**
- **项目已采用的 DI 模式**(参照 `commandPalette.ts:37`):
  - `deps.buildBuiltinContextMenuItems: (ctx) => Promise<ContextMenuItemConfig[]>`
  - **Batch 2 切入点**:把 main.ts 中 `buildBuiltinContextMenuItems` 抽到 `menus/contextMenu.ts`,作为函数 export,main.ts 注入到 `core/commandPalette.ts` 调用点
- 预期效果:main.ts → 11,600 行(-300 行)
- 风险:共享状态(`currentFilePath`/`wysiwygV2Active`/`mode`/`pluginContextMenuItems`)/需通过参数显式传入
- **拆分步骤**:
  - B2-1:识别 `buildBuiltinContextMenuItems` 内部所有 main.ts 模块级变量引用
  - B2-2:建 `src/menus/contextMenu.ts`,export `buildBuiltinContextMenuItems(ctx, deps)`,main.ts 注入调用
  - B2-3:验证右键菜单行为不变(库/编辑器/预览 3 个区域 + WYSIWYG)
  - B2-4:同样模式迁 `buildContextMenuContext` + `buildContextMenuContextForPalette`

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
