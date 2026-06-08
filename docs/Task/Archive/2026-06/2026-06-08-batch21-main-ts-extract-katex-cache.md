# Batch 21: 抽离 katexCache(KaTeX HTML 渲染缓存层)

> 状态: ✅ 已完成(完成 2026-06-08,经 Codex R1 复审 APPROVED)
> 提交: `73b24c5`(已推送 origin)
> 范围: Phase B 第二十一批 — main.ts 模块化拆分

---

## 目标(Goals)

继续 Phase B 拆分。把 main.ts 中 KaTeX HTML 渲染缓存层抽离到
独立模块 `src/modes/katexCache.ts`(工厂模式)。

## 现状分析(Context)

- main.ts 9020 行(Batch 20 拆分后)
- module-level 状态:
  - `_katexHtmlCache: Map<string,string>`
  - `KATEX_HTML_CACHE_MAX = 1500`
  - `KATEX_HTML_CACHE_MAX_LATEX_LEN = 512`
- 1 个函数 `renderKatexToHtmlCached` (16 行),用上述 3 个状态
- 2 个 call site 在 `renderKatexPlaceholders` 内 (L343, L374)

## 子任务清单(Subtasks)

- **T1 ✅** `src/modes/katexCache.ts` 新建(37 行,7 tests)
  - 工厂 `createKatexCache({ max, maxLen })` → `{ renderCached(...) }`
  - 闭包持有 Map 状态
- **T2 ✅** `src/modes/katexCache.test.ts` 新建(7 tests, node env)
  - 首次写入缓存 / 二次命中 / displayMode 区分 key
  - 长度超阈值不缓存 / 空串不缓存 / 容量达 max 触发 clear
- **T3 ✅** main.ts:
  - 删除 3 个 module-level 状态 (4 行)
  - 删除函数 (16 行)
  - 加 import + factory 实例化 + 改 2 call site
- **T4 ✅** main.ts 净 **-13 行**(9020→9007)
- **T5 ✅** Codex R1 复审 APPROVED(0 blocker)
- **T6 ✅** 验证: tsc 0 错误、test 536/536(原 528 + 7 新增 + 1 nit 改)

## 实施细节

### 关键设计

1. **工厂闭包持有 Map 状态** — 与 module-level singleton 对比:
   - 闭包 → 可测、可注入 max/maxLen
   - 工厂 deps `max`/`maxLen` 让容量/长度阈值脱离硬编码常量
2. **katex mod 不注入** — `_katexMod` 是 main 共享的动态 import 缓存,
   `renderKatexToHtmlCached` 通过参数注入 katexMod。本批保留该方式:
   `renderCached(katexMod, ...)` 由 main 闭包调用时传入
3. **1:1 行为保留**:
   - `canCache = src.length > 0 && src.length <= maxLen`
   - key 格式: `\`${displayMode ? 'B' : 'I'}:${src}\``
   - 命中: `cache.get(key); if (hit != null) return hit`
   - render: `renderToString(src, { throwOnError: false, displayMode })`
   - 淘汰: `if (cache.size >= max) cache.clear(); cache.set(key, html)`
4. **call site `katexCacheApi!` 非空断言** — factory 在 module init 阶段
   (platformInitApi 之后) 已实例化,先于任何 `renderKatexPlaceholders` 调用

### Codex R1 复审

- **R1** APPROVED
- 验证点: cache 逻辑 1:1 verbatim、deps 注入正确、Map 状态 closure 私有、
  call site 顺序合理、tsc 0 错误
- nit: test 名字 'null/undefined latex' 但实际只传空串 — **已改为**
  'treats empty string as falsy (no cache)'

## pre-existing 行为保留

- 缓存容量: 1500 entries (max 注入)
- 长度阈值: 512 chars (maxLen 注入)
- key 前缀: displayMode ? 'B' : 'I'
- 淘汰策略: 全清而非 LRU(原文注释明确说"别搞复杂的 LRU")
- render 选项: `{ throwOnError: false, displayMode }`

## 验证(Verification)

- `npx tsc --noEmit` → **0 错误**
- `npm test -- --run` → **536/536 通过**(原 528 + 新增 7 + 1 nit 改)
- main.ts 净 **-13 行**(9020→9007)
- 提交: `73b24c5`(已推送 origin)
- Codex: R1 APPROVED(0 blocker,1 nit 已修)

## 备注

- 教训: 工厂闭包是替代 module-level singleton 的最干净方式 —
  状态私有 + 可注入配置 + 可在测试中 fresh 实例化
- 教训: 不需要给所有提取函数都套工厂 — 纯 stateless 工具走命名导出
  (Batch 19/20),有共享 state 的用工厂 (本批)
- 收益: katex 缓存策略(max/maxLen)可独立调整和测试,
  不再被 main.ts 9000+ 行淹没
