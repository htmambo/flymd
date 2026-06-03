/**
 * 重置 admin 密码(命令行工具)
 *
 * 用法:npm run reset-password -- admin@flymd.local new-password-1234
 */
import { env } from "../config/env.js";
import { createApp } from "../http/app.js";
import { hashPassword } from "../utils/crypto.js";

const email = process.argv[2] || env.adminEmail;
const newPassword = process.argv[3] || process.env.NEW_PASSWORD;

if (!email || !newPassword) {
  console.error("用法: reset-password <email> <new-password>");
  console.error("  或:  email=$ADMIN_EMAIL NEW_PASSWORD=xxx npm run reset-password");
  process.exit(1);
}

(async () => {
  const app = await createApp();
  const u = app.database.findUserByEmail(email);
  if (!u) {
    console.error(`用户不存在: ${email}`);
    process.exit(1);
  }
  const db = app.database["db"] as any;
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
    hashPassword(newPassword),
    u.id,
  );
  app.database.revokeSession = app.database.revokeSession.bind(app.database);
  app.database.purgeUserData(u.id); // 清空 sessions
  console.log(`✅ 密码已重置: ${email} (已清空该用户所有 session)`);
  process.exit(0);
})();
