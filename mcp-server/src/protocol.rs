//! JSON-RPC 2.0 与 MCP 协议分发。
//!
//! 传输：stdio，每行一个 JSON-RPC 消息（换行分隔）。
//! **stdout 只承载协议消息**，所有日志必须写 stderr。

use serde_json::{json, Value};

use crate::library::Library;
use crate::tools;

pub const SERVER_NAME: &str = "flymd-mcp";
pub const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

/// 本服务器支持的最新协议版本。
pub const LATEST_PROTOCOL: &str = "2025-06-18";

/// 已知的协议版本（客户端请求其中之一时按其版本应答）。
const SUPPORTED_PROTOCOLS: &[&str] = &["2024-11-05", "2025-03-26", "2025-06-18"];

/// JSON-RPC 错误码。
pub mod codes {
    pub const PARSE_ERROR: i64 = -32700;
    pub const INVALID_REQUEST: i64 = -32600;
    pub const METHOD_NOT_FOUND: i64 = -32601;
    pub const INVALID_PARAMS: i64 = -32602;
}

/// 处理一条消息。返回 `None` 表示这是通知（notification），无需应答。
pub fn handle(msg: &Value, lib: &Library) -> Option<Value> {
    let method = match msg.get("method").and_then(|m| m.as_str()) {
        Some(m) => m,
        None => return Some(error_response(Value::Null, codes::INVALID_REQUEST, "缺少 method")),
    };
    let params = msg.get("params").cloned().unwrap_or_else(|| json!({}));
    let id = msg.get("id").cloned();

    // 通知：一律不应答
    if method.starts_with("notifications/") || id.is_none() {
        return None;
    }
    let id = id.unwrap();

    let result: Result<Value, (i64, String)> = match method {
        "initialize" => Ok(initialize(&params)),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(tools::list()),
        "tools/call" => tools_call(&params, lib),
        // 未实现的资源/提示词能力：返回空列表，而不是报错，
        // 以免客户端因能力探测失败而拒绝握手。
        "resources/list" => Ok(json!({ "resources": [] })),
        "resources/templates/list" => Ok(json!({ "resourceTemplates": [] })),
        "prompts/list" => Ok(json!({ "prompts": [] })),
        other => Err((
            codes::METHOD_NOT_FOUND,
            format!("未实现的方法: {other}"),
        )),
    };

    Some(match result {
        Ok(r) => json!({ "jsonrpc": "2.0", "id": id, "result": r }),
        Err((code, message)) => error_response(id, code, &message),
    })
}

/// 构造 JSON-RPC 错误响应。
pub fn error_response(id: Value, code: i64, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message }
    })
}

/// `initialize` 应答，含协议版本协商。
fn initialize(params: &Value) -> Value {
    let requested = params
        .get("protocolVersion")
        .and_then(|v| v.as_str())
        .unwrap_or(LATEST_PROTOCOL);
    let version = if SUPPORTED_PROTOCOLS.contains(&requested) {
        requested
    } else {
        LATEST_PROTOCOL
    };
    json!({
        "protocolVersion": version,
        "capabilities": {
            "tools": { "listChanged": false }
        },
        "serverInfo": {
            "name": SERVER_NAME,
            "version": SERVER_VERSION
        },
        "instructions": "通过 list_notes / read_note / search / get_outline / list_tasks / get_backlinks 只读访问本地 flymd 笔记库；通过 preview_write / write_note / list_writes / rollback_write 写入笔记。路径均为相对库根的相对路径。写入前会自动快照，可用 rollback_write 回滚。"
    })
}

/// `tools/call` 分发。
///
/// 按 MCP 规范区分两类错误：
/// - 协议错误（工具不存在、参数非法）→ JSON-RPC error
/// - 工具执行错误（文件不存在、路径越界）→ `isError: true` + 内容
fn tools_call(params: &Value, lib: &Library) -> Result<Value, (i64, String)> {
    let name = params
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if name.is_empty() {
        return Err((codes::INVALID_PARAMS, "缺少工具名".into()));
    }
    let args = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));
    match tools::call(&name, &args, lib) {
        Ok(text) => Ok(json!({
            "content": [{ "type": "text", "text": text }],
            "isError": false
        })),
        Err(e) => {
            // 未知工具属于协议错误；其余属于执行错误
            if e.starts_with("未知工具") {
                Err((codes::INVALID_PARAMS, e))
            } else {
                Ok(json!({
                    "content": [{ "type": "text", "text": format!("工具执行失败: {e}") }],
                    "isError": true
                }))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::Library;

    fn setup(tag: &str) -> Library {
        let root = std::env::temp_dir().join(format!("flymd-mcp-proto-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("a.md"), "# 标题\n\n- [ ] 任务\n").unwrap();
        Library::from_path(&root).unwrap()
    }

    #[test]
    fn initialize_返回协议版本与工具能力() {
        let lib = setup("init");
        let resp = handle(
            &json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}),
            &lib,
        )
        .unwrap();
        assert_eq!(resp["result"]["protocolVersion"], "2025-06-18");
        assert!(resp["result"]["capabilities"]["tools"].is_object());
        assert_eq!(resp["result"]["serverInfo"]["name"], SERVER_NAME);
    }

    #[test]
    fn initialize_未知版本回落到最新() {
        let lib = setup("init2");
        let resp = handle(
            &json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"1999-01-01"}}),
            &lib,
        )
        .unwrap();
        assert_eq!(resp["result"]["protocolVersion"], LATEST_PROTOCOL);
    }

    #[test]
    fn notifications_不产生应答() {
        let lib = setup("notif");
        let resp = handle(
            &json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
            &lib,
        );
        assert!(resp.is_none());
    }

    #[test]
    fn tools_list_返回十个工具() {
        let lib = setup("list");
        let resp = handle(&json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}), &lib).unwrap();
        let tools = resp["result"]["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 10);
        assert!(tools.iter().all(|t| t["inputSchema"].is_object()));
    }

    #[test]
    fn tools_call_成功返回文本内容() {
        let lib = setup("call");
        let resp = handle(
            &json!({
                "jsonrpc":"2.0","id":3,"method":"tools/call",
                "params":{"name":"list_notes","arguments":{}}
            }),
            &lib,
        )
        .unwrap();
        assert_eq!(resp["result"]["isError"], false);
        assert!(resp["result"]["content"][0]["text"].as_str().unwrap().contains("a.md"));
    }

    #[test]
    fn tools_call_未知工具返回协议错误() {
        let lib = setup("unknown");
        let resp = handle(
            &json!({
                "jsonrpc":"2.0","id":4,"method":"tools/call",
                "params":{"name":"nope","arguments":{}}
            }),
            &lib,
        )
        .unwrap();
        assert!(resp["error"].is_object());
        assert_eq!(resp["error"]["code"], codes::INVALID_PARAMS);
    }

    #[test]
    fn tools_call_路径越界返回执行错误而非协议错误() {
        let lib = setup("escape");
        let resp = handle(
            &json!({
                "jsonrpc":"2.0","id":5,"method":"tools/call",
                "params":{"name":"read_note","arguments":{"path":"../x.md"}}
            }),
            &lib,
        )
        .unwrap();
        assert_eq!(resp["result"]["isError"], true);
        assert!(resp["result"]["content"][0]["text"].as_str().unwrap().contains("失败"));
    }

    #[test]
    fn 未实现方法返回方法未找到() {
        let lib = setup("mf");
        let resp = handle(&json!({"jsonrpc":"2.0","id":6,"method":"nonexistent"}), &lib).unwrap();
        assert_eq!(resp["error"]["code"], codes::METHOD_NOT_FOUND);
    }

    #[test]
    fn ping_返回空结果() {
        let lib = setup("ping");
        let resp = handle(&json!({"jsonrpc":"2.0","id":7,"method":"ping"}), &lib).unwrap();
        assert!(resp["result"].is_object());
    }
}
