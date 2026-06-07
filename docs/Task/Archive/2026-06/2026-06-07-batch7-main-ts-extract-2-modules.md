# Batch 7:main.ts 拆分(第六批)

**状态**: ✅ 已完成 (完成时间: 2026-06-07)
**提交**: `13e05fb` (已推送 origin)

## 背景

Batch 6 完成时 main.ts 仍 11055 行。Batch 7 调研挑出 2 个 shippable 候选
(库内文件 FS 助手 / 顶部下拉菜单 UI),两个均 S 复杂度、无 main-local 闭包依赖。

## 任务清单

- **T1 ✅** `src/core/libraryFileOps.ts` 新建(85 行,2 个 FS 助手)+ 8 tests
- **T2 ✅** `src/ui/topMenu.ts` 新建(120 行,showTopMenu + TopMenuItemSpec)+ 10 tests jsdom
- **T3 ✅** main.ts 删除对应原定义(80 + 103 行)
- **T4 ✅** main.ts 改 import 引用,清理 menuManager 直接 import(被新模块内化)
- **T5 ✅** 1 处 call site(`initLibraryContextMenu` 的 `deleteFileSafe` 字段)自动指向新 import
- **T6 ✅** Codex R2 复审 2 轮联合通过
- **T7 ✅** `npx tsc --noEmit` 0 错误
- **T8 ✅** `npm test` 346/346 通过(原 328 + 新增 18)
- **T9 ✅** commit + push

## 关键决策

### 决策 1:libraryFileOps 放 `core/` 而非 `utils/`
**Why**:
- 调用了 `core/fsSafe` 的 `ensureDir`(库内文件安全),与 fsSafe 同层
- 涉及 invoke 后端命令(macOS 回收站 / Windows 回收站),非纯函数
- `utils/` 仅放纯函数类
**How to apply**: 涉及后端命令或副作用 IO 的助手放 core/,纯函数放 utils/。

### 决策 2:topMenu 状态走**模块级闭包** 而非 factory
- 1 个状态(`_topMenuDocHandler`)极轻
- 同一份 menu DOM 单例(`#top-ctx`),跨调用共享
- factory 反而引入模板代码 + 实例管理

**Why 不选 factory**: 与 Batch 6 previewMeta 同理 — 全局 UI 单例走模块级 state。

### 决策 3:`registerMenuCloser` 模块级副作用**保留** 在新模块内
- 原 main.ts 在 topMenu 块外层就有 `registerMenuCloser('topMenu', closeTopMenu)` 调用
- 抽离后副作用随模块 import 自动执行(新模块顶层就调)
- main.ts 不再关心菜单管理器的注册细节

**How to apply**: 模块级副作用(全局注册、事件监听)在 import 时执行,无需 main.ts 包装。

## Codex 复审发现与处理

### 第二轮 (R2 REJECTED → R2 APPROVED)

**重要发现 (R2 首轮)**:deleteFileSafe 的非空目录兜底分支不可达。
- 原因:Tauri `remove()` 对非空目录会 throw,根本走不到 `if (st?.isDirectory)` 兜底
- **pre-existing** 验证:git show HEAD:src/main.ts 显示原代码就是同样结构
- **按 CLAUDE.md "仅对需求做针对性改动" 政策**:这是 pre-existing 行为问题,不属于本次抽离引入的回归
- **Codex 同意降级**:从 R2 REJECTED 改为 R2 APPROVED + 在 archive 标记为"待后续 batch 修复"

**已记录**:此问题需在后续 batch 单独修复(目标:deleteFileSafe 目录删除语义)。

### 后续 batch 计划项
- **TODO (Batch 8+)**:`deleteFileSafe` 目录删除兜底:catch remove throw → 检查 isDirectory → 递归 → 兜底 invoke('force_remove_path')。
  Patch 已由 Codex R2 给出,可直接套用。

## 中间状态事故

在完成 main.ts 旧块删除 → 新 import 加入的过程中,出现了一次**半残中间态**(旧块已删、新 import 未生效)。
用户报告:「顶部看不到标签和窗口控制按钮了」。
**应对**:立即把 main.ts 编辑跑完(tsc 0 错误 + 346/346 tests),用户重新启动 app 验证通过。
**教训**:未来批量删除前,**先准备好新 import,确认 tsc 0 错误后,再做旧块删除**;或者一次性用 Python 脚本完成「加 import + 删旧块」原子操作,避免中间态。

## 验证(Codex R2 实测)

| 项目 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ 0 errors |
| `npm test` | ✅ 346/346(328+8+10) |
| libraryFileOps 行为保留 | ✅ Codex 确认与 main.ts HEAD 完全一致 |
| topMenu 状态封装 | ✅ Codex 确认模块级闭包 + registerMenuCloser 副作用正确 |
| main.ts 净行数 | -181(11055→10874) |
| `initLibraryContextMenu` 暴露 | ✅ Codex 确认 `deleteFileSafe` 仍正确传递 |
| `registerMenuCloser, closeAllMenus` main.ts 直接引用 | ✅ 已清空,改用 showTopMenu 包装 |
| @ts-ignore 数量 | 10(未变) |
| 新增文件 | 4(src/core/libraryFileOps.ts + .test.ts, src/ui/topMenu.ts + .test.ts) |

## 关联

- Batch 1-6(略)
- **Batch 7 (`13e05fb`): 本批**

## Codex 复审记录

**R1 调研**: 给出 3 个候选(libraryFileOps / topMenu / codeCopyEvents),
Claude 选前 2 个稳妥的,codeCopyEvents 留到下批(也属 S 复杂度但需要处理 capture 监听器的特殊性)。

**R2 提交前**: 2 轮往返
- **R2 首轮 REJECTED**: 抓 pre-existing `deleteFileSafe` 目录删除兜底不可达(不在本次抽离 scope)
- **R2 复审 APPROVED**: 降级为 pre-existing 风险记录,0 blocker/0 important/0 nit
