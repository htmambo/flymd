# 打开文件外部更改监听 — PR-3 hash 优化

> PR-1 / PR-1.1 / PR-2 / PR-2.1 已完成并归档。本期做**性能/精度优化**:为小文件加 SHA-1,降低"外部修改 mtime 偶发回退 + size 相同"导致的 false positive。

## 元数据

| 字段 | 值 |
|---|---|
| 创建日期 | 2026-06-04 |
| 状态 | ✅ 已完成 (完成时间: 2026-06-04) |
| 范围 | 单文件改动:`src/core/openFileWatcher.ts` |
| 预计工时 | S(1-2 小时) |

## 子任务

### 3.1 核心层加 SHA-1 支持
- `OpenFileWatcherDeps` 加 `readFile` / `crypto` 注入
- 新增 `computeSha1Hex(filePath, knownSize, maxBytes)` — size 已知超限早返回 null(不读字节)
- 新增 `tryFillHash(entry, snapshot)` — race 防护 + 并发去重 + 失败降级
- Entry 加 `hashInFlight: boolean` 字段
- `HASH_THRESHOLD_BYTES = 1MB`(原本已定义但未使用,本期首次启用)

### 3.2 4 个 caller 改写
- `register`:初始 snapshot 填充
- `markSelfWrite`:saveFile 完成后刷新
- `finishSelfWrite`:saveAs 完成后刷新
- `revalidate`:切回标签时 stat 复检
- `checkChange`:事件触发后 stat 比对
- 所有 caller:"s == null → 保留原 snapshot",避免 cancelled 状态污染

### 3.3 修 codex review 2 P1 + 1 P2
- P1 #1: `snapshotEqual` 改降级语义 — 任一侧 hash 缺失时按 mtime+size 判定
- P1 #2: `register` 同路径重复时设 `existed.cancelled = true`
- P2: `checkChange` removed 分支加 cancelled / map 检查

### 3.9 验证
- tsc 0 错误
- vite build 干净(24.13s)
- codex review 复审通过

## 风险

- 大文件(>1MB)走 mtime+size,无影响(本就是预期降级)
- 浏览器/无 crypto 环境:cryptoImpl 不存在 → tryFillHash 返回 null → 走 mtime+size(零影响)
- register 时多一次 readFile IO:仅 ≤1MB 触发,1MB readFile ~几 ms,可接受

## 验收

- 集成层零改动(openFileWatcherIntegration.ts 不变,`snapshotEqual` 已支持可选 hash)
- 用户行为零变化:小文件修改后 false positive 降低,大文件维持原行为
- preferences / 模态 / 文档 全部不变

## 完成情况

- **3.1** ✅:`computeSha1Hex` / `tryFillHash` 实现完整,性能优化到位(超限不读字节)
- **3.2** ✅:5 个 caller(register / markSelfWrite / finishSelfWrite / revalidate / checkChange)全部按"cancelled 检查 + 失败降级"模式
- **3.3** ✅:codex review 2 P1 + 1 P2 全部修复
- **3.9** ✅:tsc 0,vite build 干净(23.99s)
