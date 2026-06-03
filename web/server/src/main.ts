import { env } from "./config/env.js";
import { createApp } from "./http/app.js";
import { hashPassword } from "./utils/crypto.js";

async function main() {
  const app = await createApp();

  // 初始化 admin 账号(从 env 读)
  if (env.adminEmail && env.adminPassword) {
    app.database.ensureAdmin(env.adminEmail, hashPassword(env.adminPassword));
    app.log.info(`管理员账号已就绪: ${env.adminEmail}`);
  }

  await app.listen({ host: env.host, port: env.port });
  app.log.info(`flymd web server 已启动: http://${env.host}:${env.port}`);
}

main().catch((error) => {
  console.error("flymd web server 启动失败", error);
  process.exit(1);
});
