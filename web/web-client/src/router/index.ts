/**
 * 路由
 */
import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "@/stores/auth";

const routes = [
  {
    path: "/",
    redirect: "/app",
  },
  {
    path: "/login",
    name: "login",
    component: () => import("@/views/auth/LoginView.vue"),
    meta: { guestOnly: true, title: "登录" },
  },
  {
    path: "/register",
    name: "register",
    component: () => import("@/views/auth/RegisterView.vue"),
    meta: { guestOnly: true, title: "注册" },
  },
  {
    path: "/app",
    component: () => import("@/layouts/AppLayout.vue"),
    meta: { requiresAuth: true },
    children: [
      {
        path: "",
        name: "settings",
        component: () => import("@/views/admin/SettingsView.vue"),
        meta: { title: "设置" },
      },
    ],
  },
  {
    path: "/:pathMatch(.*)*",
    redirect: "/app",
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.ready) {
    await auth.initialize();
  }
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: "login", query: { redirect: to.fullPath } };
  }
  if (to.meta.guestOnly && auth.isAuthenticated) {
    return { name: "settings" };
  }
  if (typeof to.meta.title === "string") {
    document.title = `${to.meta.title} · flymd web`;
  }
  return true;
});
