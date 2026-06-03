/**
 * 告警通知 admin 路由
 *
 * 端点(全部需 admin):
 *   GET    /api/v1/admin/notify/channels           列出(脱敏)
 *   GET    /api/v1/admin/notify/channels/:id       单个(脱敏)
 *   PUT    /api/v1/admin/notify/channels/:id       创/改
 *   DELETE /api/v1/admin/notify/channels/:id       删
 *   POST   /api/v1/admin/notify/channels/:id/test  发测试消息
 *   GET    /api/v1/admin/notify/history            发送历史
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../plugins/auth.js";
import { sendError, sendOk } from "../../utils/http.js";
import {
  isValidChannelId, writeChannel, deleteChannel, findChannel, maskChannel,
} from "../../services/notify/store.js";
import type { AlertPayload } from "../../services/notify/types.js";

const NOTIFY_TYPES = ["feishu", "dingtalk", "telegram", "wecom"] as const;

const channelSchema = z.object({
  type: z.enum(NOTIFY_TYPES),
  name: z.string().max(64).optional(),
  enabled: z.boolean().optional(),
  webhook: z.string().url().max(512).optional(),
  secret: z.string().max(256).optional(),
  botToken: z.string().max(256).optional(),
  chatId: z.string().max(64).optional(),
  events: z.array(z.string().min(1).max(64)).max(32).optional(),
});

export async function registerNotifyAdminRoutes(app: FastifyInstance) {
  // 列表(脱敏)
  app.get("/api/v1/admin/notify/channels", { preHandler: requireAdmin }, async (_request, reply) => {
    try {
      const list = app.notifyService.listChannels().map(maskChannel);
      return sendOk(reply, 200, list);
    } catch (e: any) {
      return sendError(reply, 500, e?.message || "列出失败");
    }
  });

  // 读单个(脱敏)
  app.get("/api/v1/admin/notify/channels/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const params = request.params as { id: string };
    if (!isValidChannelId(params.id)) return sendError(reply, 400, "ID 非法");
    const ch = findChannel(app.notifyService.listChannels(), params.id);
    if (!ch) return sendError(reply, 404, "通道不存在");
    return sendOk(reply, 200, maskChannel(ch));
  });

  // 创/改
  app.put("/api/v1/admin/notify/channels/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const params = request.params as { id: string };
    if (!isValidChannelId(params.id)) return sendError(reply, 400, "ID 非法(仅字母数字 _-)");
    const parsed = channelSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.issues[0]?.message ?? "请求参数错误");
    try {
      writeChannel(app.settingsService, params.id, parsed.data, request.authUser!.id);
      const ch = findChannel(app.notifyService.listChannels(), params.id);
      if (!ch) return sendError(reply, 500, "创建后未找到");
      return sendOk(reply, 200, maskChannel(ch));
    } catch (e: any) {
      return sendError(reply, 500, e?.message || "保存失败");
    }
  });

  // 删
  app.delete("/api/v1/admin/notify/channels/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const params = request.params as { id: string };
    if (!isValidChannelId(params.id)) return sendError(reply, 400, "ID 非法");
    const n = deleteChannel(app.settingsService, params.id);
    return sendOk(reply, 200, { success: true, deleted: n });
  });

  // 发测试消息
  app.post("/api/v1/admin/notify/channels/:id/test", { preHandler: requireAdmin }, async (request, reply) => {
    const params = request.params as { id: string };
    if (!isValidChannelId(params.id)) return sendError(reply, 400, "ID 非法");
    const ch = findChannel(app.notifyService.listChannels(), params.id);
    if (!ch) return sendError(reply, 404, "通道不存在");
    const payload: AlertPayload = {
      event: "test",
      severity: "info",
      message: `这是一条来自 flymd-web 的测试消息(${params.id})`,
      detail: { admin: request.authUser!.email, at: new Date().toISOString() },
      dedupKey: `test-${params.id}-${Date.now()}`, // 测试不参与去重
    };
    try {
      const result = await app.notifyService.alert(payload);
      return sendOk(reply, 200, { ok: true, result });
    } catch (e: any) {
      return sendError(reply, 500, e?.message || "测试发送失败");
    }
  });

  // 历史
  app.get("/api/v1/admin/notify/history", { preHandler: requireAdmin }, async (request, reply) => {
    const q = (request.query || {}) as { event?: string; limit?: string; offset?: string };
    const limit = Math.min(Math.max(Number.parseInt(String(q.limit || "50"), 10) || 50, 1), 200);
    const offset = Math.max(Number.parseInt(String(q.offset || "0"), 10) || 0, 0);
    try {
      const rows = app.database.listAlerts({
        event: q.event,
        limit,
        offset,
      });
      return sendOk(reply, 200, { items: rows, limit, offset });
    } catch (e: any) {
      return sendError(reply, 500, e?.message || "查询失败");
    }
  });
}
