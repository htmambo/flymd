// Mermaid 按需加载器：独立模块，避免在入口 chunk 中预加载 mermaid。
// 只在真正需要渲染图表时才加载 core + 对应图表类型。

export async function loadMermaid(): Promise<any> {
  try {
    const mod: any = await import('mermaid/dist/mermaid.core.mjs')
    return mod.default || mod
  } catch (e1) {
    try {
      const mod: any = await import('mermaid/dist/mermaid.esm.mjs')
      return mod.default || mod
    } catch (e2) {
      try {
        const mod: any = await import('mermaid')
        return mod.default || mod
      } catch (e3) {
        throw e3
      }
    }
  }
}
