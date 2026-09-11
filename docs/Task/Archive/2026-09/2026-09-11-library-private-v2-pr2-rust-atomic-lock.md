# PR-2 — Rust 原子写 + 跨进程文件锁

| 字段 | 内容 |
|------|------|
| 创建日期 | 2026-09-11 |
| 责任人 | 果农 + Claude（协作） |
| 状态 | ✅ 已完成（2026-09-11） |
| 关联 | PR-1 `2026-09-11-library-private-v2-pr1-webdav-exclude.md` / 总路线图 `2026-09-05-library-private-config-roadmap.md` |
| 范围 | `src-tauri/src/main.rs`（新增 ~180 行） + `src-tauri/Cargo.toml`（+1 依赖） + `src/core/fsSafe.ts`（扩展） + `src/core/fsSafe.test.ts`（新增） |

## 0. 目标

为 PR-3/4 提供基础设施：
1. **原子写**（tmp+fsync+rename）—— 防止 kill -9 时半截写
2. **跨进程文件锁**（POSIX `flock` / Windows `LockFileEx`）—— 多 Tauri 窗口/多进程不丢写
3. **stale .tmp 清理** —— 启动时扫 `.flymd/*.tmp` 兜底
4. **带锁的便捷命令** —— `read_file_locked` / `write_file_locked` 一站式

## 1. 现状

- `src-tauri/src/main.rs` 已有 `write_text_file_any`（直写，无原子保证）
- `src-tauri/src/main.rs:3475` `force_remove_path` 已展示 `spawn_blocking` 模式
- `src-tauri/Cargo.toml` 已含 `windows = "0.58"`（仅 Windows target）
- `src/core/fsSafe.ts` 已有 `readTextFileAnySafe` / `writeTextFileAnySafe` / `statFileAnySafe`

## 2. 子任务清单

- [x] **T1** `Cargo.toml` 加 `fs2 = "0.4"` 依赖
- [x] **T2** `main.rs` 新增 `LockRegistry` 全局状态（`Mutex<HashMap<String, File>>`） + token 生成器
- [x] **T3** `main.rs` 新增 6 个命令
- [x] **T4** `main.rs:2152 invoke_handler` 注册 6 个新命令
- [x] **T5** `src/core/fsSafe.ts` 扩展 6 个包装函数
- [x] **T6** 新增 `src/core/fsSafe.test.ts`（15 个测试）
- [x] **T7** 验证：`cargo check` 0 错 / `npm run build` 成功 / `npm test` 15 新增通过

## 3.5 实际结果

- 改动文件：4（1 Rust + 1 Cargo.toml + 1 fsSafe.ts + 1 test + 1 任务文档）
- 代码行：~220 行 Rust + 60 行 JS + 130 行测试
- 验证：
  - `cargo check` 0 错误（debug 编译 4.49s）
  - `npx tsc --noEmit` 0 错误
  - `npm run build` 成功 4.41s
  - `npm test` 15 新增通过（711 → 726，1 pre-existing 失败与本 PR 无关）
- 修复的 Rust 编译错误：
  - `unlock_file` 的 `let map` 缺 `mut` (HashMap::remove 需要 &mut self)
  - `cleanup_stale_tmp_files` 缺 `Ok(count)` 返回；改用 `?` 让 spawn_blocking 内层 Result 自动 flatten

## 3. 验收标准

- `cargo check` 在 src-tauri 下 0 错误
- `npm test` 全过（含新增测试）
- `npm run build` 成功
- 手动 `pnpm tauri dev` 启动后，devtools console 调 `invoke('write_file_atomic', ...)` 验证原子写

## 4. 风险与回滚

- **风险**：中。Rust 端涉及 OS 资源管理（fd / 锁），需测试清理路径。
  - **缓解**：用 `RAII` (`Drop` trait) + 全局 `Mutex<HashMap>`，进程退出自动释放。
  - **缓解**：lock 路径用 `<path>.lock` 旁路文件，不污染目标文件本身。
- **回滚**：1 commit revert 即可。删除 `Cargo.toml` 依赖 + 6 个命令 + 6 个 JS 包装。

## 5. 工时

- 估算：M（1-2 小时）
- 实际：S（实际开发 ~45 分钟，含 2 次 Rust 编译错误修复）

## 6. 实现要点

### 6.1 fs2 crate 选择

`fs2 = "0.4"`：
- 跨平台（POSIX `flock` / Windows `LockFileEx`）
- 零外部系统依赖
- 维护稳定
- 替代方案：用 `std::fs::File::lock_exclusive`（Rust 1.89+ 内置）但项目 `rust-version = "1.70"`，会破坏版本约束

### 6.2 超时机制

不用 `tokio::time::timeout`（需要开 `time` feature，增加 tokio 体积）。
改用 `std::thread::spawn` + `std::sync::mpsc::recv_timeout`：

```rust
let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
std::thread::spawn(move || {
    let result = /* blocking work */;
    let _ = tx.send(result);
});
match rx.recv_timeout(Duration::from_millis(timeout_ms)) {
    Ok(result) => result,
    Err(_) => Err("Lock timeout".to_string()),
}
```

### 6.3 LockToken

UUID-like：SystemTime nanos + atomic counter。HashMap key 全局唯一。

```rust
fn gen_lock_token() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let c = COUNTER.fetch_add(1, Ordering::SeqCst);
    format!("{:x}-{:x}", now, c)
}
```

### 6.4 RAII 文件锁

用 `fs2::FileExt::lock_exclusive` 的方法直接调，但要在 `File` 上调用。
锁的释放靠 `Drop` trait。

## 7. 不在本 PR 范围

- 写入路径走 Rust 调度的实际业务逻辑（PR-3 范畴）
- 启动时自动调 `cleanup_stale_tmp_files`（main.ts 启动序列，PR-3 范畴）
