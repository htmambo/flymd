# 大文件标签恢复绕过所见模式守卫修复

**状态**: ✅ 已完成（完成时间：2026-10-30）
**创建时间**: 2026-10-30
**责任人**: Kimi Code
**范围**: `src/main.ts`、`src/tabs/TabManager.ts`、对应回归测试与真机验证
**前置任务**: `Archive/2026-10/2026-10-30-perf-round9-plan.md`

## 目标

1. 所有自动启用所见模式的路径，在 Milkdown/ProseMirror 构建前统一执行大文件守卫。
2. 保留明确用户操作的强制开启能力，不改变既有阈值和通知交互。
3. 被拦截的标签立即按实际模式收敛，避免每次切换重复尝试。
4. 用真实 1,078,087 字节 / 35,197 行文档验证：启动和标签恢复不再出现自动 `Editor.create` 长阻塞。

## 现状与证据

批次 I 已在打开、批量收尾、启动路径加入 200 KiB / 10,000 行守卫，但最新真机日志仍出现：

- 06:46:07 开始的一次自动 `Editor.create` 耗时 16,995ms。
- 06:46:57 已记录“超大文档跳过所见模式”后，又一次 `Editor.create` 耗时 11,250ms。
- 同次运行预览整篇渲染约 4 秒，说明剩余长阻塞不是 Markdown 字符串管线。

调用链证实遗漏在标签恢复：

`TabManager.restoreTabState` → `tabs/integration` 的 `setWysiwygEnabled` hook → `window.flymdSetWysiwygEnabled` → `main.ts:setWysiwygEnabled` → 唯一 `buildWysiwygV2FromTextarea` 调用。

该链直接读取旧会话的 `tab.wysiwygEnabled === true`，没有经过 `openFile2` 或启动守卫。

## 设计约束

- 采用默认拦截：`setWysiwygEnabled(true)` 默认执行守卫，避免未来新增自动入口再次漏判。
- 仅明确用户操作传 `userInitiated: true`：快捷键/按钮切换、模式菜单、超大文档通知里的“仍要开启”。
- 默认设置变化、启动、打开、批量恢复、标签恢复、全局 wrapper 都保持自动语义并受守卫。
- `enable === false` 始终允许；Office 只读规则优先且不变。
- 守卫以即将构建的当前内存文本（含未保存内容）为准；UTF-8 字节数 ≥200 KiB 或行数 ≥10,000 时阻断。
- `TabManager.importState` 已先 `await loadFileContent`，再把最终文本写入编辑器；守卫与 builder 读取之间没有 `await`，不引入空内容/旧内容竞态。
- 手动强制开启仍允许长耗时，这是既有产品契约；本轮不新增硬上限或二次确认。
- 已在所见模式中继续编辑导致内容增长，不属于本次“启用时守卫”的范围。

## 子任务

- ✅ G1：在 `setWysiwygEnabled` 的唯一构建入口前增加默认大文件守卫，日志记录字节、行数和当前路径。
- ✅ G2：给快捷键/按钮、通知动作加 `userInitiated` 豁免；模式菜单的豁免下沉到实际点击 handler，菜单注入本身不携带豁免。
- ✅ G3：标签恢复等待启用结果后，将 `tab.wysiwygEnabled` 收敛为此时的 `hooks.getWysiwygEnabled()`；保留内容、路径、dirty 和现有实际模式滚动恢复逻辑。恢复期间用户手动切换时读取最新实际状态，不回写调用前的旧值。
- ✅ G4：新增标签恢复回归测试，覆盖被拦截后收敛、低于阈值成功启用、重复恢复不重复发起启用、恢复等待期间手动切换不被旧值覆盖；菜单测试锁定只有点击 action 才传豁免。
- ✅ G5：运行 typecheck、全部前端测试、构建、Rust 测试，并用真实大文件复查启动/标签恢复日志。

## 验收标准

1. 真实大文件启动和会话恢复均没有自动 `Editor.create` 记录，不再出现 17 秒 / 11 秒自动构建。
2. 被拦截标签的内容、路径、dirty 不变，`wysiwygEnabled` 收敛为实际 `false`，重复恢复不重复调用启用。
3. 小文档标签成功恢复所见模式，状态保持 `true`。
4. 手动菜单、快捷键/按钮、通知动作仍可强制开启大文档所见模式。
5. 延迟回调在执行时按当前内容重新判定，而非只使用调度时的结果。
6. 所有既有及新增测试、typecheck、构建入口闭包和 Rust 测试通过。

## 实施与验收记录

- `setWysiwygEnabled` 现在默认拦截所有自动启用，仅三个真实用户动作传 `userInitiated`；标签恢复按实际模式收敛。
- 新增 4 个回归用例；完整验证为 typecheck 0 错误、Vitest 883/883、生产构建与入口闭包通过、Rust 31/31。
- 07:33 与 07:44 两次真机启动均命中新守卫并记录 1,078,087 字节 / 35,197 行，未再出现大文件自动 `Editor.create`；小文档仍约 5ms 启用。
- 遗留边界：整篇预览单次仍约 4.2–4.4 秒，启动收尾存在二次渲染；滚动与窗口重激活的主观流畅度未做独立帧率基准，不能据此宣称达到 Obsidian 的块级虚拟化水平。

## External Review Opinion

- Round 1/10（requirement）：NEEDS_CHANGES。要求改为默认拦截、盘点所有入口、明确跳过后的状态与滚动语义。
- Round 2/10（requirement）：同会话两次空响应后换会话重试；NEEDS_CHANGES。要求证明异步内容加载时序及 `wysiwygEnabled` 字段语义。
- Round 3/10（requirement）：APPROVED。确认最终内存文本在构建前已就绪，字段本就表示实际模式；默认拦截与状态收敛设计可实施。
- Round 4/10（plan）：NEEDS_CHANGES。要求菜单豁免下沉到真实点击 handler、补充等待期间手动切换竞态测试、明确小文档防误伤用例。
- Round 5/10（plan）：APPROVED。确认三项问题均已解决，方案可实施。
- Round 6/10（code）：NEEDS_CHANGES。提出守卫到 builder 的潜在异步窗口及返回契约问题。
- Round 7/10（code）：APPROVED。以逐行控制流证明守卫到 builder 无 `await`，且 builder 在首个 `await` 前同步读取同一文本；撤销不成立的竞态假设，确认实际状态回读与通知语义。
- Round 8/10（code）：APPROVED。确认标签实际状态收敛、小文档兼容、恢复期间手动操作与令牌检查均无回归。

## 风险与回滚

- 手动入口若漏标会被大文件守卫拦截：已逐一盘点并保留三条显式豁免路径，测试与真机验证覆盖。
- 标签状态从旧会话的 `true` 变为实际 `false`：该字段本就保存实际模式，不涉及用户默认偏好或数据迁移。
- 回滚仅需还原本批前端改动；已收敛的 `false` 只会让旧版本以源码视图打开，不影响文档内容。

## 工时估算

S：守卫与手动豁免、标签状态收敛、回归测试及真机复测。
