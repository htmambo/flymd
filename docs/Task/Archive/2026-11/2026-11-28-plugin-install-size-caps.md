# 插件安装体积上限（plugin-install-size-caps）

**状态**: ✅ 已完成 (开始时间: 2026-11-28，完成时间: 2026-11-28)

## 任务目标

插件安装的 manifest / main / assets 全部来自网络或用户选择的目录，旧实现直接整读整写，没有体积约束。恶意源可让安装流程下载几百 MB 文件：内存峰值、插件目录写爆、后续 Blob 加载卡死 UI。

## 问题分析

- `fetchTextSmart` / `fetchBinarySmart` 无大小上限，`writeFile` 直接落盘。
- `manifest.assets` 数组长度未限制，逐个下载会放大攻击面。
- 本地安装 `copyDirRecursive` 同样整读文件。

## 改动内容

- `src/extensions/runtime.ts` 新增导出常量：
  - `MAX_PLUGIN_MANIFEST_CHARS`（1M）、`MAX_PLUGIN_MAIN_CHARS`（8M）
  - `MAX_PLUGIN_ASSET_BYTES`（8MB）、`MAX_PLUGIN_ASSETS`（500）
- 远端安装：
  - manifest 文本、main 文本超限直接抛错（发生在写盘之前）；
  - assets 条目数超限在下载前拒绝（fail-fast）；
  - 单个资源超过 8MB 跳过并 `console.warn`，不影响其余资源；
- 本地安装：复制时单文件超过 8MB 跳过并告警。
- `src/extensions/runtimeInstall.test.ts` 增加 4 个用例（manifest/main 超限拒绝、超限资源跳过、条目过多拒绝）。

## 验收标准

- `vitest run src/extensions/runtimeInstall.test.ts`：9/9 通过。
- 全量 `pnpm test`：98 文件 / 1194 用例通过；`pnpm typecheck`、`pnpm build` 通过。
- 正常体积插件安装行为不变。

## 风险与缓解

- 上限是"防呆 + 防刷"而非精确配额：文本按 UTF-16 码元计，UTF-8 实际字节更多；阈值远高于真实插件体积。
- 超限资源是跳过而非整体失败：与旧行为（单个资源失败仅告警）一致。
- 文件在检查前已完整读入内存，峰值内存未被压缩；后续可改为流式下载 + 边下边校验。

## QA 记录

- 定向 9/9；全量 1194/1194；typecheck / build 通过。
- 外部审核：未参与（coding-bridge HTTP 429 月度配额耗尽；codex MCP 连接关闭）。
