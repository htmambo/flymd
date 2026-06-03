/**
 * Settings 路由(管理员)
 *
 * /api/v1/admin/settings
 * /api/v1/admin/users
 * /api/v1/admin/overview
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin, requireAuth } from "../plugins/auth.js";
import { sendError, sendOk } from "../../utils/http.js";

const settingValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
]);

const upsertSettingSchema = z.object({
  key: z.string().min(1).max(128),
  value: settingValueSchema,
  category: z.enum(["ai", "apikey", "system", "user"]),
  visibility: z.enum(["admin", "user", "public"]).optional(),
  description: z.string().max(255).optional(),
});

const updateUserSchema = z
  .object({
    role: z.enum(["admin", "user"]).optional(),
    status: z.enum(["active", "disabled"]).optional(),
  })
  .refine((v) => v.role !== undefined || v.status !== undefined, {
    message: "至少提供一个更新字段",
  });

export async function registerAdminRoutes(app: FastifyInstance) {
  // 总览
  app.get("/api/v1/admin/overview", { preHandler: requireAdmin }, async (_request, reply) => {
    return sendOk(reply, 200, app.database.countOverview());
  });

  // 用户列表
  app.get("/api/v1/admin/users", { preHandler: requireAdmin }, async (_request, reply) => {
    return sendOk(reply, 200, app.database.listUsers());
  });

  // 更新用户(role / status)
  app.patch(
    "/api/v1/admin/users/:id",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const parsed = updateUserSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, parsed.error.issues[0]?.message ?? "请求参数错误");
      }
      const params = request.params as { id: string };
      const user = app.database.updateUser(params.id, parsed.data);
      if (!user) return sendError(reply, 404, "用户不存在");
      return sendOk(reply, 200, user);
    },
  );

  // 清空用户数据(sessions 等)
  app.delete(
    "/api/v1/admin/users/:id/data",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const params = request.params as { id: string };
      const user = app.database.findUserById(params.id);
      if (!user) return sendError(reply, 404, "用户不存在");
      app.database.purgeUserData(params.id);
      return sendOk(reply, 200, { success: true });
    },
  );

  // ============== 设置 ==============

  /** 列出所有设置(脱敏) */
  app.get("/api/v1/admin/settings", { preHandler: requireAdmin }, async (request, reply) => {
    const query = request.query as { category?: string; unmask?: string };
    const items = app.settingsService.list({
      category: (query.category as any) || undefined,
      unmask: query.unmask === "true",
    });
    return sendOk(reply, 200, items);
  });

  /** 列出分组(便于前端按 tab 渲染) */
  app.get("/api/v1/admin/settings/grouped", { preHandler: requireAdmin }, async (request, reply) => {
    const query = request.query as { unmask?: string };
    const grouped = app.settingsService.listGrouped({ unmask: query.unmask === "true" });
    return sendOk(reply, 200, grouped);
  });

  /** 读取单个设置 */
  app.get(
    "/api/v1/admin/settings/:key",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const params = request.params as { key: string };
      const query = request.query as { unmask?: string };
      const s = app.settingsService.get(params.key, { unmask: query.unmask === "true" });
      if (!s) return sendError(reply, 404, "设置不存在");
      return sendOk(reply, 200, s);
    },
  );

  /** 创建或更新设置 */
  app.put(
    "/api/v1/admin/settings",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const parsed = upsertSettingSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, parsed.error.issues[0]?.message ?? "请求参数错误");
      }
      try {
        const s = app.settingsService.upsert({
          key: parsed.data.key,
          value: parsed.data.value,
          category: parsed.data.category,
          visibility: parsed.data.visibility,
          description: parsed.data.description,
          updatedBy: request.authUser!.id,
        });
        return sendOk(reply, 200, s);
      } catch (e) {
        return sendError(reply, 400, e instanceof Error ? e.message : "保存失败");
      }
    },
  );

  /** 删除设置 */
  app.delete(
    "/api/v1/admin/settings/:key",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const params = request.params as { key: string };
      const ok = app.settingsService.delete(params.key);
      if (!ok) return sendError(reply, 404, "设置不存在");
      return sendOk(reply, 200, { success: true });
    },
  );
}

/** 普通用户可读"public visibility" 设置 */
export async function registerSettingsUserRoutes(app: FastifyInstance) {
  app.get(
    "/api/v1/settings/public",
    { preHandler: requireAuth },
    async (_request, reply) => {
      const items = app.settingsService.list({ visibility: "public" });
      return sendOk(reply, 200, items);
    },
  );
}
