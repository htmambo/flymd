import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'

const DEV_CSP = [
  "default-src 'self'",
  "img-src 'self' https: http: asset: blob: data:",
  "style-src 'self' 'unsafe-inline' blob:",
  "font-src 'self' data:",
  "script-src 'self' http: https: 'unsafe-eval' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "connect-src 'self' ipc: http: https: ws: http://ipc.localhost",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ')

export default defineConfig(({ mode }) => ({
  base: './',
  // 测试：默认仍用 node 环境，DOM 测试继续在文件顶部写 // @vitest-environment jsdom
  // （与既有 31 个 DOM 测试文件一致）。setupFiles 无条件生效，负责修复 Node 22+
  // 内置 localStorage 全局顶掉 jsdom Storage 的问题。
  test: {
    setupFiles: ['./src/test/setup.ts'],
    // web/server 是独立工程：自带 package.json 与依赖树，而 pnpm-workspace.yaml
    // 没有 packages 字段，它不在工作区内，根 pnpm install 不会装它的依赖。
    // 不排除的话，默认 glob 会把它的测试一并扫进来，用根依赖树加载必然失败
    // （Cannot find package 'openai' / 'dotenv'），拖垮根项目的测试门禁。
    // 它的测试由 web/server 自行运行。
    exclude: [...configDefaults.exclude, 'web/server/**']
  },
  resolve: {
    dedupe: ['katex', '@milkdown/prose'] // 去重，避免多个版本
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  },
  // 生产构建：分包与剥离 console/debugger；开发：预打包重库
  esbuild: mode === 'production' ? {
    // 生产环境去掉 console/debugger，减小体积并避免多余日志。
    // 注意：启动错误浮层(index.html 的 #startup-errors)基于 window.onerror 与
    // unhandledrejection，不依赖 console，所以 drop console 不影响它。
    drop: ['console', 'debugger'],
    // MIT/BSD 等许可要求在再分发时保留版权声明，不能剥到 none；
    // 抽成同目录 *.LICENSE.txt 文件，比留在 bundle 里更省体积。
    legalComments: 'external'
  } : {},
  optimizeDeps: {
    // 开发时预构建大型依赖，加快热更新（仅影响 dev，不改变生产包）
    include: [
      'markdown-it',
      'dompurify',
      'highlight.js',
      'mermaid',
      'katex',
      // 所见模式 V2 相关依赖：预构建提升 dev 首次启动和 HMR 速度
      '@milkdown/core',
      '@milkdown/kit',
      '@milkdown/plugin-automd',
      '@milkdown/plugin-math',
      '@milkdown/preset-commonmark',
      '@milkdown/preset-gfm'
    ],
    exclude: []
  },
  build: {
    target: 'es2022', // 现代浏览器目标，生成更小的代码
    cssCodeSplit: true, // CSS 代码分割
    cssMinify: true, // CSS 压缩
    reportCompressedSize: false, // 禁用 gzip 大小报告，加快构建
    // 警告阈值恢复到默认附近（1000 KB）。原 commit 3f0bf6f 把阈值提到 7000 是为了静默
    // mermaid 懒加载 chunk 的体积警告——mermaid (~6.6MB) 按设计懒加载，桌面端从本地磁盘加载
    // 无网络开销，但体积异常应通过拆分或接受解决，而非关闭警告。后续若 CI 撞 mermaid 阈值，
    // 单独 PR 处理 mermaid 拆分或评估是否值得保留为单一 chunk。
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // 优化的代码分割策略。
        // 用 rolldown 的 codeSplitting.groups（manualChunks 的替代，显式优先级）。
        //
        // 关键修复：Vite 的 __vitePreload 辅助函数会被入口与懒加载 chunk 同时引用。
        // 旧配置下它被并入 mermaid 块，入口静态 import 该函数后，6.4MB 的
        // mermaid 就变成启动必加载（modulepreload 只是表象）。这里给它最高优先级
        // 单独成块，入口只依赖几十字节的 helper，mermaid 维持原有单一 chunk。
        codeSplitting: {
          groups: [
            { name: 'vite-preload', test: /preload-helper/, priority: 300 },
            // Milkdown 编辑器（只在所见模式加载）
            { name: 'milkdown', test: /node_modules[\\/].*@milkdown/, priority: 100 },
            // ProseMirror 生态（WYSIWYG 依赖）
            { name: 'prosemirror', test: /node_modules[\\/].*prosemirror/, priority: 100 },
            // 大型渲染库（按需加载）
            { name: 'markdown-it', test: /node_modules[\\/].*markdown-it/, priority: 100 },
            { name: 'dompurify', test: /node_modules[\\/].*dompurify/, priority: 100 },
            { name: 'highlightjs', test: /node_modules[\\/].*highlight/, priority: 100 },
            // mermaid 保持单块：拆分后其子 chunk 与共享 chunk 之间曾出现循环依赖，
            // 在 WebKit/Tauri 下报 "g is not a function"。helper 已单独成块，
            // 不再需要靠“取消 mermaid 分块”来规避入口污染。
            { name: 'mermaid', test: /node_modules[\\/].*mermaid/, priority: 100 },
            { name: 'katex', test: /node_modules[\\/].*katex/, priority: 100 },
            { name: 'pdfjs', test: /node_modules[\\/].*pdfjs-dist/, priority: 100 },
            // 导出相关库（按需加载）
            { name: 'docx', test: /node_modules[\\/].*(html2pdf|html-docx)/, priority: 100 },
            { name: 'pdf', test: /node_modules[\\/].*canvg/, priority: 100 },
            // WebDAV 相关
            { name: 'wps', test: /node_modules[\\/].*webdav/, priority: 100 },
            // Tauri 运行时
            { name: 'tauri', test: /node_modules[\\/].*@tauri-apps/, priority: 100 },
            // 命令面板拼音搜索
            { name: 'pinyin', test: /node_modules[\\/].*pinyin-pro/, priority: 100 },
            // YAML 处理
            { name: 'yaml', test: /node_modules[\\/].*js-yaml/, priority: 100 },
            // diff 库
            { name: 'diff', test: /node_modules[\\/].*[\\/]diff[\\/]/, priority: 100 },
            // HTML 转 Markdown
            { name: 'html2md', test: /[\\/]src[\\/]html2md/, priority: 100 },
          ],
        },
        // 优化文件名，启用内容哈希以利用浏览器缓存
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    },
    minify: 'esbuild', // 使用 esbuild 压缩（比 terser 快）
    sourcemap: process.env.BUILD_SOURCEMAP === '1' ? true : false // 关闭 source map 以减小体积
  }
}))
