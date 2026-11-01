# MCP 服务器使用指南

**适用版本**：flymd v1.5.0+
**能力状态**：只读（当前切片不提供写入通道）

flymd 内置一个 MCP (Model Context Protocol) 服务器，可以把你的笔记库交给 Claude Code、Cursor、Codex 等 AI 编程工具直接读取——AI 能翻你的笔记、搜你的笔记、看你的待办和文档大纲，但**不能修改你的任何文件**。

---

## 1. 它能做什么

| 工具 | 作用 |
|---|---|
| `list_notes` | 列出库里所有 Markdown 笔记（相对路径 / 大小 / 修改时间） |
| `read_note` | 读取单篇笔记全文 |
| `search` | 全库全文搜索，支持正则，返回 `文件:行号: 内容` |
| `get_outline` | 提取标题大纲（含层级与行号），快速摸清长文档结构 |
| `list_tasks` | 提取待办项（`- [ ]` / `- [x]`），可全库扫描 |
| `get_backlinks` | 查出哪些笔记通过 `[[双链]]` 指向了目标笔记 |

典型用法：让 AI 基于你的真实笔记回答问题、给会议纪要生成待办、检查某篇笔记被哪些地方引用、基于知识库写一篇新文章。

---

## 2. 获取 MCP 服务器

### 方式一：从 Release 下载独立二进制（推荐）

在 [Releases](https://github.com/htmambo/flymd/releases) 下载对应平台的独立二进制：

| 平台 | 文件 |
|---|---|
| Windows x64 | `flymd-mcp-windows-x64.exe` |
| macOS (Intel + Apple Silicon) | `flymd-mcp-macos-universal` |
| Linux x64 | `flymd-mcp-linux-x64` |

> 文件名带平台后缀是为了避免 GitHub Release 的同名资产冲突。下载后建议改名为
> `flymd-mcp`（Windows 保留 `.exe`），或在客户端配置里直接引用上面的文件名。

### 方式二：用已安装的桌面版

桌面安装包内也带了一份：

- **macOS**：`/Applications/flymd.app/Contents/MacOS/flymd-mcp`
- **Windows**：与 `flymd.exe` 同目录

### 方式三：从源码构建

```bash
git clone https://github.com/htmambo/flymd.git
cd flymd
node scripts/build-mcp-server.mjs
# 产物：mcp-server/target/release/flymd-mcp
```

---

## 3. 配置 AI 客户端

### Claude Code

```bash
claude mcp add flymd -- /绝对路径/flymd-mcp
```

### Cursor

编辑 `~/.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "flymd": {
      "command": "/绝对路径/flymd-mcp",
      "args": ["--library", "/你的笔记库根目录"]
    }
  }
}
```

### Codex

编辑 `~/.codex/config.toml`：

```toml
[mcp_servers.flymd]
command = "/绝对路径/flymd-mcp"
args = ["--library", "/你的笔记库根目录"]
```

> 💡 `--library` 是可选的。不写时，flymd-mcp 会自动从 flymd 应用设置里读取**当前激活的文库路径**，一般不需要手动指定。

---

## 4. 找到你的笔记库根目录

打开 flymd → 左侧库面板 → 当前文库右键 → 复制路径。

或者直接看设置文件：

- **macOS**：`~/Library/Application Support/com.flymd/flymd-settings.json`
- **Linux**：`~/.config/com.flymd/flymd-settings.json`
- **Windows**：`%APPDATA%\com.flymd\flymd-settings.json`

其中 `libraryRoot` 字段即当前库路径，`libraries` 数组里是全部已登记的文库。

---

## 5. 手动验证

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_notes","arguments":{"limit":5}}}' \
  | /绝对路径/flymd-mcp
```

正常输出类似：

```json
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"flymd-mcp","version":"0.1.0"}}}
{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"共 1134 个笔记，显示 5 个：\n- ..."}],"isError":false}}
```

---

## 6. 安全说明

flymd 的本地优先承诺同样适用于 MCP 服务器：

- **只读**：当前版本不提供任何写入工具，AI 无法修改你的笔记
- **路径受限**：所有访问都被限制在文库根目录内，绝对路径、`..`、指向库外的符号链接一律拒绝
- **不出网**：MCP 服务器本身不访问网络；AI 客户端请求走的是它自己配置的模型通道
- **体积上限**：单篇笔记读取上限 4 MB，单次输出上限 12 万字符，避免把模型上下文一次打爆
- **忽略目录**：`.git` `.flymd` `.obsidian` `.trash` `node_modules` 等目录不会被索引

> ⚠️ 需要注意的是：把笔记库交给 AI 客户端后，**你读到的内容会被发送给你所使用的模型服务商**。本地优先是指数据默认不出你的机器，AI 场景下这是一次显式的外发，请自行判断。

---

## 7. 常见问题

**Q：找不到笔记库怎么办？**
用 `--library` 显式指定，或设置环境变量 `FLYMD_LIBRARY=/你的笔记库根目录`。

**Q：搜索支持正则吗？**
支持，把 `regex` 参数设为 `true`。默认是字面量匹配，忽略大小写。

**Q：能修改笔记吗？**
当前版本不能。这是刻意的设计——先把只读能力做扎实，写入通道会在引入差异预览与回滚机制之后再开放。

**Q：待办识别会误报代码块里的内容吗？**
不会。标题、待办、双链三类抽取都会跳过围栏代码块内的内容。

**Q：和 flymd 应用需要同时运行吗？**
不需要。flymd-mcp 是独立进程，直接读磁盘上的文件。
