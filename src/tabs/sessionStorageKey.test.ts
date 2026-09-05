import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn() }))

import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  SESSION_KEY_LEGACY,
  SESSION_KEY_PREFIX,
  getCurrentWindowLabel,
  getSessionStorageKey,
  getUnscopedSessionKey,
  migrateLegacySessionKey,
  setSessionLibraryScope,
} from './sessionStorageKey'

const mockedGetCurrentWindow = vi.mocked(getCurrentWindow)

function setLabel(label: string | undefined): void {
  mockedGetCurrentWindow.mockReturnValue({ label } as any)
}

beforeEach(() => {
  mockedGetCurrentWindow.mockReset()
  setSessionLibraryScope(null)
})

describe('getCurrentWindowLabel', () => {
  it('返回当前窗口 label', () => {
    setLabel('main-123')
    expect(getCurrentWindowLabel()).toBe('main-123')
  })

  it('label 为空时退回 main', () => {
    setLabel('')
    expect(getCurrentWindowLabel()).toBe('main')
  })

  it('getCurrentWindow 抛错（非 Tauri 环境）时退回 browser', () => {
    mockedGetCurrentWindow.mockImplementation(() => {
      throw new Error('not tauri')
    })
    expect(getCurrentWindowLabel()).toBe('browser')
  })
})

describe('getSessionStorageKey', () => {
  it('无库时按 全局段 + 窗口 label 隔离 storage key', () => {
    setLabel('main')
    expect(getSessionStorageKey()).toBe(SESSION_KEY_PREFIX + 'global:main')
    setLabel('main-9')
    expect(getSessionStorageKey()).toBe(SESSION_KEY_PREFIX + 'global:main-9')
  })

  it('设置库作用域后 key 带库 id 段', () => {
    setLabel('main')
    setSessionLibraryScope('lib-123')
    expect(getSessionStorageKey()).toBe(SESSION_KEY_PREFIX + 'lib-123:main')
    // 清除后回落 global 段
    setSessionLibraryScope(null)
    expect(getSessionStorageKey()).toBe(SESSION_KEY_PREFIX + 'global:main')
  })

  it('无库段旧 key 保持原格式（用于一次性迁移）', () => {
    setLabel('main')
    expect(getUnscopedSessionKey()).toBe(SESSION_KEY_PREFIX + 'main')
  })
})

describe('migrateLegacySessionKey', () => {
  function fakeStorage(init: Record<string, string> = {}) {
    const map: Record<string, string> = { ...init }
    return {
      map,
      getItem: (k: string) => (k in map ? map[k] : null),
      setItem: (k: string, v: string) => {
        map[k] = v
      },
      removeItem: (k: string) => {
        delete map[k]
      },
    }
  }

  it('非 main 窗口不迁移，老 key 原样保留', () => {
    const s = fakeStorage({ [SESSION_KEY_LEGACY]: 'OLD' })
    expect(migrateLegacySessionKey(s, SESSION_KEY_PREFIX + 'main-2', 'main-2')).toBeNull()
    expect(s.map[SESSION_KEY_LEGACY]).toBe('OLD')
  })

  it('main 窗口但无老 key 时返回 null', () => {
    const s = fakeStorage()
    expect(migrateLegacySessionKey(s, SESSION_KEY_PREFIX + 'main', 'main')).toBeNull()
  })

  it('main 窗口有老 key：迁移到新 key、删除老 key、返回内容', () => {
    const target = SESSION_KEY_PREFIX + 'main'
    const s = fakeStorage({ [SESSION_KEY_LEGACY]: 'OLD' })

    expect(migrateLegacySessionKey(s, target, 'main')).toBe('OLD')
    expect(s.map[target]).toBe('OLD')
    expect(SESSION_KEY_LEGACY in s.map).toBe(false)
  })
})
