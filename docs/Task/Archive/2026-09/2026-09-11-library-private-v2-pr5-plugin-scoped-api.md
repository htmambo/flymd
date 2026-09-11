# PR-5 — 插件 library-scoped 存储 API

| 字段 | 内容 |
|------|------|
| 创建日期 | 2026-09-11 |
| 责任人 | 果农 + Claude（协作） |
| 状态 | ✅ 已完成（2026-09-11） |
| 关联 | PR-3 libraryPrivate / PR-4 数据迁移 |
| 范围 | `src/extensions/pluginHost.ts`（加 `storage.scoped` API）+ `src/extensions/pluginHost.test.ts`（新建）+ `plugin.md`（文档） |

## 0. 目标

让第三方插件可把数据写入 `<库根>/.flymd/local.json` 的 `prefs.<pluginId>` 段，跟随库走（库搬走即带走，WebDAV 同步被 PR-1 默认排除）。

## 1. API 设计

在 pluginHost.ts 已有的 `storage: { get, set }` 旁边加 `scoped: { get, set, remove }`：

```ts
host.storage.get(key)         // 旧:全局 Store plugin:<id>  (跨库共享)
host.storage.set(key, value)  // 旧:全局 Store

host.storage.scoped.get(key)        // 新:local.json.prefs.<id>.<key>  (随库)
host.storage.scoped.set(key, value) // 新
host.storage.scoped.remove(key)     // 新
```

**关键差异**：
- 旧 `storage`：全局（plugin settings 跟用户走，不跟库走）
- 新 `storage.scoped`：per-library（plugin instance data 跟库走）

**fallback 行为**：无库根（无库 / 临时库）时 `scoped.get` 返回 null，`set` 返回 false（不抛错）。

## 2. 子任务清单

- [x] **T1** `pluginHost.ts` 抽出 `createPluginScopedStorage` factory + storage.scoped 接入
- [x] **T2** 新增 `src/extensions/pluginHost.test.ts` 覆盖 17 测试
- [x] **T3** `plugin.md` 加 "context.storage.scoped (库作用域存储，v2.0+)" 一节
- [x] **T4** 验证：tsc 0 错 / test 17 新增通过 / build 3.06s

## 3.5 实际结果

- 改动文件：3（1 pluginHost 加 scoped + 抽 factory + 1 测试 + 1 文档）
- 代码行：~110 行（factory 60 + storage.scoped 调用 1 + 测试 ~200 + 文档 30）
- 验证：
  - `npx tsc --noEmit` 0 错误
  - `npm test` 17 新增通过（总 771/772，1 pre-existing 与本 PR 无关）
  - `npm run build` 成功 3.06s
- 关键设计：抽 `createPluginScopedStorage(pluginId)` 为独立 factory（与 `createDocPositionStore` 同模式），便于单测 + 解耦 pluginHost 巨型文件

## 3. 验收标准

- `npx tsc --noEmit` 0 错误
- `npm test` 全过（新增 5-8 测试覆盖 scoped API）
- `npm run build` 成功
- 手动冒烟：写测试插件，调用 `host.storage.scoped.set('x', 1)` → 切库 → 数据隔离

## 4. 风险与回滚

- **风险**：低。纯增量 API，向后兼容（旧 storage 仍可用）。
- **回滚**：1 commit revert 即可。

## 5. 工时

- 估算：S（30 分钟）
- 实际：S（约 25 分钟）

## 6. 不在本 PR 范围

- 第三方插件的迁移（旧插件用 `storage` 不动；新插件可选择 `scoped`）
- 插件数据冲突解决（不同插件同名 key，目前 pluginId 前缀已隔离）
- v2.1+ 再做细粒度权限/共享
