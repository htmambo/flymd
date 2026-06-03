/**
 * Auth 路由
 *
 * /api/v1/auth/{register,login,me,refresh,logout,change-password,profile}
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../plugins/auth.js";
import { sendError, sendOk } from "../../utils/http.js";

const emailPwdSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
});

const registerSchema = emailPwdSchema.extend({
  nickname: z.string().trim().min(1).max(32).optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(8).max(128),
  nextPassword: z.string().min(8).max(128),
});

const updateProfileSchema = z.object({
  nickname: z.string().trim().min(1).max(32),
});

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post("/api/v1/auth/register", async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, parsed.error.issues[0]?.message ?? "请求参数错误");
    }
    try {
      const result = app.authService.register(
        parsed.data.email,
        parsed.data.password,
        parsed.data.nickname,
      );
      return sendOk(reply, 201, result);
    } catch (e) {
      return sendError(reply, 400, e instanceof Error ? e.message : "注册失败");
    }
  });

  app.post("/api/v1/auth/login", async (request, reply) => {
    const parsed = emailPwdSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, parsed.error.issues[0]?.message ?? "请求参数错误");
    }
    try {
      const result = app.authService.login(parsed.data.email, parsed.data.password);
      return sendOk(reply, 200, result);
    } catch (e) {
      return sendError(reply, 401, e instanceof Error ? e.message : "登录失败");
    }
  });

  app.get("/api/v1/auth/me", { preHandler: requireAuth }, async (request, reply) => {
    return sendOk(reply, 200, request.authUser);
  });

  app.post("/api/v1/auth/refresh", async (request, reply) => {
    const parsed = refreshSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, parsed.error.issues[0]?.message ?? "请求参数错误");
    }
    try {
      const session = app.database.refreshSession(parsed.data.refreshToken);
      const sessionInfo = app.database.authenticateBearerToken(session.token);
      if (!sessionInfo) throw new Error("刷新后的会话无效");
      return sendOk(reply, 200, { ...session, user: sessionInfo.user });
    } catch (e) {
      return sendError(reply, 401, e instanceof Error ? e.message : "刷新会话失败");
    }
  });

  app.post("/api/v1/auth/logout", { preHandler: requireAuth }, async (request, reply) => {
    if (request.authTokenHash) {
      app.database.revokeSession(request.authTokenHash);
    }
    return sendOk(reply, 200, { success: true });
  });

  app.post(
    "/api/v1/auth/change-password",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = changePasswordSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, parsed.error.issues[0]?.message ?? "请求参数错误");
      }
      try {
        app.authService.changePassword(
          request.authUser!.id,
          parsed.data.currentPassword,
          parsed.data.nextPassword,
        );
        return sendOk(reply, 200, { success: true });
      } catch (e) {
        return sendError(reply, 400, e instanceof Error ? e.message : "修改密码失败");
      }
    },
  );

  app.patch(
    "/api/v1/auth/profile",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = updateProfileSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, parsed.error.issues[0]?.message ?? "请求参数错误");
      }
      try {
        const user = app.authService.updateProfile(
          request.authUser!.id,
          parsed.data.nickname,
        );
        return sendOk(reply, 200, user);
      } catch (e) {
        return sendError(reply, 400, e instanceof Error ? e.message : "更新资料失败");
      }
    },
  );
}
