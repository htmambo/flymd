# AI 写入护栏与回滚（P0-3）

**状态**：设计已定，待实施
**关联**：§3.1 MCP Server（只读切片）、§3.2 MCP 目录排除机制（见 `2026-11-01-competitive-gap-and-release-line.md`）

---

## 一、背景与目标

flymd 目前把笔记库通过 MCP 交给 AI，但**只读**。这是刻意的——先把只读做扎实，写通道再开。

问题在于：**只读不能一直只读**。SoloMD（1458★）与 Markra（2422★）都已经允许 AI 写入笔记，
并且都配套了护栏：SoloMD 每次写入落到独立 AutoGit 分支，Accept/Reject，写入上限 5 处；
Markra 在编辑前给出预览。flymd 若只补写入而不补护栏，等于把「AI 把笔记写坏了且无法回滚」
这个风险直接暴露给用户——这是相对竞品**从领先变落后**的一步。

**目标**：让**任何来源的 AI 写入**（应用内 AI 助手、插件、MCP 客户端）都满足三条：

1. **写入前留痕**——原内容必被快照，不留死角
2. **写入可预览**——AI 能先看 diff 再决定要不要落盘
3. **写入可回滚**——任何一次写入都能回到写入前的样子

---

## 二、竞品做法与取舍

| 方案 | 做法 | 门槛 | 取舍 |
|---|---|---|---|
| SoloMD AutoGit 分支 | 每次写入落独立分支，Accept/Reject | 需要 Git，且分支模型对非技术用户不直观 | 分支切换的心智负担重，用户容易「分支越攒越多不敢删」 |
| Markra 编辑前预览 | 预览 diff 后再写 | 无 | 只能防「这一次」，防不住「写进去之后发现错了再想改回来」 |
| Git tag 快照 | 每次写前打 tag | 需要库已 `git init` | 同 SoloMD 的门槛问题：**没初始化 Git 的用户完全用不上** |

**决策**：做**两级护栏**，互不依赖。

- **L1 无门槛层（默认，所有用户）**：文件内容快照存到 `<库根>/.flymd/ai-guard/`。
  不需要 Git，不改变用户的工作方式，**任何库都开箱可用**。
- **L2 Git 层（库已 `git init` 时自动叠加）**：额外打一次 commit 快照，保留完整历史，
  用户已有 Git 习惯就能用 `git diff` / `git checkout` 自行处理。

L1 是保底，L2 是加分。**L1 不依赖 Git** 是关键——否则护栏对「没装 Git 的普通用户」形同虚设，
而这恰恰是大多数用户。

---

## 三、核心设计：快照格式规范 v1

### 3.1 存储布局

```
<库根>/.flymd/ai-guard/
└── 20261101T165300Z-a1b2c3/          # 一次写入 = 一个独立目录
    ├── meta.json                     # 元数据
    ├── before.md                     # 写入前的原始内容
    └── after.md                      # 写入后的内容（用于对比与"再来一次"）
```

- **快照 ID**：`YYYYMMDDTHHMMSSZ-<6 位随机十六进制>`，按字典序即可排序，**不需要索引文件**——
  独立目录避免了并发写入索引的竞争。
- **写前不存在**的文件：`meta.json` 里 `existedBefore: false`，此时不生成 `before.md`，
  回滚语义 = **删除**该文件。

### 3.2 meta.json

```json
{
  "id": "20261101T165300Z-a1b2c3",
  "createdAt": "2026-11-01T16:53:00Z",
  "operation": "write_note",
  "actor": "mcp",
  "path": "工作/笔记.md",
  "existedBefore": true,
  "beforeSha256": "…",
  "afterSha256": "…",
  "beforeBytes": 2048,
  "afterBytes": 3150,
  "reason": "AI 续写",
  "rollbackOf": null
}
```

- `actor`：`mcp` / `app` / `plugin:<id>`，用于审计「这次改动是谁干的」
- `rollbackOf`：回滚操作本身也会生成快照，指向被回滚的快照 ID —— **回滚可以再回滚**

### 3.3 路径约定

- 快照目录一律在 `<库根>/.flymd/ai-guard/` 下，**永不接受外部路径**
- 被快照的目标路径必须与快照目录**同级约束**：目标文件必须在库根内（沿用现有越界防护）
- `.flymd/` 已在 MCP 的默认排除目录里，因此快照**不会**被 AI 自己读到（避免自举噪声）

### 3.4 保留策略

快照会无限增长，必须有上限：

| 约束 | 默认值 | 说明 |
|---|---|---|
| 单个快照大小上限 | 1 MB | 超出的内容不存 `before.md`，改为存摘要并标记 `truncated: true`，此时该快照**不可回滚**（回滚时报错说明原因） |
| 保留数量上限 | 最近 50 个 | 每次写入后清理更旧的 |
| 保留总量上限 | 100 MB | 同上 |

被截断的快照要**显式标记**，不能假装能回滚——否则用户回滚失败时无从判断是丢了内容还是别的问题。

---

## 四、落地方案

### 4.0 核心代码只有一份（重要）

护栏内核（快照存储 + diff + 回滚）**只有一份实现**，放在 `mcp-server/` 的 **lib 目标**里：

```
mcp-server/src/
├── lib.rs     # lib 目标：pub mod config / diff / guard / time
├── guard.rs   # 快照存储 + 回滚
├── diff.rs    # 行级 unified diff
└── time.rs    # UTC 日期换算
```

- `mcp-server` 的 **bin 目标**（MCP 服务器）引用这个 lib
- `src-tauri`（Tauri 应用）以**路径依赖**引用同一个 lib：
  `flymd-mcp = { path = "../mcp-server" }`

这样做的三个理由：

1. **格式一致性由构造保证**，而不是靠两边各写一遍再对齐约定——这是护栏的前提，
   格式一旦分叉，回滚就会写坏用户的文件
2. **应用内的 AI 写入与 MCP 客户端的写入落在同一个快照目录**，互相可回滚
3. **不给 Tauri 应用新增任何依赖**：lib 只依赖 `serde` / `serde_json`，
   两者 `src-tauri` 已有（`regex` 本来就被 `tauri-utils` / `tauri-plugin-http` 依赖）

> 代价：`src-tauri/Cargo.lock` 多了一条 `flymd-mcp` 记录，构建图多一个节点。
> 换来的是「护栏只有一份代码」，值得。

### 4.1 应用侧（Rust 命令 + 宿主拦截）

新增 Tauri 命令（`src-tauri/src/ai_guard.rs`，与既有 `git_*` 命令同区）：

| 命令 | 入参 | 返回 |
|---|---|---|
| `ai_guard_snapshot` | `libraryRoot` `path` `newContent` `beforeContent?` `operation?` `actor?` `reason?` | `{ id, path, existedBefore, diff, guardDir }` |
| `ai_guard_preview` | `libraryRoot` `path` `newContent` | `{ path, diff }` —— 只算 diff，不写盘、不产生快照 |
| `ai_guard_restore` | `libraryRoot` `snapshotId` `confirm?` | `{ id, rolledBack, path, deleted, content }` —— `content` 是回滚后的文件内容 |
| `ai_guard_list` | `libraryRoot` `limit?` | `{ guardDir, items[] }` |

**插件不能直接调用这四个命令**（已加入 `PLUGIN_INVOKE_DENYLIST`）——原因见 §5 的
「库根不可由插件指定」。宿主改为提供两个**库根可信**的插件 API：

- `context.aiGuardList(limit?)`
- `context.aiGuardRollbackLast({ path?, confirm? })` —— 内部用宿主自己的库根，
  并把回滚后的内容同步回编辑器

**写入拦截点放在宿主**（`src/extensions/pluginHost.ts`），而不是逐个插件改。
插件改写文档只有三个出口：`setEditorValue` / `replaceRange` / `insertAtCursor`，
在宿主统一拦截，一处覆盖所有插件（含以后新写的）。

宿主拦截的时序有个绕不开的约束：**这三个 API 是同步的，而快照要跨进程调 Rust 命令**。
处理方式：

1. 在写入的**那一刻同步捕获**「写入前」与「写入后」的文本，异步落盘——
   即使快照命令晚于写入返回，存下来的仍是正确的「写入前」内容
2. 多次写入的快照用一条 Promise 链**串起来**，保证快照顺序与写入顺序一致
3. 快照失败**只记警告、不阻断写入**——同步 API 无法让调用方 await 一个失败。
   需要「失败即中止」的强保证时，走 MCP 写入通道（那边是全异步的，可以中止）

`ai-assistant` 插件新增右键菜单项「回滚上一次 AI 写入」，走 `context.aiGuardRollbackLast`。

### 4.2 MCP 侧（`mcp-server/`）

MCP 是独立进程，走不了 Tauri IPC，但护栏内核就在同一个 crate 的 lib 目标里，
直接用即可。

新增工具：

| 工具 | 说明 | 是否写盘 |
|---|---|---|
| `preview_write` | 给定 path + content，返回 unified diff，**不写盘** | 否 |
| `write_note` | 写入前自动快照 → 写入 → 返回 diff + 快照 ID | 是 |
| `list_writes` | 列出本库的可回滚写入 | 否 |
| `rollback_write` | 回滚到指定快照 | 是 |

**写入护栏的硬约束**：

1. 目标路径必须通过现有的越界防护，且**不得落在被排除目录里**
   （排除目录是用户明确划出的边界，AI 不该往里写）
2. 单次写入内容上限 **1 MB**（对齐 SoloMD 的「写入上限」思路）
3. 单次写入**只允许改一个文件**——批量改写拆成多次，每步一个快照
4. 快照写入失败 → **中止写入**（宁可写不进去，也不能留下没有回滚路径的改动）
5. 所有写入工具的描述里都写明「会先自动快照，可用 `rollback_write` 回滚」——
   让 AI 自己就知道有护栏存在
6. 原文件超 1 MB → 拒绝写入（没法生成可回滚的快照）

> 路径解析与只读通道分开：写入目标可能尚不存在（新建笔记），不能对整条路径
> canonicalize，改为校验「最近的已存在祖先目录」；目标本身是符号链接时直接拒绝。

### 4.3 与 Git 层的叠加

若 `<库根>/.git` 存在，写入成功后额外打一次 commit：

```
git add <path> && git commit -m "flymd: AI 写入 <operation> (<snapshotId>)"
```

失败**不影响**主流程（L1 已经保底），只记一条警告。

---

## 五、边界与安全

| 风险 | 处理 |
|---|---|
| AI 写入被排除目录 | 直接拒绝——排除目录是用户划定的边界 |
| AI 写入超大内容 | 1 MB 上限，拒绝并提示 |
| **插件伪造库根** | `ai_guard_*` 命令的 `libraryRoot` 若由插件提供，恶意插件可传 `libraryRoot="/"` 让回滚写到库外。因此这四个命令**对插件禁用**（列入 `PLUGIN_INVOKE_DENYLIST`），插件只走宿主提供的 `aiGuardList` / `aiGuardRollbackLast`——库根由宿主决定 |
| 快照目录被 AI 污染 | `.flymd/` 在默认排除目录内，AI 读不到也写不进 |
| 快照无限增长占磁盘 | 数量（50）+ 总量（100 MB）双上限 |
| 快照内容含敏感信息 | 快照随库走时会随 WebDAV 同步——**`.flymd/local.json` 已被排除，但 `ai-guard/` 需要一并排除**，否则会把旧版本内容同步出去 |
| 回滚误删 | `existedBefore: false` 的快照回滚语义是删除文件，操作前必须显式确认 |
| 并发写入同一文件 | 快照带时间戳+随机 ID，回滚按 ID 精确匹配；宿主侧的多次写入用 Promise 链串行，保证快照顺序与写入顺序一致 |
| 宿主写入拦截失败 | 快照失败只记警告、不阻断写入（同步 API 无法 await 失败）。强保证由 MCP 写入通道提供 |

> ⚠️ **WebDAV 同步排除**：`.flymd/ai-guard/` 必须加入 WebDAV 的排除规则。
> 快照里是**写入前的旧内容**，同步出去等于泄露历史版本，且纯属浪费带宽。

---

## 六、实施计划与验收

| 阶段 | 内容 | 状态 | 验收标准 |
|---|---|---|---|
| A | 快照格式规范 + 护栏内核（`mcp-server/src/guard.rs` + `diff.rs`） | ✅ 完成 | 快照目录结构、meta 字段、回滚语义、截断标记全部有单测覆盖 |
| B | MCP 写入工具（`preview_write` / `write_note` / `list_writes` / `rollback_write`） | ✅ 完成 | 真实库上完成「写入 → 列出 → 回滚 → 内容复原」闭环，回滚后逐字节一致 |
| C | 应用侧 Rust 命令 + lib 共享改造 | ✅ 完成 | `src-tauri` 引用 `flymd-mcp` lib，**不新增任何外部依赖**；命令有 Rust 侧单测 |
| D | 宿主层写入拦截 + 插件回滚入口 | ✅ 完成 | 三个写入 API 统一拦截；`ai-assistant` 右键菜单有「回滚上一次 AI 写入」 |
| E | WebDAV 排除规则 + 文档 | 🔶 进行中 | `.flymd/ai-guard/` 不参与同步（已完成）；用户指南与开发文档补齐（本次收尾） |

**整体验收**：在真实库上用 MCP 写入一篇笔记 → `list_writes` 能看到 → `rollback_write` 后
文件内容与写入前**逐字节一致**；应用内 AI 写入同样可回滚。

> **已验证**：MCP 侧闭环实测通过（临时库：`write_note` → `list_writes` → `rollback_write`，
> 回滚后 sha256 与写入前完全一致）。

---

## 七、未决事项

1. **宿主侧快照失败不阻断写入**——同步 API 的硬限制。若要做到与 MCP 侧一致的
   「失败即中止」，需要把插件的写入 API 改成异步（会破坏现有插件的调用约定），
   或者在插件侧显式 await 一个新的异步写入 API。
2. **回滚是否要二次确认**——MCP 侧工具调用没有 UI 交互窗口。倾向：`rollback_write`
   本身也先打快照（可再回滚），因此不需要额外确认；但删除文件的回滚需要 AI 显式传
   `confirm: true`。
3. **快照是否要跟随 Git 分支**——L1/L2 已能覆盖主要场景，但如果用户重度使用 Git 分支工作流，
   可能希望快照与分支联动。第一版不做。
4. **保留上限是否要可配**——第一版硬编码（50 个 / 100 MB），后续视反馈决定是否开放配置。
