//! flymd MCP 服务器入口。
//!
//! 以 stdio 传输与 MCP 客户端（Claude Code / Cursor / Codex 等）通信，
//! 把本地 flymd 笔记库以**只读**方式暴露出去。
//!
//! 用法：
//! ```text
//! flymd-mcp [--library <库根路径>] [--transport stdio]
//! ```
//! 库根定位优先级：`--library` > 环境变量 `FLYMD_LIBRARY` > flymd 应用设置文件 > 当前目录。

use std::io::{BufRead, BufWriter, Write};
use std::process::ExitCode;

mod library;
mod parse;
mod protocol;
mod tools;

use library::Library;

const USAGE: &str = "\
flymd-mcp — flymd 笔记库的 MCP (Model Context Protocol) 服务器

用法:
  flymd-mcp [选项]

选项:
  -l, --library <路径>   指定笔记库根目录（默认从 flymd 应用设置自动读取）
      --transport <类型>  传输方式，当前仅支持 stdio
  -h, --help             显示本帮助
  -V, --version          显示版本号

环境变量:
  FLYMD_LIBRARY           等价于 --library

在 MCP 客户端中的配置示例（Claude Code）:
  claude mcp add flymd -- flymd-mcp

注意: 本服务器对笔记库只读，不会修改任何文件。
";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let opts = match parse_args(&args) {
        Ok(Some(o)) => o,
        Ok(None) => return ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("flymd-mcp: {e}");
            eprintln!("\n{USAGE}");
            return ExitCode::from(2);
        }
    };

    let lib = match Library::resolve(opts.library.as_deref()) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("flymd-mcp: {e}");
            return ExitCode::from(3);
        }
    };

    // 日志一律走 stderr，stdout 是协议通道。
    eprintln!(
        "flymd-mcp v{} 已启动，库根: {}",
        protocol::SERVER_VERSION,
        lib.root().display()
    );

    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = BufWriter::new(stdout.lock());

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(e) => {
                eprintln!("flymd-mcp: 读取 stdin 失败: {e}");
                break;
            }
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let msg: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(e) => {
                let resp = protocol::error_response(
                    serde_json::Value::Null,
                    protocol::codes::PARSE_ERROR,
                    &format!("JSON 解析失败: {e}"),
                );
                if write_message(&mut out, &resp).is_err() {
                    break;
                }
                continue;
            }
        };
        if let Some(resp) = protocol::handle(&msg, &lib) {
            if write_message(&mut out, &resp).is_err() {
                break;
            }
        }
    }
    ExitCode::SUCCESS
}

/// 写一条 JSON-RPC 消息并立即冲刷（客户端是逐行等待响应的）。
fn write_message<W: Write>(out: &mut W, msg: &serde_json::Value) -> std::io::Result<()> {
    let s = serde_json::to_string(msg)?;
    out.write_all(s.as_bytes())?;
    out.write_all(b"\n")?;
    out.flush()
}

/// 命令行选项。
struct Options {
    library: Option<String>,
}

/// 解析命令行。返回 `Ok(None)` 表示是 `--help` / `--version`，应直接退出。
fn parse_args(args: &[String]) -> Result<Option<Options>, String> {
    let mut library: Option<String> = None;
    let mut i = 0;
    while i < args.len() {
        let a = args[i].as_str();
        match a {
            "-h" | "--help" => {
                print!("{USAGE}");
                return Ok(None);
            }
            "-V" | "--version" => {
                println!("{} {}", protocol::SERVER_NAME, protocol::SERVER_VERSION);
                return Ok(None);
            }
            "--transport" => {
                let v = args
                    .get(i + 1)
                    .ok_or_else(|| "--transport 需要一个参数".to_string())?;
                if v != "stdio" {
                    return Err(format!("不支持的传输方式: {v}（当前仅支持 stdio）"));
                }
                i += 2;
            }
            "-l" | "--library" => {
                let v = args
                    .get(i + 1)
                    .ok_or_else(|| "--library 需要一个路径参数".to_string())?;
                library = Some(v.clone());
                i += 2;
            }
            other => {
                if let Some(v) = other.strip_prefix("--library=") {
                    library = Some(v.to_string());
                    i += 1;
                } else if let Some(v) = other.strip_prefix("--transport=") {
                    if v != "stdio" {
                        return Err(format!("不支持的传输方式: {v}（当前仅支持 stdio）"));
                    }
                    i += 1;
                } else {
                    return Err(format!("未知参数: {other}"));
                }
            }
        }
    }
    Ok(Some(Options { library }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 解析_library_参数() {
        let opts = parse_args(&["--library".into(), "/tmp/x".into()]).unwrap().unwrap();
        assert_eq!(opts.library.as_deref(), Some("/tmp/x"));
    }

    #[test]
    fn 解析_library_等号形式() {
        let opts = parse_args(&["--library=/tmp/y".into()]).unwrap().unwrap();
        assert_eq!(opts.library.as_deref(), Some("/tmp/y"));
    }

    #[test]
    fn 解析_短参数() {
        let opts = parse_args(&["-l".into(), "/tmp/z".into()]).unwrap().unwrap();
        assert_eq!(opts.library.as_deref(), Some("/tmp/z"));
    }

    #[test]
    fn 未知参数报错() {
        assert!(parse_args(&["--bogus".into()]).is_err());
    }

    #[test]
    fn 缺少参数值报错() {
        assert!(parse_args(&["--library".into()]).is_err());
    }

    #[test]
    fn 非_stdio_传输被拒绝() {
        assert!(parse_args(&["--transport".into(), "http".into()]).is_err());
    }
}
