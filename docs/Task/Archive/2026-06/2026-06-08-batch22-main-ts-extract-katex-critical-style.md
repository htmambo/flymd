# Batch 22: 抽离 katexCriticalStyle(KaTeX 兜底 CSS 注入)

> 状态: ✅ 已完成(完成 2026-06-08,经 Codex R1 复审 APPROVED,后已修)
> 提交: `157e94b`(已推送 origin)
> 范围: Phase B 第二十二批 — main.ts 模块化拆分

---

## 目标(Goals)

继续 Phase B 拆分。把 main.ts 中 KaTeX 兜底 CSS 注入抽离到
独立模块 `src/modes/katexCriticalStyle.ts`(工厂模式)。

## 现状分析(Context)

- main.ts 9007 行(Batch 21 拆分后)
- module-level const: `KATEX_CRITICAL_STYLE_ID = 'flymd-katex-critical-style'` (1 行)
- 函数 `ensureKatexCriticalStyle()` (~41 行,含整段 CSS 文本)
- 2 个 call site: L331 (renderKatexPlaceholders) + L1823 (Wysiwyg init)

## 子任务清单(Subtasks)

- **T1 ✅** `src/modes/katexCriticalStyle.ts` 新建(~85 行,5 tests)
  - 工厂 `createKatexCriticalStyle({ id })` → `{ ensure() }`
  - 命名导出常量 `KATEX_CRITICAL_STYLE_ID`(默认 'flymd-katex-critical-style')
- **T2 ✅** `src/modes/katexCriticalStyle.test.ts` 新建(5 tests, jsdom env)
  - 默认 id 与 main.ts 沿用一致
  - 首次 ensure 注入 / idempotent / 多实例 id 共存
  - **brace-center width: 50% 脆弱规则回归断言**(Codex R1 nit)
- **T3 ✅** main.ts:
  - 删除 1 个 const + 1 个函数 (42 行)
  - 加 import + factory 实例化 + 改 2 call site
  - 用 `KATEX_CRITICAL_STYLE_ID` 引用避免字面量重复(Codex R1 nit)
- **T4 ✅** main.ts 净 **-35 行**(9007→8972)
- **T5 ✅** Codex R1 复审:
  - 初始 REJECTED 1 blocker (`.brace-center` width 被误改 50% → 50.2%)
  - 已 revert 回 50% + 采纳 2 nit
  - 最终通过
- **T6 ✅** 验证: tsc 0 错误、test 541/541(原 536 + 4 + 1 nit 补)

## 实施细节

### 关键设计

1. **工厂模式** — `createKatexCriticalStyle({ id })` → `{ ensure() }`
   - 闭包无外部状态,ensure() 内部 idempotent(getElementById 早返)
   - id 通过 deps 注入,便于测试用不同 id 隔离
2. **CSS 文本作模块内常量** — 整段 CSS (~30 行规则) 作为 `KATEX_CRITICAL_CSS`
   - 1:1 verbatim 保留所有规则(尤其 `.brace-center` 宽度)
3. **常量命名导出** — `KATEX_CRITICAL_STYLE_ID` 命名导出,main.ts 直接复用
   - 避免字面量重复,Codex R1 nit 已采纳
4. **`katexCriticalStyleApi!` 非空断言合理** — factory 在 katexCacheApi 之后实例化,
   先于任何 ensure() 调用

### Codex R1 复审(踩坑记录)

- **R1** 初始 **REJECTED** 1 blocker + 2 nits
  - Blocker: 抽出时手误把 `.brace-center` 宽度从 `50%` 改成了 `50.2%` — **已 revert**
  - Nit 1: `KATEX_CRITICAL_STYLE_ID` 字面量重复 — **已采纳**(用 import 的常量)
  - Nit 2: 加 brace-center 回归断言 — **已采纳**(防止未来再次手误)
- **教训**:
  - 整段 CSS 文本复制时必须用 diff 工具逐行校验
  - 大段 verbatim 文本适合加 1-2 个针对最易错位置的回归断言
  - Codex 的 strict byte-compare 在 R1 抓到差点溜走的 regression

## pre-existing 行为保留

- id string: 'flymd-katex-critical-style'
- 早返: `document.getElementById(id)` 已存在则不重复注入
- style 标签属性: `.id = id`, `.textContent = KATEX_CRITICAL_CSS`
- 挂载点: `document.head.appendChild`
- try/catch 包裹整个 ensure 主体
- 所有 CSS 规则 verbatim(尤其 `.brace-center { ...; width: 50%; }`)

## 验证(Verification)

- `npx tsc --noEmit` → **0 错误**
- `npm test -- --run` → **541/541 通过**(原 536 + 新增 4 + 1 nit 补)
- main.ts 净 **-35 行**(9007→8972)
- 提交: `157e94b`(已推送 origin)
- Codex: R1 REJECTED → 修复后 APPROVED(0 blocker,2 nit 已采纳)

## 备注

- 教训: 整段 verbatim 文本(CSS/JSON/正则)抽出时务必用 diff 校验,
  比肉眼更可靠
- 教训: 1-2 个针对最易错位置的回归断言值得加,防止未来再次手误
- 收益: katex 兜底 CSS 集中管理,与 katexCache 解耦但同主题,
  便于未来微调或 theme 化
