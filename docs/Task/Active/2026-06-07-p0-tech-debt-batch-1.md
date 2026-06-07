# Phase B — P0 入口拆分（main.ts + style.css 模块化）

| 字段 | 内容 |
|------|------|
| 创建日期 | 2026-06-07 |
| 责任人 | 果农 + Claude（协作）+ Codex 复审 |
| 状态 | 🔄 进行中（B1 + E1 调研完成） |
| 关联 | `2026-06-02-flymd-quality-baseline.md` Task B + Task E、`docs/Task/Active/2026-06-02-flymd-quality-baseline.md` |

## 0. 目标

- `src/main.ts`：12,025 行 → ≤ 800 行（仅做入口编排）
- `src/style.css`：9,329 行 → ≤ 200 行（仅做 `@import` 编排）
- 启动耗时（DOM 就绪 / 首次渲染 / 应用就绪）不劣于拆分前
- 所有快捷键、扩展、托盘、菜单行为人工回归通过

## 1. 现状

### 1.1 main.ts 体量
- 12,025 行单文件
- 承担：DOM 初始化、命令注册、快捷键、菜单组装、模式切换、托盘、Tauri IPC、扩展启动、托管事件、错误兜底
- 任何 PR 触动它都会带出巨型 diff，git blame 失效

### 1.2 style.css 体量
- 9,329 行单文件
- 承担：变量定义、5 套主题、3 个模式（源码/阅读/所见）、库侧栏、标签、对话框、便签、专注、AI 面板、移动端、命令面板、PDF 导出预览……
- 主题切换需全量重新计算样式

## 2. 拆分草案

### 2.1 main.ts 拆分

```
src/
└─ main.ts                 # ≤ 800 行：按顺序调用 boot 阶段
   ├─ bootstrap/
   │  ├─ initDom.ts        # DOM/视图初始化
   │  ├─ initTauri.ts      # Tauri IPC、单实例、文件托管
   │  ├─ initShortcuts.ts  # 全局快捷键
   │  ├─ initMenus.ts      # 菜单/命令面板组装
   │  ├─ initExtensions.ts # 扩展宿主启动
   │  └─ initLifecycle.ts  # 启动/退出阶段钩子
   └─ commands/            # 按命令族拆分（file/view/edit/window/tools）
```

### 2.2 style.css 拆分

```
src/styles/
├── base.css              # 变量、复位、字体
├── theme-light.css       # 亮色主题变量
├── theme-dark.css        # 暗色主题变量
├── typography.css        # 正文/标题/代码字体
├── library.css           # 库侧栏 / 文件树
├── tabs.css              # 标签栏
├── editor.css            # 源码模式
├── preview.css           # 阅读模式
├── wysiwyg.css           # 所见模式
├── dialog.css            # 弹窗 / 命令面板 / 设置
├── ai-panel.css          # AI 助手停靠面板
├── sticky-note.css       # 便签模式
├── focus-mode.css        # 专注模式
├── mobile.css            # 移动端（保留独立）
└── index.css             # 仅做 @import 编排
```

## 3. 任务分解

### 3.1 main.ts 拆分

| 任务 | 文件 | 状态 |
|------|------|------|
| **B1** | 调研：Grep main.ts 调用点分类 → `main-ts-inventory.md` | ✅（144 addEventListener / 10 register / 18 invoke / 4 listen / 477 函数 / 103 import） |
| **B2** | 剥离**无副作用纯逻辑**（命令处理函数）到 `src/commands/*.ts`（按命令族 file/view/edit/window/tools） | ⏳ |
| **B3** | 剥离 **DOM 引导**到 `src/bootstrap/initDom.ts` | ⏳ |
| **B4** | 剥离 **Tauri IPC / 单实例 / 文件托管**到 `src/bootstrap/initTauri.ts` | ⏳ |
| **B5** | 剥离 **快捷键注册**到 `src/bootstrap/initShortcuts.ts`（注意输入法、便签模式、专注模式下的差异） | ⏳ |
| **B6** | 剥离 **扩展宿主启动**到 `src/bootstrap/initExtensions.ts` | ⏳ |
| **B7** | `main.ts` 收敛为顺序调用 + 顶级 try/catch + 启动 telemetry | ⏳ |

### 3.2 style.css 拆分

| 任务 | 文件 | 状态 |
|------|------|------|
| **E1** | 调研：Grep style.css 注释段分组 → `style-css-inventory.md` | ✅（26 段大注释段，14 个候选 CSS 文件） |
| **E2** | 逐组迁移并删除原段（每组单 commit） | ⏳ |
| **E3** | 在 main.ts / Bootstrap 处确认 CSS 入口仍指向单一组合文件 | ⏳ |
| **E4** | 验证：5 主题 × 3 模式 × 2 OS 截图对比 | ⏳ |

## 4. 验收标准

- `main.ts` ≤ 800 行
- 每个 `bootstrap/init*.ts` ≤ 400 行
- `style.css` ≤ 200 行（仅做 `@import` 编排）
- `npm run build` ✅
- `npm test` 全过
- `npx tsc --noEmit` 0 错误
- 启动耗时不劣于拆分前
- 库树 / PDF 导出 / 主题切换 / 模式切换 / 便签 / 专注 行为不变

## 5. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 模块化过程易破坏闭包内隐式共享状态 | 每个 Bx 单 commit；B1 + E1 调研产物先入 git 再大改 |
| CSS 顺序依赖隐含覆盖关系 | E1 调研先识别覆盖关键点；每组迁移前后用 DevTools "已计算样式"对照 |
| 启动顺序敏感 | 引入 `src/bootstrap/__golden__/` 记录拆分前各模块对外暴露的全局副作用清单作为对照 |
| 回滚 | 按 commit 粒度 revert；最坏情况整体退回 Phase B 起点 |

## 6. 协作与提交规范

- 每个子任务独立 commit
- 提交信息沿用项目已有风格：中文标题 + bullet body + `Co-Authored-By:` trailer
- 涉及破坏性改动需在 `ROADMAP.md` 同步发版说明
- 跨多个子任务的大改：先开分支 `refactor/main-ts-split` 跑通再合入

## 7. 进度

| 子任务 | 状态 | 备注 |
|---|---|---|
| B1 调研 main.ts 调用点 | ✅ | 2026-06-07（main-ts-inventory.md） |
| E1 调研 style.css 注释段 | ✅ | 2026-06-07（style-css-inventory.md） |
| B2 剥离命令处理 | ⏳ | 计划 1 日 |
| B3 剥离 DOM 引导 | ⏳ | 计划 0.5 日 |
| B4 剥离 Tauri IPC | ⏳ | 计划 1 日 |
| B5 剥离快捷键 | ⏳ | 计划 0.5 日 |
| B6 剥离扩展宿主 | ⏳ | 计划 0.5 日 |
| B7 main.ts 收敛 | ⏳ | 计划 0.5 日 |
| E2 逐组迁移 | ⏳ | 计划 1-2 日 |
| E3 验证入口 | ⏳ | 计划 0.5 日 |
| E4 视觉回归 | ⏳ | 计划 0.5 日 |

**Phase B 估算总工时**：L（5-7 天）

## 8. 下一步

1. **B1** Grep 调研 main.ts 调用点（**先做这个**，决定后续拆分策略）
2. **E1** 并行调研 style.css 注释段

调研产物先入 git，再开大改。
