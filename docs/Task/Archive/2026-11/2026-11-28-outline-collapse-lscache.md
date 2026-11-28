# 大纲折叠状态读取走内存缓存（outline-collapse-lscache）

**状态**: ✅ 已完成 (开始时间: 2026-11-28，完成时间: 2026-11-28)

## 任务目标

大纲面板每次渲染都会直接读 `localStorage['outline-collapsed:<file>']`，Markdown 与 PDF 两条路径各有一份实现。编辑模式下大纲随输入防抖重渲染，WebKitGTK 大库下单次 `getItem` 可达 ~26ms。统一改走 `src/core/lsCache.ts`。

## 问题分析

- `src/modes/outline.ts` 渲染路径两处 `localStorage.getItem`、两处 `setItem`（Markdown 折叠与 PDF 书签折叠）。
- 键按文件路径动态生成，读写必须成对走缓存，否则同窗口写入不会让缓存失效（与上一批 Mermaid 缩放同类问题）。

## 改动内容

- `src/modes/outline.ts`
  - 两处折叠状态读取 → `lsGetStringCached`
  - 两处 `saveCollapsed` 写入 → `lsSetStringCached`
  - 顺带修复：折叠状态改为在构建 DOM 前读取，箭头按 `collapsed` 初始化（旧实现重渲染后箭头恒为 `▾`，与实际折叠状态不一致）
- `src/modes/outline.test.ts`
  - 新增用例：点击折叠后强制重渲染，后代仍为 `hidden`、箭头仍为 `▸`，且 localStorage 中确实写入了标题 id（验证缓存读写一致）

## 验收标准

- `vitest run src/modes/outline.test.ts`：16/16 通过（含新增折叠持久化用例）。
- 全量 `pnpm test`：101 文件 / 1209 用例通过；`pnpm typecheck`、`pnpm build` 通过。
- 折叠/展开行为不变，重渲染后状态保持。

## 风险与缓解

- lsCache 按 key 常驻内存，键数随访问过的文件数增长；每条内容为折叠 id 数组，量级与 localStorage 原值相同，可接受。
- 若将来有其他代码直接 `setItem` 写 `outline-collapsed:*`，会造成缓存陈旧——当前用 `rg` 复核无其它读写点。

## QA 记录

- 定向 16/16；全量 1209/1209；typecheck / build 通过。
- 外部审核：未参与（coding-bridge HTTP 429 月度配额耗尽；codex MCP 连接关闭）。
