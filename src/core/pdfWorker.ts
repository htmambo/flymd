// PDF.js worker 统一初始化。
//
// 背景：此前 outline.ts 与 pluginHost.ts 各自 import `?worker`，pluginHost 还保留
// 了一条 `?url` 兜底，构建时同时产出 worker chunk（~1.5MB）与原始 mjs 资产（~1.3MB）。
// 这里统一为“单份 `?worker`”：
// - `?worker` 是 Vite 官方支持、项目原先已在用的路径，兼容性风险最低；
// - 只保留一份产物，不再额外 emit 一个 1.3MB 的 `.mjs`。
//
// 注意：workerPort 是全局状态，同一进程只创建一次；pdfjs 模块本身由调用方动态 import。

let _worker: Worker | null = null
let _loading: Promise<boolean> | null = null

export function hasPdfjsWorker(pdfjs: any): boolean {
  try {
    const g = pdfjs?.GlobalWorkerOptions
    if (!g) return false
    if (g.workerPort) return true
    // 兼容 pdfjs 通过其它路径自行设置 workerSrc 的情况
    const src = g.workerSrc
    return typeof src === 'string' && !!src
  } catch {
    return false
  }
}

export function ensurePdfjsWorker(pdfjs: any): Promise<boolean> {
  if (hasPdfjsWorker(pdfjs)) return Promise.resolve(true)
  if (!_loading) {
    _loading = (async () => {
      try {
        const g: any = pdfjs?.GlobalWorkerOptions
        if (!g) return false
        const workerMod: any = await import('pdfjs-dist/build/pdf.worker.min.mjs?worker')
        const WorkerCtor: any = workerMod?.default || workerMod
        if (!_worker) _worker = new WorkerCtor()
        g.workerPort = _worker
        return hasPdfjsWorker(pdfjs)
      } catch {
        return false
      }
    })().finally(() => {
      _loading = null
    })
  }
  return _loading
}
