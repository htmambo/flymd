// 全局模块/资源声明 shim
// 解决 TS 在 strict 模式下对“第三方未带类型/资源文件”导入的隐式 any 报错。
// 任何对项目运行无影响的“声明即满足”型模块都可以集中放这里。

// 第三方插件模块（katex 官方未暴露子路径类型，katex 的 CSS 资源同理）
declare module 'katex/contrib/mhchem'
declare module 'katex/dist/katex.min.css'
declare module 'html2pdf.js/dist/html2pdf.bundle.min.js'

// markdown-it 生态（未在项目装 @types/markdown-it 也不打算引入 ——
// 这里把 MarkdownIt 暴露为类型 + 构造器，足以满足插件注册的回调签名）
declare module 'markdown-it' {
  // markdown-it 实际是 cjs：module.exports = MarkdownIt
  // 这里提供一个 minimal interface，含一个索引签名让任意方法访问通过
  interface MarkdownIt {
    use(plugin: any, options?: any): MarkdownIt
    render(src: string, env?: any): string
    renderInline(src: string, env?: any): string
    renderer: { rules: Record<string, any> }
    [key: string]: any
  }
  // cjs 兼容：让 `import MarkdownIt from 'markdown-it'` 既可作值又可作类型
  // 通过 const 重导出（运行时仍按 cjs 默认导出）
  const MarkdownIt: { new (options?: any): MarkdownIt }
  export = MarkdownIt
}
declare module 'markdown-it-footnote'

// 通用 CSS / 资源模块声明（与 vite 静态资源加载约定一致）
declare module '*.css'

// Vite 静态资源加载（?url / ?raw / ?inline / ?worker 等查询后缀）声明
declare module '*?url'
declare module '*?raw'
declare module '*?inline'
declare module '*?worker'
