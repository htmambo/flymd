# 插件安装加固与资源优化（plugin-install-hardening）

**状态**: ✅ 已完成 (开始时间: 2026-11-28，完成时间: 2026-11-28)
> 对应 fullauto 状态：.omc/fullauto/plugin-install-hardening/state.json

## 任务目标

1. 净化插件安装阶段的全部路径输入，堵住 `manifest.id` / `main` / `assets` / 本地目录条目的路径穿越。
2. 安装前展示来源并提示扩展权限，覆盖市场一键安装与手动 URL/本地安装。
3. 压缩 `good.png` 与 AI 助手头像。
4. 产出插件隔离设计文档，作为后续根治项的依据。

## 问题分析

- `src/extensions/runtime.ts` 的远程安装直接把 `manifest.id` 拼进目录、把 `manifest.main` 拼进下载 URL 与写入路径；`assets` 只过滤 `..`，未拒绝盘符/ADS。
- 本地安装的 `manifest.id` / `main` 同样未校验。
- `pluginHost.readPluginMainCode` 直接使用历史记录里的 `p.main`。
- 安装入口只有失败日志，没有“扩展将以应用权限运行”的确认。
- `good.png` 155KB 仅用于 280px 二维码；插件头像 606KB。

## 子任务列表

- [x] T1 路径净化纯函数 + 单测；接入远程/本地安装与读取入口
- [x] T2 安装确认（i18n + 市场/手动入口）
- [x] T3 图片压缩
- [x] T4 插件隔离设计文档

## 验收标准

- `pnpm typecheck` / `pnpm test` / `pnpm build` 全绿。
- 路径穿越、Windows 盘符、ADS、Unicode 资源名均有单测。
- 两张图片体积显著下降，`dist` 不增加。

## 风险与缓解

- 过严的 id 规则可能拒绝历史插件：现有官方 id 均为 ASCII，测试覆盖 `flymd-RAG` 等大写形式。
- 非法 asset 静默跳过：保留告警日志，不阻断安装。
- 安装确认只加 UI 入口，自动更新不弹窗，避免打扰。

## 实施顺序

T1 → T2 → T3 → T4 → 全量验证。

## QA 记录

- `pnpm typecheck`：通过
- `pnpm test`：95 文件 / 1174 用例通过（新增 `pluginPath.test.ts` 7 例）
- `pnpm build`：通过；入口静态闭包 0.63MB
- `git diff --check`：通过
- 图片：`good.png` 155KB → 28KB；AI 助手头像 606KB → 48KB

## 验收结论

路径净化、安装确认、图片压缩、隔离设计文档全部完成；安全代理复核 APPROVED（LOW risk），非阻塞建议（Windows 保留名/结尾点、百分号编码、控制字符、符号链接、资产 URL 复用净化、确认标题）已全部处理。残余风险（同 realm、市场自定义源）记录在 `docs/security/plugin-isolation-plan.md`。
