//! 库根定位、文件索引与路径安全。
//!
//! 安全约束：**所有文件访问必须被限制在库根之内**。MCP 客户端会把用户输入
//! 原样传进来，`..` 穿越、绝对路径、指向库外的符号链接都必须被拒绝。

use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::config::McpConfig;

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

/// 遍历时跳过的文件名。
const SKIP_FILES: &[&str] = &[".DS_Store"];

/// 笔记扩展名。
const NOTE_EXTS: &[&str] = &["md", "markdown"];

/// 一个已解析的笔记库。
#[derive(Debug, Clone)]
pub struct Library {
    /// 已 canonicalize 的库根
    root: PathBuf,
    /// 目录排除配置
    config: McpConfig,
}

impl Library {
    /// 按优先级定位库根：`--library` > `FLYMD_LIBRARY` > 应用设置文件 > 当前目录。
    ///
    /// 定位完成后按 `内置默认 → 用户级配置 → 库级配置 → 环境变量 → 命令行`
    /// 的顺序**合并**目录排除规则。
    pub fn resolve(explicit: Option<&str>, cli_excludes: &[String]) -> Result<Self, String> {
        let root = Self::resolve_root(explicit)?;
        let config = crate::config::resolve(Some(&root), cli_excludes);
        Ok(Self { root, config })
    }

    /// 按优先级定位库根。
    fn resolve_root(explicit: Option<&str>) -> Result<PathBuf, String> {
        if let Some(p) = explicit {
            return Self::from_path(Path::new(p)).map(|l| l.root);
        }
        if let Ok(p) = std::env::var("FLYMD_LIBRARY") {
            if !p.trim().is_empty() {
                return Self::from_path(Path::new(p.trim())).map(|l| l.root);
            }
        }
        if let Some(p) = library_root_from_settings() {
            return Self::from_path(&p).map(|l| l.root);
        }
        let cwd = std::env::current_dir().map_err(|e| format!("无法获取当前目录: {e}"))?;
        if has_note(&cwd) {
            return Self::from_path(&cwd).map(|l| l.root);
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
        Ok(Self {
            root: canon,
            config: McpConfig::with_defaults(),
        })
    }

    /// 构造一个带指定排除配置的库（供测试与显式传参使用）。
    #[allow(dead_code)]
    pub fn with_config(p: &Path, config: McpConfig) -> Result<Self, String> {
        let mut lib = Self::from_path(p)?;
        lib.config = config;
        Ok(lib)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn config(&self) -> &McpConfig {
        &self.config
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
        // 落在被排除目录里的文件一律不开放读取——否则 AI 猜到路径仍能读到，
        // 排除就形同虚设。
        if self.config.is_excluded_file(&rel.replace('\\', "/")) {
            return Err(format!(
                "路径位于被排除的目录中，不对 MCP 客户端开放: {rel}\n\
                 提示：在 <库根>/.flymd/mcp.json 的 excludeDirs 里移除对应目录，或用 --exclude 覆盖。"
            ));
        }
        Ok(canon)
    }

    /// 递归索引库内所有笔记。
    ///
    /// 遍历时按相对路径判断目录排除，被排除的目录整棵跳过。
    pub fn notes(&self) -> Vec<NoteFile> {
        let mut out = Vec::new();
        // 队列元素：(绝对路径, 相对库根的路径)
        let mut dirs: Vec<(PathBuf, String)> = vec![(self.root.clone(), String::new())];
        while let Some((dir, dir_rel)) = dirs.pop() {
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
                    if ft.is_symlink() {
                        continue;
                    }
                    let child_rel = if dir_rel.is_empty() {
                        name.clone()
                    } else {
                        format!("{dir_rel}/{name}")
                    };
                    if self.config.is_excluded_dir(&child_rel) {
                        continue;
                    }
                    dirs.push((path, child_rel));
                    continue;
                }
                if !ft.is_file() {
                    continue;
                }
                if SKIP_FILES.contains(&name.as_str()) {
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

    /// 列出库内**实际被排除**的目录（相对库根的路径）。
    ///
    /// 用于启动日志与 `--print-config`：让「哪些目录没进 AI 视野」是可自查的，
    /// 而不是黑箱。
    pub fn excluded_dirs(&self) -> Vec<String> {
        let mut out = Vec::new();
        let mut dirs: Vec<(PathBuf, String)> = vec![(self.root.clone(), String::new())];
        while let Some((dir, dir_rel)) = dirs.pop() {
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
                if !ft.is_dir() || ft.is_symlink() {
                    continue;
                }
                let child_rel = if dir_rel.is_empty() {
                    name.clone()
                } else {
                    format!("{dir_rel}/{name}")
                };
                if self.config.is_excluded_dir(&child_rel) {
                    out.push(child_rel);
                    continue;
                }
                dirs.push((path, child_rel));
            }
        }
        out.sort();
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

    /// 构造一个带 `media/`、`附件/` 子目录的测试库。
    fn exclude_fixture(tag: &str) -> PathBuf {
        let root = tmpdir(tag);
        std::fs::write(root.join("真笔记.md"), "# 真笔记\n").unwrap();
        std::fs::create_dir_all(root.join("media/88-Template")).unwrap();
        std::fs::write(
            root.join("media/88-Template/simple.md"),
            "# 模板\n\n- [ ] 红薯订阅\n",
        )
        .unwrap();
        std::fs::create_dir_all(root.join("附件")).unwrap();
        std::fs::write(root.join("附件/图片说明.md"), "# 说明\n").unwrap();
        std::fs::create_dir_all(root.join("子目录/media")).unwrap();
        std::fs::write(root.join("子目录/media/深层.md"), "# 深层\n").unwrap();
        std::fs::create_dir_all(root.join("正常目录")).unwrap();
        std::fs::write(root.join("正常目录/笔记.md"), "# 正常\n").unwrap();
        root
    }

    #[test]
    fn 被排除目录不进索引() {
        let root = exclude_fixture("excl-index");
        let lib = Library::with_config(&root, McpConfig::with_defaults()).unwrap();
        let names: Vec<String> = lib.notes().into_iter().map(|n| n.rel).collect();

        assert!(names.iter().any(|x| x == "真笔记.md"));
        assert!(names.iter().any(|x| x == "正常目录/笔记.md"));
        assert!(
            !names.iter().any(|n| n.starts_with("media/")),
            "media 目录不该出现在索引里，实际: {names:?}"
        );
        assert!(
            !names.iter().any(|n| n.starts_with("附件/")),
            "附件目录不该出现在索引里，实际: {names:?}"
        );
    }

    #[test]
    fn 嵌套层级里的同名目录也被排除() {
        let root = exclude_fixture("excl-nested");
        let lib = Library::with_config(&root, McpConfig::with_defaults()).unwrap();
        let names: Vec<String> = lib.notes().into_iter().map(|n| n.rel).collect();
        assert!(
            !names.iter().any(|n| n.contains("/media/")),
            "任意层级的 media 都该被排除，实际: {names:?}"
        );
    }

    #[test]
    fn 被排除目录里的文件不可读() {
        let root = exclude_fixture("excl-read");
        let lib = Library::with_config(&root, McpConfig::with_defaults()).unwrap();
        let err = lib
            .read_note("media/88-Template/simple.md")
            .expect_err("被排除的模板不该能读到");
        assert!(err.contains("被排除"), "错误信息应说明被排除，实际: {err}");
    }

    #[test]
    fn allow_豁免后目录重新可见() {
        let root = exclude_fixture("excl-allow");
        let mut cfg = McpConfig::with_defaults();
        cfg.allow.push("media/88-Template".to_string());
        let lib = Library::with_config(&root, cfg).unwrap();
        let names: Vec<String> = lib.notes().into_iter().map(|n| n.rel).collect();
        assert!(
            names.iter().any(|x| x == "media/88-Template/simple.md"),
            "allow 豁免后应重新可见，实际: {names:?}"
        );
    }

    #[test]
    fn 排除目录清单可自查() {
        let root = exclude_fixture("excl-list");
        let lib = Library::with_config(&root, McpConfig::with_defaults()).unwrap();
        let dirs = lib.excluded_dirs();
        assert!(dirs.contains(&"media".to_string()), "实际: {dirs:?}");
        assert!(dirs.contains(&"附件".to_string()), "实际: {dirs:?}");
        assert!(dirs.contains(&"子目录/media".to_string()), "实际: {dirs:?}");
    }

    #[test]
    fn 自定义排除规则生效() {
        let root = exclude_fixture("excl-custom");
        let mut cfg = McpConfig::default();
        cfg.push_exclude("正常目录");
        let lib = Library::with_config(&root, cfg).unwrap();
        let names: Vec<String> = lib.notes().into_iter().map(|n| n.rel).collect();
        assert!(!names.iter().any(|x| x == "正常目录/笔记.md"), "实际: {names:?}");
        // 默认规则不在自定义配置里，media 仍然可见
        assert!(names.iter().any(|x| x == "media/88-Template/simple.md"), "实际: {names:?}");
    }
}
