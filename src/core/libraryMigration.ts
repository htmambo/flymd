// 库私有化 v2 - 数据迁移模块
// 把通道 B（系统层 Store 按 libId 命名空间）的存量数据一次性迁入
// 通道 C（<库根>/.flymd/local.json）。
//
// 关键设计：
//   - 幂等：每个 libId 一个标记 key（flymd:lib-local-migrated:<libId>），
//     存在即跳过
//   - 备份：迁移前把旧值写到 flymd:lib-local-migrated:backup:<libId>:<field>
//     仅 1 版本（避免 Store 膨胀）
//   - 不删除旧 key：v2.0 保留作为兜底，v2.1 稳定后再清
//   - 字段独立 try/catch：单个字段失败不阻塞其他字段
//   - 静默触发：通过 flymd:library:changed 事件桥接，不阻塞库激活
//
// 详见 docs/Task/Archive/2026-09/2026-09-11-library-private-v2-pr4-migration.md

import type { Store } from '@tauri-apps/plugin-store'
import { getLibraryScope } from './libraryConfig'
import { isInside } from './fsSafe'
import { readLibraryPrivate, writeLibraryPrivate } from './libraryPrivate'

/** 当前 schema 版本（与 libraryPrivate 的 LIBRARY_PRIVATE_SCHEMA_VERSION 同步）。 */
const MIGRATION_SCHEMA_VERSION = 1

/** 标记 key：flymd:lib-local-migrated:<libId> -> { migratedAt, version, fields } */
function markerKey(libId: string): string {
  return `flymd:lib-local-migrated:${libId}`
}

/** 备份 key：flymd:lib-local-migrated:backup:<libId>:<field> -> 旧值 */
function backupKey(libId: string, field: string): string {
  return `flymd:lib-local-migrated:backup:${libId}:${field}`
}

export interface MigrationResult {
  /** 成功迁移的字段名列表 */
  migrated: string[]
  /** 跳过（已迁移过 / 旧值不存在）的字段名列表 */
  skipped: string[]
  /** 失败字段名 + 错误信息 */
  errors: string[]
  /** 是否实际执行了迁移（false = 已迁移过） */
  didRun: boolean
}

/**
 * 把指定库在旧通道（Store）的数据一次性迁入新通道（local.json）。
 * 幂等：标记已存在则直接返回空结果。
 * 不抛错：字段失败累积到 errors。
 */
export async function migrateLibraryToLocalOnce(
  libId: string,
  store: Store | null,
): Promise<MigrationResult> {
  const result: MigrationResult = { migrated: [], skipped: [], errors: [], didRun: false }
  if (!store) return result
  if (!libId) return result

  // 1. 检查幂等标记
  try {
    const marker = await store.get(markerKey(libId))
    if (marker && typeof marker === 'object' && (marker as any).version === MIGRATION_SCHEMA_VERSION) {
      // 已迁移
      result.skipped.push('docPos', 'uploader')
      return result
    }
  } catch {}

  result.didRun = true
  const scope = getLibraryScope()
  const root = scope.root || ''

  // 2. 准备写入到 libraryPrivate 的 patch
  const patches: { docPos?: any; uploader?: any } = {}

  // 3. 迁移 docPos：取 isInside(root) 的条目
  try {
    const oldKey = `docPos:${libId}`
    const oldDocPos = await store.get(oldKey)
    if (oldDocPos && typeof oldDocPos === 'object' && !Array.isArray(oldDocPos)) {
      const filtered: Record<string, any> = {}
      if (root) {
        for (const [p, v] of Object.entries(oldDocPos)) {
          if (typeof p === 'string' && typeof v === 'object' && v !== null && isInside(root, p)) {
            filtered[p] = v
          }
        }
      }
      if (Object.keys(filtered).length > 0) {
        // 备份旧值
        try { await store.set(backupKey(libId, 'docPos'), oldDocPos) } catch {}
        patches.docPos = filtered
        result.migrated.push('docPos')
      } else {
        result.skipped.push('docPos')
      }
    } else {
      result.skipped.push('docPos')
    }
  } catch (e: any) {
    result.errors.push(`docPos: ${e?.message || String(e)}`)
  }

  // 4. 迁移 uploader
  try {
    const oldUploader = await store.get(`uploader:${libId}`)
    if (oldUploader && typeof oldUploader === 'object') {
      try { await store.set(backupKey(libId, 'uploader'), oldUploader) } catch {}
      patches.uploader = oldUploader
      result.migrated.push('uploader')
    } else {
      result.skipped.push('uploader')
    }
  } catch (e: any) {
    result.errors.push(`uploader: ${e?.message || String(e)}`)
  }

  // 5. 写入 local.json（一次原子操作）
  if (Object.keys(patches).length > 0) {
    try {
      // 先确保 local.json 缓存是当前库的（readLibraryPrivate 走 getLibraryScope）
      await readLibraryPrivate()
      const ok = await writeLibraryPrivate(patches, { immediate: true })
      if (!ok) {
        result.errors.push('writeLibraryPrivate returned false')
        // 回滚标记（不写）
        return result
      }
    } catch (e: any) {
      result.errors.push(`writeLibraryPrivate: ${e?.message || String(e)}`)
      return result
    }
  }

  // 6. 写标记（即便 patches 为空也写，避免重试循环）
  try {
    await store.set(markerKey(libId), {
      migratedAt: Date.now(),
      version: MIGRATION_SCHEMA_VERSION,
      fields: result.migrated,
    })
    await store.save()
  } catch (e: any) {
    result.errors.push(`marker: ${e?.message || String(e)}`)
  }

  return result
}

/**
 * 通知中心 hook（可选注入）。
 * 默认 noop；main.ts 可注入 `_showNotification` 全局。
 */
type NotificationLevel = 'info' | 'success' | 'error'
let _showNotification: ((msg: string, level: NotificationLevel, ms?: number) => void) | null = null
export function setMigrationNotification(
  fn: ((msg: string, level: NotificationLevel, ms?: number) => void) | null,
): void {
  _showNotification = fn
}

function notifyMigrationResult(result: MigrationResult): void {
  if (!_showNotification) return
  if (!result.didRun) return
  const n = result.migrated.length
  if (n === 0) return
  if (result.errors.length > 0) {
    _showNotification(
      `已迁移 ${n} 项库私有数据（${result.errors.length} 个错误，请查看控制台）`,
      'error',
      5000,
    )
  } else {
    _showNotification(`已迁移 ${n} 项库私有数据到 .flymd/local.json`, 'success', 3000)
  }
}

/**
 * 触发指定库的迁移（fire-and-forget）。
 * 内部通知中心 hook 会被调用（如果注入）。
 */
export function runMigrationForScope(
  libId: string | null,
  getStore: () => Store | null,
): void {
  if (!libId) return
  void migrateLibraryToLocalOnce(libId, getStore()).then((result) => {
    notifyMigrationResult(result)
    if (result.errors.length > 0) {
      try { console.warn('[libraryMigration] errors:', result.errors) } catch {}
    }
  }).catch((e) => {
    try { console.warn('[libraryMigration] unhandled:', e) } catch {}
  })
}
