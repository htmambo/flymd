/**
 * AI Provider 管理路由(管理员)
 *
 * 端点(全部需 admin):
 *   GET    /api/v1/admin/ai/providers        列出所有 provider configs
 *   PUT    /api/v1/admin/ai/providers/:id   创/改 provider
 *   DELETE /api/v1/admin/ai/providers/:id   删除
 *   POST   /api/v1/admin/ai/providers/:id/test  测试连接
 *   GET    /api/v1/admin/ai/priority       读 priority 数组
 *   PUT    /api/v1/admin/ai/priority       改 priority 数组
 *
 * 数据存到 settings 表:
 *   ai.providers.<id>.{protocol, name, apiKey, baseUrl, defaultModel, enabled}
 *   ai.priority = ["id1", "id2", ...]
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../plugins/auth.js";
import { sendError, sendOk } from "../../utils/http.js";

const providerSchema = z.object({
  protocol: z.enum(["openai", "anthropic", "ollama", "generic-openai"]),
  name: z.string().min(1).max(64).optional(),
  apiKey: z.string().min(1).max(512).optional(),
  baseUrl: z.string().url().max(256).optional(),
  defaultModel: z.string().max(128).optional(),
  enabled: z.boolean().optional(),
});

const prioritySchema = z.object({
  priority: z.array(z.string().min(1).max(64)).max(64),
});

const ID_REGEX = /^[\w\-]{1,64}$/;

function readProviders(settings: any): Array<{ id: string; protocol: string; name?: string; apiKey?: string; baseUrl?: string; defaultModel?: string; enabled?: boolean }> {
  const out: any[] = [];
  const list = settings.list({ unmask: true }) as any[];
  const map = new Map<string, any>();
  for (const s of list) {
    const m = /^ai\.providers\.([\w\-]+)\.([a-z]+)$/i.exec(s.key);
    if (!m) continue;
    const id = m[1];
    const field = m[2];
    if (!map.has(id)) map.set(id, { id });
    map.get(id)[field] = s.value;
  }
  for (const [id, v] of map) out.push(v);
  return out;
}

function providerToResponse(p: any) {
  return {
    id: p.id,
    name: p.name || p.id,
    protocol: p.protocol || "generic-openai",
    apiKey: p.apiKey ? `${"*".repeat(Math.max(0, (p.apiKey as string).length - 4))}${(p.apiKey as string).slice(-4)}` : "",
    apiKeySet: !!p.apiKey,
    baseUrl: p.baseUrl,
    defaultModel: p.defaultModel,
    enabled: p.enabled !== false,
  };
}

export async function registerAiAdminRoutes(app: FastifyInstance) {
  // 列表
  app.get("/api/v1/admin/ai/providers", { preHandler: requireAdmin }, async (_request, reply) => {
    try {
      const providers = readProviders(app.settingsService).map(providerToResponse);
      return sendOk(reply, 200, providers);
    } catch (e: any) {
      return sendError(reply, 500, e?.message || "列出失败");
    }
  });

  // 创建 / 更新
  app.put(
    "/api/v1/admin/ai/providers/:id",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const params = request.params as { id: string };
      if (!ID_REGEX.test(params.id)) return sendError(reply, 400, "ID 非法(仅字母数字 _-)");
      const parsed = providerSchema.safeParse(request.body);
      if (!parsed.success) return sendError(reply, 400, parsed.error.issues[0]?.message ?? "请求参数错误");
      try {
        for (const [k, v] of Object.entries(parsed.data)) {
          if (v === undefined) continue;
          app.settingsService.upsert({
            key: `ai.providers.${params.id}.${k}`,
            value: v,
            category: "ai",
            visibility: "admin",
            updatedBy: request.authUser!.id,
          });
        }
        const list = readProviders(app.settingsService);
        const found = list.find((p) => p.id === params.id);
        if (!found) return sendError(reply, 500, "创建后未找到");
        return sendOk(reply, 200, providerToResponse(found));
      } catch (e: any) {
        return sendError(reply, 500, e?.message || "保存失败");
      }
    },
  );

  // 删除
  app.delete(
    "/api/v1/admin/ai/providers/:id",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const params = request.params as { id: string };
      // 删 ai.providers.<id>.* 全部字段
      const all = app.settingsService.list({ category: "ai" });
      for (const s of all) {
        const m = new RegExp(`^ai\\.providers\\.${params.id}\\.[a-z]+$`).exec(s.key);
        if (m) app.settingsService.delete(s.key);
      }
      return sendOk(reply, 200, { success: true });
    },
  );

  // 测试连接
  app.post(
    "/api/v1/admin/ai/providers/:id/test",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const params = request.params as { id: string };
      const list = readProviders(app.settingsService);
      const p = list.find((x) => x.id === params.id);
      if (!p) return sendError(reply, 404, "provider 不存在");
      try {
        const { pickProvider, loadProviderConfigs, routeChat } = await import("../../services/ai/router.js");
        const configs = loadProviderConfigs(app.settingsService.list({ unmask: true }));
        const model = (p.defaultModel as string) || (p.protocol === "anthropic" ? "claude-3-5-haiku-20241022" : p.protocol === "ollama" ? "qwen2.5:0.5b" : "gpt-4o-mini");
        const resp = await routeChat({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 8 } as any, configs, { userId: request.authUser!.id, requestId: "test_" + Date.now(), mock: false });
        return sendOk(reply, 200, { ok: true, reply: resp.choices?.[0]?.message?.content || "(empty)" });
      } catch (e: any) {
        return sendOk(reply, 200, { ok: false, error: e?.message || String(e) });
      }
    },
  );

  // priority 读
  app.get("/api/v1/admin/ai/priority", { preHandler: requireAdmin }, async (_request, reply) => {
    const s = app.settingsService.get("ai.priority", { unmask: true });
    return sendOk(reply, 200, Array.isArray(s?.value) ? s!.value : []);
  });

  // priority 改
  app.put("/api/v1/admin/ai/priority", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = prioritySchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.issues[0]?.message ?? "参数错误");
    try {
      app.settingsService.upsert({
        key: "ai.priority",
        value: parsed.data.priority,
        category: "ai",
        visibility: "admin",
        updatedBy: request.authUser!.id,
      });
      return sendOk(reply, 200, { success: true, priority: parsed.data.priority });
    } catch (e: any) {
      return sendError(reply, 500, e?.message || "保存失败");
    }
  });

  // 用量聚合(Iter 3)
  app.get("/api/v1/admin/ai/usage", { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const q = (request.query || {}) as { since?: string; window?: string };
      // 支持两种语义:
      //   - since=ms 时间戳(默认 0,全量)
      //   - window=1h|24h|7d|30d(便捷写法)
      let sinceMs = Number.parseInt(String(q.since || "0"), 10);
      if (!Number.isFinite(sinceMs) || sinceMs < 0) sinceMs = 0;
      const w = String(q.window || "").toLowerCase();
      if (w === "1h") sinceMs = Date.now() - 60 * 60 * 1000;
      else if (w === "24h") sinceMs = Date.now() - 24 * 60 * 60 * 1000;
      else if (w === "7d") sinceMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
      else if (w === "30d") sinceMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const summary = app.database.aiUsageSummary(sinceMs);
      return sendOk(reply, 200, {
        sinceMs,
        window: w || "all",
        ...summary,
        errorRate: summary.totalCalls > 0
          ? Math.round((summary.errorCount * 10000) / summary.totalCalls) / 100
          : 0,
        cacheHitRate: summary.totalCalls > 0
          ? Math.round((summary.cacheHits * 10000) / summary.totalCalls) / 100
          : 0,
      });
    } catch (e: any) {
      return sendError(reply, 500, e?.message || "查询失败");
    }
  });
}
