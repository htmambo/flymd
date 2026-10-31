# 主题背景收敛：所见背景并入阅读背景，退役 `--wysiwyg-bg`

**状态**: ✅ 已完成 (completion time: 2026-10-31)
**创建时间**: 2026-10-31
**责任人**: MCode（minimax Code）
**范围**: `src/theme.ts`、`src/styles/*`、`src/modes/cm6Editor.css`、`src/modes/sourceLineNumbers.ts`、`src/core/uiNotifications.ts`、`src/wysiwyg/v2/**`、`src/exporters/pdf.ts`、`src/i18n.ts`
**基线提交**: `3eb6b34`（分支 `fix/audit-round1-correctness`）

---

## 1. 目标（Goals）

1. **删除主题面板里的独立「所见背景」设置**——所见模式已与阅读模式共用同一套正文排版与主题（`.md-content`），纸面背景再拆一份属于重复事实源。
2. **背景语义收敛为两套**：源码编辑区（textarea / CM6 / 行号栏）= `--bg`；阅读模式与所见模式 = `--preview-bg`。
3. **修复暗色模式下残留浅色背景**：夜间模式不再携带任何日间写入的浅色内联变量。

## 2. 现状分析（Context）

### 2.1 用户反馈

- 「深色模式下，行号栏的背景会变为亮色背景」（文件树与主内容之间那一条行号列）
- 「在设置中切换夜间模式时稳定复现」
- 「所见已经同步了阅读模式的样式设置，为什么非夜间模式时还要有单独的所见模式的背景颜色设置？」

### 2.2 已确认的根因（浏览器实测）

`src/theme.ts:360-380 applyThemePrefs` 的日/夜两分支**写入的 CSS 变量集合不对称**：

```ts
if (isDarkMode) {
  c.style.setProperty('--bg', editDark)
  c.style.setProperty('--preview-bg', readDark)
  // 夜间模式下，所见模式背景固定使用 CSS 定义的颜色，不支持用户调整   ← 注释这么写
} else {
  c.style.setProperty('--bg', prefs.editBg)
  c.style.setProperty('--preview-bg', prefs.readBg)
  c.style.setProperty('--wysiwyg-bg', prefs.wysiwygBg)   ← 只有日间分支写
}
```

夜间分支**从不清理**日间留下的内联 `--wysiwyg-bg`，于是暗色下容器上仍挂着浅色值。

浏览器实测（夜间模式，`http://127.0.0.1:5173/`，`.container` 内联样式）：

```
--bg: #0b0c0e; --preview-bg: #12100d; --wysiwyg-bg: #ffffff;
```

`#ffffff` 就是夜间残留的日间值。所有消费 `--wysiwyg-bg` 的元素在暗色下都仍是浅色。

### 2.3 消费者清单（全量清点：`--wysiwyg-bg` / `wysiwygBg`）

| # | 消费者 | 位置 | 现状 | 新归属 |
|---|--------|------|------|--------|
| 1 | 所见模式容器底色 | `styles/editor.css:29` | `--wysiwyg-bg` | `--preview-bg` |
| 2 | 所见正文区（暗色兜底） | `styles/dark-mode.css:241` | 硬编码 `#0b1016` | `var(--preview-bg)` |
| 3 | 所见广义兜底（含容器） | `styles/dark-mode.css:242-243` | 硬编码 `#0b1016` | `var(--preview-bg)` |
| 4 | 遗留 overlay 所见预览底 | `styles/code-block-decoration.css:206,229` | `--wysiwyg-bg` | `--preview-bg` |
| 5 | **CM6 宿主 / 编辑区 / 行号栏** | `modes/cm6Editor.css:15,21,26` | `--wysiwyg-bg` | `--bg`（CM6 是源码编辑器） |
| 6 | **源码行号栏 `.editor-gutter`** | `styles/editor.css:54` | 透明（透出容器/面板底色） | 显式 `var(--bg)` |
| 7 | 公式/图表编辑按钮、编辑提示 | `styles/editor.css:695,753` | `--wysiwyg-bg` | `--preview-bg` |
| 8 | 所见源码浮层（latex/mermaid/html） | `wysiwyg/v2/index.ts:2576,2792,3061,3459,3658` | `--wysiwyg-bg` | `--preview-bg` |
| 9 | Mermaid 编辑按钮 | `wysiwyg/v2/plugins/mermaid.ts:260` | `--wysiwyg-bg` | `--preview-bg` |
| 10 | PDF 导出变量表 | `exporters/pdf.ts:530` | `--wysiwyg-bg: #f3f4f6` | 删除（已设 `--preview-bg`） |
| 11 | 主题面板「所见背景」设置 | `theme.ts:811-824` + swatch/preview/revert/save | 有 | 删除 UI 与 CSS 写入 |
| 12 | 变量定义 | `styles/base.css:20,97,143`、`styles/dark-mode.css:6` | 有 | 删除 |
| 13 | i18n 文案 | `i18n.ts:87,687` | `theme.wysiwygBg` | 删除 |
| 14 | 「所见羊皮纸」开关 | `theme.ts:812-824` 内 | 有 | 删除 UI；偏好字段与 class 保留（旧值原样回写） |

### 2.4 `.editor-gutter` 与 `.cm-gutters` 的关系

两层不同的东西，本次都要收口：

- `.editor-gutter`（`modes/sourceLineNumbers.ts:398`）：源码 textarea 左侧的行号列，**当前无 background 规则**，靠透出祖先底色显示 → 祖先底色一旦变亮，这条列就跟着变亮（用户看到的现象）。
- `.cm-gutters`：CM6 大文档编辑器的行号列，`background: var(--wysiwyg-bg, var(--bg))` → 夜间直接吃到残留的浅色值。

### 2.5 排查结论

- 打印：`styles/print.css:101` 强制 `body, .preview { background: white !important }` → 不受本次改动影响。
- CM6 样式竞争：CM6 注入的基础主题选择器特异性为 (0,1,0)，本仓规则 `.cm6-editor-host .cm-gutters` 为 (0,2,0) → 本仓规则恒胜出。
- `body.dark-mode .container`（0,2,1）与 `body.dark-mode [class*="wysiwyg"]`（0,2,1）平级，靠 `index.css` 顺序决胜 → 需显式加 `body.dark-mode .container.wysiwyg-v2`（0,3,1）避免顺序依赖。
- 未发现「遍历设置项 → `setProperty('--' + key)`」式的通用注入路径（已逐条核对 `theme.ts` 全部 `setProperty` 调用点）。

## 3. 子任务清单（Subtasks）

- [x] T1 需求轮外审（session `a6c183c0-3fa9-4a32-a4eb-97c383256916`）——结论：方向正确；要求补齐消费者清单、遗留数据兼容、对称性单测、验收矩阵
- [x] T2 写本任务文档 + 计划轮外审（session `e6298804-4b6d-4622-afd7-12609b733501`，有条件通过；放行条件：补运行时验证手段、验收矩阵扩到羊皮纸/PDF、明确排期、产品侧确认——产品侧确认由用户提问本身完成）
- [x] T3 样式层：`--wysiwyg-bg` 变量退役 + 消费者改指（`base.css` / `dark-mode.css` / `editor.css` / `code-block-decoration.css` / `cm6Editor.css`）
- [x] T4 `.editor-gutter` 显式 `background: var(--bg)`，不再透底
- [x] T5 `theme.ts`：删「所见背景」设置与全部 CSS 写入分支；夜间分支清理历史残留内联值；所见外圈色推导改用阅读背景
- [x] T6 `wysiwyg/v2/**` 浮层与按钮背景改 `--preview-bg`
- [x] T7 `exporters/pdf.ts` 删 `--wysiwyg-bg`
- [x] T8 `i18n.ts` 删 `theme.wysiwygBg`
- [x] T9 新增 `src/styles/themeBackgroundTokens.test.ts`（6 例）：变量退役断言 + `applyThemePrefs` 日/夜写入键集合对称性断言 + 旧配置读取兼容断言
- [x] T10 门禁：`typecheck` / `vitest` / `build` + 浏览器实测（明/暗 × 源码/阅读/所见）
- [x] T11 代码轮外审 + 归档 + README 索引
- [x] T12 「源码行号只能重启才生效」定位与修复（用户第三问，见 §8）
- [x] T13 新增 `src/modes/sourceLineNumbers.install.test.ts`（10 例）：安装不放弃 / 幂等标志时机 / 提示链路不变量
- [x] T14 代码轮外审 3 轮（REQS_CHANGES ×2 → APPROVED），见 §9
- [x] T15 最终门禁复跑 + 浏览器双分支实测（所见模式弹提示 / 源码模式不弹）

## 4. 验收标准（Acceptance）

1. `pnpm test` 全绿（新增用例通过），`pnpm typecheck` 无错，`pnpm build` 通过（含入口静态闭包）。
2. 源码、样式、导出链中**不再出现** `--wysiwyg-bg` 的定义/消费/写入（仅允许一处 `removeProperty` 清理语句）。
3. 主题面板不再出现「所见背景」区块；`theme.wysiwygBg` 文案从 i18n 中消失。
4. 浏览器实测：夜间模式下切换设置里的夜间开关，`.container` 内联样式里**不存在**浅色背景变量；三模式内容区与行号栏底色一致。
5. 旧配置（localStorage 含 `wysiwygBg`）加载不报错、不复活变量，且该字段原样回写（保证 git revert 后用户设置不丢）。
6. 阅读模式观感零变更（沿用 `scripts/style-parity/` 的 baseline 校验）。

## 5. 风险与回滚（Risks & Rollback）

| 风险 | 处置 |
|------|------|
| 所见模式日间底色从 `--wysiwyg-bg`（#f3f4f6 冷灰）变为阅读背景（#fafafa / 用户设置） | 预期内：用户明确要求所见=阅读；阅读背景可在面板里调 |
| 夜间所见底色从 `#0b1016`（冷蓝黑）变为 `#12100d`（暖黑） | 预期内：与阅读模式统一；代码块底色 `#1a1f27` 仍与之明确区分 |
| CM6 日间底色从 `#f3f4f6` 变为 `--bg`（#ffffff 纯白） | CM6 是源码编辑器，与 textarea 同底色更自洽 |
| 用户已自定义的「所见背景」值失效 | 保留偏好字段并原样回写（不删除用户数据），发布说明中记一笔 |
| `applyThemePrefs` 其它变量仍可能存在类似不对称 | 列入后续任务，本次用对称性单测锁死当前集合 |

**回滚**：`git revert` 本次提交即可。旧配置字段未被删除，回滚后所见背景自动恢复。

## 6. 工时估算（Estimate）

M（0.5–1 人日，含验证与外审）

## 7. 备注（Remarks）

- 外审要求「浮层用纸面色 questionable」：本次沿用仓库既有先例（`preview.css` 的 `.md-footnote-tooltip` 浮层即用 `var(--preview-bg)`），不新造第三个 token；独立 `--overlay-bg` 留作后续设计债。
- 外审要求「验收矩阵覆盖日/夜 × 浅/深 × 三模式」：本次以「静态断言 + 浏览器实测三模式」覆盖；系统浅色/深色差异由 `body.dark-mode` / `body.light-mode` / `@media (prefers-color-scheme)` 三套定义决定，不引入新的组合维度。

## 8. 附带子任务：源码行号「只能重启才生效」（T12–T15）

### 8.1 机制定位（实测，非推测）

行号列 `.editor-gutter` 是**源码编辑器专属 DOM**（`modes/sourceLineNumbers.ts` 安装，挂在 textarea 上）。`flush()` 中
`nextLineNumbersActive = _pref && mode === 'edit' && !wysiwyg && !stickyNote` → **所见 / 阅读模式下这一列根本不渲染**，
所以在那两种模式里切开关看不到任何变化。应用默认进入所见模式 → 极易被误判为「改了不生效、要重启」。

真正需要重启的失败路径只有一条：旧实现在编辑器 DOM 未挂上时 `setTimeout(installLineNumbers, 800)` 后直接 `return`，
**永不重试** → 本会话永远没有行号列，只能重启。

### 8.2 落地修复（三管齐下）

1. **即时反馈**：切开关时若当前不在源码模式，弹 `setting-hint` 通知「源码行号只作用于源码模式，已保存；切到源码模式即可看到」；
   开关本身加 tooltip「源码模式编辑器左侧的行号列（只在源码模式显示）」。
2. **安装不放弃**：`scheduleInstall` 改为有限次重试（12 × 800ms ≈ 9.6s），窗口用尽后转入 `MutationObserver` 兜底
   （监听 `document.body`，命中新增的 `#editor` 即安装），杜绝静默永久放弃。
3. **安装幂等标志时机修正**：`flymd.__flymdSourceLineNumbersInit` 原在 DOM 组装**之前**置位，
   而 `if (!parent) return` 发生在其后 → 走到该分支时标志已被占用却没装成行号列，本会话永久失效（退化回「必须重启」）。
   现改为**子树在游离状态组装完成、一次性插入 DOM 之后**才置位；并补「编辑器已在 .editor-shell 内」的防御分支，避免二次插入触发层级错误把安装卡死。

### 8.3 浏览器实测

| 场景 | 预期 | 实测 |
|------|------|------|
| 所见模式切「源码行号」 | 弹出提示 | ✅ `.notification-item` 渲染出「源码行号只作用于源码模式，已保存；切到源码模式即可看到」 |
| 源码模式切「源码行号」 | 不弹提示（效果立即可见） | ✅ 通知容器为空；`.editor-shell` 立即增删 `line-numbers-disabled`，行号列即时重绘 |
| 源码模式行号列底色 | 暗色下不得变亮 | ✅ 截图确认行号栏与源码区同为深色，无亮色带 |

> 实测注：提示时长 3.2s，短于两次工具调用的实际间隔，首轮「无通知」是**观察窗口过期**而非功能失效；
> 拉长观察窗口后复测通过。这一误判过程已记入 §9 的外审佐证。

## 9. External Review Opinion

| 轮次 | 类型 | session | 结论 |
|------|------|---------|------|
| 1 | requirement | `a6c183c0-3fa9-4a32-a4eb-97c383256916` | 方向正确，要求补齐消费者清单 / 遗留数据兼容 / 对称性单测 / 验收矩阵 / 回滚说明（均已落实） |
| 2 | plan | `e6298804-4b6d-4622-afd7-12609b733501` | 有条件通过（补运行时验证手段、验收矩阵扩到羊皮纸/PDF、明确排期、产品侧确认） |
| 3 | code | `3653f0b7-61e5-4d84-92e3-a6296c24c735` | **REQS_CHANGES**（4×P1 + 3×P2） |
| 4 | code | `92c1b891-fd7f-428b-9f59-098ecaa1e573` | **REQS_CHANGES**（2×P2 + 3×P3） |
| 5 | code | `7cc712d4-be8c-4717-a318-8d4eb4ef986c` | **APPROVED** |

### 9.1 代码轮采纳 / 驳回明细

| 外审意见 | 处置 | 依据 |
|---------|------|------|
| 有限重试仍可能永久放弃安装 | **采纳** | 改为重试窗口用尽后 `MutationObserver` 兜底 + `console.warn` 留痕 |
| 并发链可能双重安装 | **驳回** | `installLineNumbers` 由 `flymd.__flymdSourceLineNumbersInit` 保证幂等，且安装体全同步无 `await` 交错 |
| `catch {}` 静默吞掉提示 | **采纳** | try 收窄到两次钩子读取；钩子缺失/抛错一律降级为「未知模式」→ 仍弹提示 |
| 分屏模式会误弹「切到源码模式」 | **驳回** | 分屏要求 `mode === 'edit' && !wysiwyg`（`modes/sourcePreviewSplit.ts:isSupportedContext`）→ 判为源码模式，不提示 |
| 未知模式时应弹提示 | **采纳** | `mode` 缺失 → `inSourceMode === false` → 弹提示（反馈 fail-open） |
| `String(null)` 误判 | **采纳** | 改为 `typeof raw === 'string'` |
| 时长字面量重复 | **采纳** | 调用点去掉第三参，配置表为唯一事实源 |
| 首次探测应立即执行 | **驳回** | 保留 800ms 首延迟：过早安装会让编辑器尚未就位时半途失败；改为「组装完成后才置幂等标志」后，早装不再吞掉安装机会 |
| 安装中断会二次插入并卡死 | **采纳** | 子树游离组装 + 单次插入；补 `.editor-shell` 已存在时的防御分支 |
| 观察器每次变更都做全局查询 | **采纳** | 改为扫描 `MutationRecord.addedNodes` 命中 `#editor` 才动作 |
| `getFlymd()` 可能返回新对象 | **驳回** | `getFlymd()` 返回 `window as any`（稳定单例） |
| 非 `edit` 模式弹提示 | **驳回** | 该特性本就是源码编辑器专属，在阅读/所见模式提示正是要消除用户困惑的反馈 |

## 10. 验收结果（Acceptance Result）

| # | 验收项 | 结果 |
|---|--------|------|
| 1 | `tsc --noEmit` 无错 / `vitest` 全绿 / `vite build` 通过 | ✅ 0 错；**79 文件 / 952 用例**全绿；`✓ built in 4.9s`（入口静态闭包 8 文件 OK） |
| 2 | 源码/样式/导出链不再出现 `--wysiwyg-bg`（仅允许一处 `removeProperty`） | ✅ `themeBackgroundTokens.test.ts` 断言通过 |
| 3 | 主题面板不再出现「所见背景」区块；`theme.wysiwygBg` 文案消失 | ✅ 截图确认区块消失 |
| 4 | 夜间模式 `.container` 内联样式不含浅色背景变量 | ✅ 冷启动实测：`--bg: #0b0c0e; --preview-bg: #12100d`，**无 `--wysiwyg-bg`** |
| 5 | 旧配置（含 `wysiwygBg`）可读且原样回写 | ✅ 单测断言通过 |
| 6 | 阅读模式观感零变更 | ✅ 沿用 `scripts/style-parity/` 基线校验 |
| 7 | 源码行号即时反馈 + 安装不放弃 | ✅ 双分支浏览器实测通过；10 条新增不变量用例全绿 |

## 11. 遗留与后续

- **「所见模式不能编辑」**：代码侧未发现本次回归；缺用户现象细节（整篇不可输入 / 仅代码块 / 仅公式表格块 / 是否已切成 CM6），留待用户补充后单独立项。
- **各主题暗色下的代码块背景**：`dark-mode.css` 的统一 `!important` 使各主题代码块底色在暗色下未被逐个调亮；是否统一救活需产品决策。
- **`loadThemePrefs` 不读取 `parchmentEdit` / `parchmentRead` / `parchmentWysiwyg`**（既有 bug：羊皮纸开关保存后不恢复），本次未修，已记录。
