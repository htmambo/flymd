// fileTree 异步门面（perf 批次 E / P1-3）
//
// ./fileTree（含 fileTreePathKey，约 120KB minified）原为入口静态依赖，但首个实际
// 使用（fileTree.init）发生在窗口 reveal 之后的启动阶段B。本门面把模块加载收敛为
// 单次动态 import；main.ts 以 `import { fileTreeFacade as fileTree }` 换入，全部
// 调用点签名不变（类型层由 FileTreeAPI 同型保证）。
//
// 语义约定：
// - init / refresh / revealAndSelect / newFileInSelected / newFolderInSelected：
//   转发真实 Promise，await 语义与原先一致
// - setSort：真实模块本就无返回值消费，fire-and-forget 转发；调用经 ensureFileTree
//   的单例 promise 排队，保持调用次序
// - getSelectedDir：唯一同步 API；模块未就绪时返回 null（与"无选中"同义，唯一
//   调用点是用户操作路径上的 getter，彼时模块早已就绪）
// - 启动 IIFE 阶段A 起点显式 `void ensureFileTree()` 预取，chunk 拉取与 initStore
//   等启动工作并行
//
// 时序变化（可接受，perf 批次 E 计划已记录）：fileTree 模块顶层的
// LIBRARY_CONFIG_CHANGED_EVENT 监听器注册从入口求值推迟到 chunk 加载完成
// （毫秒级；事件源为 WebDAV/其他窗口，启动亚秒窗口内触发概率趋零，
// 错过事件由下一次 refresh 自愈）。

import type { FileTreeAPI } from './fileTree'

type FileTreeModule = typeof import('./fileTree')

let modPromise: Promise<FileTreeModule> | null = null
let modLoaded: FileTreeModule | null = null

/** 单例动态加载；首次调用发起 chunk 拉取，后续调用复用同一 promise */
export function ensureFileTree(): Promise<FileTreeModule> {
  if (!modPromise) {
    modPromise = import('./fileTree').then((m) => {
      modLoaded = m
      return m
    })
  }
  return modPromise
}

export const fileTreeFacade: FileTreeAPI = {
  init: (container, opts) => ensureFileTree().then((m) => m.default.init(container, opts)),
  refresh: () => ensureFileTree().then((m) => m.default.refresh()),
  revealAndSelect: (path) => ensureFileTree().then((m) => m.default.revealAndSelect(path)),
  getSelectedDir: () => modLoaded?.default.getSelectedDir() ?? null,
  newFileInSelected: () => ensureFileTree().then((m) => m.default.newFileInSelected()),
  newFolderInSelected: () => ensureFileTree().then((m) => m.default.newFolderInSelected()),
  setSort: (mode) => {
    void ensureFileTree()
      .then((m) => m.default.setSort(mode))
      .catch(() => {})
  },
}
