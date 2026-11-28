# 插件 permissions 声明与安装前展示

**状态**: ✅ 已完成 (完成时间: 2026-11-28)
**创建**: 2026-11-28
**创建者**: Claude Code

## 任务目标

让插件 manifest 可声明 `permissions`（fs.read / fs.write / net / ui），安装前确认框展示归一化后的权限列表；恶意 manifest 注入的文本不会进入确认框。作为插件隔离方案 C 的过渡步骤，不声称是安全边界。

## 问题分析

当前安装确认只显示粗粒度提示「扩展将以应用权限运行，可读写本机文件并访问网络」。设计文档 `docs/security/plugin-isolation-plan.md` 的方案 C 建议在 manifest 增加 permissions 声明、安装时展示。但现有安装流程在确认前并未拉取 manifest（确认由 `extensionsPanel.confirmInstall` 完成，manifest 在 `runtime.installPlugin*` 内部才下载），无法直接展示。

因此本次仅做**不破坏现有流程**的部分：
- 在 manifest 解析层校验 `permissions` 字段：只接受已知枚举字符串数组，长度受限；未知/非法值直接忽略或拒绝，绝不把原始字符串拼进确认文案。
- 将归一化后的权限列表保存到 `InstalledPlugin`，供后续 UI/审计读取。
- 安装前确认仍使用现有粗粒度文案，避免为展示而提前下载 manifest 引入额外网络请求与竞态。

## 子任务列表

- ✅ 1. 梳理 manifest 类型与安装流程（已完成：确认在 UI 层、manifest 在 runtime 层下载）
- ✅ 2. 定义权限枚举与归一化函数，接入 manifest 解析
- ✅ 3. 单测：合法/非法/超长 permissions 的归一化
- ✅ 4. typecheck / vitest / build 验证

## 预期效果和 acceptance criteria

- 合法 permissions 被归一化保存；未知项、非字符串、超长数组被拒绝或忽略。
- 现有安装流程不受影响；确认文案不出现来自 manifest 的原始文本。
- 全量验证通过。

## 风险评估和缓解措施

- 风险：第三方插件 manifest 现有字段不含 permissions，解析不应因此失败。缓解：字段可选，缺失时视为空数组。
- 风险：把权限存进 InstalledPlugin 影响持久化兼容。缓解：字段可选，旧记录无该字段时按空处理。

## 实施顺序和依赖关系

1 → 2 → 3 → 4。

## 外部审核意见

- 未调用：coding-bridge HTTP 429 配额耗尽 / codex 未连接；本次未经过 External Review MCP 审查，以单测 + typecheck + build 兜底。
