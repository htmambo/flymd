//! flymd MCP 服务器入口。
//!
//! 以 stdio 传输与 MCP 客户端（Claude Code / Cursor / Codex 等）通信，
//! 把本地 flymd 笔记库以**只读**方式暴露出去。
//!
//! 用法：
//! ```text
//! flymd-mcp [--library <库根路径>] [--transport stdio] [--exclude <目录>] [--print-config]
//! ```
//! 库根定位优先级：`--library` > 环境变量 `FLYMD_LIBRARY` > flymd 应用设置文件 > 当前目录。

use std::io::{BufRead, BufWriter, Write};
use std::process::ExitCode;

mod config;
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
      --exclude <目录>   排除目录，不对 MCP 客户端开放（可重复）
      --print-config     打印当前生效的排除配置与被排除目录后退出
      --transport <类型>  传输方式，当前仅支持 stdio
  -h, --help             显示本帮助
  -V, --version          显示版本号

环境变量:
  FLYMD_LIBRARY           等价于 --library
  FLYMD_MCP_EXCLUDE       逗号分隔的排除目录，语义同 --exclude

目录排除（按优先级合并）:
  1. 内置默认（技术目录 + media/assets/templates 等资源目录）
  2. 用户级配置 ~/.config/com.flymd/mcp.json
  3. 库级配置 <库根>/.flymd/mcp.json（随库走、随 WebDAV 同步）
  4. 环境变量 FLYMD_MCP_EXCLUDE
  5. 命令行 --exclude

  被排除的目录整棵不进索引，AI 也无法读到里面的文件。

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

    let lib = match Library::resolve(opts.library.as_deref(), &opts.excludes) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("flymd-mcp: {e}");
            return ExitCode::from(3);
        }
    };

    // --print-config：打印生效配置与实际被排除的目录后退出，用于排查。
    if opts.print_config {
        print_config(&lib);
        return ExitCode::SUCCESS;
    }

    // 日志一律走 stderr，stdout 是协议通道。
    eprintln!(
        "flymd-mcp v{} 已启动，库根: {}",
        protocol::SERVER_VERSION,
        lib.root().display()
    );
    let excluded = lib.excluded_dirs();
    if !excluded.is_empty() {
        eprintln!(
            "已排除 {} 个目录（不对 MCP 客户端开放）：{}",
            excluded.len(),
            excluded.join("、")
        );
    }

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

/// 打印当前生效的排除配置（`--print-config`）。
fn print_config(lib: &Library) {
    let cfg = lib.config();
    let excluded = lib.excluded_dirs();
    let sources: Vec<serde_json::Value> = config::user_config_path()
        .map(|p| serde_json::json!({"级别": "用户级", "路径": p.to_string_lossy()}))
        .into_iter()
        .chain({
            let p = config::library_config_path(lib.root());
            if p.exists() {
                Some(serde_json::json!({
                    "级别": "库级",
                    "路径": p.to_string_lossy(),
                }))
            } else {
                None
            }
        })
        .collect();

    let out = serde_json::json!({
        "库根": lib.root().to_string_lossy(),
        "排除规则": cfg.exclude,
        "保留规则": cfg.allow,
        "已加载的配置文件": sources,
        "库内实际被排除的目录": excluded,
        "笔记总数": lib.notes().len(),
    });
    println!("{}", serde_json::to_string_pretty(&out).unwrap_or_default());
}

/// 命令行选项。
struct Options {
    library: Option<String>,
    /// 命令行排除的目录（可重复）
    excludes: Vec<String>,
    /// 是否只打印配置后退出
    print_config: bool,
}

/// 解析命令行。返回 `Ok(None)` 表示是 `--help` / `--version`，应直接退出。
fn parse_args(args: &[String]) -> Result<Option<Options>, String> {
    let mut library: Option<String> = None;
    let mut excludes: Vec<String> = Vec::new();
    let mut print_config = false;
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
            "--print-config" => {
                print_config = true;
                i += 1;
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
            "--exclude" => {
                let v = args
                    .get(i + 1)
                    .ok_or_else(|| "--exclude 需要一个目录名参数".to_string())?;
                excludes.push(v.clone());
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
                } else if let Some(v) = other.strip_prefix("--exclude=") {
                    excludes.push(v.to_string());
                    i += 1;
                } else {
                    return Err(format!("未知参数: {other}"));
                }
            }
        }
    }
    Ok(Some(Options {
        library,
        excludes,
        print_config,
    }))
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

    #[test]
    fn 解析_exclude_参数可重复() {
        let opts = parse_args(&[
            "--exclude".into(),
            "media".into(),
            "--exclude".into(),
            "模板".into(),
        ])
        .unwrap()
        .unwrap();
        assert_eq!(opts.excludes, vec!["media".to_string(), "模板".to_string()]);
    }

    #[test]
    fn 解析_exclude_等号形式() {
        let opts = parse_args(&["--exclude=media".into()]).unwrap().unwrap();
        assert_eq!(opts.excludes, vec!["media".to_string()]);
    }

    #[test]
    fn 解析_print_config() {
        let opts = parse_args(&["--print-config".into()]).unwrap().unwrap();
        assert!(opts.print_config);
        let opts = parse_args(&[]).unwrap().unwrap();
        assert!(!opts.print_config);
    }

    #[test]
    fn exclude_缺少参数报错() {
        assert!(parse_args(&["--exclude".into()]).is_err());
    }
}
