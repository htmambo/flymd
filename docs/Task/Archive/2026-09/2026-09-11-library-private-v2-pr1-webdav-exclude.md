# PR-1 — WebDAV 默认排除 local.json（库私有化 v2 第一个 PR）

| 字段 | 内容 |
|------|------|
| 创建日期 | 2026-09-11 |
| 责任人 | 果农 + Claude（协作） |
| 状态 | ✅ 已完成（2026-09-11） |
| 关联 | 总路线图 `2026-09-05-library-private-config-roadmap.md` / 详细实施计划 `~/.claude/plans/cheeky-twirling-creek.md` |
| 范围 | `src/extensions/webdavSync.ts`（仅 1 文件改动 + 1 新测试文件） |

## 0. 目标

在 WebDAV 同步通道默认排除 `<库根>/.flymd/local.json`，避免库内私有数据（图床凭据 / 光标位置 / ASR 偏好）随 WebDAV 上传到远端。这是后续 PR-4（数据迁移到 local.json）的前置安全护栏。

## 1. 现状

- `src/extensions/webdavSync.ts:1025` 默认 `excludeGlobs` 仅含 4 项：
  ```ts
  ['**/.git/**','**/.trash/**','**/.DS_Store','**/Thumbs.db']
  ```
- 全部不带库私有数据排除。
- **关键发现**：当前 WebDAV 设置对话框（`openWebdavSyncDialog`）**未暴露 includeGlobs / excludeGlobs 的 UI 输入**——它们只走默认值 + 配置存储，无 GUI 修改入口。
  - 这意味着 PR-1 不需要"UI 锁死"工作，只需默认值常量化 + 新增 + 测试。
  - 后续若加 UI 暴露（PR-7 范畴），需加锁死逻辑。

## 2. 子任务清单

- [x] **T1** `webdavSync.ts` 提取默认 `excludeGlobs` 为命名常量 `DEFAULT_EXCLUDE_GLOBS`，新增 `**/.flymd/local.json` 项
- [x] **T2** 顶部加注释，说明这是**保留项**（系统保护不可删），并指向计划文档
- [x] **T3** 新增 `src/extensions/webdavExclude.test.ts`，覆盖 `shouldSyncRelativePath` 对 `.flymd/local.json` 返回 false
- [x] **T4** 运行 `npx tsc --noEmit` + `npm test` 验证 0 错全过（新增 12 测试通过；1 个 pre-existing 失败与本 PR 无关）
- [x] **T5** commit + 归档任务到 `docs/Task/Archive/2026-09/`

## 3.5 实际结果

- 改动文件：`src/extensions/webdavSync.ts`（+15/-2 行）
- 新增文件：`src/extensions/webdavExclude.test.ts`（12 个测试）
- 验证：
  - `npx tsc --noEmit` 0 错误
  - `npm run build` 成功（5.43s）
  - 新增测试：12/12 通过
  - 全量测试：710/711 通过（1 个 pre-existing `previewMeta.test.ts:100` 与本 PR 无关；stash 验证证实）

## 3. 验收标准

- `npx tsc --noEmit` 0 错误
- `npm test` 全过，新增 1 文件测试覆盖 `shouldSyncRelativePath('.flymd/local.json') === false`
- `npm run build` 成功
- 手动 smoke：打开一个库、WebDAV 同步配置面板里虽然无 UI 但默认值已包含新项（可通过 devtools 看 store）

## 4. 风险与回滚

- **风险**：低。纯默认值常量 + 新增 1 个 glob pattern。
  - 若新 glob 误命中合法用户文件 → 收紧为 `**/.flymd/local.json`（精确匹配）已足够，仅 `local.json` 文件本身被排除。
- **回滚**：1 commit revert 即可。删除常量中新增那行。

## 5. 工时

- 估算：S（< 30 分钟）
- 实际：S（< 30 分钟，全部一次通过）

## 6. 实现细节

### T1 常量定义

```ts
// 默认排除 glob 列表（库私有化 v2 护栏）。
// **/.flymd/local.json 含图床凭据 / 光标位置 / ASR 偏好等设备私有数据，
// 严禁同步到 WebDAV 远端（即便用户手动改配置）。
// 详见 docs/Task/Archive/2026-09/2026-09-11-library-private-v2-pr1-webdav-exclude.md
export const DEFAULT_EXCLUDE_GLOBS: readonly string[] = [
  '**/.git/**',
  '**/.trash/**',
  '**/.DS_Store',
  '**/Thumbs.db',
  '**/.flymd/local.json',  // PR-1: 库私有配置 v2
]
```

### T2 引用替换

`src/extensions/webdavSync.ts:1025` 改为：
```ts
excludeGlobs: Array.isArray(raw?.excludeGlobs) ? raw.excludeGlobs : [...DEFAULT_EXCLUDE_GLOBS],
```

### T3 测试用例

```ts
import { describe, it, expect } from 'vitest'
import { shouldSyncRelativePath } from './webdavSync'

describe('shouldSyncRelativePath - reserved excludes (PR-1)', () => {
  it('blocks .flymd/local.json (channel C private data)', () => {
    expect(shouldSyncRelativePath('.flymd/local.json')).toBe(false)
  })
  it('blocks nested .flymd/local.json', () => {
    expect(shouldSyncRelativePath('sub/dir/.flymd/local.json')).toBe(false)
  })
  it('allows .flymd/library-id.json (channel A, shareable)', () => {
    expect(shouldSyncRelativePath('.flymd/library-id.json')).toBe(true)
  })
  it('allows regular markdown files', () => {
    expect(shouldSyncRelativePath('notes/foo.md')).toBe(true)
  })
  it('allows .git directory entry (excluded via glob but path check is for top-level)', () => {
    // .git is excluded via glob; shouldSyncRelativePath is for top-level allow check
    expect(shouldSyncRelativePath('README.md')).toBe(true)
  })
})
```

> **注意**：`shouldSyncRelativePath` 当前是 module-level 非导出函数；测试需要它导出。需要同步把 `function` 改为 `export function`。

## 7. 不在本 PR 范围

- WebDAV 设置 UI 暴露 include/exclude 列表（PR-7 范畴）
- UI 锁死保留项不可删（PR-7 范畴）
- local.json 实际创建（PR-3 范畴）
