/**
 * 健康检查
 */
import type { FastifyInstance } from "fastify";
import { sendOk } from "../../utils/http.js";

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get("/health", async (_request, reply) => {
    return sendOk(reply, 200, {
      status: "ok",
      service: "flymd-web",
      timestamp: new Date().toISOString(),
    });
  });
}
