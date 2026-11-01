//! flymd MCP 服务器的**可复用核心**。
//!
//! 这个 lib 目标刻意只依赖 `serde` / `serde_json`（不引 `regex`），这样
//! `src-tauri` 可以把它作为路径依赖引进来，**不给 Tauri 应用新增任何依赖**。
//!
//! 共享的核心：
//! - [`config`]：MCP 目录排除配置（索引与写入共用的边界规则）
//! - [`diff`]：行级 unified diff（预览写入结果）
//! - [`guard`]：AI 写入护栏的快照存储与回滚
//! - [`time`]：UTC 日期换算（快照 ID 与时间戳都要用）
//!
//! 应用侧（`src-tauri/src/ai_guard.rs`）与 MCP 侧（`src/tools.rs`）**共用**
//! [`guard`] 与 [`diff`] 这两份实现——快照格式的一致性由「同一份代码」保证，
//! 而不是靠两边各写一遍再对齐约定。

pub mod config;
pub mod diff;
pub mod guard;
pub mod time;
