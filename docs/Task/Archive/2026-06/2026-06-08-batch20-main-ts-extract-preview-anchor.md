# Batch 20: 抽离 previewAnchor(预览锚点解析)

> 状态: ✅ 已完成(完成 2026-06-08,经 Codex R1 复审 APPROVED)
> 提交: `49a611b`(已推送 origin)
> 范围: Phase B 第二十批 — main.ts 模块化拆分

---

## 目标(Goals)

继续 Phase B 拆分。把 main.ts 中 6 个 preview 锚点解析函数
抽离到独立模块 `src/core/previewAnchor.ts`,作为命名导出
(无工厂无 deps,纯函数簇)。

## 现状分析(Context)

- main.ts 9084 行(Batch 19 拆分后)
- 6 函数 (51 行):
  - `normalizePreviewAnchorText` (2 行,纯 URI decode)
  - `makePreviewHeadingId` (8 行,纯)
  - `ensurePreviewHeadingIds` (14 行,DOM)
  - `isPreviewHashLink` (1 行,纯 regex)
  - `findPreviewAnchorTarget` (22 行,DOM + 调用 2 上)
  - `scrollPreviewAnchorIntoView` (4 行,DOM)
- 内聚簇: 共享 normalize/makePreviewHeadingId,围绕 preview anchor 解析
- 唯一 main-local 闭包: `preview` 变量(在 findPreviewAnchorTarget 内 fallback 用)

## 子任务清单(Subtasks)

- **T1 ✅** `src/core/previewAnchor.ts` 新建(78 行,19 tests)
  - 命名导出 6 函数(无工厂)
  - `findPreviewAnchorTarget` / `scrollPreviewAnchorIntoView` 加 `previewEl` 第二参数
    替代原 main-local `preview` 闭包
- **T2 ✅** `src/core/previewAnchor.test.ts` 新建(19 vitest tests,jsdom)
  - normalizePreviewAnchorText: URI 解码 / 失败兜底 / 空
  - makePreviewHeadingId: 大小写 / 中文 / 特殊字符 / 64 截断 / fallback
  - ensurePreviewHeadingIds: 补 id / 保留现有 / 重复加序号
  - isPreviewHashLink: #hash / 非 hash
  - findPreviewAnchorTarget: id 找 / 文本 fallback / previewEl fallback
  - scrollPreviewAnchorIntoView: 未找到返 false / 找到 scrollIntoView
- **T3 ✅** main.ts 添加 import + 删除 6 函数体 (65 行)
  - L1466 call site 改 `scrollPreviewAnchorIntoView(href, preview)`
  - L1699 deps 对象加 `makePreviewHeadingId` 引用
- **T4 ✅** main.ts 净 **-64 行**(添加 1,删除 65)
- **T5 ✅** Codex R1 复审 APPROVED(0 blocker)
- **T6 ✅** 验证: tsc 0 错误、test 528/528(原 510 + 18 新增 + 1 nit 补)

## 实施细节

### 关键设计

1. **命名导出而非工厂** — 6 函数都是 utility,无状态
   - 与 Batch 19 imageUtils 同样的命名导出模式
2. **`previewEl` 参数化替代闭包**
   - 原 `findPreviewAnchorTarget(hashHref)` 内部 `body || preview || document`
     其中 `preview` 是 main-local 闭包变量
   - 抽离后变 stateless,加 `previewEl: HTMLElement | null` 第二参数
   - 唯一外部 call site (L1466) 改为 `scrollPreviewAnchorIntoView(href, preview)` 显式传入
3. **`makePreviewHeadingId` 仍暴露** — OutlineDeps 类型契约需要它作为
   factory deps 注入项。从 previewAnchor 命名导出,deps 对象里指向 import 引用
4. **CJK 字符范围保留 `一-龥` 字面写法** — 与原文 1:1,无 Unicode 转义差异
5. **`cssEscapeCompat` 复用** — 从 `src/ui/outlineHeadsCache.ts:31` import
   (该函数本就在 outlineHeadsCache 中导出,无重复)

### Codex R1 复审

- **R1** APPROVED
- 验证点: regex verbatim、URI decode fallback verbatim、dedupe suffix verbatim、
  call site `preview` 传入正确、OutlineDeps 仍满足、tsc 0 错误
- nit 1(误判): Codex 误判 CJK regex 是 `一-龥`,实际原文就是 `一-龥`
  字面写法 — 1:1 保留
- nit 2: 缺 `previewEl` fallback 路径的测试 — **已补**(L142-152)

## pre-existing 行为保留

- normalizePreviewAnchorText: try/catch 包裹 decodeURIComponent,失败返原值
- makePreviewHeadingId: lowercase + 过滤 `[a-z0-9一-龥\s-]` + space→hyphen + 64 截断
- ensurePreviewHeadingIds: 补缺失 id,去重用 `used` Set + 数字后缀
- isPreviewHashLink: regex `/^#[^#\s]+/` 字面保留
- findPreviewAnchorTarget: `.preview .preview-body` 优先 → previewEl → document,
  id 查询优先,fallback 文本匹配
- scrollPreviewAnchorIntoView: smooth + try/catch fallback 同步

## 验证(Verification)

- `npx tsc --noEmit` → **0 错误**
- `npm test -- --run` → **528/528 通过**(原 510 + 新增 18 + 1 nit 补)
- main.ts 净 **-64 行**(9084→9020)
- 提交: `49a611b`(已推送 origin)
- Codex: R1 APPROVED(0 blocker,1 nit 已补)

## 备注

- 教训: 命名导出模式适用范围比想象中广 — 凡是 stateless 工具函数簇
  都适合,不必为"工厂一致性"强行套工厂
- 教训: 抽离时 main-local 闭包变量要明确处理 — 优先参数化(本批),
  次之工厂 deps 注入(需 test-time replacement 时)
- 收益: preview anchor 解析逻辑独立可测,heading id 策略/锚点定位规则
  调整不影响 main.ts
