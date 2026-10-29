# 性能优化批次 6 安全子集计划（C1-C4）

**状态**: ✅ 已完成（完成时间: 2026-10-30）
**依据**: [PERFORMANCE_ANALYSIS_2026-10.md](../Analysis/PERFORMANCE_ANALYSIS_2026-10.md) P0-9 / P1-12 / P3-5 + 上轮 validation.md 债务清单
**前轮**: [2026-10-30-perf-round2-plan.md](Archive/2026-10/2026-10-30-perf-round2-plan.md)（R1-R5 已完成，d9735bd）

## 任务目标

在无 GUI 验证条件下，只做可确定性验证的安全子集：

1. **C1（P1-12）**: 所见模式代码块按钮覆盖层每帧读写交叉 → 两阶段读写分离。现状 `refreshCodeCopyButtonsNow`（rAF 合帧后逐 pre 执行）对每个 pre 依次 `getBoundingClientRect` 读 → `display/left/top` 写 → 下一个 pre 又读 = 每 pre 一次强制 reflow；两阶段后每帧一次 reflow
2. **C2（P3-5 子集）**: `initOnlineAnnouncements` 从首帧完成立即发起延后 1.5s（非紧急 UI，让出启动尾段主线程）
3. **C3（P0-9 安全子集）**: math reparse 定时器复用 markdownUpdated 已产出的原始序列化（以"文档对象引用相等"判定新鲜度，引用不等回退 getMarkdown），消除含 `$$` 文档每次 reparse 的重复全文序列化。**不做** changed-range 局部重解析（需 prosemirror 基建 + GUI 验证，维持 Deferred）
4. **C4（validation 债务）**: Windows 兜底 reveal 线程直调 `show()` 绕过 CAS → 与非 Windows 分支对称改用 `reveal_window_once`，exactly-once 语义全平台一致

明确排除：`initExternalChangeWatcher` 模块顶层挪移（实测顶层成本仅为一次 fire-and-forget 异步 IPC，分析前提不成立）；prewarmExtensionsPanel 行为变更（空闲期成本 vs 面板首开延迟是权衡，非纯收益）；S3 缓存 LRU / mermaid per-render 超时（低收益）；markdownUpdated rAF 合并、预览块级缓存、watch 多路合并（维持 Deferred）。

## 实施要点

- **C1**: `positionCodeCopyWrap` 拆为 measure（读 pre 矩形 + 可见性 + left/top 计算，无写）与 apply（纯写）；主循环先对所有 pre 完成测量，再统一创建/更新 wrap 并应用定位；`wrap.offsetWidth` 读移入测量阶段（新建 wrap 在创建后补测，新建为低频路径）；`alive`/删除循环语义不变
- **C3**: 新增模块级 `_lastRawSerializedMd` / `_lastRawSerializedDoc`；`lm.updated` 与 `lm.markdownUpdated` 各自捕获当前 view.state.doc 引用与原始序列化串（顺序无关）；reparse 定时器内先做引用相等判定，相等才复用，否则回退 `getMarkdown()`（防陈旧串 replaceAll 覆盖新编辑）。enable 时双双置 null
- **C4**: cfg(windows) 分支与非 Windows 分支语句集完全对称（`win_clone.state::<AppState>()` + `reveal_window_once`），编译安全性由另一分支背书

## 门禁

`npx tsc --noEmit` / `npx vitest run` / `npm run build`（含闭包门禁）/ `cargo check` / `cargo test`

## 验证（2026-10-30）

- `tsc --noEmit`：0 错误
- `vitest run`：768/768
- `npm run build`：成功，check-entry-closure 通过
- `cargo check`：通过（1 个 pre-existing 警告）
- `cargo test`：31/31（单元 16 + 集成 15）

## 实施记录

- C1 抽取 `createCodeCopyWrap` 时曾把 expand 按钮 SVG 从记忆转写错（多了第三个 line 元素），已改为直接从 git HEAD 提取字面量替换并用 `diff` 对账——三个 SVG 字面量与 HEAD 逐字节一致。教训：搬运字面量必须程序化取原文，禁止手工转写。
- C4 是 cfg(windows) 代码，Linux 侧 cargo check 不编译该分支；编译安全性由 cfg(not) 分支的完全对称语句集背书（同类型 `WebviewWindow` / `AppState` / `reveal_window_once`）。

## 备注

- 本轮未经过 External Review MCP 审查（当前运行时未配置该 MCP）。
- 残留（维持 Deferred）：math changed-range 局部重解析、markdownUpdated rAF 合并、预览块级缓存/虚拟化、watch 多路合并、localStorage 会话结构改造、S3 缓存 LRU、mermaid per-render 超时。

## 风险与回滚

- C1 触碰视觉定位逻辑：以"逐字节等价的定位输出"为红线，measure 返回值即原函数内联计算；新建 wrap 首帧宽度补测，后续帧走缓存读
- C3 新鲜度判定失败一律回退原路径（getMarkdown），无行为变化面
- 每项独立文件集，回归按 `git diff` 定位手工 revert
