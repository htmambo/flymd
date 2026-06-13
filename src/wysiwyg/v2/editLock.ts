// editLock.ts
// 所见模式编辑器冻结锁:用于在浮层源码编辑期间,把整个 editor 设为只读,
// 避免 prosemirror transaction 在浮层打开期间修改文档,导致 cachedFrom / cachedTo 失效。
//
// 任何需要"打开浮层 → 用户改源码 → apply"的场景都应该:
//   await withEditLock(async (release) => {
//     const ta = ... // 浮层 textarea
//     ta.addEventListener('focusout', () => release(apply))
//   })
//
// 设计要点:
// 1. 计数(可重入):同一时间可叠加多个锁,全部 release 后才真正解锁
// 2. editable 切换走 milkdown ctx(editorViewOptionsCtx),不破坏 prosemirror 内部状态
// 3. 提供 acquireEditLock/releaseEditLock 低阶 API;withEditLock 高阶包装

import type { Editor } from '@milkdown/core'
import { editorViewOptionsCtx } from '@milkdown/core'

type ReleaseFn = () => void

let _lockCount = 0
let _restoreEditable: (() => void) | null = null

/**
 * 获取 editor 实例的引用。由 wysiwyg/v2/index.ts 在创建 editor 时调用注入。
 */
let _getEditor: (() => Editor | null) | null = null
export function bindEditLockEditor(getter: () => Editor | null): void {
  _getEditor = getter
}

/**
 * 同步获取当前锁计数,用于测试/调试。
 */
export function editLockCount(): number {
  return _lockCount
}

async function setEditorEditable(editable: boolean): Promise<void> {
  const ed = _getEditor?.()
  if (!ed) return
  try {
    await ed.action((ctx) => {
      ctx.set(editorViewOptionsCtx, { editable: () => editable })
    })
  } catch {
    // 编辑器尚未就绪或被销毁:静默吞掉;调用方应保证时序
  }
}

/**
 * 申请一个编辑锁。返回 release 函数,必须配对调用。
 * 重入安全:Nested locks stack,全部 release 后才真正解锁。
 */
export function acquireEditLock(): ReleaseFn {
  _lockCount += 1
  if (_lockCount === 1) {
    // 首次加锁:把 editor 设为不可编辑
    void setEditorEditable(false)
  }
  let released = false
  return () => {
    if (released) return
    released = true
    _lockCount = Math.max(0, _lockCount - 1)
    if (_lockCount === 0) {
      // 全部释放:恢复可编辑
      void setEditorEditable(true)
      _restoreEditable = null
    }
  }
}

/**
 * 高阶包装:在锁内执行 fn;fn 返回的 release 函数会在 scope 退出前调用。
 * 用于:
 *   withEditLock(async (release) => { ... })
 */
export async function withEditLock<T>(fn: (release: ReleaseFn) => T | Promise<T>): Promise<T> {
  const release = acquireEditLock()
  try {
    return await fn(release)
  } finally {
    release()
  }
}

/**
 * 测试/重置:把锁计数清零并恢复可编辑。仅供 vitest 使用。
 */
export function __resetEditLockForTest(): void {
  _lockCount = 0
  if (_restoreEditable) {
    try { _restoreEditable() } catch {}
    _restoreEditable = null
  }
  void setEditorEditable(true)
}
