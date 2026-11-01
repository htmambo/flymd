# flymd-mcp

flymd 笔记库的 **MCP (Model Context Protocol) 服务器**：把本地笔记库以**只读**方式暴露给 Claude Code、Cursor、Codex 等 MCP 客户端。

独立 Rust crate，零重依赖（仅 `serde` / `serde_json` / `regex`），release 产物约 1.3 MB。

> 当前切片**全部只读**——不提供任何写入笔记的通道。AI 客户端能读、能搜、能看大纲与待办，但**不能改动用户的任何文件**。

---

## 快速开始

```bash
# 构建
cargo build --release --manifest-path mcp-server/Cargo.toml

# 运行（自动从 flymd 应用设置读取库根）
./mcp-server/target/release/flymd-mcp

# 手动指定库根
./mcp-server/target/release/flymd-mcp --library "/path/to/notes"

# 额外排除目录（可重复）
./mcp-server/target/release/flymd-mcp --exclude media --exclude 模板

# 查看当前生效的排除配置
./mcp-server/target/release/flymd-mcp --print-config

# 交互式验证
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' \
  | ./mcp-server/target/release/flymd-mcp
```

仓库根目录也提供了封装脚本：

```bash
node scripts/build-mcp-server.mjs     # 构建 + 放入 src-tauri/binaries/
node scripts/build-mcp-server.mjs --universal   # macOS universal（lipo 合并）
node scripts/bundle-mcp-server.mjs    # 注入打包产物（尽力而为，不阻断构建）
pnpm mcp:test                         # 跑 Rust 单元测试
```

---

## 在 MCP 客户端中配置

### Claude Code

```bash
claude mcp add flymd -- /path/to/flymd-mcp
# 或显式指定库根
claude mcp add flymd -- /path/to/flymd-mcp --library /path/to/notes
```

写入 `~/.claude.json`（或项目级 `.mcp.json`）：

```json
{
  "mcpServers": {
    "flymd": {
      "command": "/path/to/flymd-mcp",
      "args": ["--library", "/path/to/notes"]
    }
  }
}
```

### Cursor

在 `~/.cursor/mcp.json` 中：

```json
{
  "mcpServers": {
    "flymd": {
      "command": "/path/to/flymd-mcp",
      "args": ["--library", "/path/to/notes"]
    }
  }
}
```

### Codex

`~/.codex/config.toml`：

```toml
[mcp_servers.flymd]
command = "/path/to/flymd-mcp"
args = ["--library", "/path/to/notes"]
```

---

## 工具清单

| 工具 | 参数 | 说明 |
|---|---|---|
| `list_notes` | `filter?` `limit?` | 列出库内所有 Markdown 笔记（相对路径 / 大小 / 修改时间） |
| `read_note` | `path` | 读取单个笔记的完整 Markdown 内容 |
| `search` | `query` `regex?` `ignore_case?` `limit?` | 全库全文搜索，返回 `文件:行号: 内容` |
| `get_outline` | `path` | 提取标题大纲（含层级与行号） |
| `list_tasks` | `path?` `include_done?` | 提取待办项（`- [ ]` / `- [x]`），不传 `path` 则扫描全库 |
| `get_backlinks` | `path` | 查询指向某笔记的双链来源（`[[目标]]`） |

---

## 库根定位优先级

1. `--library <路径>` 命令行参数
2. 环境变量 `FLYMD_LIBRARY`
3. flymd 应用设置文件（按平台）：
   - macOS：`~/Library/Application Support/com.flymd/flymd-settings.json`
   - Linux：`$XDG_CONFIG_HOME/com.flymd/flymd-settings.json`（或 `~/.config/com.flymd/`）
   - Windows：`%APPDATA%\com.flymd\flymd-settings.json`
   - 便携模式：可执行文件同级目录的 `flymd-settings.json`
4. 当前目录（若含 `.md` 文件）

设置文件里优先取 `activeLibraryId` 对应的库，其次取 `libraryRoot`。

---

## 目录排除

Obsidian 库里的 `media/`、`templates/` 装的是附件和模板，不是笔记。把它们喂给 AI 会污染
搜索、待办和列表结果——模板里的 `- [ ] 某某订阅` 会被当成用户的真待办。

### 配置来源（按优先级合并，不是替换）

| 来源 | 位置 |
|---|---|
| 内置默认 | 技术目录 + 常见资源/模板目录（见下） |
| 用户级配置 | `~/.config/com.flymd/mcp.json`（macOS：`~/Library/Application Support/com.flymd/mcp.json`） |
| 库级配置 | `<库根>/.flymd/mcp.json`（随库走、随 WebDAV 同步） |
| 环境变量 | `FLYMD_MCP_EXCLUDE`，逗号或分号分隔 |
| 命令行 | `--exclude <目录>`，可重复 |

内置默认排除：

- 技术目录：`.git` `.hg` `.svn` `node_modules` `target` `dist` `build` `.next` `.vite` `.obsidian` `.trash` `.flymd` `ebwebview` `code cache` `gpucache` `service worker`
- 附件/资源/模板：`media` `assets` `asset` `attachment` `attachments` `templates` `template` `excalidraw` `.excalidraw` `附件` `模板`

### 配置文件格式

```json
{
  "excludeDirs": ["我的草稿", "工作/归档"],
  "allowDirs": ["media/重要笔记"]
}
```

`exclude` / `allow` 是 `excludeDirs` / `allowDirs` 的别名。

### 匹配语义

- 模式**不含** `/` → 按**目录名**匹配，任意层级命中（`media` 命中 `a/b/media`）
- 模式**含** `/` → 按**相对库根的路径前缀**匹配（`工作/归档` 只命中那一处）
- 大小写不敏感
- `allowDirs` 优先于 `excludeDirs`
  - allow 路径的**祖先目录也会放行**，否则遍历到祖先就停了，永远走不到被豁免的子目录

### 全屏障

被排除的目录整棵不进索引（影响 `list_notes` / `search` / `list_tasks` / `get_backlinks`），
且 `read_note` 读到被排除路径直接报错——否则 AI 猜到路径仍能读到，排除形同虚设。

### 自查

```bash
flymd-mcp --print-config
```

输出 JSON：库根、生效的排除/保留规则、加载了哪些配置文件、**库内实际被排除了哪些目录**、
索引里剩多少篇笔记。服务器启动时也会往 stderr 打一行被排除目录的提示。

---

## 安全边界

| 防护 | 实现 |
|---|---|
| 只读 | 当前切片不提供任何写入工具 |
| 路径限制 | 所有路径必须是**相对库根**的相对路径；绝对路径、`..`、Windows 前缀一律拒绝 |
| 符号链接逃逸 | 目标文件 `canonicalize` 后必须仍在库根内，指向库外的链接被拒绝 |
| 体积上限 | 单个笔记读取上限 4 MB；输出上限 12 万字符 |
| 目录排除 | 被排除目录不进索引、也不可读取，规则可配置（见上节） |
| 通道隔离 | **stdout 只承载 JSON-RPC 协议消息**，所有日志写 stderr |

路径穿越、符号链接逃逸、目录排除都有对应的单元测试覆盖（`library::tests`、`config::tests`）。

---

## 架构

```
mcp-server/src/
├── main.rs       # CLI 解析、stdio JSON-RPC 循环、--print-config
├── protocol.rs   # JSON-RPC 2.0 分发 + MCP 握手（协议版本协商）
├── config.rs     # 目录排除配置：来源合并、匹配语义、配置文件读取
├── library.rs    # 库根定位、文件索引（含目录排除）、路径安全、时间格式化
├── parse.rs      # 标题 / 待办 / 双链抽取（均跳过围栏代码块）
└── tools.rs      # 工具 schema 与实现
```

**协议版本协商**：`initialize` 时若客户端请求的版本在支持列表内则原样应答，否则回落到 `2025-06-18`。

**错误分层**（按 MCP 规范）：未知工具 / 参数非法 → JSON-RPC error；文件不存在 / 路径越界等执行错误 → `isError: true` + 文本内容。

---

## 测试

```bash
cargo test --manifest-path mcp-server/Cargo.toml
cargo clippy --manifest-path mcp-server/Cargo.toml --all-targets
```

63 个单元测试，覆盖：围栏代码块内的伪标题/伪待办/伪链接不会被抽取、路径穿越拒绝、
指向库外的符号链接拒绝、超大文件拦截、反链归一化匹配、协议握手与错误分层、CLI 参数解析、
目录排除的索引屏蔽/读取拒绝/allow 豁免/多来源合并。
