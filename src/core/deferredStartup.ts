// 启动期非关键模块延迟加载调度(抽离自 main.ts:296-320)
//
// 设计:
//   - 工厂 createDeferredStartup(deps) → { schedule() }
//   - 闭包持有 _scheduled: boolean(避免重复调度)
//   - 任务列表作模块内 const:每条 { delayMs, label, run(deps) }
//   - schedule() 内逐个调 scheduleAfterFirstPaint 把 run 包成 cb,1:1 还原原 main.ts 结构
//
// 任务序列(从 main.ts verbatim 移植):
//   t+0    Tabs
//   t+80   SplitPreview
//   t+160  SourceLineNumbers
//   t+240  LibraryResize
//   t+320  applyI18nUi
//   t+400  loadAutoSave

export interface DeferredStartupDeps {
  scheduleAfterFirstPaint: (cb: () => void, delayMs: number) => void
  applyI18nUi: () => void
  loadAutoSave: () => void | Promise<void>
}

export interface DeferredStartupApi {
  schedule(): void
}

interface DeferredTask {
  delayMs: number
  label: string
  run: (deps: DeferredStartupDeps) => void
}

const TASKS: DeferredTask[] = [
  {
    delayMs: 0,
    label: 'Tabs',
    run: () => {
      void import('../tabs/integration').catch((e) => console.warn('[Tabs] Failed to load tab system:', e))
    },
  },
  {
    delayMs: 80,
    label: 'SplitPreview',
    run: () => {
      void import('../modes/sourcePreviewSplit').catch((e) => console.warn('[SplitPreview] Failed to init split view:', e))
    },
  },
  {
    delayMs: 160,
    label: 'SourceLineNumbers',
    run: () => {
      void import('../modes/sourceLineNumbers').catch((e) => console.warn('[SourceLineNumbers] Failed to init line numbers:', e))
    },
  },
  {
    delayMs: 240,
    label: 'LibraryResize',
    run: () => {
      void import('../ui/libraryResize').catch((e) => console.warn('[LibraryResize] Failed to init library resize:', e))
    },
  },
  {
    delayMs: 320,
    label: 'i18nUi',
    run: (deps) => {
      try { deps.applyI18nUi() } catch {}
    },
  },
  {
    delayMs: 400,
    label: 'autoSaveLoad',
    run: (deps) => {
      try { void deps.loadAutoSave() } catch {}
    },
  },
]

export function createDeferredStartup(deps: DeferredStartupDeps): DeferredStartupApi {
  let scheduled = false

  return {
    schedule(): void {
      if (scheduled) return
      scheduled = true
      for (const task of TASKS) {
        deps.scheduleAfterFirstPaint(() => task.run(deps), task.delayMs)
      }
    },
  }
}
