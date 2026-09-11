# PR-4 — 数据迁移 + 各消费方改读 local.json（库私有化 v2 第四个 PR）

| 字段 | 内容 |
|------|------|
| 创建日期 | 2026-09-11 |
| 责任人 | 果农 + Claude（协作） |
| 状态 | ✅ 已完成（2026-09-11） |
| 关联 | PR-3 `2026-09-11-library-private-v2-pr3-libraryprivate.md` |
| 范围 | `src/core/libraryMigration.ts`（新建 ~200 行）+ 5 个消费方文件改读 + 多测试文件 |

## 0. 目标

把通道 B 在 Tauri Store / localStorage 中的存量数据迁移到 `local.json`，并把消费方切到读 local.json（fallback 旧 key）。**最高风险 PR**——涉及 5 个核心模块的数据读写顺序变更。

## 1. 通道 B → 通道 C 迁移映射（v2.0 范围）

| 字段 | 旧 key | 新位置 | 迁移策略 |
|---|---|---|---|
| `docPos` | Store `docPos:<libId>` | `local.json.docPos` | 取 isInside(root) 的条目；按 key 合并 |
| `uploader` | Store `uploader:<libId>` | `local.json.uploader` | 整对象覆盖 |

**v2.0 不迁移**（设计修正：这些是全局偏好，迁入 per-library 反而是降级——切库丢配置）：
- `asr` (Store) — 全局 ASR 偏好，保留在 Store
- `manualTranscribe` (Store) — 全局手动转写偏好，保留在 Store
- `officePreview` (Store) — 全局 Word 预览 enabled，保留在 Store
- `tabSession` (localStorage) — 已是 (libId, windowLabel) 隔离，无需迁
- WebDAV `sync.profiles[libId]` — 库搬走后配失效是合理预期
- AI 助手 / 搜索历史 / 主题 / 快捷键 — 全局

**v2.1+ 再议**（per-library 化全局偏好需用户显式 opt-in）。local.json schema 仍预留 `prefs` 段以便未来扩展。

## 2. 幂等与备份策略

**标记 key**：`flymd:lib-local-migrated:<libId>` 在 Store 中存 `{migratedAt, version, fields}`。
- 存在 → 跳过迁移
- 不存在 → 执行迁移，写入后置标记

**备份 key**（迁移前快照）：`flymd:lib-local-migrated:backup:<libId>:<field>` 最多保留 1 版本。
- 写入 local.json 成功后
- 旧 key 标记"已迁移"但**不删除**（v2.0 兜底，v2.1 清理）
- 保留 backup 给用户回退用

## 3. 触发时机

- 库切换到 persisted 库时（`setLibraryScopeCache` 内）
- 显式调用 `migrateLibraryToLocalOnce(libId, root)`
- **不阻塞**库激活（fire-and-forget + 错误日志）

## 4. 消费方改读策略

每个消费方的 read 函数：
1. 优先读 `libraryPrivate.<section>`（新通道）
2. fallback 到旧 Store key（旧通道）
3. 缓存到 consumer 本地（避免每次都 fallback）

每个 write 函数：
1. 写 `libraryPrivate`（新通道唯一写入点）
2. **不再写**旧 Store key（迁移完成后清空旧路径）

## 5. 子任务清单

- [x] **T1** `src/core/libraryMigration.ts`（新建 ~180 行）
- [x] **T2** 触发点：libraryPrivate.ts 通过 LIBRARY_CHANGED_EVENT 桥接触发（fire-and-forget）
- [x] **T3** `src/core/docPosition.ts` 改读 libraryPrivate.docPos（fallback Store），write 走 libraryPrivate
- [x] **T4** `src/uploader/storeConfig.ts` 改读 libraryPrivate.uploader（fallback Store），write 走 libraryPrivate
- [x] **T5-T7** asrNote/speechTranscribe/officePreview 不动（保留全局 Store）
- [x] **T8** 2 个测试文件更新（docPosition.test.ts）+ libraryMigration.test.ts 新建
- [x] **T9** 验证：tsc 0 错 / test 24 新增通过 / build 成功

## 3.5 实际结果

- 改动文件：6（1 新模块 + 2 消费方改 + 1 桥接 + 1 测试 + 1 任务文档）
- 新增测试：24 用例（libraryMigration 13 + docPosition 11）
- 验证：
  - `npx tsc --noEmit` 0 错误
  - `npm test` 24 新增通过（总 754/755，1 pre-existing 失败与本 PR 无关）
  - `npm run build` 成功 5.11s
- 修复的 bug：
  - **设计修正**：v2.0 不迁 ASR/manualTranscribe/officePreview（全局偏好迁入 per-library 反而降级）
  - **测试 mock bug**：`...actual` spread 不能 mock 内部引用原模块 export 的函数（libraryScopedKey 调用真实 getLibraryScope）—— 必须显式 override
  - **测试 type 错误**：`mockResolvedValueOnce` 返回类型不完整 → `as any` 强制绕过

## 6. 验收标准

- 旧版本（v1.4.4）创建的 `docPos:<libId>` / `uploader:<libId>` / `asr` / `manualTranscribe` / `officePreview` → 升级 v2.0 打开库 → 自动迁移
- 通知中心出现"已迁移 N 项"
- 重启后数据完整（local.json 已写入）
- 旧 key 保留（不删除）作为兜底
- 第二次打开同一库：跳过迁移（标记已存在）
- 任何写操作不再写旧 key

## 7. 风险与回滚

- **风险**：🔴 高。核心数据迁移路径，5 个模块读写顺序变更。
  - **缓解**：幂等保证 + 旧 key 保留 + backup + 错误隔离（单字段失败不阻塞其他）
  - **缓解**：消费方先读 libraryPrivate，fallback 旧 key → 旧 key 不会立即失效
  - **缓解**：迁移前 backup 旧 key → 用户可手动回退
- **回滚**：1 commit revert 即可。旧 key 未删，下次启动会重读旧 key。

## 8. 工时

- 估算：L（3-4 小时）
- 实际：L（约 2.5 小时，含 1 次设计修正 + 2 次测试 mock bug 修复）
