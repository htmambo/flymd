import { defineConfig } from 'vite'

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
  resolve: {
    alias: {},
    dedupe: ['katex', '@milkdown/prose'] // 去重，避免多个版本
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  },
  // 生产构建：分包与剥离 console/debugger；开发：预打包重库
  esbuild: mode === 'production' ? {
    // 生产环境去掉 console/debugger，减小体积并避免多余日志
    drop: ['console', 'debugger'],
    legalComments: 'none' // 移除许可注释，减小体积
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
        // 优化的代码分割策略
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // Milkdown 编辑器（只在所见模式加载）
            if (id.includes('@milkdown')) return 'milkdown'
            // ProseMirror 生态（WYSIWYG 依赖）
            if (id.includes('prosemirror')) return 'prosemirror'
            // 大型渲染库（按需加载）
            if (id.includes('markdown-it')) return 'markdown-it'
            if (id.includes('dompurify')) return 'dompurify'
            if (id.includes('highlight')) return 'highlightjs'
            if (id.includes('mermaid')) {
              // 把 mermaid 所有模块合并到一个 chunk，避免 Rollup 拆分后
              // 图表子 chunk 与共享 chunk 之间出现循环依赖，导致生产包
              // 在 WebKit/Tauri 下出现 "g is not a function" 等初始化错误。
              return 'mermaid'
            }
            if (id.includes('katex')) return 'katex'
            if (id.includes('pdfjs-dist')) return 'pdfjs'
            // 导出相关库（按需加载）
            if (id.includes('html2pdf') || id.includes('html-docx') || id.includes('html-to-docx')) return 'docx'
            if (id.includes('canvg')) return 'pdf'
            // WebDAV 相关
            if (id.includes('webdav')) return 'wps'
            // Tauri 运行时
            if (id.includes('@tauri-apps')) return 'tauri'
            // 命令面板拼音搜索
            if (id.includes('pinyin-pro')) return 'pinyin'
            // YAML 处理
            if (id.includes('js-yaml')) return 'yaml'
            // diff 库
            if (id.includes('/diff/') || id.includes('diff/dist')) return 'diff'
            // 其余小型依赖不再强制合并到 vendor，让 Rollup 自动处理
          }
          // 应用代码分割：将大型模块分离
          if (id.includes('/src/')) {
            // 注意：不要按目录强制把 /src/wysiwyg/、/src/extensions/ 等归入
            // 独立 chunk——它们与入口共享的模块（uploader/utils/core 等）会被
            // 一并拖进懒加载 chunk，入口静态引用这些共享模块后整条
            // wysiwyg→milkdown→mermaid 链就会被拖成启动即加载
            // （dist/index.html 里 mermaid 6.6MB 的 modulepreload 就是这么来的）。
            // 交给 rolldown 按动态 import 边界自动拆分即可。
            // 文件树（入口静态依赖，独立 chunk 便于缓存）
            if (id.includes('/fileTree')) return 'filetree'
            // HTML 转 Markdown
            if (id.includes('/html2md')) return 'html2md'
          }
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
