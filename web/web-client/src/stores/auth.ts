/**
 * Auth Store(Pinia 组合式)
 */
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { api, ApiError } from "@/services/api";
import type { PublicUser } from "@/types/api";

const TOKEN_KEY = "flymd-web:token";
const USER_KEY = "flymd-web:user";

function loadToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}
function loadUser(): PublicUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export const useAuthStore = defineStore("auth", () => {
  const token = ref<string | null>(loadToken());
  const user = ref<PublicUser | null>(loadUser());
  const ready = ref(false);
  const error = ref<string | null>(null);
  const loading = ref(false);

  const isAuthenticated = computed(() => Boolean(token.value && user.value));
  const isAdmin = computed(() => user.value?.role === "admin");

  function setSession(nextToken: string, nextUser: PublicUser) {
    token.value = nextToken;
    user.value = nextUser;
    try { localStorage.setItem(TOKEN_KEY, nextToken) } catch {}
    try { localStorage.setItem(USER_KEY, JSON.stringify(nextUser)) } catch {}
  }

  function replaceUser(nextUser: PublicUser) {
    user.value = nextUser;
    try { localStorage.setItem(USER_KEY, JSON.stringify(nextUser)) } catch {}
  }

  function clearSession() {
    token.value = null;
    user.value = null;
    try { localStorage.removeItem(TOKEN_KEY) } catch {}
    try { localStorage.removeItem(USER_KEY) } catch {}
  }

  function setError(msg: string | null) {
    error.value = msg
  }

  async function login(email: string, password: string): Promise<boolean> {
    loading.value = true
    setError(null)
    try {
      const result = await api.login(email, password)
      setSession(result.token, result.user)
      return true
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error)?.message || "登录失败")
      return false
    } finally {
      loading.value = false
    }
  }

  async function register(email: string, password: string, nickname?: string): Promise<boolean> {
    loading.value = true
    setError(null)
    try {
      const result = await api.register(email, password, nickname)
      setSession(result.token, result.user)
      return true
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error)?.message || "注册失败")
      return false
    } finally {
      loading.value = false
    }
  }

  async function logout(): Promise<void> {
    if (token.value) {
      try { await api.logout(token.value) } catch {}
    }
    clearSession()
  }

  async function refreshMe(): Promise<void> {
    if (!token.value) return
    try {
      const me = await api.me(token.value)
      replaceUser(me)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        clearSession()
      }
    }
  }

  async function initialize(): Promise<void> {
    if (ready.value) return
    if (token.value) {
      await refreshMe()
    }
    ready.value = true
  }

  return {
    token, user, ready, error, loading,
    isAuthenticated, isAdmin,
    login, register, logout, refreshMe, initialize,
    setError, clearSession,
  }
})
