/**
 * HTTP 工具:统一响应包装 + 错误处理
 */
import type { FastifyReply } from "fastify";
import { ZodError } from "zod";

/** 统一成功响应包装:{ data: ... } */
export function sendOk<T>(reply: FastifyReply, status: number, data: T) {
  return reply.code(status).send({ data });
}

/** 统一错误响应:{ error: { message } } */
export function sendError(reply: FastifyReply, status: number, message: string) {
  return reply.code(status).send({ error: { message } });
}

/** 处理 zod 错误或普通 Error → 统一响应 */
export function handleError(reply: FastifyReply, error: unknown, defaultStatus = 400) {
  if (error instanceof ZodError) {
    return sendError(reply, 400, error.issues[0]?.message ?? "请求参数错误");
  }
  if (error instanceof Error) {
    return sendError(reply, defaultStatus, error.message);
  }
  return sendError(reply, 500, "服务器内部错误");
}
