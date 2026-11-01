//! MCP 工具定义与实现。
//!
//! 当前切片**全部只读**：不提供任何写入笔记的通道。AI 客户端能读、能搜、
//! 能看大纲与待办，但不能改动用户的文件——这是把笔记库交给外部 agent 时
//! 最关键的一条边界。

use serde_json::{json, Value};

use crate::library::Library;
use crate::parse;

/// 单次 `tools/call` 的结果上限，避免把客户端上下文一次打爆。
const MAX_OUTPUT_CHARS: usize = 120_000;

/// `tools/list` 返回的工具清单。
pub fn list() -> Value {
    json!({
        "tools": [
            {
                "name": "list_notes",
                "description": "列出笔记库中的所有 Markdown 笔记（相对路径、大小、修改时间）。",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "filter": {
                            "type": "string",
                            "description": "可选的路径子串过滤，只返回包含该子串的笔记。"
                        },
                        "limit": {
                            "type": "integer",
                            "description": "最多返回多少条，默认 200。",
                            "minimum": 1
                        }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "read_note",
                "description": "读取单个笔记的完整 Markdown 内容。路径必须是相对于库根的相对路径。",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "相对于库根的笔记路径，例如 \"笔记/2026-11-01 日记.md\"。"
                        }
                    },
                    "required": ["path"],
                    "additionalProperties": false
                }
            },
            {
                "name": "search",
                "description": "在全部笔记中全文搜索，返回命中的文件、行号与上下文行。",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "要搜索的文本。"
                        },
                        "regex": {
                            "type": "boolean",
                            "description": "把 query 当作正则表达式处理，默认 false。"
                        },
                        "ignore_case": {
                            "type": "boolean",
                            "description": "忽略大小写，默认 true。"
                        },
                        "limit": {
                            "type": "integer",
                            "description": "最多返回多少条命中，默认 100。",
                            "minimum": 1
                        }
                    },
                    "required": ["query"],
                    "additionalProperties": false
                }
            },
            {
                "name": "get_outline",
                "description": "提取笔记的标题大纲（含层级与行号），用于快速了解长文档结构。",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "相对于库根的笔记路径。"
                        }
                    },
                    "required": ["path"],
                    "additionalProperties": false
                }
            },
            {
                "name": "list_tasks",
                "description": "提取待办项（`- [ ]` / `- [x]`）。不指定 path 时扫描整个库。",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "可选，只扫描该笔记；省略则扫描全库。"
                        },
                        "include_done": {
                            "type": "boolean",
                            "description": "是否包含已完成项，默认 false。"
                        }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "get_backlinks",
                "description": "查询指向某个笔记的双链来源（`[[目标]]`）。",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "目标笔记路径或笔记名。"
                        }
                    },
                    "required": ["path"],
                    "additionalProperties": false
                }
            }
        ]
    })
}

/// 执行一个工具调用，返回可直接投喂给模型的文本。
pub fn call(name: &str, args: &Value, lib: &Library) -> Result<String, String> {
    let out = match name {
        "list_notes" => list_notes(args, lib)?,
        "read_note" => read_note(args, lib)?,
        "search" => search(args, lib)?,
        "get_outline" => get_outline(args, lib)?,
        "list_tasks" => list_tasks(args, lib)?,
        "get_backlinks" => get_backlinks(args, lib)?,
        other => return Err(format!("未知工具: {other}")),
    };
    Ok(truncate(&out))
}

/// 超出上限时截断并标注，避免把结果撑爆客户端上下文。
fn truncate(s: &str) -> String {
    if s.chars().count() <= MAX_OUTPUT_CHARS {
        return s.to_string();
    }
    let mut out: String = s.chars().take(MAX_OUTPUT_CHARS).collect();
    out.push_str("\n\n…（输出过长已截断）");
    out
}

/// 取字符串参数。
fn arg_str(args: &Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.trim().is_empty())
}

/// 取布尔参数。
fn arg_bool(args: &Value, key: &str, default: bool) -> bool {
    args.get(key).and_then(|v| v.as_bool()).unwrap_or(default)
}

/// 取整数参数。
fn arg_int(args: &Value, key: &str, default: usize) -> usize {
    args.get(key)
        .and_then(|v| v.as_u64())
        .map(|v| v as usize)
        .unwrap_or(default)
}

/// 人类可读的体积。
fn human_size(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{bytes} B")
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{:.1} MB", bytes as f64 / 1048576.0)
    }
}

fn list_notes(args: &Value, lib: &Library) -> Result<String, String> {
    let filter = arg_str(args, "filter");
    let limit = arg_int(args, "limit", 200);
    let notes = lib.notes();

    let mut lines = Vec::new();
    let mut shown = 0usize;
    for n in &notes {
        if let Some(f) = &filter {
            if !n.rel.contains(f.as_str()) {
                continue;
            }
        }
        if shown >= limit {
            lines.push(format!("…（还有更多笔记未列出，提高 limit 查看）"));
            break;
        }
        lines.push(match n.modified {
            Some(t) => format!(
                "- {} ({}, {})",
                n.rel,
                human_size(n.size),
                crate::library::format_time(t)
            ),
            None => format!("- {} ({})", n.rel, human_size(n.size)),
        });
        shown += 1;
    }
    if lines.is_empty() {
        return Ok(if filter.is_some() {
            "没有匹配的笔记。".to_string()
        } else {
            "笔记库是空的。".to_string()
        });
    }
    Ok(format!(
        "共 {} 个笔记，显示 {} 个：\n{}",
        notes.len(),
        shown,
        lines.join("\n")
    ))
}

fn read_note(args: &Value, lib: &Library) -> Result<String, String> {
    let path = arg_str(args, "path").ok_or("缺少参数 path")?;
    let content = lib.read_note(&path)?;
    if content.trim().is_empty() {
        return Ok(format!("{path}（空文件）"));
    }
    Ok(content)
}

fn search(args: &Value, lib: &Library) -> Result<String, String> {
    let query = arg_str(args, "query").ok_or("缺少参数 query")?;
    let use_regex = arg_bool(args, "regex", false);
    let ignore_case = arg_bool(args, "ignore_case", true);
    let limit = arg_int(args, "limit", 100);

    enum Matcher {
        Literal { needle: String, ignore_case: bool },
        Regex(regex::Regex),
    }

    let matcher = if use_regex {
        let mut builder = regex::RegexBuilder::new(&query);
        builder.case_insensitive(ignore_case);
        let re = builder
            .build()
            .map_err(|e| format!("正则表达式无效: {e}"))?;
        Matcher::Regex(re)
    } else {
        Matcher::Literal {
            needle: if ignore_case {
                query.to_lowercase()
            } else {
                query.clone()
            },
            ignore_case,
        }
    };

    let mut hits: Vec<String> = Vec::new();
    let mut total = 0usize;
    for note in lib.notes() {
        let content = match std::fs::read_to_string(&note.abs) {
            Ok(c) => c,
            Err(_) => continue,
        };
        for (i, line) in content.lines().enumerate() {
            let matched = match &matcher {
                Matcher::Literal { needle, ignore_case } => {
                    if *ignore_case {
                        line.to_lowercase().contains(needle.as_str())
                    } else {
                        line.contains(needle.as_str())
                    }
                }
                Matcher::Regex(re) => re.is_match(line),
            };
            if !matched {
                continue;
            }
            total += 1;
            if hits.len() < limit {
                hits.push(format!("{}:{}: {}", note.rel, i + 1, line.trim()));
            }
        }
    }
    if total == 0 {
        return Ok(format!("没有匹配 “{query}” 的内容。"));
    }
    let mut out = format!("命中 {total} 处，显示 {} 处：\n{}", hits.len(), hits.join("\n"));
    if total > hits.len() {
        out.push_str(&format!("\n…（共 {total} 处命中，已截断）"));
    }
    Ok(out)
}

fn get_outline(args: &Value, lib: &Library) -> Result<String, String> {
    let path = arg_str(args, "path").ok_or("缺少参数 path")?;
    let content = lib.read_note(&path)?;
    let headings = parse::extract_headings(&content);
    if headings.is_empty() {
        return Ok(format!("{path} 没有标题。"));
    }
    let lines: Vec<String> = headings
        .iter()
        .map(|h| format!("{}{} (第 {} 行)", "  ".repeat((h.level - 1) as usize), h.title, h.line))
        .collect();
    Ok(format!("{} 的大纲：\n{}", path, lines.join("\n")))
}

fn list_tasks(args: &Value, lib: &Library) -> Result<String, String> {
    let include_done = arg_bool(args, "include_done", false);
    let path = arg_str(args, "path");

    let targets: Vec<(String, std::path::PathBuf)> = match &path {
        Some(p) => {
            let abs = lib.resolve_relative(p)?;
            vec![(p.clone(), abs)]
        }
        None => lib.notes().into_iter().map(|n| (n.rel, n.abs)).collect(),
    };

    let mut lines = Vec::new();
    let mut total = 0usize;
    let mut done = 0usize;
    for (rel, abs) in targets {
        let content = match std::fs::read_to_string(&abs) {
            Ok(c) => c,
            Err(_) => continue,
        };
        for t in parse::extract_tasks(&content) {
            if t.done {
                done += 1;
                if !include_done {
                    continue;
                }
            }
            total += 1;
            let mark = if t.done { "x" } else { " " };
            lines.push(format!("- [{mark}] {} ({rel}:{})", t.text, t.line));
        }
    }
    if lines.is_empty() {
        return Ok(if include_done {
            "没有待办项。".to_string()
        } else {
            format!("没有未完成待办（共 {done} 个已完成项已隐藏）。")
        });
    }
    let header = match &path {
        Some(p) => format!("{p} 的待办："),
        None => format!("全库待办（未完成 {total} 个）："),
    };
    Ok(format!("{header}\n{}", lines.join("\n")))
}

fn get_backlinks(args: &Value, lib: &Library) -> Result<String, String> {
    let path = arg_str(args, "path").ok_or("缺少参数 path")?;
    let links = lib.backlinks(&path);
    if links.is_empty() {
        return Ok(format!("没有笔记通过 [[链接]] 指向 {path}。"));
    }
    let lines: Vec<String> = links
        .iter()
        .map(|(rel, line, text)| format!("- {rel}:{line}  {text}"))
        .collect();
    Ok(format!(
        "{} 处链接指向 {path}：\n{}",
        links.len(),
        lines.join("\n")
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn setup(tag: &str) -> Library {
        let root = std::env::temp_dir().join(format!("flymd-mcp-tools-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("子目录")).unwrap();
        std::fs::write(root.join("a.md"), "# 标题A\n\n- [ ] 待办甲\n- [x] 已办乙\n").unwrap();
        std::fs::write(root.join("子目录/b.md"), "# 标题B\n\n参见 [[a]] 与 [[其他]]\n").unwrap();
        Library::from_path(&root).unwrap()
    }

    #[test]
    fn list_notes_返回全部笔记() {
        let lib = setup("list");
        let out = call("list_notes", &json!({}), &lib).unwrap();
        assert!(out.contains("a.md"));
        assert!(out.contains("b.md"));
    }

    #[test]
    fn list_notes_支持过滤() {
        let lib = setup("filter");
        let out = call("list_notes", &json!({"filter": "子目录"}), &lib).unwrap();
        assert!(out.contains("b.md"));
        assert!(!out.contains("- a.md"));
    }

    #[test]
    fn read_note_返回内容() {
        let lib = setup("read");
        let out = call("read_note", &json!({"path": "a.md"}), &lib).unwrap();
        assert!(out.contains("标题A"));
    }

    #[test]
    fn read_note_拒绝越界路径() {
        let lib = setup("read2");
        assert!(call("read_note", &json!({"path": "../etc/passwd"}), &lib).is_err());
    }

    #[test]
    fn search_字面与正则() {
        let lib = setup("search");
        let out = call("search", &json!({"query": "标题A"}), &lib).unwrap();
        assert!(out.contains("a.md:1"));

        let out = call(
            "search",
            &json!({"query": "标题[AB]", "regex": true}),
            &lib,
        )
        .unwrap();
        assert!(out.contains("a.md:1"));
        assert!(out.contains("b.md:1"));
    }

    #[test]
    fn search_无效正则返回错误() {
        let lib = setup("search2");
        assert!(call(
            "search",
            &json!({"query": "([", "regex": true}),
            &lib
        )
        .is_err());
    }

    #[test]
    fn get_outline_返回标题层级() {
        let lib = setup("outline");
        let out = call("get_outline", &json!({"path": "a.md"}), &lib).unwrap();
        assert!(out.contains("标题A"));
    }

    #[test]
    fn list_tasks_默认只显示未完成() {
        let lib = setup("tasks");
        let out = call("list_tasks", &json!({}), &lib).unwrap();
        assert!(out.contains("待办甲"));
        assert!(!out.contains("已办乙"));

        let out = call("list_tasks", &json!({"include_done": true}), &lib).unwrap();
        assert!(out.contains("已办乙"));
    }

    #[test]
    fn get_backlinks_找到来源() {
        let lib = setup("backlink");
        let out = call("get_backlinks", &json!({"path": "a.md"}), &lib).unwrap();
        assert!(out.contains("b.md"));
    }

    #[test]
    fn 未知工具返回错误() {
        let lib = setup("unknown");
        assert!(call("nonexistent", &json!({}), &lib).is_err());
    }
}
