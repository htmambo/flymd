//! MCP 服务器的目录排除配置。
//!
//! 背景：Obsidian 库里的 `media/`、`assets/`、`templates/` 这类目录装的是
//! **附件和模板**，不是笔记。把它们喂给 AI 会污染搜索、待办和列表结果——
//! 比如模板里的 `- [ ] 红薯订阅` 会被当成用户的真待办。
//!
//! 配置来源（按优先级从低到高，**合并**而非替换）：
//! 1. 内置默认：技术目录 + 常见资源/模板目录
//! 2. 用户级配置：`~/.config/com.flymd/mcp.json`（不随库同步）
//! 3. 库级配置：`<库根>/.flymd/mcp.json`（随库走、随 WebDAV 同步）
//! 4. 环境变量 `FLYMD_MCP_EXCLUDE`（逗号分隔）
//! 5. 命令行 `--exclude <dir>`（可重复）
//!
//! 匹配语义：
//! - 模式**不含** `/` → 按**目录名**匹配，任意层级都命中（`media` 命中 `a/b/media`）
//! - 模式**含** `/` → 按**相对库根的路径前缀**匹配（`Personal/media` 只命中这一处）
//! - 大小写不敏感
//! - `allowDirs` 优先于 `excludeDirs`：路径前缀命中 allow 时不排除

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

/// 用户级配置路径（不随库走）。
pub fn user_config_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
    let home = PathBuf::from(home);
    let mut out = Vec::new();
    // macOS
    out.push(home.join("Library/Application Support/com.flymd/mcp.json"));
    // Linux
    if let Some(xdg) = std::env::var_os("XDG_CONFIG_HOME") {
        out.push(PathBuf::from(xdg).join("com.flymd/mcp.json"));
    }
    out.push(home.join(".config/com.flymd/mcp.json"));
    // Windows
    if let Some(appdata) = std::env::var_os("APPDATA") {
        out.push(PathBuf::from(appdata).join("com.flymd/mcp.json"));
    }
    out.into_iter().find(|p| p.exists())
}

/// 库级配置路径（随库走，随 WebDAV 同步）。
pub fn library_config_path(library_root: &Path) -> PathBuf {
    library_root.join(".flymd").join("mcp.json")
}

/// 组装最终生效配置。
///
/// `library_root` 为 None 时跳过库级配置（此时尚未定位到库）。
pub fn resolve(library_root: Option<&Path>, cli_excludes: &[String]) -> McpConfig {
    let mut cfg = McpConfig::with_defaults();

    if let Some(p) = user_config_path() {
        cfg.merge(&read_config_file(&p));
    }
    if let Some(root) = library_root {
        cfg.merge(&read_config_file(&library_config_path(root)));
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
        assert!(p.ends_with(".flymd/mcp.json"));
    }
}
