# Task 文档约定

> 任务计划与执行档案的目录约定。CLAUDE.md 中已声明，本文件作为目录索引落地。

## 目录结构

```
docs/Task/
├── README.md              # 本文件（约定与索引）
├── Active/                # 进行中或待执行的任务计划
└── Archive/
    └── YYYY-MM/           # 按月归档已完成的任务
```

## 文件命名

- `YYYY-MM-DD-<kebab-title>.md`，例如 `2026-06-02-flymd-quality-baseline.md`
- 一份文件聚焦一条主线任务（可含多个子任务）

## 文档骨架

每个计划文件至少包含：

1. **元数据** — 创建日期、责任人、状态、范围
2. **目标（Goals）** — 必须可验证、可终止
3. **现状分析（Context）** — 引用文件路径与行号、引用提交哈希
4. **子任务清单（Subtasks）** — 每条带状态标记
5. **验收标准（Acceptance）** — 能否通过测试、构建、人工核查的条件
6. **风险与回滚（Risks & Rollback）** — 失败时如何回退
7. **工时估算（Estimate）** — 粗粒度（S / M / L / XL）

## 状态标记

| 标记 | 含义 |
|------|------|
| ⏳ | 待执行 |
| 🔄 | 进行中 |
| ✅ | 已完成 |
| ⏸ | 已暂停（写明原因） |
| ❌ | 已废弃（写明原因） |

## 归档规则

任务完成后，在文件顶部更新状态为 ✅，并整体移动到 `Archive/YYYY-MM/`（按完成日期）。在本 README 增补一行索引（如有显著产出）。

## 索引

### Active

- [2026-06-02-flymd-quality-baseline.md](Active/2026-06-02-flymd-quality-baseline.md) — FlyMD 质量基线与技术债清理（P0-P3 七项 + A.1）
  - **Task A ✅**（wysiwyg/v2 11 → 0；顺带修 1 处真实 bug：`docChanged → updated`）
  - **Task A.1 ⏳**（剩余 116 处 TS 错误，5 个 Batch）

### Archive

#### 2026-06

- ✅ [2026-06-02-open-file-external-change-watch.md](Archive/2026-06/2026-06-02-open-file-external-change-watch.md) — 打开文件外部更改监听（一期 MVP,完成 2026-06-03,⚠️ 未经 codex 复核）
  - **PR-1 ✅**（核心模块 + 主流程集成,1.1–1.12 子任务全部完成）
  - **PR-1.1 ✅**（codex review 修 7 个 P0/P1 阻断 bug,commit 371997b）
  - **PR-2 ✅**（模态抽离 + 偏好面板 3 开关 + 中英双文档,commit 27f3f8a）
  - **PR-2.1 ✅**（codex review 修 1 P1 阻断 + 2 P2,commit a0aa86e）
  - **PR-3 ✅**（≤1MB SHA-1 hash 优化,降 false positive,commit 62d6709）
  - 详见 [2026-06-04-external-watch-pr1-fixes.md](Archive/2026-06/2026-06-04-external-watch-pr1-fixes.md) / [2026-06-04-external-watch-pr2.md](Archive/2026-06/2026-06-04-external-watch-pr2.md) / [2026-06-04-external-watch-pr3-hash.md](Archive/2026-06/2026-06-04-external-watch-pr3-hash.md)
