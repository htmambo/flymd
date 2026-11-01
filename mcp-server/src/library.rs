//! 库根定位、文件索引与路径安全。
//!
//! 安全约束：**所有文件访问必须被限制在库根之内**。MCP 客户端会把用户输入
//! 原样传进来，`..` 穿越、绝对路径、指向库外的符号链接都必须被拒绝。

use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// 单个笔记的索引条目。
#[derive(Debug, Clone)]
pub struct NoteFile {
    /// 相对库根的路径（统一用 `/` 分隔）
    pub rel: String,
    pub abs: PathBuf,
    pub size: u64,
    pub modified: Option<SystemTime>,
}

/// 单个笔记的读取上限，避免误读超大文件把客户端上下文打爆。
const MAX_NOTE_BYTES: u64 = 4 * 1024 * 1024;

/// 遍历时跳过的目录名。
const SKIP_DIRS: &[&str] = &[
    ".git",
    ".flymd",
    ".obsidian",
    ".trash",
    ".DS_Store",
    "node_modules",
    "target",
    "dist",
];

/// 笔记扩展名。
const NOTE_EXTS: &[&str] = &["md", "markdown"];

/// 一个已解析的笔记库。
#[derive(Debug, Clone)]
pub struct Library {
    /// 已 canonicalize 的库根
    root: PathBuf,
}

impl Library {
    /// 按优先级定位库根：`--library` > `FLYMD_LIBRARY` > 应用设置文件 > 当前目录。
    pub fn resolve(explicit: Option<&str>) -> Result<Self, String> {
        if let Some(p) = explicit {
            return Self::from_path(Path::new(p));
        }
        if let Ok(p) = std::env::var("FLYMD_LIBRARY") {
            if !p.trim().is_empty() {
                return Self::from_path(Path::new(p.trim()));
            }
        }
        if let Some(p) = library_root_from_settings() {
            return Self::from_path(&p);
        }
        let cwd = std::env::current_dir().map_err(|e| format!("无法获取当前目录: {e}"))?;
        if has_note(&cwd) {
            return Self::from_path(&cwd);
        }
        Err(
            "未能定位笔记库。请用 --library <路径> 指定，或设置环境变量 FLYMD_LIBRARY。\n\
             提示：在 flymd 应用内打开库后，库根路径可在「库设置」中看到。"
                .into(),
        )
    }

    pub(crate) fn from_path(p: &Path) -> Result<Self, String> {
        let canon = p
            .canonicalize()
            .map_err(|e| format!("无法访问库路径 {}: {e}", p.display()))?;
        if !canon.is_dir() {
            return Err(format!("库路径不是目录: {}", canon.display()));
        }
        Ok(Self { root: canon })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// 把客户端传入的相对路径解析为库内的绝对路径，并做越界防护。
    pub fn resolve_relative(&self, rel: &str) -> Result<PathBuf, String> {
        let rel = rel.trim();
        if rel.is_empty() {
            return Err("路径不能为空".into());
        }
        let p = Path::new(rel);
        if p.is_absolute() {
            return Err(format!("路径必须是相对于库根的相对路径，收到绝对路径: {rel}"));
        }
        for c in p.components() {
            match c {
                Component::ParentDir => {
                    return Err(format!("路径不允许包含 `..`：{rel}"));
                }
                Component::RootDir | Component::Prefix(_) => {
                    return Err(format!("非法路径: {rel}"));
                }
                _ => {}
            }
        }
        let joined = self.root.join(p);
        let canon = joined
            .canonicalize()
            .map_err(|e| format!("无法访问 {rel}: {e}"))?;
        if !canon.starts_with(&self.root) {
            return Err(format!("路径越出库根范围: {rel}"));
        }
        Ok(canon)
    }

    /// 递归索引库内所有笔记。
    pub fn notes(&self) -> Vec<NoteFile> {
        let mut out = Vec::new();
        let mut dirs = vec![self.root.clone()];
        while let Some(dir) = dirs.pop() {
            let entries = match std::fs::read_dir(&dir) {
                Ok(e) => e,
                Err(_) => continue,
            };
            for entry in entries.flatten() {
                let path = entry.path();
                let name = entry.file_name().to_string_lossy().to_string();
                let ft = match entry.file_type() {
                    Ok(t) => t,
                    Err(_) => continue,
                };
                if ft.is_dir() {
                    // 不跟随符号链接目录，避免环路
                    if ft.is_symlink() || SKIP_DIRS.contains(&name.as_str()) {
                        continue;
                    }
                    dirs.push(path);
                    continue;
                }
                if !ft.is_file() {
                    continue;
                }
                let ext = path
                    .extension()
                    .map(|e| e.to_string_lossy().to_lowercase())
                    .unwrap_or_default();
                if !NOTE_EXTS.contains(&ext.as_str()) {
                    continue;
                }
                let meta = match entry.metadata() {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                let rel = match path.strip_prefix(&self.root) {
                    Ok(r) => r.to_string_lossy().replace('\\', "/"),
                    Err(_) => continue,
                };
                out.push(NoteFile {
                    rel,
                    abs: path,
                    size: meta.len(),
                    modified: meta.modified().ok(),
                });
            }
        }
        out.sort_by(|a, b| a.rel.cmp(&b.rel));
        out
    }

    /// 读取单个笔记内容（带体积上限）。
    pub fn read_note(&self, rel: &str) -> Result<String, String> {
        let abs = self.resolve_relative(rel)?;
        let meta = std::fs::metadata(&abs).map_err(|e| format!("无法读取 {rel}: {e}"))?;
        if meta.len() > MAX_NOTE_BYTES {
            return Err(format!(
                "{rel} 过大（{:.1} MB），超过 {} MB 上限",
                meta.len() as f64 / 1048576.0,
                MAX_NOTE_BYTES / 1048576
            ));
        }
        std::fs::read_to_string(&abs).map_err(|e| format!("无法读取 {rel}: {e}"))
    }

    /// 库内所有笔记中，出现过 `[[目标]]` 的来源列表。
    ///
    /// 按目标名匹配，忽略大小写与扩展名差异（`笔记` 匹配 `笔记.md`）。
    pub fn backlinks(&self, target: &str) -> Vec<(String, usize, String)> {
        let want = normalize_link_key(target);
        let mut out = Vec::new();
        for note in self.notes() {
            if note.size > MAX_NOTE_BYTES {
                continue;
            }
            let content = match std::fs::read_to_string(&note.abs) {
                Ok(c) => c,
                Err(_) => continue,
            };
            for link in crate::parse::extract_wikilinks(&content) {
                if normalize_link_key(&link.target) == want {
                    let text = content
                        .lines()
                        .nth(link.line.saturating_sub(1))
                        .unwrap_or("")
                        .trim()
                        .to_string();
                    out.push((note.rel.clone(), link.line, text));
                }
            }
        }
        out
    }
}

/// 把 Unix 时间戳格式化为 `YYYY-MM-DD HH:MM`（UTC）。
///
/// 不引入 chrono 等依赖：只用于列表里展示修改时间，精度到分钟足够。
pub fn format_time(t: SystemTime) -> String {
    let secs = t
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02} {:02}:{:02}",
        rem / 3600,
        (rem % 3600) / 60
    )
}

/// 从「自 1970-01-01 起的天数」反推公历日期（Howard Hinnant 算法）。
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// 双链目标归一化：去扩展名、去首尾空白、转小写。
fn normalize_link_key(s: &str) -> String {
    let s = s.trim();
    let stem = match s.rsplit_once('.') {
        Some((base, ext)) if NOTE_EXTS.contains(&ext.to_lowercase().as_str()) => base,
        _ => s,
    };
    stem.trim().to_lowercase()
}

/// 从应用设置文件里读库根。
fn library_root_from_settings() -> Option<PathBuf> {
    for path in settings_candidates() {
        let raw = match std::fs::read_to_string(&path) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let v: serde_json::Value = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(root) = pick_library_root(&v) {
            return Some(PathBuf::from(root));
        }
    }
    None
}

/// 从 store 内容里挑出库根：优先 `activeLibraryId` 对应项，其次 `libraryRoot`。
fn pick_library_root(v: &serde_json::Value) -> Option<String> {
    let active = v.get("activeLibraryId").and_then(|x| x.as_str());
    if let (Some(active), Some(list)) = (
        active,
        v.get("libraries").and_then(|x| x.as_array()),
    ) {
        for lib in list {
            if lib.get("id").and_then(|x| x.as_str()) == Some(active) {
                if let Some(root) = lib.get("root").and_then(|x| x.as_str()) {
                    if !root.is_empty() {
                        return Some(root.to_string());
                    }
                }
            }
        }
    }
    v.get("libraryRoot")
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// 应用设置文件的候选路径（按平台）。
fn settings_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"));
    if let Some(home) = home {
        let home = PathBuf::from(home);
        // macOS
        out.push(home.join("Library/Application Support/com.flymd/flymd-settings.json"));
        // Linux
        if let Some(xdg) = std::env::var_os("XDG_CONFIG_HOME") {
            out.push(PathBuf::from(xdg).join("com.flymd/flymd-settings.json"));
        }
        out.push(home.join(".config/com.flymd/flymd-settings.json"));
        // Windows
        if let Some(appdata) = std::env::var_os("APPDATA") {
            out.push(PathBuf::from(appdata).join("com.flymd/flymd-settings.json"));
        }
    }
    // 便携模式：配置写在可执行文件同级目录
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            out.push(dir.join("flymd-settings.json"));
        }
    }
    // 当前目录
    out.push(PathBuf::from("flymd-settings.json"));
    out
}

/// 目录是否包含笔记文件（用于 cwd 兜底）。
fn has_note(dir: &Path) -> bool {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return false,
    };
    entries.flatten().any(|e| {
        let path = e.path();
        if !path.is_file() {
            return false;
        }
        path.extension()
            .map(|x| x.to_string_lossy().to_lowercase())
            .map(|x| NOTE_EXTS.contains(&x.as_str()))
            .unwrap_or(false)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("flymd-mcp-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn 索引收集笔记并跳过忽略目录() {
        let root = tmpdir("index");
        std::fs::write(root.join("a.md"), "# A").unwrap();
        std::fs::write(root.join("b.markdown"), "# B").unwrap();
        std::fs::write(root.join("c.txt"), "not a note").unwrap();
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::write(root.join(".git/hidden.md"), "# hidden").unwrap();

        let lib = Library::from_path(&root).unwrap();
        let notes = lib.notes();
        let names: Vec<&str> = notes.iter().map(|n| n.rel.as_str()).collect();
        assert_eq!(names, vec!["a.md", "b.markdown"]);
    }

    #[test]
    fn 拒绝越界路径() {
        let root = tmpdir("escape");
        std::fs::write(root.join("ok.md"), "ok").unwrap();
        let lib = Library::from_path(&root).unwrap();

        assert!(lib.resolve_relative("../secret.md").is_err());
        assert!(lib.resolve_relative("/etc/passwd").is_err());
        assert!(lib.resolve_relative("").is_err());
        assert!(lib.resolve_relative("ok.md").is_ok());
    }

    #[test]
    fn 拒绝指向库外的符号链接() {
        let root = tmpdir("symlink");
        let outside = tmpdir("outside");
        std::fs::write(outside.join("secret.md"), "secret").unwrap();
        std::fs::write(root.join("ok.md"), "ok").unwrap();

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(outside.join("secret.md"), root.join("link.md")).unwrap();
            let lib = Library::from_path(&root).unwrap();
            assert!(
                lib.resolve_relative("link.md").is_err(),
                "指向库外的符号链接必须被拒绝"
            );
        }
    }

    #[test]
    fn 读取超限文件被拦截() {
        let root = tmpdir("big");
        let big = vec![b'x'; (MAX_NOTE_BYTES + 1) as usize];
        std::fs::write(root.join("big.md"), &big).unwrap();
        let lib = Library::from_path(&root).unwrap();
        assert!(lib.read_note("big.md").is_err());
    }

    #[test]
    fn 反链按归一化目标匹配() {
        let root = tmpdir("backlink");
        std::fs::write(root.join("source.md"), "见 [[目标笔记]] 与 [[另一篇#小节]]\n").unwrap();
        std::fs::write(root.join("target.md"), "# 目标笔记\n").unwrap();
        let lib = Library::from_path(&root).unwrap();

        let bl = lib.backlinks("目标笔记");
        assert_eq!(bl.len(), 1);
        assert_eq!(bl[0].0, "source.md");

        // 目标写作带扩展名也应命中
        assert_eq!(lib.backlinks("目标笔记.md").len(), 1);
    }

    #[test]
    fn 设置文件优先取活跃库() {
        let v: serde_json::Value = serde_json::json!({
            "libraryRoot": "/tmp/a",
            "activeLibraryId": "lib-2",
            "libraries": [
                {"id": "lib-1", "root": "/tmp/one"},
                {"id": "lib-2", "root": "/tmp/two"}
            ]
        });
        assert_eq!(pick_library_root(&v).as_deref(), Some("/tmp/two"));
    }
}
