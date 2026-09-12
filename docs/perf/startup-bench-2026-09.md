# 大库启动性能基准（2026-09）

## 背景

`3f0bf6f` 引入启动期整树文档预扫描（`scan_dirs_doc_presence`），替换前端逐目录递归
`readDir`（曾致大库启动后主线程被淹、操作卡 8~10 秒）。本计划对该命令硬化并增加测试。

## 修复路径

7 批独立 commit（`247a37a` → `92f100e`），详见 `/Users/hoping/.claude/plans/jaunty-drifting-pond.md`。

## 测试库 fixture

`/tmp/flymd-perf-bench/library-1000/`：1200 顶层目录 × 12 文件 + 50 嵌套，含：
- ~3378 个 md/markdown 文件
- 1305 总目录（含子目录）
- `node_modules/` 与 `.git/`（验证 skip 名单生效）

生成脚本：`/tmp/gen-perf-fixture.js`

```bash
TEST_ROOT=/tmp/flymd-perf-bench/library-1000 node /tmp/gen-perf-fixture.js
```

## 单元 + 集成测试覆盖

### Rust 集成测试（`src-tauri/tests/scan_dirs_doc_presence.rs`，11 用例，全部通过）

| 测试 | 验证点 |
|---|---|
| `rejects_relative_path` | `Path::is_absolute` 守卫 |
| `basic_tree_returns_all_dirs_with_md` | 底向上聚合 |
| `allow_empty_returns_only_root_or_empty` | 边界 |
| `skip_dirs_are_excluded` | `node_modules` 命中 skip |
| `max_depth_zero_returns_only_root_path` | WalkDir `max_depth(0)` 语义 |
| `max_depth_truncates_correctly` | 深度截断 |
| `file_symlink_is_followed` | 文件 symlink 放行 |
| `dir_symlink_not_recursed` | 目录 symlink 阻止递归 |
| `max_entries_truncates` | MAX_ENTRIES 防御 |
| `ancestor_aggregation_works` | 底向上冒泡 |
| `nonexistent_root_via_metadata` | `fs::metadata` 错误上抛 |

运行：`cd src-tauri && cargo test --test scan_dirs_doc_presence`

### TypeScript 单元测试（`src/fileTreePathKey.test.ts`，15 用例，全部通过）

| 测试 | 验证点 |
|---|---|
| `normDirKey × 7` | 反斜杠归一、尾斜杠去除、驱动器根保留、空串守卫、大小写归一 |
| `pathPrefixMatch × 5` | 相等、子路径、段级边界（C:/lib vs C:/library）、空串守卫 |
| `isCaseInsensitiveFS memoize` | 重置缓存 |

运行：`npx vitest run src/fileTreePathKey.test.ts`

## 大库实测（待 dev 模式启动后手动测量）

由于应用为 Tauri 桌面 app，benchmark 需要在 GUI 模式下进行；本文档提供测量方法：

1. 启动应用：`npm run tauri:dev`
2. 打开 fixture：`/tmp/flymd-perf-bench/library-1000/`
3. 通过 DevTools Performance 面板录制启动期
4. 关键指标：
   - time-to-render-first-frame（首帧渲染）
   - time-to-first-input（首次可交互）
   - longtask 数量与最长时长
   - `scan_dirs_doc_presence` 命令耗时（开发日志输出）

## 已记录风险与后续工作

| 风险 | 当前缓解 | 后续 |
|---|---|---|
| `scan_dirs_doc_presence` 截断静默 | `eprintln` 含 root/计数/结果大小 | 升级到结构体返回 `truncated` + `error_samples`，前端可观测 |
| 平台 FS 大小写启发式 | memoize + UA 兜底 | Rust 端 `cfg!(target_os)` 权威返回 |
| 遍历错误仅 `eprintln` | dev 可见 | 接 `tauri-plugin-log` |
| `mermaid` 6.6 MB chunk 触发 vite 警告 | 恢复阈值到 1000 KB | 单独 PR 拆分 mermaid |
| invalidate 后无重扫 | 接受（缓存缺失即走递归） | debounce 重扫 |
| 集成测试覆盖后端，UI 闭环需 vitest + jsdom 进一步 | 文档化不变量 | 后续 PR |

## 历史

- 2026-09-12：7 批修复 commit（详见 `/Users/hoping/.claude/plans/jaunty-drifting-pond.md`）
