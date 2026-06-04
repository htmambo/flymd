/**
 * RAG HTTP 路由
 *
 * 端点:
 *   POST /api/v1/rag/search    检索(libraryRoot + query) → hits[]
 *   POST /api/v1/rag/ask       RAG 闭环(search + prompt + LLM) → { answer, sources, model, usage }
 *   POST /api/v1/rag/embed     代理 embedding(SSRF 校验) → { dim, vectors }
 *
 * 鉴权:
 *   - search / ask: 需登录 — 普通用户也能用
 *   - embed: 需 admin(因为它能对任意 baseUrl 发请求,SSRF 风险点)
 *
 * 设计取舍:
 *   - search/ask 不强制 admin,因为它们依赖 libraryRoot(用户自己机器的路径),
 *     攻击面小。但依然走 auth 闸门。
 *   - embed 是高风险端点(SSRF 任意 URL),强制 admin。
 *   - 不在服务端做 chunking(由浏览器端索引器负责,避免重复)
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendError, sendOk, handleError } from "../../utils/http.js";
import { requireAdmin } from "../plugins/auth.js";
import { validateBaseUrl } from "../../services/rag/ssrf.js";
import { OpenAIEmbedder } from "../../services/rag/index.js";

// ============================================================
// zod schema
// ============================================================

const searchSchema = z.object({
  query: z.string().min(1).max(2000),
  libraryRoot: z.string().min(1).max(1024),
  topK: z.number().int().min(1).max(50).optional(),
  minScore: z.number().min(-1).max(1).optional(),
  maxContextChars: z.number().int().min(200).max(20000).optional(),
});

const askSchema = searchSchema.extend({
  model: z.string().min(1).max(128).optional(),
  temperature: z.number().min(0).max(2).optional(),
  systemPrompt: z.string().min(1).max(4000).optional(),
});

const embedSchema = z.object({
  baseUrl: z.string().min(1).max(512),
  apiKey: z.string().max(512).optional(),
  model: z.string().min(1).max(128),
  inputs: z.array(z.string().min(1).max(8000)).min(1).max(2048),
  allowPrivate: z.boolean().optional(),
  timeoutMs: z.number().int().min(1000).max(120000).optional(),
});

// ============================================================
// 路由注册
// ============================================================

export async function registerRagRoutes(app: FastifyInstance) {
  // 1) /api/v1/rag/search — 需登录
  app.post("/api/v1/rag/search", async (request, reply) => {
    if (!request.authUser) {
      return sendError(reply, 401, "未登录");
    }
    const parsed = searchSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, parsed.error.issues[0]?.message ?? "请求参数错误");
    }
    try {
      if (!app.ragService) {
        return sendError(reply, 503, "RAG 服务未初始化(请先在 admin 配置 AI provider)");
      }
      const hits = await app.ragService.searchHits(
        parsed.data.libraryRoot,
        parsed.data.query,
        {
          topK: parsed.data.topK,
          minScore: parsed.data.minScore,
          maxContextChars: parsed.data.maxContextChars,
        },
      );
      return sendOk(reply, 200, { hits });
    } catch (e) {
      app.log.warn({ err: e }, "/api/v1/rag/search failed");
      return handleError(reply, e, 400);
    }
  });

  // 2) /api/v1/rag/ask — 需登录
  app.post("/api/v1/rag/ask", async (request, reply) => {
    if (!request.authUser) {
      return sendError(reply, 401, "未登录");
    }
    const parsed = askSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, parsed.error.issues[0]?.message ?? "请求参数错误");
    }
    try {
      if (!app.ragService) {
        return sendError(reply, 503, "RAG 服务未初始化(请先在 admin 配置 AI provider)");
      }
      const { model, temperature, systemPrompt, ...rest } = parsed.data;
      const r = await app.ragService.askWithContext(
        rest.libraryRoot,
        rest.query,
        {
          topK: rest.topK,
          minScore: rest.minScore,
          maxContextChars: rest.maxContextChars,
          model,
          temperature,
          systemPrompt,
        },
      );
      return sendOk(reply, 200, r);
    } catch (e) {
      app.log.warn({ err: e }, "/api/v1/rag/ask failed");
      return handleError(reply, e, 400);
    }
  });

  // 3) /api/v1/rag/embed — 需 admin(SSRF 高风险)
  // bodyLimit:2048 inputs × 8000 chars ≈ 16MB,但实际 JSON 会更小;
  // 设为 8MB 留余量(避免上游 100MB+ 滥用)
  app.post(
    "/api/v1/rag/embed",
    {
      preHandler: requireAdmin,
      config: { bodyLimit: 8 * 1024 * 1024 },
    },
    async (request, reply) => {
      const parsed = embedSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, parsed.error.issues[0]?.message ?? "请求参数错误");
      }
      const v = validateBaseUrl(parsed.data.baseUrl, {
        allowPrivate: parsed.data.allowPrivate,
      });
      if (!v.ok) {
        return reply.code(400).send({
          error: { message: v.reason, code: "ssrf_blocked" },
        });
      }
      try {
        const embedder = new OpenAIEmbedder({
          baseUrl: parsed.data.baseUrl,
          apiKey: parsed.data.apiKey,
          model: parsed.data.model,
          allowPrivate: parsed.data.allowPrivate,
          timeoutMs: parsed.data.timeoutMs,
        });
        const vectors = await embedder.embed(parsed.data.inputs);
        const dim = vectors[0]?.length ?? 0;
        return sendOk(reply, 200, { dim, vectors });
      } catch (e) {
        app.log.warn({ err: e }, "/api/v1/rag/embed failed");
        return handleError(reply, e, 502);
      }
    },
  );
}
