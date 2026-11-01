# 定时/触发式 AI 任务（YAML Recipes，P1-4）

## 一、背景与目标

竞品对标（`docs/Analysis/COMPETITIVE_ANALYSIS_2026-11.md`）里 P1 第 4 项是「定时/触发式 AI 任务」：
SoloMD 允许用户写 YAML 描述的 recipe，由 cron / on-save / on-commit / on-tag-add 等触发器驱动 AI 加工笔记，
并随包提供 11 个开箱即用的 recipe。

Flymd 当前的 AI 能力全部是**人在环**的：打开 AI 助手面板 → 选文档 → 下指令 → 审阅草稿 → 手动插入。
所有加工动作都要用户守在编辑器前。定时任务能补上这段——尤其是「每天早上把昨天的零散笔记汇总成日报」
「保存后自动给日记补待办」这类**低风险、可预期的机械劳动**。

本任务的目标：给 Flymd 加一个**声明式任务系统**——用户在库里放一个 YAML 文件，Flymd 按 cron 或保存事件
自动调用 AI，把结果写回库里的指定笔记。全过程可审计、可回滚。

非目标（本轮不做）：
- 不做 Git 触发器（on-commit / on-tag-add）。Flymd 的 Git 能力在插件侧且非核心，收益低、耦合重。
- 不做可视化 recipe 编辑器 UI。本轮只提供 YAML + 文档 + 示例，用户手写或复制示例改。
- 不做多 recipe 依赖编排（A 完成后触发 B）。本轮 recipe 之间彼此独立。

## 二、架构选型：核心模块，不是插件

第一直觉是做成插件——插件体系本来就是 Flymd 的扩展机制。但实测下来这条路在三个地方走不通：

| 能力 | 插件能用吗 | 原因 |
|---|---|---|
| on-save 触发源 | ❌ | 插件 API **没有事件订阅机制**，`context` 上没有任何 `onSave`/`subscribe` 钩子 |
| 全库扫描待办 | ❌ | `flymd_list_markdown_files` / `flymd_search_files_content` 在 `PLUGIN_INVOKE_DENYLIST` 里（防插件扫全库） |
| 写入走护栏 | ❌ | `ai_guard_snapshot` 等四个命令同样在 denylist，插件只能走宿主提供的可信入口 |

走插件路线要先给宿主补两套新 API（事件总线 + 库结构化访问），还要改 76KB 的 `plugin.md` 插件文档，
而这三个能力恰好都是**核心层天然拥有的**。

因此定为核心 TS 模块 `src/core/recipes/`，与 `src/core/autoSave.ts` 这类核心模块平级。

### 与现有 AI 能力的关系

AI 请求逻辑不重写。Flymd 已经有两套现成的 AI 调用：

1. `public/plugins/ai-assistant/main.js` 里的 `callAIForPlugins()`——但它在插件沙箱里，核心调不到。
2. 核心层目前**没有**任何 AI 调用。

所以本轮在核心侧实现一份**最小**的 OpenAI 兼容调用（约 80 行），但**配置复用** ai-assistant 的：

- 用户在 AI 助手里配好的 `baseUrl` / `apiKey` / `model` 存在 Tauri store 的 `plugin:ai-assistant` → `ai.config`，
  核心可以直接读。用户在 AI 助手里改一次 key，recipes 立刻跟着生效。
- 免费模式（SiliconFlow 代理 `https://flymd.llingfei.com/ai/ai_proxy.php` + `X-Flymd-Token` 滚动令牌）
  的算法与 ai-assistant 保持一致，令牌生成逻辑在两处各存一份并互相注释提醒同步。

优先级：recipe 内 `ai:` 段 > ai-assistant 的 `ai.config` > 内置免费模式。

## 三、核心设计

### 3.1 Recipe 文件布局

```
<库根>/.flymd/recipes/
├── daily-report.yaml      # 每天 9 点汇总昨日笔记
└── tag-todo.yaml         # 保存后补待办
```

放 `.flymd/` 下，跟着库走、能被 WebDAV 同步（recipe 是**配置**，不是设备私有数据）；
运行日志 `runs.jsonl` 单独放 `.flymd/recipes/runs.jsonl` 并加入 WebDAV 默认排除（它是设备本地的执行痕迹）。

### 3.2 YAML 格式（规范 v1）

```yaml
id: daily-report                 # 必填，库内唯一，/[a-zA-Z0-9][a-zA-Z0-9._-]*/
name: 每日汇总                   # 必填
enabled: true                    # 默认 true
trigger:
  type: schedule                 # schedule | on-save
  cron: "0 9 * * *"              # schedule 必填，5 段 cron
  paths: ["日记/*.md"]           # on-save 可选：路径 glob（相对库根）
  debounceMs: 5000               # on-save 可选：同文件防抖窗口，默认 3000
prompt: |                        # 必填，支持 {{变量}}
  汇总 {{date}} 的日记，输出要点清单。
system: 你是一个严谨的编辑助手       # 可选
model: gpt-4o-mini                # 可选，覆盖默认模型
ai:                              # 可选，覆盖 AI 配置
  baseUrl: https://api.example.com/v1
  apiKey: sk-xxx
output:
  mode: note                     # none（默认）| note（追加）| replace（覆盖）
  path: "AI/日报.md"              # mode≠none 时必填，相对库根
  heading: true                  # note 模式是否加分隔标题，默认 true
```

**cron 表达式**用标准 5 段式（分 时 日 月 周），支持 `*`、列表 `1,2`、范围 `1-5`、步长 `*/5`、`1-10/2`，
外加 `@daily`/`@hourly`/`@weekly`/`@monthly`/`@yearly` 宏。日与周同时指定时按 cron 标准取 **OR**。

### 3.3 模板变量

prompt 里可用的占位符（`{{name}}` 形式，未知变量替换为空串并在运行日志里记 warning）：

| 变量 | 含义 |
|---|---|
| `{{date}}` / `{{time}}` / `{{datetime}}` / `{{weekday}}` | 本地时间 |
| `{{library}}` | 库根目录名 |
| `{{file}}` | 触发文件（库内相对路径），on-save 触发时有值 |
| `{{content}}` | 触发文件的正文，on-save 触发时有值 |
| `{{todos}}` | 触发文件里未完成的待办项，on-save 触发时有值 |
| `{{files}}` | 库内全部 markdown 文件的相对路径清单（换行分隔） |

### 3.4 输出与护栏

AI 返回的文本按 `output.mode` 落盘：

- `none`——不落盘，只在运行日志里留摘要（默认，最安全）。
- `note`——追加到 `output.path`；文件不存在则创建。前面加分隔标题与时间戳。
- `replace`——覆盖 `output.path`。

**所有落盘都先过写入护栏**：写之前调 `ai_guard_snapshot`（Tauri 命令）留快照，写回后把 `snapshotId`
记进运行日志。因为核心的 `writeTextFileAnySafe` 不经过 `pluginHost.ts` 的写入拦截（那里只管插件的三个
写出口），所以 recipes 必须**显式**建快照，不能指望宿主兜底。这样 recipes 的写入和 MCP 客户端的写入落在
同一个快照目录里，用户可以用同一套 `rollback_write` / AI 助手右键菜单回滚。

### 3.5 运行日志

每次执行追加一行 JSON 到 `<库根>/.flymd/recipes/runs.jsonl`：

```json
{"ts":"2026-11-01T09:00:03.120Z","recipeId":"daily-report","recipeName":"每日汇总",
 "trigger":"schedule","ok":true,"durationMs":4213,"outputPath":"AI/日报.md",
 "snapshotId":"20261101T090012Z-a3f9c1","excerpt":"……"}
```

这是本任务顺带落地的**可回溯 trace** 雏形：能回答「昨天那次定时任务到底跑了没、写了什么、能不能回滚」。

### 3.6 防自循环

recipes 的输出是**直接文件写入**，不经过编辑器，因此不会触发 `flymd-file-saved` 事件。
引擎只订阅编辑器保存事件（不订阅文件系统 watcher），天然不存在「AI 写回 → 触发 on-save → 再写回」的循环。
另加一道保险：引擎自身写入后在 2 秒窗口内忽略该路径的保存事件。

### 3.7 调度

- 每个 enabled 的 schedule recipe 独立一个定时器，按 `nextCronTime()` 算出下次触发时刻。
- `setTimeout` 单次上限约 24.8 天，超出时分段等待（先挂 60 秒的短定时器再重算）。
- 引擎在**库切换**时重载 recipe 集合并重排调度（`flymd:library:changed` 事件）。
- 同一 recipe 正在执行时再次触发 → 跳过并记日志，不排队堆积。

## 四、落地方案

### 4.1 新增文件

```
src/core/recipes/
├── types.ts        # Recipe 类型定义
├── cron.ts         # 5 段 cron 解析 + nextCronTime（纯函数）
├── parse.ts        # YAML → Recipe 校验
├── vars.ts         # 模板变量渲染
├── store.ts        # .flymd/recipes 目录读写
├── ai.ts           # OpenAI 兼容调用 + 配置解析
├── engine.ts       # 调度器 + 触发 + 执行 + 运行日志
└── *.test.ts       # 单测
```

### 4.2 改动文件

- `src/main.ts`：给 `flymd-file-saved` 事件补 `detail.path`（现有监听者忽略 detail，向后兼容）；
  启动时初始化 recipes 引擎；库切换时重载。
- `src/extensions/webdavSync.ts`：`DEFAULT_EXCLUDE_GLOBS` 加 `**/.flymd/recipes/runs.jsonl`。

### 4.3 安全边界

- recipe 的 `output.path` 必须是库内相对路径，越界（`../`、绝对路径）直接拒绝。
- 写回前必过 `ai_guard_snapshot`；快照失败即**中止写入**（这是核心侧，可以 await，所以能做到 MCP 那样的
  「失败即中止」——比插件侧那条弱保证强）。
- 单次写入内容 ≤ 1 MB（与护栏一致，由 `ai_guard_snapshot` 侧强制）。
- AI 请求直连用户配置的模型服务商，不做任何中转（沿用 ai-assistant 的约定）。

## 五、实施计划与验收

| 步骤 | 内容 | 验收 |
|---|---|---|
| 1 | `types.ts` / `cron.ts` / `parse.ts` / `vars.ts` / `store.ts` | cron 解析与下次触发时间单测通过；非法 YAML/非法 cron 报错信息可读 |
| 2 | `ai.ts` | 配置优先级单测；未配置 key 时给出可操作的中文提示 |
| 3 | `engine.ts` | 定时触发、on-save 触发、debounce、并发跳过、护栏写回、运行日志，逐项单测 |
| 4 | 接入 `main.ts` | 真机验证：写 recipe → 触发 → 产出笔记 → 可回滚 |
| 5 | 文档与示例 | `docs/Usage/RECIPES_GUIDE.md` + 3 个示例 recipe |

## 六、未决事项

1. **recipe 的 UI 入口**：本轮只支持手写 YAML。要不要在插件菜单里加一个「打开 recipes 目录」的快捷项？
   （很小，可以顺手做。）
2. **on-save 的路径过滤语义**：目前 `paths` 是 glob 列表，空列表 = 全部文件。
   要不要支持 `exclude` 列表？
3. **历史 recipe 的 schema 演进**：规范 v1 定死了字段。将来加字段时如何兼容旧文件，
   等真出现第二个版本再定（当前策略：未知字段忽略，不报错）。
4. **多窗口**：同一库在两个窗口打开时，两个窗口的引擎都会跑定时任务 → 会重复调用 AI。
   需要加一个跨窗口的单例锁（可借 Tauri store 的原子写或 `try_lock_file`）。本轮先在文档里写明这个限制。
