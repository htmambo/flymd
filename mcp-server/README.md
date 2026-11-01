# flymd-mcp

flymd 笔记库的 **MCP (Model Context Protocol) 服务器**：把本地笔记库暴露给 Claude Code、Cursor、Codex 等 MCP 客户端。

独立 Rust crate，零重依赖（仅 `serde` / `serde_json` / `regex`），release 产物约 1.4 MB。

> **v0.2.0**：只读 + 目录排除。
> **v0.3.0+**：增加 AI 写入护栏与写入工具——每次写入前强制快照，可预览、可回滚。
> **v0.3.1+**：目录排除规则改为**全应用共用**（定时任务 / 知识库 / 插件枚举也遵守），
> 配置文件名扩展为 `ai-scope.json`；**旧名 `mcp.json` 继续生效**。

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

## crate 结构：lib + bin

```
mcp-server/src/
├── lib.rs       # lib 目标：pub mod config / diff / guard / time
├── config.rs    # 目录排除配置：来源合并、匹配语义、配置文件读取
├── diff.rs      # 行级 unified diff（自己实现的 LCS，无外部依赖）
├── guard.rs     # AI 写入护栏：快照存储、SHA-256、回滚、保留上限
├── time.rs      # UTC 日期换算（快照 ID 与时间戳）
├── main.rs      # bin 目标：CLI 解析、stdio JSON-RPC 循环
├── protocol.rs  # JSON-RPC 2.0 分发 + MCP 握手
├── library.rs   # 库根定位、文件索引（含目录排除）、路径安全
├── parse.rs     # 标题 / 待办 / 双链抽取
└── tools.rs     # 工具 schema 与实现
```

**lib 目标刻意只依赖 `serde` / `serde_json`**（不引 `regex`），这样 `src-tauri`
可以把它作为路径依赖引进来：

```toml
# src-tauri/Cargo.toml
flymd-mcp = { path = "../mcp-server" }
```

应用内的 AI 写入护栏（`src-tauri/src/ai_guard.rs`）与 MCP 侧的写入护栏**共用**
`guard` 与 `diff` 这两份实现——**快照格式的一致性由「同一份代码」保证**，
而不是靠两边各写一遍再对齐约定。对 Tauri 应用而言，这**不新增任何外部依赖**
（`regex` 本来就被 `tauri-utils` / `tauri-plugin-http` 依赖）。

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

### 只读（v0.2.0 起）

| 工具 | 参数 | 说明 |
|---|---|---|
| `list_notes` | `filter?` `limit?` | 列出库内所有 Markdown 笔记（相对路径 / 大小 / 修改时间） |
| `read_note` | `path` | 读取单个笔记的完整 Markdown 内容 |
| `search` | `query` `regex?` `ignore_case?` `limit?` | 全库全文搜索，返回 `文件:行号: 内容` |
| `get_outline` | `path` | 提取标题大纲（含层级与行号） |
| `list_tasks` | `path?` `include_done?` | 提取待办项（`- [ ]` / `- [x]`），不传 `path` 则扫描全库 |
| `get_backlinks` | `path` | 查询指向某笔记的双链来源（`[[目标]]`） |

### 写入（v0.3.0+）

| 工具 | 参数 | 说明 |
|---|---|---|
| `preview_write` | `path` `content` | 返回 unified diff，**不写盘、不产生快照** |
| `write_note` | `path` `content` `reason?` | 快照 → 写入 → 返回 diff 与快照 ID |
| `list_writes` | `limit?` | 列出本库可回滚的写入 |
| `rollback_write` | `snapshotId` `confirm?` | 回滚到指定快照；「文件原本不存在」语义需 `confirm: true` |

写入的硬约束：单次 ≤ 1 MB、一次只改一个文件、不得写入被排除目录、
**快照写不成功就中止写入**。

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

## AI 写入护栏（v0.3.0+）

写入的核心承诺：**每次写入前留痕、写入可预览、写入可回滚**。

### 快照格式

```
<库根>/.flymd/ai-guard/
└── 20261101T165300Z-a1b2c3/          # 一次写入 = 一个独立目录
    ├── meta.json                     # 元数据（camelCase 字段）
    ├── before.md                     # 写入前的原始内容（原文件不存在时不生成）
    └── after.md                      # 写入后的内容
```

`meta.json` 字段：`id` `createdAt` `operation` `actor` `path` `existedBefore`
`beforeSha256` `afterSha256` `beforeBytes` `afterBytes` `reason` `rollbackOf` `truncated`。

- 快照 ID：`YYYYMMDDTHHMMSSZ-<6 位十六进制>`，字典序即时间序，**不需要索引文件**
  （独立目录避免了并发写索引的竞争）
- `rollbackOf`：回滚本身也生成快照，指向被回滚的那次 —— **回滚可以再回滚**
- `existedBefore: false` 时不生成 `before.md`，回滚语义 = **删除该文件**

### 保留上限

| 约束 | 默认值 |
|---|---|
| 单个快照内容上限 | 1 MB（超出的标记 `truncated: true`，**不可回滚**，回滚时报明确错误） |
| 保留数量上限 | 最近 50 个 |
| 保留总量上限 | 100 MB |

被截断的快照要**显式标记**，不能假装能回滚——否则用户回滚失败时无从判断原因。

### 写入流程

1. 校验路径：越界防护 + 被排除目录拒绝 + 符号链接拒绝
2. 读原内容；原文件超 1 MB → 拒绝（没法生成可回滚快照）
3. **建快照**（失败即中止——不能留下没有回滚路径的改动）
4. **原子写**（先写临时文件再 rename）
5. 返回 diff + 快照 ID

### 与应用侧的关系

护栏内核在 lib 目标里，`src-tauri` 以路径依赖引用同一份实现。因此：

- 应用内 AI 助手的写入与 MCP 客户端的写入落在**同一个快照目录**
- 两边互相可回滚：在应用里能回滚 MCP 的写入，在 MCP 里也能回滚应用的写入
- 快照**不参与 WebDAV 同步**（`src/extensions/webdavSync.ts` 的 `DEFAULT_EXCLUDE_GLOBS`）

设计文档：`docs/Task/Active/2026-11-01-ai-write-guard.md`

---

## 安全边界

| 防护 | 实现 |
|---|---|
| 只读 | 当前切片不提供任何写入工具 |
| 路径限制 | 所有路径必须是**相对库根**的相对路径；绝对路径、`..`、Windows 前缀一律拒绝 |
| 符号链接逃逸 | 目标文件 `canonicalize` 后必须仍在库根内，指向库外的链接被拒绝 |
| 体积上限 | 单个笔记读取上限 4 MB；输出上限 12 万字符 |
| 目录排除 | 被排除目录不进索引、也不可读取，规则可配置（见上节） |
| 写入护栏 | 写入前强制快照；快照写不成功即中止写入；可回滚（回滚亦留快照） |
| 通道隔离 | **stdout 只承载 JSON-RPC 协议消息**，所有日志写 stderr |

路径穿越、符号链接逃逸、目录排除、写入护栏都有对应的单元测试覆盖
（`library::tests`、`config::tests`、`guard::tests`、`tools::tests`）。

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

93 个单元测试，覆盖：围栏代码块内的伪标题/伪待办/伪链接不会被抽取、路径穿越拒绝、
指向库外的符号链接拒绝、超大文件拦截、反链归一化匹配、协议握手与错误分层、CLI 参数解析、
目录排除的索引屏蔽/读取拒绝/allow 豁免/多来源合并、快照的创建/回滚/截断标记/保留上限、
写入工具的越界与排除目录拒绝与原子写、UTC 日期换算的往返一致性。
