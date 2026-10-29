# 性能优化批次 D 计划（缓存与持久化收尾：D1-D3）

**状态**: ✅ 已完成（完成时间: 2026-10-30）
**依据**: [PERFORMANCE_ANALYSIS_2026-10.md](../Analysis/PERFORMANCE_ANALYSIS_2026-10.md) P2-15 / P2-16 / P3-17 残留子集
**前轮**: 批次 6 C1-C4（509edd1）

## 任务目标

1. **D1（P2-15 子集）**: docPos 写盘相同内容跳过——`saveNow` 每次都写整个库的 docPos（含只变了 `ts` 的情况）；以"排序 key + 非 ts 字段签名"与上次写入比对，相同则跳过 `writeLibraryPrivate`（省序列化 + 防抖写盘）。`ts` 为只写字段（无读取方），不入签名
2. **D2（P2-16 子集）**: mermaid SVG 缓存加字节上限——现仅按条数（300）淘汰，300 个大图可达几十 MB；加 16M code units（≈32MB UTF-16）字节上限，超限按 LRU 序淘汰；`invalidateMermaidSvgCache` 同步清零计数
3. **D3（P3-17 子集）**: 状态栏行列回退路径免分配——行号索引缺失（启动 800ms 内/关行号）时每次光标移动 `value.slice(0,pos).split('\n')` 分配整段前缀 + N 个子串；改为单趟 charCode 计数（row/col 语义逐字节等价），扩展既有测试锁定

明确排除：localStorage 会话结构改造、docPos 按 key 增量写（存储结构问题，维持 Deferred）、启动日志合并（诊断完整性优先）、hljs 异步补高亮（视觉时序变化，需 GUI）。

## 验证

五门禁 + 新增 mermaidCache.test.ts（字节记账/替换/字节淘汰/失效清零）+ titlebarStatus.test.ts 扩展（多行回退等价）。

## 验证结果（2026-10-30）

- `tsc --noEmit`：0 错误
- `vitest run`：775/775（60 文件；新增 7 用例：mermaidCache 6 + titlebarStatus 多行等价 1）
- `npm run build`：成功，check-entry-closure 通过
- `cargo check` / `cargo test`：31/31

## 实施记录

- D1 两个边界在实现时补齐：① `writeLibraryPrivate` 失败/返回 false 时**不**记签名（否则下次相同内容会误跳过、数据永不落盘）；② 签名绑定库根（防切库后内容巧合相同而误跳新库首写）。
- D2 测试专用覆盖钩子 `_setMermaidCacheMaxBytesForTest`（沿用仓库 test-hooks 惯例），避免测试分配 16M 字符；测试曾因 svg 不含 renderId 而无法验证 ID 替换行为，已修正用例构造（模块实现本身无误）。

## 备注

- 本轮未经过 External Review MCP 审查（当前运行时未配置该 MCP）。
- 至此 P2-15/P2-16/P3-17 的安全子集全部收敛；剩余大项（预览块级缓存/虚拟化、watch 多路合并、markdownUpdated rAF 合并、math changed-range 局部重解析、fileTree 异步门面、localStorage 会话结构改造）均需 GUI 回归或管线抽取先行，维持 Deferred。

## 风险与回滚

- D2 改变大图文档下的缓存命中率（旧条目被字节淘汰后按需重渲），渲染输出不变
- D3 为纯计算等价替换，等价性由现有回退用例 + 新增多行用例锁定
- 各项独立文件集，回归按 `git diff` 定位手工 revert
