<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
const router = useRouter();

const navItems = computed(() => [
  { name: "settings", label: "设置", icon: "⚙" },
]);

async function handleLogout() {
  await auth.logout();
  await router.push({ name: "login" });
}
</script>

<template>
  <div class="app-layout">
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="logo">flymd</div>
        <div class="muted small">管理后台</div>
      </div>
      <nav class="sidebar-nav">
        <router-link
          v-for="item in navItems"
          :key="item.name"
          :to="{ name: item.name }"
          class="nav-item"
          active-class="active"
        >
          <span class="nav-icon">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
        </router-link>
      </nav>
      <div class="sidebar-footer">
        <div class="user-card hover-card">
          <div class="user-name">{{ auth.user?.nickname || auth.user?.email }}</div>
          <div class="user-role muted small">
            {{ auth.user?.email }}
            <span v-if="auth.isAdmin" class="badge">管理员</span>
          </div>
        </div>
        <button class="btn-ghost logout" @click="handleLogout">退出登录</button>
      </div>
    </aside>
    <main class="content">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.app-layout {
  display: grid;
  grid-template-columns: 240px 1fr;
  height: 100vh;
  background: var(--bg);
  color: var(--fg);
}
.sidebar {
  display: flex;
  flex-direction: column;
  background: var(--card);
  border-right: 1px solid var(--border);
  overflow: hidden;
}
.sidebar-header {
  padding: 20px 16px 16px;
  border-bottom: 1px solid var(--border);
}
.logo {
  font-size: 20px;
  font-weight: 800;
  background: linear-gradient(135deg, var(--accent), #7c3aed);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.small { font-size: 12px; }
.muted { color: var(--muted); }
.sidebar-nav {
  flex: 1;
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 6px;
  text-decoration: none;
  color: var(--fg);
  font-size: 14px;
  transition: background 0.12s;
}
.nav-item:hover { background: var(--border); }
.nav-item.active { background: rgba(37, 99, 235, 0.12); color: var(--accent); font-weight: 600; }
.nav-icon { font-size: 16px; }
.sidebar-footer {
  padding: 12px;
  border-top: 1px solid var(--border);
}
.user-card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 8px;
}
.user-name { font-weight: 600; font-size: 13px; }
.user-role { display: flex; align-items: center; gap: 6px; }
.badge {
  background: var(--accent);
  color: white;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 10px;
}
.logout {
  width: 100%;
  padding: 6px;
  font-size: 13px;
  border: 1px solid var(--border);
  background: transparent;
  border-radius: 6px;
  color: var(--muted);
}
.logout:hover { color: var(--danger); border-color: var(--danger); }
.content { overflow: auto; padding: 24px 32px; }
</style>
