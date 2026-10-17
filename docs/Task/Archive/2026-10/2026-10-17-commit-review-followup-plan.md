# 最近5次提交外部审核的后续处置计划

**Status**: ✅ Completed (completion time: 2026-10-17)
**Created**: 2026-10-17

## 背景

对 ee98d1d / 570da66 / 35e1b44 / e06e2e0 / 58008b3 五个提交逐一调用了
External Review MCP（coding-bridge，串行）进行审查。结论：

- 570da66（jsdom 断言修复）：APPROVED，无阻塞。
- ee98d1d（测试门禁）：通过但有保留 —— 47 个 SSRF 测试脱离 CI，
  建议补 web/server 的 CI job（better-sqlite3 走预编译二进制，
  只需 pnpm-workspace.yaml 放行 onlyBuiltDependencies）。
- 58008b3（退出丢弃修复）：修复正确；审核方怀疑「退出 await 窗口内
  事件驱动的 saveTabSession 会回写脏内容」。
- 35e1b44（callout 标题栏折叠）：NEEDS_CHANGES，3 项阻塞。
- e06e2e0（删除路径校验）：NEEDS_CHANGES，核心质疑 root=None 信任边界。

## 实证核查结果（以代码为准）

- 35e1b44 risk[2]「标题编辑被破坏」：**不成立**。callout.ts:231
  `titleBar.contentEditable = 'false'`，标题是静态 textContent，无插入符可破坏。
- 35e1b44 risk[3]「逐 callout 注册双触发」：**不成立**。main.ts:2889 为预览容器上
  单一 capture 委托。
- 35e1b44 risk[1]「mousedown 未过滤按键」：**成立**。右键/中键点击标题栏会误触发
  折叠。同代码块内 foldBtn/copyBtn 的 mousedown 处理器（早于本提交）有同类缺陷。
- 58008b3 残余风险：**不成立**。exitNow 的 await 窗口内四步（flush 文件标识 /
  restoreStickyIfNeeded 只恢复窗口尺寸 / 便携导出 / 关闭前同步）均不触碰
  tabManager、不 emit tab-switched，无人会再调 saveTabSession。
- e06e2e0 root=None：属提交时已明确记录的取舍（库外删除场景），redesign 为
  后端 managed state 是架构级变更，登记为后续任务，本次不动。

## 任务分解

- [x] T1：修复 callout.ts 三个 mousedown 处理器缺 `e.button !== 0` 守卫 ✅
  （titleBar 为本次回归，foldBtn/copyBtn 为同类既有缺陷，一并修复保持一致）
- [x] T2：补测试评估 —— CalloutNodeView 未导出、无既有脚手架，维持原提交的
  Not-tested 披露；以 typecheck + 全量回归验证（typecheck 已通过；
  期间发现并修复了 node_modules 过期导致的 mdast TS2307 —— ee98d1d 的
  依赖修复未在本地 install 生效，已 `pnpm install` 同步）
- [x] T3：修复后重新调用 External Review MCP 复审 ✅ Round 2/5 APPROVED
  （SESSION bad3628e；确认 e.button 守卫闭合右键/中键缺陷，两项反驳被接受；
  残余非阻塞：macOS Ctrl+点击折叠+菜单并发、标题单击不再触发 PM 节点选中、
  守卫无自动化覆盖）
- [x] T4：后续任务登记 ✅（不在本次改动，见下）

## 遗留后续任务（未动工，供排期）

- web/server CI job：pnpm-workspace.yaml 放行 onlyBuiltDependencies: [better-sqlite3]，
  新增 CI job 恢复 94 用例（含 47 个 SSRF）覆盖；根治选项是把 web/server 纳入
  pnpm workspace + vitest projects
- e06e2e0 root=None 后端化：root 改为后端 managed state，库外删除拆独立命令
  （clear_upload_cache），renderer 传句柄而非路径；改造前在 threat model 文档
  明示当前边界只是 bug-guard
- 58008b3 终局 save 静默 catch 加 warn 日志（配额超限时会恢复已丢弃内容）
- callout 键盘可达性（role=button / tabindex / aria-expanded）

## 验收结果

- typecheck 通过；vitest 55 文件 / 694 用例全绿（2026-10-17）
- 外部复审 Round 2 verdict = APPROVED，无阻塞残余
- 右键/中键点击 callout 标题栏/折叠按钮/复制按钮不再触发折叠或复制

## 备注

- 经验：外部审核 MCP 单次响应约 4-5 分钟且接近 300s 超时上限，禁止并行调用，
  必须串行；超时后按协议先简化 prompt 重试（e06e2e0 精简后 75s 即返回）
- 审核方的两项阻塞质疑（标题编辑破坏、嵌套双触发）经代码实证不成立 ——
  外部审核结论必须以项目代码为准交叉验证，不能照单全收
