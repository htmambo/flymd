//! AI 写入护栏：写入前快照、写入后回滚。
//!
//! 这是 `docs/Task/Active/2026-11-01-ai-write-guard.md` §3「快照格式规范 v1」
//! 在 MCP 侧的落地实现。应用侧会实现同格式的另一份，两边必须能互认：
//!
//! ```text
//! <库根>/.flymd/ai-guard/
//! └── 20261101T165300Z-a1b2c3/          # 一次写入 = 一个独立目录
//!     ├── meta.json                     # 元数据
//!     ├── before.md                     # 写入前的原始内容（原文件不存在时不生成）
//!     └── after.md                      # 写入后的内容
//! ```
//!
//! 硬约束：
//! - 快照目录永不接受外部路径，目标文件必须在库根之内；
//! - 快照写不成功就不许落盘——不能留下没有回滚路径的改动；
//! - 内容超上限的快照显式标记 `truncated`，**不假装能回滚**。

use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// 单个快照内容上限（1 MB）。超过则不存 `before.md` / `after.md`。
pub const MAX_SNAPSHOT_BYTES: usize = 1024 * 1024;

/// 保留的快照数量上限（最近 50 个）。
pub const MAX_SNAPSHOTS: usize = 50;

/// 快照目录总量上限（100 MB）。
pub const MAX_TOTAL_BYTES: u64 = 100 * 1024 * 1024;

/// 快照根目录名（相对库根）。
const GUARD_DIR: &str = "ai-guard";

/// 快照元数据（`meta.json`）。
///
/// 字段与设计文档 §3.2 逐字对齐；`truncated` 是 §3.4 要求的截断标记。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotMeta {
    /// 快照 ID：`YYYYMMDDTHHMMSSZ-<6 位十六进制>`
    pub id: String,
    /// 创建时间（ISO8601，UTC）
    pub created_at: String,
    /// 操作名：`write_note` / `rollback_write` / …
    pub operation: String,
    /// 发起者：`mcp` / `app` / `plugin:<id>`
    pub actor: String,
    /// 目标路径（相对库根）
    pub path: String,
    /// 写入前文件是否已存在
    pub existed_before: bool,
    /// 写入前内容的 SHA-256
    pub before_sha256: String,
    /// 写入后内容的 SHA-256
    pub after_sha256: String,
    /// 写入前的字节数
    pub before_bytes: u64,
    /// 写入后的字节数
    pub after_bytes: u64,
    /// 写入原因（可空）
    pub reason: Option<String>,
    /// 若本快照是一次回滚，指向被回滚的快照 ID
    pub rollback_of: Option<String>,
    /// 内容超上限、快照被截断时为 true；此时不可回滚
    pub truncated: bool,
}

/// 一次快照的内容与元信息。
pub struct SnapshotPayload<'a> {
    /// 目标路径（相对库根）
    pub path: &'a str,
    /// 操作名
    pub operation: &'a str,
    /// 发起者
    pub actor: &'a str,
    /// 写入原因
    pub reason: Option<&'a str>,
    /// 被回滚的快照 ID
    pub rollback_of: Option<&'a str>,
    /// 写入前的内容；`None` 表示文件原本不存在
    pub before: Option<&'a str>,
    /// 写入后的内容；`None` 表示操作后文件不存在（回滚语义 = 删除）
    pub after: Option<&'a str>,
}

/// 回滚结果。
#[derive(Debug, Clone)]
pub struct RollbackOutcome {
    /// 回滚本身生成的新快照（可以再回滚）
    pub snapshot: SnapshotMeta,
    /// 被回滚的快照 ID
    pub rolled_back: String,
    /// 目标路径（相对库根）
    pub path: String,
    /// 回滚后文件是否被删除
    pub deleted: bool,
}

/// 写入护栏的快照存储。
#[derive(Debug, Clone)]
pub struct GuardStore {
    /// 快照根目录：`<库根>/.flymd/ai-guard/`
    root: PathBuf,
    /// 库根：快照的写入目标必须落在它之内。
    library_root: PathBuf,
}

impl GuardStore {
    /// 绑定到某个库根的护栏存储。
    pub fn new(library_root: &Path) -> Self {
        Self {
            root: library_root.join(".flymd").join(GUARD_DIR),
            library_root: library_root.to_path_buf(),
        }
    }

    /// 快照根目录。
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// 某个快照的目录。
    pub fn dir_of(&self, id: &str) -> PathBuf {
        self.root.join(id)
    }

    /// 创建一个快照。
    ///
    /// 任何一步失败都会清掉半成品目录并返回错误——调用方据此中止写入。
    pub fn create(&self, payload: &SnapshotPayload) -> Result<SnapshotMeta, String> {
        std::fs::create_dir_all(&self.root)
            .map_err(|e| format!("无法创建快照目录 {}: {e}", self.root.display()))?;
        let (id, dir) = self.alloc_dir(SystemTime::now())?;
        let meta = match self.write_snapshot(&id, &dir, payload) {
            Ok(meta) => meta,
            Err(e) => {
                // 半成品目录不能留：否则列表里会出现一个没有元数据的快照。
                let _ = std::fs::remove_dir_all(&dir);
                return Err(e);
            }
        };
        // 超出保留上限时清理更旧的快照；清理失败不影响本次写入。
        let _ = self.prune();
        Ok(meta)
    }

    /// 写入快照目录里的 `meta.json` 与内容文件。
    fn write_snapshot(
        &self,
        id: &str,
        dir: &Path,
        payload: &SnapshotPayload,
    ) -> Result<SnapshotMeta, String> {
        let before_bytes = payload.before.map(|s| s.len() as u64).unwrap_or(0);
        let after_bytes = payload.after.map(|s| s.len() as u64).unwrap_or(0);
        // 内容超上限：不存内容文件，显式标记截断（此时不可回滚）。
        let truncated =
            before_bytes > MAX_SNAPSHOT_BYTES as u64 || after_bytes > MAX_SNAPSHOT_BYTES as u64;
        if !truncated {
            if let Some(before) = payload.before {
                write_file(&dir.join("before.md"), before.as_bytes())?;
            }
            if let Some(after) = payload.after {
                write_file(&dir.join("after.md"), after.as_bytes())?;
            }
        }
        let meta = SnapshotMeta {
            id: id.to_string(),
            created_at: timestamp_iso(SystemTime::now()),
            operation: payload.operation.to_string(),
            actor: payload.actor.to_string(),
            path: payload.path.to_string(),
            existed_before: payload.before.is_some(),
            before_sha256: sha256::hex_digest(payload.before.unwrap_or("").as_bytes()),
            after_sha256: sha256::hex_digest(payload.after.unwrap_or("").as_bytes()),
            before_bytes,
            after_bytes,
            reason: payload.reason.map(|r| r.to_string()),
            rollback_of: payload.rollback_of.map(|r| r.to_string()),
            truncated,
        };
        let json = serde_json::to_string_pretty(&meta)
            .map_err(|e| format!("序列化快照元数据失败: {e}"))?;
        write_file(&dir.join("meta.json"), json.as_bytes())?;
        Ok(meta)
    }

    /// 分配一个不冲突的快照目录。
    fn alloc_dir(&self, now: SystemTime) -> Result<(String, PathBuf), String> {
        let stamp = timestamp_id(now);
        for attempt in 0..64u32 {
            let id = format!("{stamp}-{}", random_suffix(attempt));
            let dir = self.root.join(&id);
            if !dir.exists() {
                std::fs::create_dir_all(&dir)
                    .map_err(|e| format!("无法创建快照目录 {}: {e}", dir.display()))?;
                return Ok((id, dir));
            }
        }
        Err("无法分配快照 ID：目录名持续冲突".into())
    }

    /// 列出快照（按 ID 倒序，即最新在前）。
    pub fn list(&self, limit: Option<usize>) -> Vec<SnapshotMeta> {
        let entries = match std::fs::read_dir(&self.root) {
            Ok(e) => e,
            Err(_) => return Vec::new(),
        };
        let mut ids: Vec<String> = entries
            .flatten()
            .filter(|e| e.path().is_dir())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|name| is_valid_id(name))
            .collect();
        ids.sort();
        ids.reverse();
        let mut out = Vec::new();
        for id in ids {
            if let Ok(meta) = self.get(&id) {
                out.push(meta);
                if let Some(limit) = limit {
                    if out.len() >= limit {
                        break;
                    }
                }
            }
        }
        out
    }

    /// 读取单个快照的元数据。
    pub fn get(&self, id: &str) -> Result<SnapshotMeta, String> {
        if !is_valid_id(id) {
            return Err(format!("快照 ID 非法: {id}"));
        }
        let path = self.dir_of(id).join("meta.json");
        let raw = std::fs::read_to_string(&path)
            .map_err(|e| format!("读取快照 {id} 的元数据失败: {e}"))?;
        serde_json::from_str(&raw).map_err(|e| format!("快照 {id} 的元数据解析失败: {e}"))
    }

    /// 读取快照的 `before.md`（文件原本不存在时返回 `None`）。
    pub fn read_before(&self, id: &str) -> Result<Option<String>, String> {
        if !is_valid_id(id) {
            return Err(format!("快照 ID 非法: {id}"));
        }
        let path = self.dir_of(id).join("before.md");
        match std::fs::read(&path) {
            Ok(bytes) => {
                Ok(Some(String::from_utf8(bytes).map_err(|_| {
                    format!("快照 {id} 的 before.md 不是合法的 UTF-8 文本")
                })?))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(format!("读取快照 {id} 的 before.md 失败: {e}")),
        }
    }

    /// 回滚到指定快照。
    ///
    /// 回滚本身也会生成快照（`rollbackOf` 指向被回滚的快照），因此**回滚可以再回滚**。
    /// 快照对应的文件原本不存在时，回滚语义是删除文件，必须显式 `confirm`。
    /// 回滚一次写入。
    ///
    /// `actor` 记进新生成的回滚快照，用于审计「这次回滚是谁发起的」——
    /// MCP 客户端与应用侧共用本实现，actor 必须由调用方给，不能写死。
    pub fn rollback(
        &self,
        id: &str,
        confirm: bool,
        actor: &str,
    ) -> Result<RollbackOutcome, String> {
        let meta = self.get(id)?;
        if meta.truncated {
            return Err(format!(
                "快照 {id} 的内容超过 {} 字节上限、已被截断，无法回滚。",
                MAX_SNAPSHOT_BYTES
            ));
        }
        let rel = meta.path.clone();
        let target = self.target_path(&rel)?;
        if !meta.existed_before && !confirm {
            return Err(format!(
                "快照 {id} 对应的文件在写入前并不存在，回滚语义是**删除**该文件。\n\
                 请显式传入 confirm: true 以确认删除：{rel}"
            ));
        }

        // 读取当前磁盘内容，作为这次回滚的「回滚前状态」。
        let current = match std::fs::read(&target) {
            Ok(bytes) => Some(bytes),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(format!("读取 {rel} 失败: {e}")),
        };
        let before = match &current {
            Some(bytes) => Some(
                String::from_utf8(bytes.clone())
                    .map_err(|_| format!("{rel} 不是合法的 UTF-8 文本，无法回滚"))?,
            ),
            None => None,
        };
        let restored: Option<String> = if meta.existed_before {
            Some(
                self.read_before(id)?
                    .ok_or_else(|| format!("快照 {id} 缺少 before.md，无法回滚"))?,
            )
        } else {
            None
        };

        // 先给这次回滚留一份快照，保证「回滚也能再回滚」。
        let reason = format!("回滚快照 {id}");
        let payload = SnapshotPayload {
            path: &rel,
            operation: "rollback_write",
            actor,
            reason: Some(&reason),
            rollback_of: Some(id),
            before: before.as_deref(),
            after: restored.as_deref(),
        };
        let snapshot = self.create(&payload)?;

        // 再真正执行回滚。
        if meta.existed_before {
            let content = restored.unwrap_or_default();
            atomic_write_bytes(&target, content.as_bytes())?;
        } else {
            match std::fs::remove_file(&target) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(format!("删除 {rel} 失败: {e}")),
            }
        }
        Ok(RollbackOutcome {
            snapshot,
            rolled_back: id.to_string(),
            path: rel,
            deleted: !meta.existed_before,
        })
    }

    /// 快照记录的目标路径必须落在库根之内。
    fn target_path(&self, rel: &str) -> Result<PathBuf, String> {
        let rel = rel.trim();
        if rel.is_empty() {
            return Err("快照记录的目标路径为空".into());
        }
        let p = Path::new(rel);
        if p.is_absolute() {
            return Err(format!("快照记录的目标路径非法（绝对路径）: {rel}"));
        }
        for c in p.components() {
            match c {
                Component::ParentDir => {
                    return Err(format!("快照记录的目标路径非法（包含 `..`）: {rel}"))
                }
                Component::RootDir | Component::Prefix(_) => {
                    return Err(format!("快照记录的目标路径非法: {rel}"))
                }
                _ => {}
            }
        }
        Ok(self.library_root.join(p))
    }

    /// 按保留上限清理旧快照：数量上限 50、总量上限 100 MB，超出时删最旧的。
    pub fn prune(&self) -> Result<(), String> {
        let entries = match std::fs::read_dir(&self.root) {
            Ok(e) => e,
            Err(_) => return Ok(()),
        };
        let mut dirs: Vec<(String, PathBuf, u64)> = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if !is_valid_id(&name) {
                continue;
            }
            let size = dir_size(&path);
            dirs.push((name, path, size));
        }
        // 旧 → 新
        dirs.sort_by(|a, b| a.0.cmp(&b.0));
        let mut total: u64 = dirs.iter().map(|d| d.2).sum();
        let mut count = dirs.len();
        for (_, path, size) in dirs {
            if count <= MAX_SNAPSHOTS && total <= MAX_TOTAL_BYTES {
                break;
            }
            if std::fs::remove_dir_all(&path).is_ok() {
                total = total.saturating_sub(size);
                count -= 1;
            }
        }
        Ok(())
    }
}

/// 原子写：先写同目录临时文件，再 rename 覆盖目标。
///
/// 中途失败不会把原文件写坏——最坏情况是留下一个临时文件。
pub fn atomic_write_bytes(path: &Path, data: &[u8]) -> Result<(), String> {
    let dir = path
        .parent()
        .ok_or_else(|| format!("路径没有父目录: {}", path.display()))?;
    std::fs::create_dir_all(dir).map_err(|e| format!("无法创建目录 {}: {e}", dir.display()))?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "flymd".to_string());
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let tmp = dir.join(format!(".{name}.flymd-tmp-{}-{nanos}", std::process::id()));
    std::fs::write(&tmp, data).map_err(|e| format!("写入临时文件失败: {e}"))?;
    if let Err(e) = std::fs::rename(&tmp, path) {
        // 某些平台上 rename 不能覆盖已存在的文件，退化成「先删后改名」。
        let _ = std::fs::remove_file(path);
        if let Err(e2) = std::fs::rename(&tmp, path) {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!(
                "写入 {} 失败: {e}（重试仍失败: {e2}）",
                path.display()
            ));
        }
    }
    Ok(())
}

/// 写一个文件。
fn write_file(path: &Path, data: &[u8]) -> Result<(), String> {
    std::fs::write(path, data).map_err(|e| format!("写入 {} 失败: {e}", path.display()))
}

/// 目录占用的字节数。
fn dir_size(dir: &Path) -> u64 {
    let mut total = 0u64;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    total += meta.len();
                }
            }
        }
    }
    total
}

/// 快照 ID 是否合法（只允许字母数字、`-`、`_`，杜绝路径穿越）。
fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// 由系统纳秒 + 进程 ID 派生 6 位十六进制后缀（不引入 rand 依赖）。
fn random_suffix(attempt: u32) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u64)
        .unwrap_or(0);
    let pid = std::process::id() as u64;
    let mut x = nanos
        ^ pid.wrapping_mul(0x9E37_79B9_7F4A_7C15)
        ^ (attempt as u64).wrapping_mul(0x0000_0100_0000_01B3);
    // xorshift 混合，避免低位相关性。
    x ^= x >> 33;
    x = x.wrapping_mul(0xff51_afd7_ed55_8ccd);
    x ^= x >> 29;
    format!("{:06x}", x & 0x00FF_FFFF)
}

/// UTC 时间戳，`YYYYMMDDTHHMMSSZ`（快照 ID 用）。
fn timestamp_id(now: SystemTime) -> String {
    let (y, mo, d, h, mi, s) = utc_parts(now);
    format!("{y:04}{mo:02}{d:02}T{h:02}{mi:02}{s:02}Z")
}

/// UTC 时间戳，ISO8601（`createdAt` 用）。
fn timestamp_iso(now: SystemTime) -> String {
    let (y, mo, d, h, mi, s) = utc_parts(now);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z")
}

/// 拆分 UTC 时间。
fn utc_parts(now: SystemTime) -> (i64, u32, u32, u32, u32, u32) {
    let secs = now
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (y, mo, d) = crate::time::civil_from_days(days);
    (
        y,
        mo,
        d,
        (rem / 3600) as u32,
        ((rem % 3600) / 60) as u32,
        (rem % 60) as u32,
    )
}

/// SHA-256（纯 Rust 实现，不引入 sha2 依赖）。
///
/// 只用于快照内容指纹，但算法本身是标准 FIPS 180-4。
mod sha256 {
    /// 轮常量。
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];

    /// 计算 SHA-256 摘要，返回小写十六进制字符串。
    pub fn hex_digest(data: &[u8]) -> String {
        let mut out = String::with_capacity(64);
        for byte in digest(data) {
            out.push(char::from_digit((byte >> 4) as u32, 16).unwrap_or('0'));
            out.push(char::from_digit((byte & 0x0f) as u32, 16).unwrap_or('0'));
        }
        out
    }

    /// 计算 SHA-256 摘要。
    fn digest(data: &[u8]) -> [u8; 32] {
        let mut h: [u32; 8] = [
            0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
            0x5be0cd19,
        ];
        // 填充：补 0x80，补零到 56 字节（模 64），最后 8 字节是消息比特长度。
        let mut msg = data.to_vec();
        let bit_len = (data.len() as u64).wrapping_mul(8);
        msg.push(0x80);
        while msg.len() % 64 != 56 {
            msg.push(0);
        }
        msg.extend_from_slice(&bit_len.to_be_bytes());

        for chunk in msg.chunks(64) {
            let mut w = [0u32; 64];
            for (i, c) in chunk.chunks_exact(4).enumerate() {
                w[i] = u32::from_be_bytes([c[0], c[1], c[2], c[3]]);
            }
            for i in 16..64 {
                let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
                let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
                w[i] = w[i - 16]
                    .wrapping_add(s0)
                    .wrapping_add(w[i - 7])
                    .wrapping_add(s1);
            }
            let mut v = h;
            for (i, &ki) in K.iter().enumerate() {
                let s1 = v[4].rotate_right(6) ^ v[4].rotate_right(11) ^ v[4].rotate_right(25);
                let ch = (v[4] & v[5]) ^ ((!v[4]) & v[6]);
                let t1 = v[7]
                    .wrapping_add(s1)
                    .wrapping_add(ch)
                    .wrapping_add(ki)
                    .wrapping_add(w[i]);
                let s0 = v[0].rotate_right(2) ^ v[0].rotate_right(13) ^ v[0].rotate_right(22);
                let maj = (v[0] & v[1]) ^ (v[0] & v[2]) ^ (v[1] & v[2]);
                let t2 = s0.wrapping_add(maj);
                // 轮函数更新：h=g, g=f, f=e, e=d+T1, d=c, c=b, b=a, a=T1+T2
                v[7] = v[6];
                v[6] = v[5];
                v[5] = v[4];
                v[4] = v[3].wrapping_add(t1);
                v[3] = v[2];
                v[2] = v[1];
                v[1] = v[0];
                v[0] = t1.wrapping_add(t2);
            }
            for (hw, vw) in h.iter_mut().zip(v.iter()) {
                *hw = hw.wrapping_add(*vw);
            }
        }
        let mut out = [0u8; 32];
        for (i, word) in h.iter().enumerate() {
            out[i * 4..i * 4 + 4].copy_from_slice(&word.to_be_bytes());
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("flymd-mcp-guard-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    /// 造一个只有一篇笔记的临时库。
    fn library(tag: &str) -> PathBuf {
        let root = tmpdir(tag);
        std::fs::write(root.join("笔记.md"), "# 原内容\n").unwrap();
        root
    }

    fn payload<'a>(path: &'a str, before: Option<&'a str>, after: &'a str) -> SnapshotPayload<'a> {
        SnapshotPayload {
            path,
            operation: "write_note",
            actor: "mcp",
            reason: Some("测试"),
            rollback_of: None,
            before,
            after: Some(after),
        }
    }

    #[test]
    fn 快照目录结构与元数据字段符合规范() {
        let root = library("meta");
        let store = GuardStore::new(&root);
        let meta = store
            .create(&payload("笔记.md", Some("# 原内容\n"), "# 新内容\n"))
            .unwrap();

        // 目录布局：<库根>/.flymd/ai-guard/<id>/
        let dir = root.join(".flymd").join("ai-guard").join(&meta.id);
        assert!(dir.is_dir(), "快照目录应存在: {}", dir.display());
        assert!(dir.join("meta.json").is_file());
        assert!(dir.join("before.md").is_file());
        assert!(dir.join("after.md").is_file());

        // ID 形如 20261101T165300Z-a1b2c3
        assert!(meta.id.contains('T'), "ID 应含时间戳: {}", meta.id);
        let suffix = meta.id.rsplit('-').next().unwrap();
        assert_eq!(suffix.len(), 6, "后缀应为 6 位: {suffix}");
        assert!(suffix.chars().all(|c| c.is_ascii_hexdigit()));

        // meta.json 字段
        let raw = std::fs::read_to_string(dir.join("meta.json")).unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        for key in [
            "id",
            "createdAt",
            "operation",
            "actor",
            "path",
            "existedBefore",
            "beforeSha256",
            "afterSha256",
            "beforeBytes",
            "afterBytes",
            "reason",
            "rollbackOf",
        ] {
            assert!(v.get(key).is_some(), "meta.json 缺少字段 {key}");
        }
        assert_eq!(v["id"], meta.id);
        assert_eq!(v["operation"], "write_note");
        assert_eq!(v["actor"], "mcp");
        assert_eq!(v["path"], "笔记.md");
        assert_eq!(v["existedBefore"], true);
        assert_eq!(v["beforeBytes"], 12);
        assert_eq!(v["afterBytes"], 12);
        assert!(v["rollbackOf"].is_null());
        assert_eq!(
            v["beforeSha256"].as_str().unwrap().len(),
            64,
            "SHA-256 应为 64 位十六进制"
        );
        assert_ne!(v["beforeSha256"], v["afterSha256"]);
    }

    #[test]
    fn 写前不存在的文件不生成_before_md() {
        let root = library("nobefore");
        let store = GuardStore::new(&root);
        let meta = store
            .create(&payload("新笔记.md", None, "# 新建\n"))
            .unwrap();
        let dir = store.dir_of(&meta.id);
        assert!(
            !dir.join("before.md").exists(),
            "写前不存在时不该生成 before.md"
        );
        assert!(dir.join("after.md").exists());
        assert!(!meta.existed_before);
    }

    #[test]
    fn 回滚逐字节还原内容() {
        let root = library("restore");
        let original = "# 原内容\n\n带 空格\t与中文\n";
        std::fs::write(root.join("笔记.md"), original).unwrap();
        let store = GuardStore::new(&root);
        let meta = store
            .create(&payload("笔记.md", Some(original), "# 被改坏了\n"))
            .unwrap();
        std::fs::write(root.join("笔记.md"), "# 被改坏了\n").unwrap();

        store.rollback(&meta.id, false, "test").unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("笔记.md")).unwrap(),
            original,
            "回滚后应逐字节还原"
        );
    }

    #[test]
    fn 回滚不存在文件等于删除() {
        let root = library("delete");
        let store = GuardStore::new(&root);
        let meta = store
            .create(&payload("新笔记.md", None, "# 新建\n"))
            .unwrap();
        std::fs::write(root.join("新笔记.md"), "# 新建\n").unwrap();

        // 没确认时必须拒绝
        let err = store.rollback(&meta.id, false, "test").expect_err("应要求确认");
        assert!(err.contains("confirm"), "错误信息应说明需要确认: {err}");
        assert!(root.join("新笔记.md").exists(), "未确认时不该删除");

        store.rollback(&meta.id, true, "test").unwrap();
        assert!(!root.join("新笔记.md").exists(), "确认后应删除文件");
    }

    #[test]
    fn 回滚生成新快照且_rollback_of_正确() {
        let root = library("rollbackof");
        let store = GuardStore::new(&root);
        let meta = store
            .create(&payload("笔记.md", Some("# 原内容\n"), "# 新内容\n"))
            .unwrap();
        std::fs::write(root.join("笔记.md"), "# 新内容\n").unwrap();

        let outcome = store.rollback(&meta.id, false, "test").unwrap();
        assert_eq!(
            outcome.snapshot.rollback_of.as_deref(),
            Some(meta.id.as_str())
        );
        assert_eq!(outcome.snapshot.operation, "rollback_write");
        assert_ne!(outcome.snapshot.id, meta.id);

        // 回滚可以再回滚：再回滚一次应回到「被改坏」的内容
        store.rollback(&outcome.snapshot.id, false, "test").unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("笔记.md")).unwrap(),
            "# 新内容\n"
        );
    }

    #[test]
    fn 超过数量上限时清理最旧快照() {
        let root = library("prune");
        let store = GuardStore::new(&root);
        for i in 0..(MAX_SNAPSHOTS + 5) {
            store
                .create(&payload(
                    "笔记.md",
                    Some("# 原内容\n"),
                    &format!("# 第{i}次\n"),
                ))
                .unwrap();
        }
        let ids: Vec<String> = store.list(None).into_iter().map(|m| m.id).collect();
        assert_eq!(ids.len(), MAX_SNAPSHOTS, "快照数量应被限制在上限内");
        // 磁盘上的快照目录数应与列表一致（最旧的已被清理）
        let dirs = std::fs::read_dir(store.root()).unwrap().flatten().count();
        assert_eq!(dirs, MAX_SNAPSHOTS, "磁盘上的快照目录数应与上限一致");
    }

    #[test]
    fn 超过内容上限的快照标记截断且不可回滚() {
        let root = library("truncate");
        let store = GuardStore::new(&root);
        let big = "x".repeat(MAX_SNAPSHOT_BYTES + 1);
        let meta = store
            .create(&payload("大笔记.md", Some("# 原内容\n"), &big))
            .unwrap();
        assert!(meta.truncated, "超限快照应标记 truncated");
        let dir = store.dir_of(&meta.id);
        assert!(!dir.join("before.md").exists(), "截断后不该存内容文件");
        assert!(!dir.join("after.md").exists());
        assert_eq!(meta.after_bytes as usize, big.len());

        let err = store
            .rollback(&meta.id, true, "test")
            .expect_err("截断快照不可回滚");
        assert!(err.contains("截断"), "错误信息应说明原因: {err}");
    }

    #[test]
    fn 非法快照_id_被拒绝() {
        let root = library("badid");
        let store = GuardStore::new(&root);
        assert!(store.get("../../etc/passwd").is_err());
        assert!(store.get("..").is_err());
        assert!(store.read_before("../..").is_err());
    }

    #[test]
    fn sha256_标准向量正确() {
        assert_eq!(
            sha256::hex_digest(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256::hex_digest(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            sha256::hex_digest("你好，flymd".as_bytes()),
            sha256::hex_digest("你好，flymd".as_bytes())
        );
    }

    #[test]
    fn 原子写结果正确且不留临时文件() {
        let root = library("atomic");
        let target = root.join("新目录").join("笔记.md");
        atomic_write_bytes(&target, "# 内容\n".as_bytes()).unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "# 内容\n");
        let leftovers: Vec<String> = std::fs::read_dir(target.parent().unwrap())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.contains("flymd-tmp"))
            .collect();
        assert!(leftovers.is_empty(), "不该留下临时文件: {leftovers:?}");
    }
}
