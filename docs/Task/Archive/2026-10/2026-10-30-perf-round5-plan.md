# 性能优化批次 E 计划（fileTree 异步门面：入口减负）

**状态**: ✅ 已完成（完成时间: 2026-10-30）
**依据**: [PERFORMANCE_ANALYSIS_2026-10.md](../Analysis/PERFORMANCE_ANALYSIS_2026-10.md) P1-3 残留（上两轮 Deferred 项，本轮以静态审计 + 门面单测 + 构建闭包断言建立确定性验证后纳入）

## 任务目标

`./fileTree`（含 fileTreePathKey，约 120KB minified）当前为入口静态依赖，但首个实际使用（`fileTree.init`）在窗口 reveal 之后的启动阶段B。本轮把 fileTree 移出入口静态闭包，chunk 拉取与 `initStore` 等 Phase A 工作并行：

1. **E1（依赖解耦）**: fileTree.ts 里的 `newFileSafe`/`newFolderSafe` 是与 `core/libraryFileOps.ts` 逐语义重复的纯 fs 帮助函数（不碰 fileTree 内部状态），收敛到 libraryFileOps 单一来源；`ui/libraryContextMenu.ts` 改从 libraryFileOps 导入——它是入口静态链上最后一个 fileTree 引用方
2. **E2（门面）**: 新建 `src/fileTreeFacade.ts`（单次动态 import 单例 + FileTreeAPI 同型签名）；main.ts 以 `import { fileTreeFacade as fileTree }` 保持 27 个调用点零改动；启动 IIFE 阶段A 起点显式预取；vite manualChunks 的 `/fileTree` 前缀规则收窄为精确匹配（防门面/pathKey 误入同一 chunk 使优化失效）；闭包门禁 VIOLATION_RE 增加 filetree——**此后任何人重新静态引入 fileTree 都会让 build 直接失败**
3. **E3（单测）**: 门面转发/单例/getSelectedDir 未就绪语义/setSort fire-and-forget

## 关键语义约定

- init / refresh / revealAndSelect / newFileInSelected / newFolderInSelected：转发真实 Promise，await 语义不变
- setSort：真实模块无返回值消费，fire-and-forget 转发；调用经单例 promise 排队保序
- getSelectedDir：唯一同步 API，未就绪时返回 null（与"无选中"同义；唯一调用点 main.ts:711 是用户操作路径上的 getter，彼时模块早已就绪）
- 时序变化（可接受、已记录）：fileTree 模块顶层 `LIBRARY_CONFIG_CHANGED_EVENT` 监听器注册从入口求值推迟到 chunk 加载完成（毫秒级；错过事件由下一次 refresh 自愈）

## 验证

五门禁 + 闭包门禁输出"不含 filetree chunk" + 门面单测（vi.mock('./fileTree') 动态导入打桩）。若闭包门禁失败即说明仍有未知静态引用方（门禁兜底审计盲区）。

## 验证结果（2026-10-30）

- `tsc --noEmit`：0 错误
- `vitest run`：779/779（61 文件；新增门面单测 4 例）
- `npm run build`：**闭包门禁通过，入口静态闭包不含 fileTree chunk**；产物形态 `import("./fileTree-CaAN9F_e.js")`，chunk 不在 modulepreload
- `cargo check` / `cargo test`：31/31（本批无 Rust 改动，纪律性复跑）

## 实施记录与关键发现

1. **原 manualChunks 规则是本项优化的隐藏障碍**：`/fileTree` → 'filetree' 强制命名把 fileTree.ts 的静态共享依赖（i18n、libraryConfig 等）一并吸进该 chunk，入口反向静态导入 45 个符号，整个 chunk 退回静态依赖（modulepreload）——闭包门禁首跑即 FAIL 抓住。已删除该规则，交给 rolldown 按动态 import 边界自动拆分。
2. **实际减负约 36KB raw（≈11KB gzip）而非分析报告估的 120KB**：旧估算把强制 chunk 里的共享依赖也算了进去，而那些模块本来就是静态加载的。真实的独占部分是 fileTree.ts + fileTreePathKey。
3. 顺带收敛：fileTree.ts 与 core/libraryFileOps.ts 的 `newFileSafe` 重复实现合为单一来源，`newFolderSafe` 随迁；libraryContextMenu 脱离 fileTree 依赖（它是入口静态链上最后一个 fileTree 引用方）。
4. 门面单测踩坑一次：测试文件漏 `@vitest-environment jsdom`（用例用到 document）；fileTree.ts 顶部 import 因搬走函数触发 noUnusedLocals，`writeFile` 曾被误删后恢复（438 行仍在用）。

## 备注

- 本轮未经过 External Review MCP 审查（当前运行时未配置该 MCP）。
- 闭包门禁从此把"fileTree 保持懒加载"固化为构建期约束。
- 剩余 Deferred（需 GUI 回归或结构改造）：预览块级缓存/虚拟化、watch 多路合并、markdownUpdated rAF 合并、math changed-range 局部重解析、localStorage 会话结构改造。

## 风险与回滚

- main.ts 27 个调用点签名不变（类型层由 FileTreeAPI 同型保证，`Parameters<typeof fileTree.init>` 用例仍在）
- 回滚 = 还原 main.ts 导入 + 删门面（单 commit 文件集）
