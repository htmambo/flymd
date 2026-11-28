# Mermaid 缩放读取走内存缓存（mermaid-scale-lscache）

**状态**: ✅ 已完成 (开始时间: 2026-11-28，完成时间: 2026-11-28)

## 任务目标

`flymd:mermaidScale` 在每张图表渲染时都会直接从 `localStorage` 读取。WebKitGTK 在 localStorage 较大时单次 `getItem` 实测约 26ms，一篇多图表笔记会被乘进渲染路径。统一改走 `src/core/lsCache.ts` 的内存缓存。

## 问题分析

- `src/core/mermaid.ts`、`src/wysiwyg/v2/index.ts`、`src/wysiwyg/v2/plugins/mermaid.ts` 三处渲染路径直接 `localStorage.getItem('flymd:mermaidScale')`。
- 同模块已有 `isMermaidCacheDisabled` 走缓存，但写入方（`window.setDisableMermaidCache`）直接 `setItem`；同窗口写入不会触发 `storage` 事件，缓存不会失效——切换开关后需要刷新才生效，属于既有缺陷。
- `window.setMermaidScale` 同样直接写入，与缓存读不一致。

## 改动内容

- `src/core/mermaid.ts`
  - `getMermaidScale` → `lsGetStringCached`
  - `setMermaidScaleClamped` → `lsSetStringCached`
- `src/wysiwyg/v2/index.ts`、`src/wysiwyg/v2/plugins/mermaid.ts`
  - 图表渲染读取缩放改用 `lsGetStringCached`
- `src/main.ts`
  - `window.setDisableMermaidCache` / `window.setMermaidScale` 改用 `lsSetStringCached`，修复同窗口写入后缓存不失效的问题
- 新增 `src/core/mermaidScaleCache.test.ts`（5 用例）：持久化读取、同窗口写入立即可读、非法/越界回落、开关即时生效

约定（写在 `core/mermaid.ts` 注释里）：这两个键的读写必须成对使用 lsCache，否则缓存会读到旧值。

## 验收标准

- `vitest run src/core/mermaidScaleCache.test.ts src/core/mermaidCache.test.ts`：11/11 通过。
- 全量 `pnpm test`：101 文件 / 1208 用例通过；`pnpm typecheck`、`pnpm build` 通过。
- 缩放与缓存开关行为不变，且同窗口切换立即生效。

## 风险与缓解

- lsCache 仅在本窗口写入时同步更新；其它模块若再用裸 `setItem` 写这两个键会造成缓存陈旧——已用 `rg` 复核全部读写点，当前无遗漏。
- 缓存常驻内存的条目数与窗口内访问过的键数成正比，这两个键各一条，可忽略。

## QA 记录

- 定向 11/11；全量 1208/1208；typecheck / build 通过。
- 外部审核：未参与（coding-bridge HTTP 429 月度配额耗尽，codex MCP 连接关闭）。
