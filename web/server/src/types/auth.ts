/**
 * 共享类型
 */

export type UserRole = "admin" | "user";
export type UserStatus = "active" | "disabled";

export type PublicUser = {
  id: string;
  email: string;
  nickname: string;
  role: UserRole;
  status: UserStatus;
  createdAt: number;
  lastLoginAt: number | null;
};

export type AuthPayload = {
  token: string;
  refreshToken: string;
  expiresAt: number;
  user: PublicUser;
};

export type AdminOverview = {
  totalUsers: number;
  activeUsers: number;
  disabledUsers: number;
  totalSettings: number;
};
