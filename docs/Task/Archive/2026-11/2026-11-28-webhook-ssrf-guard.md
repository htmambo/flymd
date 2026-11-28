# Webhook 出站 URL 校验（webhook-ssrf-guard）

**状态**: ✅ 已完成 (开始时间: 2026-11-28，完成时间: 2026-11-28)

## 任务目标

通知渠道（飞书 / 钉钉 / 企业微信）的 webhook 由管理员配置，但服务端直接 `fetch(cfg.webhook)` 仍是 SSRF 面。本轮在发送前统一校验目标 URL。

## 问题分析

- `web/server/src/services/notify/{wecom,feishu,dingtalk}.ts` 未校验 webhook，可访问 `169.254.169.254`、云元数据、`0.0.0.0` 等地址。
- webhook 由管理员配置，风险低于公开接口，但配置被篡改/误填时仍可被利用。

## 改动内容

- 新增 `web/server/src/utils/urlGuard.ts`：仅 http/https，拒绝内嵌凭据、link-local、`0.0.0.0/8`、Alibaba/Azure/Oracle/AWS IPv6 元数据；私网/回环保留（自托管机器人）。
- 三个发送器在 `fetch` 前调用 `validateOutboundUrl`，失败返回结构化错误。
- 新增 `urlGuard.test.ts`：公网/内网放行，14 类危险目标拒绝。

## 验收标准

- `vitest run src/utils/urlGuard.test.ts` 通过。
- 现有通知发送逻辑在合法 URL 下行为不变；非法 URL 返回 `success:false` 与原因。

## 风险与缓解

- DNS rebinding 未覆盖（只做字符串/IP 字面量校验），在文件注释中记录。
- 私网/回环故意放行，避免破坏内网通知；如需更严格可加配置开关。

## QA 记录

- 定向测试：`web/server` 下 `vitest run src/utils/urlGuard.test.ts` 3/3 通过。
- `web/server` 全量测试当前受环境缺失依赖影响（`dotenv`/`fastify`/`zod`/`@types/node` 未安装，3 个既有文件失败），与本次改动无关。
