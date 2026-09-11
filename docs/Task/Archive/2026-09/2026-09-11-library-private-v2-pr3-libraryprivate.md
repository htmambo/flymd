# PR-3 — 通道C 框架 `libraryPrivate.ts`（库私有化 v2 第三个 PR）

| 字段 | 内容 |
|------|------|
| 创建日期 | 2026-09-11 |
| 责任人 | 果农 + Claude（协作） |
| 状态 | ✅ 已完成（2026-09-11） |
| 关联 | PR-1 `2026-09-11-library-private-v2-pr1-webdav-exclude.md` / PR-2 `2026-09-11-library-private-v2-pr2-rust-atomic-lock.md` |
| 范围 | `src/core/libraryPrivate.ts`（新建 ~280 行） + `src/core/libraryPrivate.test.ts`（新建 ~150 行）+ main.ts 启动序列 hook |

## 0. 目标

建立 `<库根>/.flymd/local.json` 读写框架（通道C），作为后续 PR-4 各消费方迁入的承载层。

**关键特性**：
1. **原子写 + 跨进程文件锁**（PR-2 基础设施）—— `writeFileLockedSafe` 一站式
2. **mtime 外部变更检测**（3s 轮询）—— 库搬走/同步/另一窗口改 → 自动派发 `flymd:libraryPrivate:changed`
3. **500ms 防抖写**（高频 docPos 写合并）—— debounce + 立即 flush 模式
4. **滚动 3 个 .bak 备份**（损坏可回退）—— `local.json.bak1` / `.bak2` / `.bak3`
5. **缓存 + 写时合并**（避免过期内存覆盖外部变更）—— 类比 `libraryConfig.ts`

## 1. 现状

- `src/core/libraryConfig.ts`（通道A 框架）已存在，**完全沿用其模式**
- `src/core/fsSafe.ts`（PR-2 新增）已提供 `readFileLockedSafe` / `writeFileLockedSafe` / `cleanupStaleTmpFilesSafe`
- Tauri Store `flymd-settings.json` 当前持有 `docPos:<libId>` / `uploader:<libId>` / `asr` / `manualTranscribe` / `officePreview`

## 2. 子任务清单

- [x] **T1** 新建 `src/core/libraryPrivate.ts`（类型 + 状态 + API + 轮询 + 备份 + library 桥接）
- [x] **T2** 桥接到 `LIBRARY_CHANGED_EVENT` 事件（替代 main.ts 显式 hook，main.ts 改动 = 0）
- [x] **T3** 同 T2
- [x] **T4** 通过订阅 `LIBRARY_CHANGED_EVENT` + 引入 `installLibraryChangedBridge()` 替代注释更新
- [x] **T5** 新建 `src/core/libraryPrivate.test.ts`（15 个测试）
- [x] **T6** 验证：`tsc --noEmit` 0 错 / `npm test` 15 新增通过 / `npm run build` 5.63s

## 3.5 实际结果

- 改动文件：3（1 新模块 + 1 测试 + 1 任务文档）
- 代码行：~280 行模块 + 200 行测试
- 验证：
  - `npx tsc --noEmit` 0 错误
  - `npm test` 15 新增通过（总 740/741，1 pre-existing 失败与本 PR 无关）
  - `npm run build` 成功 5.63s
- 修复的 bug：
  - `_pendingPatch` 第一行 `...patch` 会替换嵌套 docPos → 改用字段级合并（per-field check）
  - `doWrite` 同问题：base.docPos + patch.docPos 需按 key 合并而非整体替换

## 3. 验收标准

- `npx tsc --noEmit` 0 错误
- `npm test` 全过（新增 8-12 测试覆盖关键 API）
- `npm run build` 成功
- 手动 smoke：
  - 创建测试库目录 + `<root>/.flymd/`
  - 打开库 → 触发首次读 → 缓存就绪
  - 写 patch → 防抖 → 实际落盘
  - 外部修改 local.json（touch + 改 mtime）→ 3s 内派发 changed 事件
  - 切库 → flush → 新库独立 local.json

## 4. 风险与回滚

- **风险**：中。核心模块，须保证 fsSafe 兜底、文件锁、防抖、备份都覆盖。
  - **缓解**：测试覆盖核心路径 + main.ts 集成 hook
  - **缓解**：writeFileLockedSafe 失败时回退到 writeFileAtomicSafe（无锁，但至少原子）
- **回滚**：1 commit revert 即可。新文件不破坏现有。

## 5. 工时

- 估算：M（1-2 小时）
- 实际：M（约 1 小时，含 2 次 deep-merge bug 修复）

## 6. 实现要点

### 6.1 数据结构

```ts
export const LIBRARY_PRIVATE_SCHEMA_VERSION = 1

export interface LibraryPrivateData {
  version: number  // 当前 1, 未来 v2 时按段迁移
  docPos?: Record<string, DocPos>
  uploader?: AnyUploaderConfig | null
  prefs?: {
    asr?: any
    manualTranscribe?: any
    officePreview?: { enabled?: boolean }
    [k: string]: any  // 插件可扩展
  }
}
```

### 6.2 模块级状态（类比 libraryConfig）

```ts
let _cache: { root: string; data: LibraryPrivateData } | null = null
let _loading: Promise<LibraryPrivateData | null> | null = null
let _writeQueue: Promise<void> = Promise.resolve()
let _debounceTimer: number | null = null
let _lastKnownMtime: number | null = null
let _watchTimer: number | null = null
let _pendingPatch: Partial<LibraryPrivateData> | null = null
```

### 6.3 公共 API

```ts
export async function readLibraryPrivate(): Promise<LibraryPrivateData | null>
export async function writeLibraryPrivate(
  patch: Partial<LibraryPrivateData>,
  opts?: { immediate?: boolean }
): Promise<boolean>
export async function flushLibraryPrivate(): Promise<void>
export function invalidateLibraryPrivateCache(): void
export function subscribeLibraryPrivateChange(cb: (root: string) => void): () => void
export const LIBRARY_PRIVATE_CHANGED_EVENT: string
export function libraryPrivateFilePath(root: string): string
```

### 6.4 写队列 + 防抖

```ts
async function doWrite(patch: Partial<LibraryPrivateData>): Promise<boolean> {
  const scope = getLibraryScope()
  if (!scope.root) return false
  const root = scope.root
  const path = libraryPrivateFilePath(root)
  
  const task = _writeQueue.then(async () => {
    // 写时合并磁盘最新值
    let base: LibraryPrivateData = { version: LIBRARY_PRIVATE_SCHEMA_VERSION }
    try {
      const text = await readTextFileAnySafe(path)
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object') base = parsed
    } catch {}
    if (!base.version) base.version = LIBRARY_PRIVATE_SCHEMA_VERSION
    
    const next: LibraryPrivateData = { ...base, ...patch }
    _cache = { root, data: next }
    await ensureDir(root + '/.flymd')
    
    // 滚动备份：local.json -> bak1 -> bak2 -> bak3
    await rotateBackups(path)
    
    // 原子写 + 锁
    await writeFileLockedSafe(path, JSON.stringify(next, null, 2), 5000)
    
    // 自身写入后刷新 mtime 基线
    await refreshMtimeBaseline(path)
  })
  _writeQueue = task.catch(() => {})
  try {
    await task
    return true
  } catch {
    return false
  }
}
```

### 6.5 备份滚动

```ts
async function rotateBackups(path: string): Promise<void> {
  // bak3 删除, bak2 -> bak3, bak1 -> bak2, current -> bak1
  try { await remove(path + '.bak3') } catch {}
  try { await rename(path + '.bak2', path + '.bak3') } catch {}
  try { await rename(path + '.bak1', path + '.bak2') } catch {}
  try { await rename(path, path + '.bak1') } catch {}
}
```

## 7. 不在本 PR 范围

- 实际把 Store 数据迁入（PR-4 范畴）
- 消费方（docPosition / uploader / asrNote / speechTranscribe / officePreview）改读（PR-4 范畴）
- UI hook（库设置面板"撤回迁移"按钮）（PR-4 范畴）
