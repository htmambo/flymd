//! AI 写入护栏（应用侧）。
//!
//! 与 MCP 侧共用 `flymd_mcp::guard` —— 快照格式的一致性由**同一份代码**保证，
//! 而不是两边各写一遍再对齐约定。因此应用内的 AI 写入与 MCP 客户端的写入
//! 落在同一个快照目录里，可以互相回滚。
//!
//! 护栏的核心承诺：
//! 1. 写入前留痕（原内容必被快照）
//! 2. 写入可预览（返回 unified diff）
//! 3. 写入可回滚（任何一次写入都能回到写入前的样子）
//!
//! 详见 `docs/Task/Active/2026-11-01-ai-write-guard.md`。

use std::path::{Path, PathBuf};

use flymd_mcp::guard::{GuardStore, SnapshotPayload};
use serde_json::json;

use super::ensure_inside_root;

/// 单次写入内容上限（1 MB）。与 MCP 侧一致。
pub const MAX_WRITE_BYTES: usize = 1024 * 1024;

/// 把库根与目标绝对路径转成「库根 + 相对路径」，并做越界防护。
///
/// 复用 main.rs 的 `ensure_inside_root`（同一套越界语义），额外补一条：
/// 目标本身是符号链接时拒绝——写穿链接会写到别处。
fn resolve_in_library(library_root: &str, file_path: &str) -> Result<(PathBuf, String), String> {
  let root = PathBuf::from(library_root);
  let target = PathBuf::from(file_path);

  if !root.is_absolute() {
    return Err(format!("库根必须是绝对路径: {library_root}"));
  }
  if !target.is_absolute() {
    return Err(format!("目标必须是绝对路径: {file_path}"));
  }
  if target.is_symlink() {
    return Err(format!("目标是符号链接，拒绝写入: {file_path}"));
  }
  ensure_inside_root(library_root, file_path)?;

  // 相对路径（统一用 `/` 分隔），与应用侧的库内路径表示一致
  let rel = target
    .strip_prefix(&root)
    .map_err(|_| format!("目标不在库根之内: {file_path}"))?
    .to_string_lossy()
    .replace('\\', "/");
  if rel.is_empty() {
    return Err("目标路径不能是库根本身".to_string());
  }
  Ok((target, rel))
}

/// 读出目标的当前磁盘内容；文件不存在返回 None。
fn read_disk_content(path: &Path) -> Result<Option<String>, String> {
  match std::fs::read(path) {
    Ok(bytes) => Ok(Some(
      String::from_utf8(bytes).map_err(|_| "目标不是合法的 UTF-8 文本".to_string())?,
    )),
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
    Err(e) => Err(format!("读取目标失败: {e}")),
  }
}

/// 为一次即将发生的写入建立快照，并返回预览 diff。
///
/// `before_content` 是「写入前」的内容——应用内的 AI 写入发生在**编辑器内存态**，
/// 而编辑器内容可能尚未落盘，所以以调用方给的编辑器内容为准；没给才回退到磁盘内容。
#[tauri::command]
pub async fn ai_guard_snapshot(
  library_root: String,
  path: String,
  new_content: String,
  before_content: Option<String>,
  operation: Option<String>,
  actor: Option<String>,
  reason: Option<String>,
) -> Result<serde_json::Value, String> {
  let res = tauri::async_runtime::spawn_blocking(move || {
    if new_content.len() > MAX_WRITE_BYTES {
      return Err(format!(
        "写入内容 {:.1} MB，超过 {} MB 上限，已拒绝。",
        new_content.len() as f64 / 1048576.0,
        MAX_WRITE_BYTES / 1048576
      ));
    }
    let (abs, rel) = resolve_in_library(&library_root, &path)?;
    let store = GuardStore::new(Path::new(&library_root));

    // 写入前的内容：优先用调用方给的（编辑器态），否则读磁盘
    let before = match before_content {
      Some(c) => Some(c),
      None => read_disk_content(&abs)?,
    };
    let existed = before.is_some();

    // 原内容超限时没法生成可回滚的快照——宁可写不进去
    if let Some(c) = &before {
      if c.len() > MAX_WRITE_BYTES {
        return Err(format!(
          "目标现有内容 {:.1} MB，超过 {} MB 上限，无法生成可回滚快照，已中止。",
          c.len() as f64 / 1048576.0,
          MAX_WRITE_BYTES / 1048576
        ));
      }
    }

    let payload = SnapshotPayload {
      path: &rel,
      operation: operation.as_deref().unwrap_or("app_write"),
      actor: actor.as_deref().unwrap_or("app"),
      reason: reason.as_deref(),
      rollback_of: None,
      before: before.as_deref(),
      after: Some(&new_content),
    };
    let meta = store.create(&payload)?;

    let old_text = before.clone().unwrap_or_default();
    let old_label = if existed {
      rel.clone()
    } else {
      "/dev/null".to_string()
    };
    let diff = flymd_mcp::diff::unified_diff(&old_text, &new_content, &old_label, &rel);

    Ok(json!({
      "id": meta.id,
      "path": meta.path,
      "existedBefore": meta.existed_before,
      "beforeBytes": meta.before_bytes,
      "afterBytes": meta.after_bytes,
      "diff": diff,
      "guardDir": store.root().to_string_lossy(),
    }))
  })
  .await
  .map_err(|e| format!("任务执行失败: {e}"))?;
  res
}

/// 只算 diff，不写盘、不产生快照。
#[tauri::command]
pub async fn ai_guard_preview(
  library_root: String,
  path: String,
  new_content: String,
) -> Result<serde_json::Value, String> {
  let res = tauri::async_runtime::spawn_blocking(move || {
    if new_content.len() > MAX_WRITE_BYTES {
      return Err(format!(
        "内容 {:.1} MB，超过 {} MB 上限。",
        new_content.len() as f64 / 1048576.0,
        MAX_WRITE_BYTES / 1048576
      ));
    }
    let (abs, rel) = resolve_in_library(&library_root, &path)?;
    let before = read_disk_content(&abs)?;
    let existed = before.is_some();
    let old_text = before.clone().unwrap_or_default();
    let old_label = if existed {
      rel.clone()
    } else {
      "/dev/null".to_string()
    };
    let diff = flymd_mcp::diff::unified_diff(&old_text, &new_content, &old_label, &rel);
    Ok(json!({ "path": rel, "diff": diff }))
  })
  .await
  .map_err(|e| format!("任务执行失败: {e}"))?;
  res
}

/// 回滚一次写入：把快照里的「写入前内容」写回目标文件。
///
/// 回滚本身也会生成一份新快照（`rollbackOf` 指向被回滚的那次），
/// 所以**回滚可以再回滚**。
#[tauri::command]
pub async fn ai_guard_restore(
  library_root: String,
  snapshot_id: String,
  confirm: Option<bool>,
) -> Result<serde_json::Value, String> {
  let res = tauri::async_runtime::spawn_blocking(move || {
    let root = PathBuf::from(&library_root);
    let store = GuardStore::new(&root);
    let meta = store.get(&snapshot_id)?;
    // 目标路径同样要过越界防护
    let abs = root.join(&meta.path);
    let _ = resolve_in_library(&library_root, &abs.to_string_lossy())?;

    let outcome = store.rollback(&snapshot_id, confirm.unwrap_or(false), "app")?;
    // 返回**被回滚的那次快照**的「写入前内容」——那才是回滚后文件应有的内容。
    // （回滚本身生成的快照，其 before 是「回滚前的文件内容」，方向相反，不能用）
    let restored = store.read_before(&snapshot_id)?;
    Ok(json!({
      "id": outcome.snapshot.id,
      "rolledBack": outcome.rolled_back,
      "path": outcome.path,
      "deleted": outcome.deleted,
      // 回滚后的文件内容，调用方应同步回编辑器；null 表示文件被删除
      "content": restored,
    }))
  })
  .await
  .map_err(|e| format!("任务执行失败: {e}"))?;
  res
}

/// 列出本库可回滚的写入记录。
#[tauri::command]
pub async fn ai_guard_list(
  library_root: String,
  limit: Option<usize>,
) -> Result<serde_json::Value, String> {
  let res = tauri::async_runtime::spawn_blocking(move || {
    let root = PathBuf::from(&library_root);
    let store = GuardStore::new(&root);
    let metas = store.list(Some(limit.unwrap_or(20)));
    let items: Vec<serde_json::Value> = metas
      .iter()
      .map(|m| {
        json!({
          "id": m.id,
          "createdAt": m.created_at,
          "operation": m.operation,
          "actor": m.actor,
          "path": m.path,
          "existedBefore": m.existed_before,
          "beforeBytes": m.before_bytes,
          "afterBytes": m.after_bytes,
          "reason": m.reason,
          "rollbackOf": m.rollback_of,
          "truncated": m.truncated,
        })
      })
      .collect();
    Ok(json!({
      "guardDir": store.root().to_string_lossy(),
      "items": items,
    }))
  })
  .await
  .map_err(|e| format!("任务执行失败: {e}"))?;
  res
}

#[cfg(test)]
mod ai_guard_tests {
  use super::*;

  fn tmp_root(tag: &str) -> PathBuf {
    let base = std::env::temp_dir().join(format!(
      "flymd_ai_guard_test_{}_{:?}",
      tag,
      std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&base);
    std::fs::create_dir_all(base.join("子目录")).expect("create test dirs");
    base
  }

  fn root_str(root: &Path) -> String {
    root.to_string_lossy().to_string()
  }

  #[test]
  fn 库内路径被接受() {
    let root = tmp_root("inside");
    let target = root.join("子目录/a.md");
    std::fs::write(&target, "x").expect("write test file");
    let r = resolve_in_library(&root_str(&root), &target.to_string_lossy());
    let _ = std::fs::remove_dir_all(&root);
    assert!(r.is_ok(), "库内文件应被接受: {:?}", r);
    assert_eq!(r.unwrap().1, "子目录/a.md");
  }

  #[test]
  fn 库外路径被拒绝() {
    let root = tmp_root("outside");
    let other = tmp_root("outside_other");
    let target = other.join("b.md");
    std::fs::write(&target, "x").expect("write test file");
    let r = resolve_in_library(&root_str(&root), &target.to_string_lossy());
    let _ = std::fs::remove_dir_all(&root);
    let _ = std::fs::remove_dir_all(&other);
    assert!(r.is_err(), "库外文件必须被拒绝");
  }

  #[test]
  fn 相对路径被拒绝() {
    let root = tmp_root("relative");
    let r = resolve_in_library(&root_str(&root), "子目录/a.md");
    let _ = std::fs::remove_dir_all(&root);
    assert!(r.is_err(), "相对路径必须被拒绝");
  }

  #[test]
  fn 符号链接目标被拒绝() {
    let root = tmp_root("symlink");
    let other = tmp_root("symlink_other");
    std::fs::write(other.join("b.md"), "x").expect("write test file");
    #[cfg(unix)]
    {
      std::os::unix::fs::symlink(other.join("b.md"), root.join("link.md")).expect("symlink");
      let r = resolve_in_library(&root_str(&root), &root.join("link.md").to_string_lossy());
      assert!(r.is_err(), "符号链接目标必须被拒绝");
    }
    let _ = std::fs::remove_dir_all(&root);
    let _ = std::fs::remove_dir_all(&other);
  }

  #[test]
  fn 快照与回滚闭环() {
    let root = tmp_root("roundtrip");
    let target = root.join("a.md");
    std::fs::write(&target, "# 原内容\n").expect("write test file");
    let store = GuardStore::new(&root);

    let payload = SnapshotPayload {
      path: "a.md",
      operation: "app_write",
      actor: "app",
      reason: None,
      rollback_of: None,
      before: Some("# 原内容\n"),
      after: Some("# 新内容\n"),
    };
    let meta = store.create(&payload).expect("create snapshot");
    assert!(meta.existed_before);
    assert_eq!(meta.path, "a.md");

    // 回滚：文件应恢复原内容
    let outcome = store.rollback(&meta.id, false, "app").expect("rollback");
    assert!(!outcome.deleted);
    let restored = std::fs::read_to_string(&target).expect("read restored");
    assert_eq!(restored, "# 原内容\n");
    assert_eq!(outcome.snapshot.rollback_of.as_deref(), Some(meta.id.as_str()));

    let _ = std::fs::remove_dir_all(&root);
  }

  #[test]
  fn 快照目录落在_dot_flymd_下() {
    let root = tmp_root("dir");
    let store = GuardStore::new(&root);
    let dir = store.root().to_string_lossy().to_string();
    let _ = std::fs::remove_dir_all(&root);
    assert!(dir.ends_with(".flymd/ai-guard"), "实际: {dir}");
  }
}
