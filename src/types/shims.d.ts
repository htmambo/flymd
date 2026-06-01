// 全局模块/资源声明 shim
// 解决 TS 在 strict 模式下对“第三方未带类型/资源文件”导入的隐式 any 报错。
// 任何对项目运行无影响的“声明即满足”型模块都可以集中放这里。

// 第三方插件模块（katex 官方未暴露子路径类型，katex 的 CSS 资源同理）
declare module 'katex/contrib/mhchem'
declare module 'katex/dist/katex.min.css'
declare module 'html2pdf.js/dist/html2pdf.bundle.min.js'

// 通用 CSS / 资源模块声明（与 vite 静态资源加载约定一致）
declare module '*.css'

// Vite 静态资源加载（?url / ?raw / ?inline 等查询后缀）声明
declare module '*?url'
declare module '*?raw'
declare module '*?inline'
