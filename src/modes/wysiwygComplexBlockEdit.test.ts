// wysiwygComplexBlockEdit.test.ts
// PR-1 验收用例:
//  1. editLock acquire/release 计数与重入
//  2. editLock 嵌套释放
//  3. editLock 全部释放后恢复 editable
//  4. __resetEditLockForTest 工具幂等
//  5. withEditLock 异常路径也会 release
//  6. bindEditLockEditor 切换 getter
//  7. editLockCount 初始为 0
//  8. 多次 acquire 后计数正确累加
//  9. 同一 release 函数多次调用不重复扣减
//  ≥ 9 用例

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  acquireEditLock,
  withEditLock,
  bindEditLockEditor,
  editLockCount,
  __resetEditLockForTest
} from '../wysiwyg/v2/editLock'

// 模拟一个最小可用的 milkdown editor,只关心 action(ctx) 路径
function makeFakeEditor() {
  let editable = true
  const editor: any = {
    action: (fn: (ctx: any) => any) => {
      const ctx = {
        set: (_k: any, v: any) => {
          // editorViewOptionsCtx 写入: { editable: () => bool }
          if (v && typeof v.editable === 'function') {
            editable = !!v.editable()
          }
        }
      }
      return Promise.resolve(fn(ctx))
    },
    isEditable: () => editable
  }
  return editor
}

describe('wysiwyg/v2/editLock', () => {
  beforeEach(() => {
    __resetEditLockForTest()
    bindEditLockEditor(() => null)
  })
  afterEach(() => {
    __resetEditLockForTest()
  })

  it('初始计数为 0', () => {
    expect(editLockCount()).toBe(0)
  })

  it('acquire/release 单次配对计数归零', () => {
    const release = acquireEditLock()
    expect(editLockCount()).toBe(1)
    release()
    expect(editLockCount()).toBe(0)
  })

  it('重入安全:Nested locks 全部 release 后才归零', () => {
    const r1 = acquireEditLock()
    const r2 = acquireEditLock()
    const r3 = acquireEditLock()
    expect(editLockCount()).toBe(3)
    r1()
    expect(editLockCount()).toBe(2)
    r2()
    expect(editLockCount()).toBe(1)
    r3()
    expect(editLockCount()).toBe(0)
  })

  it('release 函数多次调用不重复扣减', () => {
    const r = acquireEditLock()
    r()
    r()
    r()
    expect(editLockCount()).toBe(0)
  })

  it('withEditLock 正常路径 release', async () => {
    await withEditLock(async () => {
      expect(editLockCount()).toBe(1)
    })
    expect(editLockCount()).toBe(0)
  })

  it('withEditLock 异常路径也会 release', async () => {
    let caught = false
    try {
      await withEditLock(async () => {
        throw new Error('boom')
      })
    } catch {
      caught = true
    }
    expect(caught).toBe(true)
    expect(editLockCount()).toBe(0)
  })

  it('首次加锁时调用 setEditorEditable(false),全部释放后恢复', async () => {
    const ed = makeFakeEditor()
    bindEditLockEditor(() => ed)
    // 初始 true
    expect(ed.isEditable()).toBe(true)
    const release = acquireEditLock()
    // action 是异步,需要 microtask flush
    await new Promise((r) => setTimeout(r, 0))
    expect(ed.isEditable()).toBe(false)
    release()
    await new Promise((r) => setTimeout(r, 0))
    expect(ed.isEditable()).toBe(true)
  })

  it('bindEditLockEditor 切换 getter 不会跨实例污染', async () => {
    const ed1 = makeFakeEditor()
    const ed2 = makeFakeEditor()
    bindEditLockEditor(() => ed1)
    const r1 = acquireEditLock()
    await new Promise((r) => setTimeout(r, 0))
    expect(ed1.isEditable()).toBe(false)
    expect(ed2.isEditable()).toBe(true)
    bindEditLockEditor(() => ed2)
    // r1 释放时,会调用 ed2 的 setEditable(true),ed1 不再被管
    r1()
    await new Promise((r) => setTimeout(r, 0))
    expect(ed2.isEditable()).toBe(true)
  })

  it('editor getter 返回 null 时 acquire 不抛错', () => {
    bindEditLockEditor(() => null)
    expect(() => acquireEditLock()).not.toThrow()
    expect(editLockCount()).toBe(1)
  })

  it('__resetEditLockForTest 幂等', () => {
    acquireEditLock()
    acquireEditLock()
    expect(editLockCount()).toBe(2)
    __resetEditLockForTest()
    expect(editLockCount()).toBe(0)
    __resetEditLockForTest()
    expect(editLockCount()).toBe(0)
  })
})
