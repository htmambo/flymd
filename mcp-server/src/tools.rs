//! MCP 工具定义与实现。
//!
//! 六个**只读**工具（`list_notes` `read_note` `search` `get_outline` `list_tasks`
//! `get_backlinks`）不改动用户的任何文件。
//!
//! 四个**写入**工具（`preview_write` `write_note` `list_writes` `rollback_write`）
//! 受写入护栏约束：写入前强制快照、可预览 diff、可回滚——护栏内核在
//! `crate::guard`，快照格式与设计文档 §3「快照格式规范 v1」逐字对齐。

use serde_json::{json, Value};

use crate::library::Library;
use crate::parse;

/// 单次 `tools/call` 的结果上限，避免把客户端上下文一次打爆。
const MAX_OUTPUT_CHARS: usize = 120_000;

/// 单次写入的内容上限（1 MB）。
const MAX_WRITE_BYTES: usize = 1024 * 1024;

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
            },
            {
                "name": "preview_write",
                "description": "预览写入某个笔记会产生什么差异（unified diff）。不写盘、不产生快照。正式写入前会自动快照，可用 rollback_write 回滚。",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "相对于库根的笔记路径，例如 \"笔记/2026-11-01 日记.md\"。"
                        },
                        "content": {
                            "type": "string",
                            "description": "准备写入的完整 Markdown 内容。"
                        }
                    },
                    "required": ["path", "content"],
                    "additionalProperties": false
                }
            },
            {
                "name": "write_note",
                "description": "写入一个笔记（单次只改一个文件，内容上限 1 MB，被排除目录不可写）。写入前会自动快照原内容，可用 rollback_write 回滚；返回差异与快照 ID。",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "相对于库根的笔记路径，例如 \"笔记/2026-11-01 日记.md\"。"
                        },
                        "content": {
                            "type": "string",
                            "description": "写入后的完整 Markdown 内容（覆盖整个文件）。"
                        },
                        "reason": {
                            "type": "string",
                            "description": "可选，写入原因，记录进快照元数据供审计。"
                        }
                    },
                    "required": ["path", "content"],
                    "additionalProperties": false
                }
            },
            {
                "name": "list_writes",
                "description": "列出本库通过 AI 写入留下的快照（可回滚的写入记录），按时间倒序。写入前会自动快照，可用 rollback_write 回滚。",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "limit": {
                            "type": "integer",
                            "description": "最多返回多少条，默认 20。",
                            "minimum": 1
                        }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "rollback_write",
                "description": "回滚一次 AI 写入，把文件恢复到快照时的内容。回滚本身也会生成快照（可再回滚）；若快照对应的文件原本不存在，回滚等于删除文件，必须传 confirm: true。",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "snapshotId": {
                            "type": "string",
                            "description": "list_writes 返回的快照 ID。"
                        },
                        "confirm": {
                            "type": "boolean",
                            "description": "确认删除文件；快照对应的文件原本不存在时必须为 true。"
                        }
                    },
                    "required": ["snapshotId"],
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
        "preview_write" => preview_write(args, lib)?,
        "write_note" => write_note(args, lib)?,
        "list_writes" => list_writes(args, lib)?,
        "rollback_write" => rollback_write(args, lib)?,
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

/// 取字符串参数（允许空串——把笔记写成空文件是合法操作）。
fn arg_str_raw(args: &Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
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
            lines.push("…（还有更多笔记未列出，提高 limit 查看）".to_string());
            break;
        }
        lines.push(match n.modified {
            Some(t) => format!(
                "- {} ({}, {})",
                n.rel,
                human_size(n.size),
                flymd_mcp::time::format_time(t)
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

/// 预览写入产生的差异：不写盘、不产生快照。
fn preview_write(args: &Value, lib: &Library) -> Result<String, String> {
    let path = arg_str(args, "path").ok_or("缺少参数 path")?;
    let content = arg_str_raw(args, "content").ok_or("缺少参数 content")?;
    check_write_size(&content)?;

    let abs = lib.resolve_write_path(&path)?;
    let (old_text, existed) = match std::fs::read(&abs) {
        Ok(bytes) => (
            String::from_utf8(bytes)
                .map_err(|_| format!("{path} 不是合法的 UTF-8 文本，无法预览"))?,
            true,
        ),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (String::new(), false),
        Err(e) => return Err(format!("读取 {path} 失败: {e}")),
    };
    let old_label = if existed {
        path.clone()
    } else {
        "/dev/null".to_string()
    };
    let diff = flymd_mcp::diff::unified_diff(&old_text, &content, &old_label, &path);
    if diff.is_empty() {
        return Ok(format!("{path} 的内容没有变化，无需写入。"));
    }
    Ok(format!(
        "预览写入 {path} 将产生的差异（未写盘、未产生快照）：\n{diff}"
    ))
}

/// 写入笔记：校验 → 读原内容 → 建快照 → 原子写 → 返回 diff 与快照 ID。
fn write_note(args: &Value, lib: &Library) -> Result<String, String> {
    let path = arg_str(args, "path").ok_or("缺少参数 path")?;
    let content = arg_str_raw(args, "content").ok_or("缺少参数 content")?;
    let reason = arg_str(args, "reason");
    check_write_size(&content)?;

    // ① 越界防护 + 被排除目录必须拒绝
    let abs = lib.resolve_write_path(&path)?;

    // ② 读原内容
    let before_bytes = match std::fs::read(&abs) {
        Ok(bytes) => Some(bytes),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("读取 {path} 失败: {e}")),
    };
    let existed = before_bytes.is_some();
    let before_text = match &before_bytes {
        Some(bytes) => Some(
            String::from_utf8(bytes.clone())
                .map_err(|_| format!("{path} 不是合法的 UTF-8 文本，无法安全写入"))?,
        ),
        None => None,
    };
    // 原文件超限时没法生成可回滚的快照——宁可写不进去。
    if let Some(bytes) = &before_bytes {
        if bytes.len() > flymd_mcp::guard::MAX_SNAPSHOT_BYTES {
            return Err(format!(
                "{path} 现有内容 {:.1} MB，超过 {} MB 上限，无法生成可回滚快照，已中止写入。",
                bytes.len() as f64 / 1048576.0,
                flymd_mcp::guard::MAX_SNAPSHOT_BYTES / 1048576
            ));
        }
    }

    // ③ 建快照（失败即中止：不能留下没有回滚路径的改动）
    let guard = lib.guard_store();
    let payload = flymd_mcp::guard::SnapshotPayload {
        path: path.as_str(),
        operation: "write_note",
        actor: "mcp",
        reason: reason.as_deref(),
        rollback_of: None,
        before: before_text.as_deref(),
        after: Some(content.as_str()),
    };
    let meta = guard.create(&payload)?;

    // ④ 原子写
    flymd_mcp::guard::atomic_write_bytes(&abs, content.as_bytes())?;

    // ⑤ 返回 diff + 快照 ID + 新内容大小
    let old_text = before_text.unwrap_or_default();
    let old_label = if existed {
        path.clone()
    } else {
        "/dev/null".to_string()
    };
    let diff = flymd_mcp::diff::unified_diff(&old_text, &content, &old_label, &path);
    let mut out = format!(
        "已写入：{path}\n快照 ID：{}\n新内容：{}（原 {}）\n提示：可用 rollback_write 回滚这次写入。\n",
        meta.id,
        human_size(content.len() as u64),
        human_size(meta.before_bytes),
    );
    if diff.is_empty() {
        out.push_str("（内容与原文件一致，没有差异）\n");
    } else {
        out.push_str(&diff);
    }
    Ok(out)
}

/// 列出本库可回滚的写入（快照）。
fn list_writes(args: &Value, lib: &Library) -> Result<String, String> {
    let limit = arg_int(args, "limit", 20);
    let guard = lib.guard_store();
    let metas = guard.list(Some(limit));
    if metas.is_empty() {
        return Ok("本库还没有 AI 写入留下的快照。".to_string());
    }
    let mut lines = Vec::new();
    for m in &metas {
        let state = if m.truncated {
            "内容超限已截断，不可回滚"
        } else if m.existed_before {
            "写入前已存在"
        } else {
            "写入前不存在（回滚=删除文件）"
        };
        let rollback = match &m.rollback_of {
            Some(r) => format!("，回滚自 {r}"),
            None => String::new(),
        };
        lines.push(format!(
            "- {}  {}  {}  {}（{}）{}",
            m.id, m.created_at, m.path, m.operation, state, rollback
        ));
    }
    Ok(format!(
        "本库的 AI 写入记录（显示 {} 条，快照目录 {}）：\n{}",
        lines.len(),
        guard.root().display(),
        lines.join("\n")
    ))
}

/// 回滚一次 AI 写入。
fn rollback_write(args: &Value, lib: &Library) -> Result<String, String> {
    let id = arg_str(args, "snapshotId").ok_or("缺少参数 snapshotId")?;
    let confirm = arg_bool(args, "confirm", false);
    let guard = lib.guard_store();
    let meta = guard.get(&id)?;
    // 目标路径同样要过越界与排除目录校验。
    lib.resolve_write_path(&meta.path)?;
    let outcome = guard.rollback(&id, confirm, "mcp")?;
    let action = if outcome.deleted {
        "已删除该文件（写入前它并不存在）"
    } else {
        "已还原文件内容"
    };
    Ok(format!(
        "已回滚：{}\n{}\n回滚快照 ID：{}（rollbackOf={}，可再次回滚）",
        outcome.path,
        action,
        outcome.snapshot.id,
        outcome.rolled_back
    ))
}

/// 单次写入内容大小校验。
fn check_write_size(content: &str) -> Result<(), String> {
    if content.len() > MAX_WRITE_BYTES {
        return Err(format!(
            "写入内容 {:.1} MB，超过 {} MB 上限，已拒绝。",
            content.len() as f64 / 1048576.0,
            MAX_WRITE_BYTES / 1048576
        ));
    }
    Ok(())
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

    /// 从写入结果里取出快照 ID。
    fn snapshot_id_of(out: &str) -> String {
        out.lines()
            .find(|l| l.starts_with("快照 ID："))
            .expect("结果里应有快照 ID")
            .trim_start_matches("快照 ID：")
            .trim()
            .to_string()
    }

    #[test]
    fn write_note_写入后内容正确且产生快照() {
        let lib = setup("write");
        let out = call(
            "write_note",
            &json!({"path": "a.md", "content": "# 新内容\n\n- [ ] 新待办\n"}),
            &lib,
        )
        .unwrap();
        assert!(out.contains("已写入：a.md"));
        assert!(out.contains("快照 ID："));
        assert_eq!(
            std::fs::read_to_string(lib.root().join("a.md")).unwrap(),
            "# 新内容\n\n- [ ] 新待办\n"
        );
        // 快照目录应落在 <库根>/.flymd/ai-guard/
        let id = snapshot_id_of(&out);
        assert!(
            lib.root()
                .join(".flymd/ai-guard")
                .join(&id)
                .join("meta.json")
                .is_file(),
            "应生成快照目录"
        );
    }

    #[test]
    fn write_note_拒绝被排除目录() {
        let lib = setup("write-excl");
        std::fs::create_dir_all(lib.root().join("media")).unwrap();
        let err = call(
            "write_note",
            &json!({"path": "media/模板.md", "content": "x"}),
            &lib,
        )
        .expect_err("被排除目录不该能写");
        assert!(err.contains("被排除"), "错误信息应说明被排除，实际: {err}");
        assert!(!lib.root().join("media/模板.md").exists());
    }

    #[test]
    fn write_note_拒绝越界路径() {
        let lib = setup("write-escape");
        assert!(call(
            "write_note",
            &json!({"path": "../逃逸.md", "content": "x"}),
            &lib
        )
        .is_err());
        assert!(call(
            "write_note",
            &json!({"path": "/etc/passwd", "content": "x"}),
            &lib
        )
        .is_err());
    }

    #[test]
    fn write_note_拒绝超限内容() {
        let lib = setup("write-big");
        let big = "x".repeat(1024 * 1024 + 1);
        let err = call(
            "write_note",
            &json!({"path": "a.md", "content": big}),
            &lib,
        )
        .expect_err("超限内容应被拒绝");
        assert!(err.contains("上限"), "错误信息应说明上限，实际: {err}");
        assert_eq!(
            std::fs::read_to_string(lib.root().join("a.md")).unwrap(),
            "# 标题A\n\n- [ ] 待办甲\n- [x] 已办乙\n",
            "被拒绝的写入不该改动文件"
        );
    }

    #[test]
    fn write_note_快照失败则不写文件() {
        let lib = setup("write-nosnap");
        // 把快照目录占成一个普通文件，快照必然创建失败
        std::fs::create_dir_all(lib.root().join(".flymd")).unwrap();
        std::fs::write(lib.root().join(".flymd/ai-guard"), "占位").unwrap();
        let err = call(
            "write_note",
            &json!({"path": "a.md", "content": "# 不该写进去\n"}),
            &lib,
        )
        .expect_err("快照失败应中止写入");
        assert!(!err.is_empty());
        assert_eq!(
            std::fs::read_to_string(lib.root().join("a.md")).unwrap(),
            "# 标题A\n\n- [ ] 待办甲\n- [x] 已办乙\n",
            "快照失败时不该动原文件"
        );
    }

    #[test]
    fn preview_write_返回差异且不产生快照() {
        let lib = setup("preview");
        let out = call(
            "preview_write",
            &json!({"path": "a.md", "content": "# 标题A\n\n- [ ] 待办甲\n- [x] 已办乙\n- [ ] 追加\n"}),
            &lib,
        )
        .unwrap();
        assert!(out.contains("+"), "应返回差异: {out}");
        assert!(out.contains("追加"));
        assert_eq!(
            std::fs::read_to_string(lib.root().join("a.md")).unwrap(),
            "# 标题A\n\n- [ ] 待办甲\n- [x] 已办乙\n",
            "预览不该写盘"
        );
        assert!(
            !lib.root().join(".flymd/ai-guard").exists(),
            "预览不该产生快照"
        );
    }

    #[test]
    fn list_writes_能看到写入记录() {
        let lib = setup("listwrites");
        call(
            "write_note",
            &json!({"path": "a.md", "content": "# 新内容\n"}),
            &lib,
        )
        .unwrap();
        let out = call("list_writes", &json!({}), &lib).unwrap();
        assert!(out.contains("a.md"), "应列出写入记录: {out}");
        assert!(out.contains("write_note"));
    }

    #[test]
    fn rollback_write_删除文件需要显式确认() {
        let lib = setup("rollback-confirm");
        let out = call(
            "write_note",
            &json!({"path": "新文件.md", "content": "# 新建\n"}),
            &lib,
        )
        .unwrap();
        let id = snapshot_id_of(&out);

        let err = call("rollback_write", &json!({"snapshotId": id}), &lib)
            .expect_err("删除文件必须先确认");
        assert!(err.contains("confirm"), "错误信息应提示 confirm，实际: {err}");
        assert!(lib.root().join("新文件.md").exists(), "未确认时不该删除");

        let out = call(
            "rollback_write",
            &json!({"snapshotId": id, "confirm": true}),
            &lib,
        )
        .unwrap();
        assert!(out.contains("已回滚：新文件.md"));
        assert!(!lib.root().join("新文件.md").exists(), "确认后应删除文件");
    }

    #[test]
    fn 端到端_写入列出回滚后内容逐字节复原() {
        let lib = setup("e2e");
        let original = std::fs::read_to_string(lib.root().join("a.md")).unwrap();
        let new_content = "# 标题A\n\n- [ ] 待办甲\n- [x] 已办乙\n- [ ] AI 追加的待办\n";

        // 写入
        let out = call(
            "write_note",
            &json!({"path": "a.md", "content": new_content, "reason": "AI 续写"}),
            &lib,
        )
        .unwrap();
        let id = snapshot_id_of(&out);
        assert_eq!(
            std::fs::read_to_string(lib.root().join("a.md")).unwrap(),
            new_content
        );

        // 列出
        let list = call("list_writes", &json!({}), &lib).unwrap();
        assert!(list.contains(&id), "列表里应能看到该快照: {list}");

        // 回滚
        let out = call("rollback_write", &json!({"snapshotId": id}), &lib).unwrap();
        assert!(out.contains("已回滚：a.md"));
        assert_eq!(
            std::fs::read_to_string(lib.root().join("a.md")).unwrap(),
            original,
            "回滚后内容应与写入前逐字节一致"
        );

        // 回滚本身也留了快照，可以再回滚
        let list = call("list_writes", &json!({}), &lib).unwrap();
        assert_eq!(
            list.matches("rollback_write").count(),
            1,
            "回滚应生成一条新快照: {list}"
        );
    }
}
