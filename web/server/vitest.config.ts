import { defineConfig } from "vitest/config"

// web/server 是独立工程（自带依赖树），不能继承仓库根目录的 vite.config.ts：
// 根配置的 setupFiles 指向仓库根的 src/test/setup.ts，在 web/server 下解析会失败。
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
})
