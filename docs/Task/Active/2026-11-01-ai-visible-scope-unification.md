# AI 可见范围统一（目录排除规则全应用生效）

## 一、背景与目标

Flymd 有一套目录排除规则，用来把模板 / 附件目录挡在 AI 的视野之外——
起因是用户库里的 `media/88-Template/每月稿费操作情况一览.md` 写着 16 条 `- [ ] 红薯订阅`
这类**占位符**，被 MCP 索引后当成了用户的真实待办。

v2.0.1 把这套规则做进了 MCP 服务器。但**它只管住了 MCP 一条通道**：

| AI 通道 | 走哪套排除规则 | 状态 |
|---|---|---|
| MCP 客户端 | `mcp-server/src/config.rs` 的 `McpConfig` | ✅ 完整生效 |
| 应用内定时任务（recipes 的 `{{files}}`） | `flymd_list_markdown_files` → 全树遍历 | ❌ 无过滤 |
| AI 助手的知识库（flymd-RAG） | 插件自己的 `excludeDirs`（默认空） | ❌ 默认不排除 |
| 插件的库文件枚举 | 宿主 TS 遍历 + 插件传入的 `excludeDirs` | ❌ 无全局规则 |
| ai-assistant 的 TODO 便签 | `context.invoke('read_text_file_any')` | ❌ 被 denylist 打死 |

最后一条是独立的既有 bug：插件 denylist（提交 `3161876`）比 ai-assistant 用这两个命令
（`a49b9f7`）**晚 1206 个提交**，加 denylist 时没扫到这处调用。结果
`createTodoStickyFromContent` 必然抛 `plugin cannot invoke internal command`，
用户看到的是「读取 TODO 文件失败」。

目标：**一套规则，全应用生效**。模板目录在哪个通道都不该出现——
否则边界只是「看起来有」，实际各走各的。

## 二、核心决定：规则只有一份，在 Rust 侧

排除规则的实现本来就在 `mcp-server/src/config.rs` 的 `McpConfig` 里，
而 `mcp-server` 的 **lib 目标**早就被 `src-tauri` 以路径依赖引进来（当初为了共享护栏核心）。

所以不需要写第二份匹配逻辑，也不需要在 TS 侧复刻一遍规则。
只要把 Rust 侧已有的能力**暴露给应用**：

```
flymd_mcp::config::McpConfig
      │
      ├── mcp-server（MCP 客户端）        ← 一直走这里
      │
      └── src-tauri（桌面应用）
            ├── flymd_list_markdown_files   ← 遍历时按规则剪枝
            ├── flymd_ai_scope               ← 返回生效的规则列表
            └── flymd_ai_scope_filter        ← 批量判定哪些路径被排除
```

**判定放在 Rust 侧、一次 IPC 判一批**。插件与宿主不实现匹配逻辑，
所以不存在「两边规则慢慢漂移」的问题。

## 三、落地方案

### 3.1 Rust 侧

**`mcp-server/src/config.rs`**

- 配置文件名从 `mcp.json` 扩展为 `ai-scope.json`——这套规则现在管的不只是 MCP。
- **旧名继续生效**：`<库根>/.flymd/mcp.json` 与 `~/.config/com.flymd/mcp.json` 仍然被读取，
  两个文件都读、都合并。用户已有配置不会因为改名而失效。
- 新增 `McpConfig::filter_excluded_files(&[String]) -> Vec<String>`：批量判定。

**`src-tauri/src/main.rs`**

- `flymd_list_markdown_files`：遍历时按规则**剪枝**（不是事后过滤）——
  被排除的目录整棵不进结果，也不必 stat 里面的每个文件。
- 新增 `flymd_ai_scope(library_root) -> { excluded, allowed }`。
- 新增 `flymd_ai_scope_filter(library_root, paths) -> { blocked }`。
- 抽出同步函数 `list_markdown_files_filtered()` 与 `resolve_ai_scope()`——命令本身是
  async + tauri runtime，抽出来才能直接单测。

### 3.2 宿主侧（`src/extensions/pluginHost.ts`）

新增四个插件 API：

| API | 作用 |
|---|---|
| `context.getAiScope()` | 取生效的排除 / 豁免规则（供插件展示与理解） |
| `context.filterAiExcludedPaths(paths)` | 批量判定哪些库内相对路径被排除 |
| `context.readLibraryFile(relPath)` | 读库内文件（库根约束 + 排除规则约束） |
| `context.writeLibraryFile(relPath, content)` | 写库内文件（同上 + **写入留护栏快照**） |

`listLibraryFiles` 的返回结果在返回前统一过滤一次（一次 IPC 判一批）。

**为什么给插件 `readLibraryFile` / `writeLibraryFile` 而不是给 denylist 开特例？**
`read_text_file_any` / `write_text_file_any` 接受**任意绝对路径**，放进 denylist 是对的；
但那样插件就没有任何办法写库内文件了（ai-assistant 的便签就是这么坏的）。
新 API 受库根与排除规则约束，是「受限入口」而不是「放开原有入口」。

### 3.3 插件侧

**`public/plugins/ai-assistant/main.js`**

TODO 便签改走 `context.readLibraryFile` / `context.writeLibraryFile`。
新增 `toLibraryRelPath()` 把库内绝对路径转成相对路径。

**`public/plugins/flymd-RAG/main.js`**

批量路径走宿主的 `listLibraryFiles`，宿主已经过滤过，**零改动继承**。
但**增量监听**路径绕过了 `listLibraryFiles`（它走文件 watcher），
所以在两个增量入口补 `isAiScopeBlocked()` 判定（同样交给宿主，规则不复制）。

## 四、安全边界

- 插件 API 的库根由宿主决定，**不接受插件传入**（与 `ai_guard_*` 同一条规矩）
- `readLibraryFile` / `writeLibraryFile` 的路径必须是库内相对路径：
  绝对路径、前导斜杠、`..` 越界一律拒绝（前导斜杠也拒绝——与 MCP 的
  `resolve_write_path` 约定一致，不猜测用户是不是想表达「从库根开始」）
- 落在被排除目录里的路径拒绝读写：AI 不该看见的地方，插件也不该碰
- 写入前自动留 AI 写入护栏快照，可回滚
- **判定失败时拒绝**：宁可一次合法写入被拒，也不能在规则失效时放行

## 五、验证

### 5.1 Rust 单测（`src-tauri/src/main.rs` 的 `ai_scope_tests`）

- 全库扫描排除 `media/` 目录
- 全库扫描遵守库级 `.flymd/ai-scope.json` 配置
- `allowDirs` 优先于 `excludeDirs`（豁免的目录重新出现，其余 media 子目录仍排除）
- 批量过滤返回被排除的相对路径
- 库根必须是绝对路径

### 5.2 MCP 单测（`mcp-server/src/config.rs`）

- 通用名 `ai-scope.json` 与旧名 `mcp.json` 都读、都生效
- 库级配置候选路径含新旧两个名字
- 批量过滤返回被排除的路径

### 5.3 TS 单测（`src/extensions/aiScope.test.ts`）

- `normalizeLibraryRelPath`：接受库内相对路径；拒绝绝对路径 / 前导斜杠 / `..` / 空 / 非字符串
- 匹配语义的参考实现与 Rust 侧交叉校验（目录名任意层级、路径前缀、大小写不敏感）

### 5.4 真实库实测

用户的真实库 `media/` 下有 4 个 md 文件、30 条假待办。统一后：
MCP、定时任务、知识库、插件枚举都应看不到它们。

## 六、未决事项

1. **`plugin.en.md` 整体落后中文版**：15+ 个 API（含 `listLibraryFiles`）在英文版没有记录。
   本轮只补了新增的 AI 范围与库内读写 API，完整同步单列。
2. **RAG 索引里的历史残留**：若某个模板目录此前已被索引进 RAG 知识库，
   需要重建一次索引才会清掉（重建时走的是已过滤的 `listLibraryFiles`）。
3. **多窗口**：两个窗口各自有一份 recipes 引擎，定时任务会跑两次（与 recipes 文档里的已知限制同源）。
