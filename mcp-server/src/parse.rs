//! Markdown 内容解析：标题大纲、待办项、Wiki 双链。
//!
//! 三类抽取都必须跳过围栏代码块内的内容——否则 `# comment` 会被当成标题，
//! `- [ ] example` 会被当成待办，`[[link]]` 示例会污染反链索引。

/// 代码围栏状态：记录围栏字符（` 或 ~）与其长度。
#[derive(Debug, Clone, Copy)]
struct Fence {
    marker: char,
    len: usize,
}

/// 判断一行是否为围栏的开启/关闭行。返回围栏字符与长度。
///
/// 围栏必须位于行首（允许最多 3 个空格缩进），且至少 3 个连续字符。
fn fence_of(line: &str) -> Option<Fence> {
    let indent = line.len() - line.trim_start_matches(' ').len();
    if indent > 3 {
        return None;
    }
    let trimmed = line.trim_start();
    let marker = trimmed.chars().next()?;
    if marker != '`' && marker != '~' {
        return None;
    }
    let len = trimmed.chars().take_while(|c| *c == marker).count();
    if len < 3 {
        return None;
    }
    // 反引号围栏的信息串不能含反引号（CommonMark 规则）
    if marker == '`' && trimmed[len..].contains('`') {
        return None;
    }
    Some(Fence { marker, len })
}

/// 逐行遍历，标记每行是否位于代码块内部。
///
/// 返回 `(行号, 行内容, 是否在代码块内)`，行号从 1 开始。
pub fn iter_lines(content: &str) -> Vec<(usize, &str, bool)> {
    let mut out = Vec::new();
    let mut open: Option<Fence> = None;
    for (i, line) in content.lines().enumerate() {
        match open {
            Some(f) => {
                let is_close = match fence_of(line) {
                    Some(g) => g.marker == f.marker && g.len >= f.len,
                    None => false,
                };
                if is_close {
                    open = None;
                    out.push((i + 1, line, true));
                } else {
                    out.push((i + 1, line, true));
                }
            }
            None => {
                if let Some(f) = fence_of(line) {
                    open = Some(f);
                    out.push((i + 1, line, true));
                } else {
                    out.push((i + 1, line, false));
                }
            }
        }
    }
    out
}

/// 标题（ATX 风格）。
#[derive(Debug, Clone, PartialEq)]
pub struct Heading {
    pub level: u8,
    pub title: String,
    pub line: usize,
}

/// 抽取 ATX 标题（`#` ~ `######`）。
///
/// 闭合式 ATX（`## Title ##`）会去掉尾部同字量的 `#`。
pub fn extract_headings(content: &str) -> Vec<Heading> {
    let mut out = Vec::new();
    for (no, line, in_code) in iter_lines(content) {
        if in_code {
            continue;
        }
        let trimmed = line.trim_start();
        if trimmed.len() > line.len() - trimmed.len() {
            // 缩进超过 3 个空格不算标题
            if line.len() - line.trim_start().len() > 3 {
                continue;
            }
        }
        let hashes = trimmed.chars().take_while(|c| *c == '#').count();
        if hashes == 0 || hashes > 6 {
            continue;
        }
        let rest = &trimmed[hashes..];
        // ATX 标题后必须跟空格或行尾
        if !rest.is_empty() && !rest.starts_with(' ') && !rest.starts_with('\t') {
            continue;
        }
        let mut title = rest.trim().to_string();
        // 去掉闭合式 ATX 的尾部 #
        if title.ends_with('#') {
            let trailing = title.chars().rev().take_while(|c| *c == '#').count();
            if trailing >= hashes {
                title = title[..title.len() - trailing].trim_end().to_string();
            }
        }
        out.push(Heading {
            level: hashes as u8,
            title,
            line: no,
        });
    }
    out
}

/// 待办项。
#[derive(Debug, Clone, PartialEq)]
pub struct Task {
    pub done: bool,
    pub text: String,
    pub line: usize,
}

/// 去掉有序列表标记（`1. ` / `1) `），返回剩余部分。
fn strip_ordered_marker(s: &str) -> Option<&str> {
    let digits = s.chars().take_while(|c| c.is_ascii_digit()).count();
    if digits == 0 || digits > 9 {
        return None;
    }
    let rest = &s[digits..];
    let rest = rest.strip_prefix(". ").or_else(|| rest.strip_prefix(") "))?;
    Some(rest)
}

/// 解析一行是否为待办项。
fn parse_task_line(line: &str) -> Option<(bool, String)> {
    let t = line.trim_start();
    let rest = t
        .strip_prefix("- ")
        .or_else(|| t.strip_prefix("* "))
        .or_else(|| t.strip_prefix("+ "))
        .or_else(|| strip_ordered_marker(t))?;
    let rest = rest.trim_start();
    if rest.starts_with("[ ]") {
        Some((false, rest[3..].trim().to_string()))
    } else if rest.starts_with("[x]") || rest.starts_with("[X]") {
        Some((true, rest[3..].trim().to_string()))
    } else {
        None
    }
}

/// 抽取待办项（`- [ ]` / `- [x]`）。
pub fn extract_tasks(content: &str) -> Vec<Task> {
    let mut out = Vec::new();
    for (no, line, in_code) in iter_lines(content) {
        if in_code {
            continue;
        }
        if let Some((done, text)) = parse_task_line(line) {
            out.push(Task { done, text, line: no });
        }
    }
    out
}

/// Wiki 双链。
#[derive(Debug, Clone, PartialEq)]
pub struct WikiLink {
    /// 链接目标（已剥离 `#heading` 与 `|alias`）
    pub target: String,
    /// 显示别名
    pub alias: Option<String>,
    pub line: usize,
}

/// 抽取 `[[目标]]` 与 `[[目标|别名]]`。
///
/// `[[笔记#小节]]` 的目标会被剥离 `#小节`——反链应指向笔记本身。
pub fn extract_wikilinks(content: &str) -> Vec<WikiLink> {
    let mut out = Vec::new();
    for (no, line, in_code) in iter_lines(content) {
        if in_code {
            continue;
        }
        let bytes = line.as_bytes();
        let mut i = 0usize;
        while i + 1 < bytes.len() {
            if bytes[i] == b'[' && bytes[i + 1] == b'[' {
                if let Some(end) = line[i + 2..].find("]]") {
                    let inner = &line[i + 2..i + 2 + end];
                    let (target_raw, alias) = match inner.split_once('|') {
                        Some((t, a)) => (t.trim(), Some(a.trim().to_string())),
                        None => (inner.trim(), None),
                    };
                    // 剥离 `#heading` / `#^block`
                    let target = target_raw
                        .split('#')
                        .next()
                        .unwrap_or(target_raw)
                        .trim()
                        .to_string();
                    if !target.is_empty() {
                        out.push(WikiLink {
                            target,
                            alias,
                            line: no,
                        });
                    }
                    i += 2 + end + 2;
                    continue;
                }
            }
            i += 1;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 标题抽取跳过代码块() {
        let md = "# 标题一\n\n```md\n# 代码里的假标题\n```\n\n## 标题二\n";
        let hs = extract_headings(md);
        assert_eq!(hs.len(), 2, "代码块内的标题不应被抽取");
        assert_eq!(hs[0].title, "标题一");
        assert_eq!(hs[0].level, 1);
        assert_eq!(hs[1].title, "标题二");
        assert_eq!(hs[1].level, 2);
    }

    #[test]
    fn 标题闭合标记被去除() {
        let md = "## 标题 ##\n";
        let hs = extract_headings(md);
        assert_eq!(hs[0].title, "标题");
        assert_eq!(hs[0].level, 2);
    }

    #[test]
    fn 七级井号不是标题() {
        assert!(extract_headings("####### 不是标题\n").is_empty());
    }

    #[test]
    fn 井号后必须有空格() {
        assert!(extract_headings("#tag 不是标题\n").is_empty());
    }

    #[test]
    fn 待办抽取识别完成态() {
        let md = "- [ ] 未完成\n- [x] 已完成\n* [X] 也完成\n1. [ ] 有序未完成\n";
        let ts = extract_tasks(md);
        assert_eq!(ts.len(), 4);
        assert!(!ts[0].done);
        assert_eq!(ts[0].text, "未完成");
        assert!(ts[1].done);
        assert!(ts[2].done);
        assert!(!ts[3].done);
        assert_eq!(ts[3].text, "有序未完成");
    }

    #[test]
    fn 待办抽取跳过代码块() {
        let md = "```\n- [ ] 代码块里的假待办\n```\n- [ ] 真待办\n";
        let ts = extract_tasks(md);
        assert_eq!(ts.len(), 1);
        assert_eq!(ts[0].text, "真待办");
    }

    #[test]
    fn 双链剥离小节与别名() {
        let md = "见 [[目标笔记]] 和 [[另一篇#小节]] 与 [[第三篇|显示名]]\n";
        let ls = extract_wikilinks(md);
        assert_eq!(ls.len(), 3);
        assert_eq!(ls[0].target, "目标笔记");
        assert_eq!(ls[1].target, "另一篇");
        assert_eq!(ls[2].target, "第三篇");
        assert_eq!(ls[2].alias.as_deref(), Some("显示名"));
    }

    #[test]
    fn 双链跳过代码块() {
        let md = "```\n[[代码里的假链接]]\n```\n[[真链接]]\n";
        let ls = extract_wikilinks(md);
        assert_eq!(ls.len(), 1);
        assert_eq!(ls[0].target, "真链接");
    }

    #[test]
    fn 波浪号围栏也能识别() {
        let md = "~~~\n# 假标题\n~~~\n# 真标题\n";
        assert_eq!(extract_headings(md).len(), 1);
    }

    #[test]
    fn 行号定位准确() {
        let md = "第一行\n第二行\n# 标题\n";
        let hs = extract_headings(md);
        assert_eq!(hs[0].line, 3);
    }
}
