# 性能优化第二轮计划（运行期效率：R1-R5）

**状态**: ✅ 已完成（完成时间: 2026-10-30）
**依据**: [PERFORMANCE_ANALYSIS_2026-10.md](../Analysis/PERFORMANCE_ANALYSIS_2026-10.md) 中批次 4-6 未落地项 + 上轮 validation.md 登记的已知债务
**上轮**: [2026-10-18-perf-startup-runtime-plan.md](Archive/2026-10/2026-10-18-perf-startup-runtime-plan.md)（T1-T8 已完成）

## 任务目标

延续 perf-2026-10 第一轮（T1-T8，已合入 590edd6），本轮处理第一轮明确 Deferred 与 validation 登记的遗留项，聚焦运行期效率：

1. **R1（T3 债务收敛）**: Rust `scan_dirs_doc_presence` 支持 prefix 过滤，前端增量路径真正收敛为前缀扫描 + 合并回填，消除"增量失效后仍 root 全树后台扫描"
2. **R2（P0-8 子集）**: 所见模式 markdownUpdated 管线各 pass 加 `includes` 快跳 + 下游 onChange 去重，降低大文档每击键成本（不做 rAF 合并——行为变更风险高，留批次 6）
3. **R3（P2-14）**: 行号栏缩放 remeasure 防抖 + 同文本去重测量，消除 Ctrl+滚轮每 tick 全量强制 reflow
4. **R4（P2-15 子集）**: 会话自动保存写放大收敛（per-tab fragment 复用 + 相同 payload 跳写），不做 localStorage 结构改造
5. **R5（P2-16 子集）**: windowsCompositorPoke 4 个 Tauri 事件 unlisten 句柄补全，stop 语义完整

明确排除（沿用上轮 Deferred，本轮不做）：fileTree 异步门面、prewarmExtensionsPanel 行为变更、markdownUpdated rAF/100ms 合并、math 局部重解析（批次 6）、预览块级缓存/虚拟化、watch 单路合并、localStorage 会话结构改造、renderPreview 快照测试。

## 问题分析与方案

### R1 — scan_dirs_doc_presence prefix 过滤（T3 债务收敛）

**现状**：T3 已实现前缀失效决策（`src/core/docPresenceScan.ts`），但两个遗留问题使增量路径名不副实：
- `pathsToInvalidatePrefixes` 的祖先链截断在文件系统根，未截断在库根 → 库内任意事件的 prefix 集必含库根本身 → `invalidateDirDocPresenceScan` 实际等于全清
- Rust 命令无 prefix 参数 → 后台预取恒为 root 全树扫描（fileTree.ts:1722 注释登记的债务）

**方案**：
- `docPresenceScan.ts`：`pathsToInvalidatePrefixes(paths, boundRoot?)` 祖先链在库根截断（库根本身不入集，除非事件路径就是库根）；`resolveDocPresenceRefresh` 同步加 boundRoot 参数，路径命中库根时直接判 full-scan
- Rust `scan_dirs_doc_presence` 加 `prefixes: Option<Vec<String>>`：Some 非空时 filter_entry 限定前缀子树，聚合底向上到"最短匹配前缀"为止；前缀防御性校验（绝对路径 + 须在 root 内，否则跳过）；full-scan 语义不变
- 前端 `prefetchDirDocPresence(root, baseline?, prefixes?)`：前缀模式下结果**合并**（不 clear，缓存不变量"只写 true"保持）；过期 epoch 的前缀结果重排队（`_dirDocPresencePendingPrefixes`），由下一次增量预取捎带，恢复 FR-3 最终一致
- 过期轮次语义变更：原全扫"新轮必覆盖旧轮"；前缀模式新轮只覆盖自己的前缀，故需重排队（fileTree.ts:808 注释预设的方向）

### R2 — markdownUpdated 管线快跳（P0-8 安全子集）

**现状**（wysiwyg/v2/index.ts:830-872）：每事务触发 6 个 pass，全部全文扫描：
- 图片包裹正则（仅需 `](` 存在）
- 转义还原 `\[`/`\]`（仅需 `\` 存在）
- stripStrongBoundaryGuard 删 `\u200B`（仅需该字符存在）
- unprotectExcelDollarRefs（仅需 `\$` 序列存在）
- restoreEscapedDollars（已有内部快跳）
- normalizeTabIndentText 4 次 split/join（仅需 4 种特征字符之一存在）

**方案**：各 pass 前置 `indexOf`/单次正则快跳（超集条件，零行为变化）；`md4 === 上次已通知值` 时跳过 `_onChange`（下游 textarea 全量写 + 行号 O(n) diff 不再空跑）；`rewriteLocalImagesToAsset`/`scheduleCodeCopyRefresh` 保留在守卫外（保留瞬态失败的自动重试语义）。
**不做**：rAF/100ms 合并（ onChange 时序是正确性关键路径，无 GUI 验证手段，留批次 6）。

### R3 — 行号栏 remeasure（P2-14）

**现状**（sourceLineNumbers.ts:788）：Ctrl+滚轮每 tick 派发 `flymd:uiZoom:changed` → `schedule('layout')` → `remeasureAll` 逐行 `probe.textContent=...; probe.offsetHeight`（每行一次强制 reflow）；大文档缩放手势 = 几万次 reflow。

**方案**：
- 缩放监听改为 trailing 防抖（~120ms）：手势期间合并为一次 layout 刷新；手势中行号几何短暂 stale 属不可感知代价
- `remeasureRange` 单次调用内按行文本去重（`Map<text, height>`）：相同文本行只测一次（同字体同宽度 → 同高度）；最坏情况（全唯一行）与现状持平

### R4 — 会话自动保存写放大（P2-15 安全子集）

**现状**（tabs/integration.ts:268-366 + TabManager.ts:632）：5s 定时器无条件重排 → 每 5s `exportState()` + `JSON.stringify(全部标签含 dirty 内容快照)` + `localStorage.setItem`，无变化也照写；闲置但带脏标签时无限重写多 MB 字符串。

**方案**（输出字节等价）：
- `TabManager.exportStateJSON(opts?)`：per-tab fragment 记忆化（WeakMap，键为字段引用同一性 bundle——`===` 引用比较 O(1)，无假复用可能），手工拼装 `'{"tabs":[…],"activeTabId":…}'`，与 `JSON.stringify(exportState())` 字节等价（测试锁定）
- 配套：`saveCurrentTabState` 内容相同时跳过重赋值（保引用 → fragment 命中）
- `saveTabSession`：payload 与上次写入相同则跳过 setItem（O(n) 比较，无分配）；显式保存路径（切库/退出/discard）不受影响
- **不做**：rev 计数器方案——TabDocument 存在模块外直接改字段的路径（integration.ts:497、tabTransferReceiver），漏计数即数据丢失风险，弃用

### R5 — windowsCompositorPoke unlisten 泄漏（P2-16 子集）

**现状**（windowsCompositorPoke.ts:152-167）：`onMoved/onResized/onFocusChanged/onScaleChanged` 返回的 UnlistenFn promise 被丢弃，`stop()` 只清 DOM 监听 → 重复 start/stop 后 Tauri 事件处理器累积。

**方案**：收集 4 个 promise，`stop()` 时逐个 `.then(fn => fn())` 解绑（未决状态解绑同样安全）。

## 子任务列表

- [x] **R5** compositorPoke unlisten（windowsCompositorPoke.ts + 测试）✅
- [x] **R4** 会话保存 fragment memo（TabManager.ts + integration.ts + 测试）✅
- [x] **R3** 行号 remeasure（sourceLineNumbers.ts）✅
- [x] **R2** markdownUpdated 快跳（wysiwyg/v2/index.ts + utils/tabIndent.ts）✅
- [x] **R1** Rust prefix 扫描（main.rs + tests/scan_dirs_doc_presence.rs + docPresenceScan.ts + fileTree.ts + 测试）✅

## 实施记录（2026-10-30）

- **R1 关键实现点**：`filter_entry` 前缀过滤有两个必踩的坑，均有测试锁定——① 根条目（depth==0）也参与过滤，根不匹配前缀会剪空整树，必须豁免；② 返回 false 连子树剪掉，前缀的祖先目录须放行（`p.starts_with(path)` 判定），否则前缀成员不可达。前端祖先链在库根截断（`pathsToInvalidatePrefixes(paths, boundRoot)`），事件命中库根直接判 full-scan；前缀扫描结果**合并**（不 clear），过期轮次前缀重排队（`_dirDocPresencePendingPrefixes`）由下次增量预取捎带。Rust 侧聚合以"最短匹配前缀"为上界，不越界回填。
- **R4 关键实现点**：`exportStateJSON` 与 `JSON.stringify(exportState())` 字节等价（测试锁定三种形态 + discard 路径）；fragment 键用字段严格相等（`===`）比较，content 值相等即复用（O(n) memcmp），无假复用路径；`setItem` 抛出时重置 lastSessionWrite 防止跳写吞数据。
- **R2/R3 实施范围**：R2 只做零行为变化的快跳 + onChange 去重（rAF 合并留批次 6）；R3 缩放 layout 刷新 trailing 防抖 120ms + remeasureRange 同文本去重。

## 验证（五门禁，2026-10-30）

- `tsc --noEmit`：0 错误
- `vitest run`：768/768（新增 10 用例：compositorPoke 解绑 1、exportStateJSON 等价 3、docPresenceScan boundRoot 5、fileTreeWatch 重排队 1）
- `npm run build`：成功，check-entry-closure 闭包门禁通过（入口静态闭包不含 yaml/diff）
- `cargo check`：通过（1 个 pre-existing dead_code 警告，Windows 专属函数，与本轮无关）
- `cargo test`：31/31（单元 16 + 集成 15，新增 4 个前缀用例）

## 备注

- 本轮经外部静态自查（逐点 FR-2 类等价审计）+ 测试锁定，**未经过 External Review MCP 审查**（当前运行时未配置该 MCP）。
- 残留（批次 6 及更远）：markdownUpdated rAF/100ms 合并、math 局部重解析、预览块级缓存/虚拟化、watch 多路合并、localStorage 会话结构改造、S3 缓存 LRU 演进、mermaid 渲染链 per-render 超时、Windows 兜底 show 绕过 CAS（pre-existing）。

## 风险与回滚

- R1 风险最高（跨栈 + 缓存竞态）：epoch/重排队逻辑有 docPresenceScan/fileTreeWatchPresence 双测试覆盖；Rust 侧前缀校验失败一律降级为空结果（安全侧）
- R4 的 WeakMap fragment 键用引用同一性，杜绝内容相同但引用不同时的假复用（宁可重算）
- 每项独立成文件集，回归时按文件 `git diff` 定位手工 revert；本流程不自动 commit
