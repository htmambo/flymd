<script setup lang="ts">
import { ref, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const mode = ref<"login" | "register">("login");
const email = ref("");
const password = ref("");
const nickname = ref("");
const showPassword = ref(false);

const submitLabel = computed(() => (mode.value === "login" ? "登录" : "注册"));
const switchLabel = computed(() => (mode.value === "login" ? "没有账号?立即注册" : "已有账号?立即登录"));

async function handleSubmit() {
  if (!email.value || !password.value) {
    auth.setError("请输入邮箱和密码");
    return
  }
  let ok = false
  if (mode.value === "login") {
    ok = await auth.login(email.value, password.value)
  } else {
    ok = await auth.register(email.value, password.value, nickname.value || undefined)
  }
  if (ok) {
    const redirect = (route.query.redirect as string) || "/app"
    await router.push(redirect)
  }
}

function switchMode() {
  mode.value = mode.value === "login" ? "register" : "login"
  auth.setError(null)
}
</script>

<template>
  <div class="login-page">
    <div class="login-card card hover-card hover-card-glow">
      <div class="brand">
        <div class="logo">flymd</div>
        <div class="muted">管理后台</div>
      </div>
      <h1 class="title">{{ mode === "login" ? "欢迎回来" : "创建账号" }}</h1>
      <p class="subtitle">
        {{ mode === "login" ? "登录以管理 AI 配置、API_KEY 与用户" : "注册一个管理员账号" }}
      </p>

      <form class="form" @submit.prevent="handleSubmit">
        <div v-if="mode === 'register'">
          <label for="nickname">昵称(可选)</label>
          <input
            id="nickname"
            v-model="nickname"
            type="text"
            placeholder="您的显示名"
            autocomplete="nickname"
          />
        </div>
        <div>
          <label for="email">邮箱</label>
          <input
            id="email"
            v-model="email"
            type="email"
            placeholder="admin@flymd.local"
            autocomplete="email"
            required
          />
        </div>
        <div>
          <label for="password">密码</label>
          <div class="password-row">
            <input
              id="password"
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              placeholder="至少 8 位"
              autocomplete="current-password"
              required
            />
            <button
              type="button"
              class="toggle-pwd"
              @click="showPassword = !showPassword"
              :title="showPassword ? '隐藏密码' : '显示密码'"
            >
              {{ showPassword ? "🙈" : "👁" }}
            </button>
          </div>
        </div>

        <div v-if="auth.error" class="error">{{ auth.error }}</div>

        <button class="btn btn-primary submit" :disabled="auth.loading" type="submit">
          <span v-if="auth.loading">处理中…</span>
          <span v-else>{{ submitLabel }}</span>
        </button>
      </form>

      <button class="switch" @click="switchMode">{{ switchLabel }}</button>

      <div class="hint muted">
        默认管理员:<code>admin@flymd.local</code> / <code>admin123</code>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  padding: 24px;
}
.login-card {
  width: 100%;
  max-width: 400px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 32px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.04);
}
.brand { text-align: center; margin-bottom: 24px; }
.logo {
  font-size: 28px;
  font-weight: 800;
  background: linear-gradient(135deg, var(--accent), #7c3aed);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.title { font-size: 20px; margin: 0 0 4px; text-align: center; }
.subtitle { text-align: center; color: var(--muted); font-size: 13px; margin: 0 0 24px; }
.form { display: flex; flex-direction: column; gap: 14px; }
.password-row { position: relative; display: flex; }
.password-row input { padding-right: 40px; }
.toggle-pwd {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: 0;
  width: 32px;
  height: 32px;
  padding: 0;
  font-size: 16px;
  border-radius: 4px;
}
.toggle-pwd:hover { background: var(--border); }
.submit { margin-top: 8px; padding: 10px; font-weight: 600; }
.error { padding: 8px 12px; background: rgba(220, 38, 38, 0.1); border-radius: 6px; }
.switch {
  margin-top: 16px;
  width: 100%;
  background: transparent;
  border: 0;
  color: var(--accent);
  font-size: 13px;
  cursor: pointer;
  padding: 8px;
}
.switch:hover { text-decoration: underline; }
.hint { text-align: center; font-size: 12px; margin-top: 16px; }
.hint code { background: var(--bg); padding: 1px 4px; border-radius: 3px; font-size: 11px; }
.muted { color: var(--muted); }
</style>
