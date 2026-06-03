/**
 * Auth 业务服务
 */
import { DatabaseClient } from "../db/database.js";
import { verifyPassword } from "../utils/crypto.js";
import type { AuthPayload, PublicUser, UserRole } from "../types/auth.js";

const NICK_MAX = 32;
const PWD_MIN = 8;
const PWD_MAX = 128;

export class AuthService {
  constructor(private db: DatabaseClient) {}

  validateEmail(email: string): string {
    const e = String(email || "").trim().toLowerCase();
    if (!e || !e.includes("@") || e.length > 255) {
      throw new Error("邮箱格式不正确");
    }
    return e;
  }

  validatePassword(pwd: string): string {
    const p = String(pwd || "");
    if (p.length < PWD_MIN) throw new Error(`密码至少 ${PWD_MIN} 位`);
    if (p.length > PWD_MAX) throw new Error(`密码最多 ${PWD_MAX} 位`);
    return p;
  }

  validateNickname(name: string): string {
    const n = String(name || "").trim().slice(0, NICK_MAX);
    if (!n) throw new Error("昵称不能为空");
    return n;
  }

  register(email: string, password: string, nickname?: string, role: UserRole = "user"): AuthPayload {
    const e = this.validateEmail(email);
    const p = this.validatePassword(password);
    if (this.db.findUserByEmail(e)) {
      throw new Error("该邮箱已被注册");
    }
    const n = nickname ? this.validateNickname(nickname) : e.split("@")[0];
    const user = this.db.createUser({ email: e, password: p, nickname: n, role });
    return this.issueSession(user);
  }

  login(email: string, password: string): AuthPayload {
    const e = this.validateEmail(email);
    const p = this.validatePassword(password);
    const u = this.db.findUserByEmail(e);
    if (!u) throw new Error("邮箱或密码不正确");
    if (u.status !== "active") throw new Error("账户已被禁用");
    if (!verifyPassword(p, u.password_hash)) {
      throw new Error("邮箱或密码不正确");
    }
    this.db.touchLastLogin(u.id);
    const publicUser = this.db.getPublicUserById(u.id);
    if (!publicUser) throw new Error("用户不存在");
    return this.issueSession(publicUser);
  }

  refresh(refreshToken: string): AuthPayload {
    const session = this.db.refreshSession(refreshToken);
    const info = this.db.authenticateBearerToken(session.token);
    if (!info) throw new Error("刷新后的会话无效");
    return { ...session, user: info.user };
  }

  changePassword(userId: string, currentPassword: string, nextPassword: string): void {
    const p = this.validatePassword(nextPassword);
    this.db.updatePassword(userId, currentPassword, p);
    // 简单安全:改密后清掉该用户所有 session(强制重新登录)
    this.db.purgeUserData(userId);
  }

  updateProfile(userId: string, nickname: string): PublicUser {
    const n = this.validateNickname(nickname);
    return this.db.updateProfile(userId, n);
  }

  private issueSession(user: PublicUser): AuthPayload {
    const session = this.db.createSession(user.id);
    return { ...session, user };
  }
}
