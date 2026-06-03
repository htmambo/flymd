import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:8787", changeOrigin: true },
      "/asr": { target: "http://127.0.0.1:8787", changeOrigin: true },
      "/ai":  { target: "http://127.0.0.1:8787", changeOrigin: true },
      "/xiaoshuo": { target: "http://127.0.0.1:8787", changeOrigin: true },
      "/pdf": { target: "http://127.0.0.1:8787", changeOrigin: true },
      "/announcements.json": { target: "http://127.0.0.1:8787", changeOrigin: true },
      "/plugins/index.json": { target: "http://127.0.0.1:8787", changeOrigin: true },
      "/health": { target: "http://127.0.0.1:8787", changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
