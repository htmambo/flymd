# callout 复制按钮改文字式 + 已复制/1.2s 还原

**状态**: ✅ 已完成 (完成时间: 2026-06-08)
**提交**: `52a3eef`(已推送 origin)
**复审**: Codex R2 APPROVED(0 blocker / 0 important / 2 nit)

## 目标

把 callout 右上角"复制"按钮从 SVG 图标改成文字式(对齐 `.code-copy` 风格),
点击后改"已复制"文案 + 1.2s 还原(沿用 src/ui/codeCopyEvents.ts 行为)。

## 现状分析

原 `.callout-copy-icon` 渲染 SVG 双矩形图标,点击通过 `navigator.clipboard.writeText`
写入剪贴板但**无视觉反馈**。用户已习惯 `.code-copy` 的"已复制"反馈节奏,
需统一两类按钮的交互语言。

覆盖 2 个 callout 渲染路径:
1. markdown-it 预览路径(默认):`src/plugins/markdownItCallout.ts` 渲染 HTML + `src/plugins/calloutPreviewEvents.ts` 事件处理
2. WYSIWYG v2 路径(所见模式):`src/wysiwyg/v2/plugins/callout.ts` Milkdown NodeView 独立构造 DOM

## 子任务清单

### T1 ✅ markdownItCallout.ts 改文字
- 删除 `getCopyIcon()` 助手(line 49-51 整体删除)
- line 279 改为 `<div class="callout-copy-icon" data-callout-copy title="复制内容">复制</div>`

### T2 ✅ calloutPreviewEvents.ts 反馈
- 增 3 个常量:`COPIED_TEXT = '已复制'` / `RESET_TEXT = '复制'` / `RESET_DELAY_MS = 1200`
- 原同步 `navigator.clipboard.writeText().catch(() => {})` 改为 `void (async () => {...})()` IIFE
- 失败时静默 return(无"复制失败"反馈,设计取舍:标题栏空间有限)
- 成功时:`copyBtn.textContent = COPIED_TEXT; setTimeout(() => { copyBtn.textContent = RESET_TEXT }, RESET_DELAY_MS)`
- 注释明确化:与 codeCopyEvents 行为差异(无 FAILED_TEXT,无 execCommand 兜底)

### T3 ✅ WYSIWYG v2 callout.ts 同步
- `getCopyIconSvg()` 返回值由 SVG 字符串改为 `'复制'`(函数名保留,加注释说明)
- `copyBtn.innerHTML = ...` → `copyBtn.textContent = ...`(XSS 加固,虽当前静态但更稳健)
- `copyContent()` 改为 async IIFE;成功后:`this.dom.querySelector('.callout-copy-icon').textContent = '已复制'` + 1.2s 还原

### T4 ✅ callout-copy-icon.css 适配文字
- 删除 `.callout-copy-icon svg { width: 14px; height: 14px; }`
- 加 `padding: 0 6px` / `min-width: 28px` / `font-size: 12px` / `line-height: 1` / `cursor: pointer` / `user-select: none`
- `display: flex` → `display: inline-flex`

### T5 ✅ 测试
- 新增 2 个测试:成功改文案 + 1.2s 还原、clipboard 失败不改文案
- 原 8 个测试保持通过

### T6 ✅ 验证
- `npx tsc --noEmit` 0 错误
- `npm test` 371/371 通过(原 369 + 新增 2)

## 验收标准

- [x] 视觉: callout 复制按钮显示"复制"文字(非图标)
- [x] 交互: 点击后立即变"已复制",1.2s 后还原"复制"
- [x] 覆盖: 2 个 callout 渲染路径(markdown-it 预览 + WYSIWYG NodeView)都改了
- [x] 安全: textContent 替代 innerHTML,杜绝注入风险
- [x] Codex R2 APPROVED
- [x] 提交 + 推送完成

## Codex 复审过程

- **R1**: REJECTED(0 blocker, 1 important, 2 nit)
  - P1: wysiwyg/v2 callout 仍用 SVG、无反馈 → 已修
  - P2 nit 1: 注释欠精确 → 已扩注释明确化与 codeCopyEvents 的行为差异
  - P2 nit 2: `afterEach` 未用 → 已知,项目 lint baseline 无 `no-unused-imports` 规则
- **R2**: APPROVED(0 blocker, 0 important, 2 nit) → 收

## 风险与回滚

- **设计取舍**: 与 codeCopyEvents 失败时"复制失败"反馈不同,callout 失败时静默。理由:标题栏空间有限 + 失败罕见。若用户反馈需要"复制失败"提示,后续 batch 加。
- **双重击 race**: 1.2s 内连点两次复制,前次 setTimeout 会过早还原文案。codeCopyEvents 同样 race,接受一致性。
- **回滚方案**:`git revert 52a3eef`

## 工时估算

实际: ~30 分钟(1 轮 codex 复审被 reject,修 WYSIWYG 后 R2 通过)

## 备注

- 这是 callout 系统的 UI 一致性改进,非 main.ts 模块化拆分(不属于 Phase B 范围)
- 累计 Phase B 抽离模块数仍为 8(本次未新增模块)
- 后续候选:如需 callout 复制失败时也显示"复制失败",在两个 path 的 `if (!ok) return` 后追加分支即可
