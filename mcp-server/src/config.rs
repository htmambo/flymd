//! MCP 服务器的目录排除配置。
//!
//! 背景：Obsidian 库里的 `media/`、`assets/`、`templates/` 这类目录装的是
//! **附件和模板**，不是笔记。把它们喂给 AI 会污染搜索、待办和列表结果——
//! 比如模板里的 `- [ ] 红薯订阅` 会被当成用户的真待办。
//!
//! 配置来源（按优先级从低到高，**合并**而非替换）：
//! 1. 内置默认：技术目录 + 常见资源/模板目录
//! 2. 用户级配置：`~/.config/com.flymd/ai-scope.json`（不随库同步）
//! 3. 库级配置：`<库根>/.flymd/ai-scope.json`（随库走、随 WebDAV 同步）
//! 4. 环境变量 `FLYMD_MCP_EXCLUDE`（逗号分隔）
//! 5. 命令行 `--exclude <dir>`（可重复）
//!
//! **兼容旧名**：早期这套规则只服务 MCP，配置文件叫 `mcp.json`。现在它同时管
//! 应用内的 AI 通道（recipes 的全库扫描、RAG 知识库、插件的库内读写），名字
//! 改成更通用的 `ai-scope.json`；但**旧文件仍然继续读取并生效**——用户已有的
//! `mcp.json` 不会因为改名而失效。两个文件都读，都合并进同一份规则。
//!
//! 匹配语义：
//! - 模式**不含** `/` → 按**目录名**匹配，任意层级都命中（`media` 命中 `a/b/media`）
//! - 模式**含** `/` → 按**相对库根的路径前缀**匹配（`Personal/media` 只命中这一处）
//! - 大小写不敏感
//! - `allowDirs` 优先于 `excludeDirs`：路径前缀命中 allow 时不排除
//!
//! 这份规则是**全应用唯一**的排除实现：MCP 服务器、桌面应用的 Rust 命令
//! （`flymd_list_markdown_files`）、宿主给插件的库内读写入口，都走这里。

use std::path::{Path, PathBuf};

/// 内置默认排除项：技术目录 + 常见资源/模板目录。
const DEFAULT_EXCLUDE: &[&str] = &[
    // 技术目录
    ".git",
    ".hg",
    ".svn",
    ".node_modules",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".vite",
    ".obsidian",
    ".trash",
    ".flymd",
    "ebwebview",
    "code cache",
    "gpucache",
    "service worker",
    // 附件 / 资源 / 模板目录（Obsidian 惯例）
    "media",
    "assets",
    "asset",
    "attachment",
    "attachments",
    "templates",
    "template",
    "excalidraw",
    ".excalidraw",
    "附件",
    "模板",
];

/// 生效的排除配置。
#[derive(Debug, Clone, Default)]
pub struct McpConfig {
    /// 排除规则：目录名或相对路径前缀
    pub exclude: Vec<String>,
    /// 强制保留规则：相对路径前缀，优先于 exclude
    pub allow: Vec<String>,
}

impl McpConfig {
    /// 构造只含内置默认的配置。
    pub fn with_defaults() -> Self {
        Self {
            exclude: DEFAULT_EXCLUDE.iter().map(|s| s.to_string()).collect(),
            allow: Vec::new(),
        }
    }

    /// 合并另一份配置（并集）。
    pub fn merge(&mut self, other: &McpConfig) {
        for e in &other.exclude {
            if !self.exclude.iter().any(|x| x.eq_ignore_ascii_case(e)) {
                self.exclude.push(e.clone());
            }
        }
        for a in &other.allow {
            if !self.allow.iter().any(|x| x.eq_ignore_ascii_case(a)) {
                self.allow.push(a.clone());
            }
        }
    }

    /// 追加一条排除规则。
    pub fn push_exclude(&mut self, pattern: &str) {
        let p = pattern.trim();
        if p.is_empty() {
            return;
        }
        if !self.exclude.iter().any(|x| x.eq_ignore_ascii_case(p)) {
            self.exclude.push(p.to_string());
        }
    }

    /// 判断某个**目录**（相对库根，如 `media/88-Template`）是否应被排除。
    pub fn is_excluded_dir(&self, rel_dir: &str) -> bool {
        let lower = rel_dir.trim().trim_matches('/').to_lowercase();
        if lower.is_empty() {
            return false;
        }
        // allow 优先：命中 allow 的目录、allow 目录之下的子目录，都不排除。
        for a in &self.allow {
            let al = a.trim().trim_matches('/').to_lowercase();
            if al.is_empty() {
                continue;
            }
            if lower == al || lower.starts_with(&format!("{al}/")) {
                return false;
            }
            // allow 路径的祖先目录不能排除——否则遍历到它就停了，
            // 永远走不到被豁免的那个子目录。
            if al.starts_with(&format!("{lower}/")) {
                return false;
            }
        }
        for e in &self.exclude {
            let el = e.trim().trim_matches('/').to_lowercase();
            if el.is_empty() {
                continue;
            }
            if el.contains('/') {
                // 路径前缀
                if lower == el || lower.starts_with(&format!("{el}/")) {
                    return true;
                }
            } else if lower.split('/').any(|seg| seg == el) {
                // 目录名，任意层级
                return true;
            }
        }
        false
    }

    /// 判断某个**文件**（相对库根，如 `media/a.md`）是否落在被排除的目录里。
    pub fn is_excluded_file(&self, rel_file: &str) -> bool {
        let p = Path::new(rel_file.trim().trim_matches('/'));
        let parent = match p.parent() {
            Some(x) if !x.as_os_str().is_empty() => x,
            _ => return false,
        };
        let rel_parent = parent.to_string_lossy().replace('\\', "/");
        self.is_excluded_dir(&rel_parent)
    }

    /// 批量判断：给一批相对库根的文件路径，返回其中**被排除**的那些。
    ///
    /// 桌面应用侧用它给插件做批量过滤——一次 IPC 判定一批，
    /// 规则仍然只有这一份实现（应用侧不另写一份匹配逻辑）。
    pub fn filter_excluded_files(&self, rel_paths: &[String]) -> Vec<String> {
        let mut out = Vec::new();
        for p in rel_paths {
            let rel = p.replace('\\', "/");
            if self.is_excluded_file(&rel) {
                out.push(rel);
            }
        }
        out
    }
}

/// 从配置文件读取（JSON）。文件不存在或解析失败都不报错，返回空配置。
fn read_config_file(path: &Path) -> McpConfig {
    let mut cfg = McpConfig::default();
    let raw = match std::fs::read_to_string(path) {
        Ok(r) => r,
        Err(_) => return cfg,
    };
    let v: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return cfg,
    };
    // 兼容 `excludeDirs` / `exclude` 两种键名
    for key in ["excludeDirs", "exclude"] {
        if let Some(arr) = v.get(key).and_then(|x| x.as_array()) {
            for it in arr {
                if let Some(s) = it.as_str() {
                    let t = s.trim();
                    if !t.is_empty() {
                        cfg.exclude.push(t.to_string());
                    }
                }
            }
        }
    }
    // 兼容 `allowDirs` / `allow` 两种键名
    for key in ["allowDirs", "allow"] {
        if let Some(arr) = v.get(key).and_then(|x| x.as_array()) {
            for it in arr {
                if let Some(s) = it.as_str() {
                    let t = s.trim();
                    if !t.is_empty() {
                        cfg.allow.push(t.to_string());
                    }
                }
            }
        }
    }
    cfg
}

/// 通用配置文件名（新）：这套规则现在管的不只是 MCP。
pub const CONFIG_FILE_NAME: &str = "ai-scope.json";

/// 旧配置文件名（兼容）：早期只服务 MCP 时叫这个。
pub const LEGACY_CONFIG_FILE_NAME: &str = "mcp.json";

/// 用户级配置路径（不随库走）。
///
/// 返回**所有**候选路径（通用名优先，旧名在后）——旧文件继续生效。
pub fn user_config_paths() -> Vec<PathBuf> {
    let home = match std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
        Some(h) => PathBuf::from(h),
        None => return Vec::new(),
    };
    let mut dirs: Vec<PathBuf> = Vec::new();
    // macOS
    dirs.push(home.join("Library/Application Support/com.flymd"));
    // Linux
    if let Some(xdg) = std::env::var_os("XDG_CONFIG_HOME") {
        dirs.push(PathBuf::from(xdg).join("com.flymd"));
    }
    dirs.push(home.join(".config/com.flymd"));
    // Windows
    if let Some(appdata) = std::env::var_os("APPDATA") {
        dirs.push(PathBuf::from(appdata).join("com.flymd"));
    }

    let mut out = Vec::new();
    for dir in dirs {
        out.push(dir.join(CONFIG_FILE_NAME));
        out.push(dir.join(LEGACY_CONFIG_FILE_NAME));
    }
    out
}

/// 库级配置路径（随库走，随 WebDAV 同步）。
///
/// 返回**所有**候选路径（通用名优先，旧名在后）——旧文件继续生效。
pub fn library_config_paths(library_root: &Path) -> Vec<PathBuf> {
    let dir = library_root.join(".flymd");
    vec![
        dir.join(CONFIG_FILE_NAME),
        dir.join(LEGACY_CONFIG_FILE_NAME),
    ]
}

/// 库级配置路径（**通用名**）。
///
/// 只关心单个文件时用这个；要连旧名一起兼容，请用 [`library_config_paths`]。
pub fn library_config_path(library_root: &Path) -> PathBuf {
    library_root.join(".flymd").join(CONFIG_FILE_NAME)
}

/// 组装最终生效配置。
///
/// `library_root` 为 None 时跳过库级配置（此时尚未定位到库）。
pub fn resolve(library_root: Option<&Path>, cli_excludes: &[String]) -> McpConfig {
    let mut cfg = McpConfig::with_defaults();

    for p in user_config_paths() {
        cfg.merge(&read_config_file(&p));
    }
    if let Some(root) = library_root {
        for p in library_config_paths(root) {
            cfg.merge(&read_config_file(&p));
        }
    }
    // 环境变量
    if let Ok(env) = std::env::var("FLYMD_MCP_EXCLUDE") {
        for part in env.split([',', ';']) {
            cfg.push_exclude(part);
        }
    }
    // 命令行（最高优先级）
    for e in cli_excludes {
        cfg.push_exclude(e);
    }
    cfg
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 默认排除_media_目录名_任意层级命中() {
        let cfg = McpConfig::with_defaults();
        assert!(cfg.is_excluded_dir("media"));
        assert!(cfg.is_excluded_dir("media/88-Template"));
        assert!(cfg.is_excluded_dir("a/b/media"));
        assert!(cfg.is_excluded_dir("a/b/media/deep"));
    }

    #[test]
    fn 默认不排除普通笔记目录() {
        let cfg = McpConfig::with_defaults();
        assert!(!cfg.is_excluded_dir("个人"));
        assert!(!cfg.is_excluded_dir("个人/AI"));
        assert!(!cfg.is_excluded_dir("网络收藏"));
    }

    #[test]
    fn 含斜杠的模式只按路径前缀匹配() {
        let mut cfg = McpConfig::default();
        cfg.push_exclude("Personal/media");
        assert!(cfg.is_excluded_dir("Personal/media"));
        assert!(cfg.is_excluded_dir("Personal/media/sub"));
        assert!(!cfg.is_excluded_dir("Other/media"), "别处的 media 不该被路径前缀规则命中");
        assert!(!cfg.is_excluded_dir("Personal/notes"));
    }

    #[test]
    fn allow_优先于_exclude() {
        let mut cfg = McpConfig::with_defaults();
        cfg.allow.push("media/重要笔记".to_string());
        assert!(!cfg.is_excluded_dir("media/重要笔记"));
        assert!(cfg.is_excluded_dir("media/其他"), "allow 只豁免它自己的前缀");
    }

    #[test]
    fn allow_路径的祖先目录不下钻拦截() {
        let mut cfg = McpConfig::with_defaults();
        cfg.allow.push("media/重要笔记".to_string());
        // 祖先必须放行，否则遍历停在 media，永远到不了豁免的子目录
        assert!(!cfg.is_excluded_dir("media"));
        assert!(!cfg.is_excluded_dir("media/重要笔记/更深层"));
        // 但同级的其它目录仍然排除
        assert!(cfg.is_excluded_dir("media/其他"));
    }

    #[test]
    fn 文件排除看父目录() {
        let cfg = McpConfig::with_defaults();
        assert!(cfg.is_excluded_file("media/88-Template/simple.md"));
        assert!(cfg.is_excluded_file("media/x.md"));
        assert!(!cfg.is_excluded_file("个人/笔记.md"));
        assert!(!cfg.is_excluded_file("顶层.md"));
    }

    #[test]
    fn 大小写不敏感() {
        let cfg = McpConfig::with_defaults();
        assert!(cfg.is_excluded_dir("Media"));
        assert!(cfg.is_excluded_dir("MEDIA/Sub"));
    }

    #[test]
    fn 合并去重() {
        let mut a = McpConfig::default();
        a.push_exclude("x");
        a.push_exclude("X");
        assert_eq!(a.exclude.len(), 1);
        let mut b = McpConfig::default();
        b.push_exclude("y");
        a.merge(&b);
        assert_eq!(a.exclude.len(), 2);
    }

    #[test]
    fn 读取配置文件() {
        let dir = std::env::temp_dir().join(format!("flymd-cfg-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("mcp.json");
        std::fs::write(&p, r#"{"excludeDirs":["media","我的附件"],"allowDirs":["media/keep"]}"#).unwrap();
        let cfg = read_config_file(&p);
        assert_eq!(cfg.exclude.len(), 2);
        assert_eq!(cfg.allow.len(), 1);
        assert!(cfg.is_excluded_dir("我的附件"));
        assert!(!cfg.is_excluded_dir("media/keep"));
    }

    #[test]
    fn 配置文件缺失时返回空配置() {
        let cfg = read_config_file(Path::new("/nonexistent/path/mcp.json"));
        assert!(cfg.exclude.is_empty());
        assert!(cfg.allow.is_empty());
    }

    #[test]
    fn 库级配置与命令行合并生效() {
        let root = std::env::temp_dir().join(format!("flymd-cfg-lib-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join(".flymd")).unwrap();
        std::fs::write(
            root.join(".flymd/mcp.json"),
            r#"{"excludeDirs":["我的草稿"],"allowDirs":["media/保留"]}"#,
        )
        .unwrap();

        let cli = vec!["命令行目录".to_string()];
        let cfg = resolve(Some(&root), &cli);

        assert!(cfg.is_excluded_dir("我的草稿"), "库级配置应生效");
        assert!(cfg.is_excluded_dir("命令行目录"), "命令行应生效");
        assert!(cfg.is_excluded_dir("media/其他"), "内置默认仍生效");
        assert!(!cfg.is_excluded_dir("media/保留"), "allow 应豁免");
        // media 是 allow 路径的祖先，必须放行才能下钻到豁免目标
        assert!(!cfg.is_excluded_dir("media"));
        assert!(cfg.exclude.iter().any(|e| e == "media"), "内置默认应在列表里");
    }

    #[test]
    fn 库级配置路径在_dot_flymd_下() {
        let p = library_config_path(Path::new("/tmp/lib"));
        assert!(p.ends_with(".flymd/ai-scope.json"));
    }

    #[test]
    fn 通用配置文件名与旧名都读_旧名不失效() {
        let root = std::env::temp_dir().join(format!("flymd-cfg-compat-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join(".flymd")).unwrap();

        // 旧名文件：继续生效
        std::fs::write(
            root.join(".flymd/mcp.json"),
            r#"{"excludeDirs":["旧名目录"]}"#,
        )
        .unwrap();
        // 新名文件：也生效
        std::fs::write(
            root.join(".flymd/ai-scope.json"),
            r#"{"excludeDirs":["新名目录"]}"#,
        )
        .unwrap();

        let cfg = resolve(Some(&root), &[]);
        assert!(cfg.is_excluded_dir("旧名目录"), "旧配置文件必须继续生效");
        assert!(cfg.is_excluded_dir("新名目录"), "新配置文件必须生效");
        assert!(cfg.is_excluded_dir("media"), "内置默认仍生效");
    }

    #[test]
    fn 库级配置候选路径含新旧两个名字() {
        let paths = library_config_paths(Path::new("/tmp/lib"));
        assert_eq!(paths.len(), 2);
        assert!(paths[0].ends_with(".flymd/ai-scope.json"), "通用名优先");
        assert!(paths[1].ends_with(".flymd/mcp.json"), "旧名兼容");
    }

    #[test]
    fn 批量过滤返回被排除的路径() {
        let cfg = McpConfig::with_defaults();
        let input = vec![
            "日记/今天.md".to_string(),
            "media/88-Template/simple.md".to_string(),
            "media/test/x.md".to_string(),
            "a/b/media/deep.md".to_string(),
            "顶层.md".to_string(),
        ];
        let blocked = cfg.filter_excluded_files(&input);
        assert_eq!(blocked.len(), 3, "media 下的与深层 media 都该被排除");
        assert!(blocked.iter().any(|b| b == "media/88-Template/simple.md"));
        assert!(blocked.iter().any(|b| b == "a/b/media/deep.md"));
    }
}
