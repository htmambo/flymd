import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import "./style.css";

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount("#app");

// ============================================================
// 全局鼠标 spotlight 监听:为 .hover-card-glow 元素设置 CSS 变量
// --spotlight-x / --spotlight-y,让 ::before radial-gradient 跟随鼠标
// ============================================================
document.addEventListener(
  "mousemove",
  (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const card = target.closest(".hover-card-glow") as HTMLElement | null;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    card.style.setProperty("--spotlight-x", `${x.toFixed(1)}%`);
    card.style.setProperty("--spotlight-y", `${y.toFixed(1)}%`);
  },
  { passive: true },
);
