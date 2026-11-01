# 定时/触发式 AI 任务（Recipes）

> 用 YAML 描述一条任务，让 Flymd 按 cron 或保存事件自动调用 AI，把结果写回你的笔记库。

- 适用版本：v2.2.0 起
- 配方存放位置：`<你的文库根>/.flymd/recipes/*.yaml`
- 设计文档：`docs/Task/Active/2026-11-01-scheduled-ai-recipes.md`

---

## 一、30 秒上手

在文库根目录下新建 `.flymd/recipes/` 文件夹，放一个 `hello.yaml`：

```yaml
id: hello
name: 打个招呼
trigger:
  type: schedule
  cron: "0 9 * * *"
prompt: 用一句话欢迎我。
output:
  mode: note
  path: "AI/问候.md"
```

保存后切回 Flymd（或重启应用），任务会在每天 09:00 触发，把结果追加到 `AI/问候.md`。

第一次用建议先设 `cron: "* * * * *"`（每分钟一次）验证链路通不通，再改成你要的节奏。

## 二、recipe 长什么样

```yaml
id: daily-report          # 必填。库内唯一，只能是字母数字开头 + 字母数字 . _ -
name: 每日汇总            # 必填。任务名，出错提示与运行日志里显示
enabled: true             # 可选，默认 true

trigger:
  type: schedule          # 必填。schedule（定时）| on-save（保存触发）
  cron: "0 9 * * *"       # type=schedule 时必填，5 段 cron
  paths: ["日记/*.md"]    # type=on-save 时可选。路径过滤，缺省=全部文件
  debounceMs: 5000        # type=on-save 时可选。同文件防抖，默认 3000

prompt: |                 # 必填。支持 {{变量}}
  汇总 {{date}} 的日记要点。

system: 你是一个严谨的编辑助手   # 可选。system 提示词
model: gpt-4o-mini              # 可选。覆盖默认模型

ai:                      # 可选。单独给这条任务指定 AI 服务
  baseUrl: https://api.example.com/v1
  apiKey: sk-xxx
  model: my-model

output:
  mode: note             # none（默认，只记日志）| note（追加）| replace（覆盖）
  path: "AI/日报.md"      # mode≠none 时必填。库内相对路径
  heading: true          # note 模式是否加分隔标题，默认 true
```

配置文件写错了 **不会静默失效**——Flymd 会在控制台打出具体是哪个文件、哪个字段、期望什么，
其余 recipe 不受影响照常运行。

## 三、触发方式

### 3.1 schedule（定时）

标准 5 段 cron，顺序是 **分 时 日 月 周**：

```
0 9 * * *        每天 09:00
30 8 * * 1-5     工作日 08:30
0 */2 * * *      每 2 小时
0 9 1 * *        每月 1 号 09:00
```

支持 `*`、列表 `1,2`、范围 `1-5`、步长 `*/5`、`1-10/2`，以及宏
`@hourly` `@daily` `@midnight` `@weekly` `@monthly` `@yearly`。

> 日和周**同时**写死时按 cron 惯例取 **或**：`0 9 1 * 1` = 每月 1 号 **或** 每周一。

### 3.2 on-save（保存触发）

保存文件时触发。`paths` 决定哪些文件算数：

| 写法 | 含义 |
|---|---|
| 省略 / 留空 | 任何文件保存都触发 |
| `*.md` | 任意层级的 `.md` 文件（不含 `/` 时按文件名匹配） |
| `日记/*.md` | 只匹配 `日记/` 目录下的直接子文件 |
| `**/*.md` | 任意深度的 `.md` 文件 |

同一个文件在 `debounceMs` 窗口内反复保存只触发一次（默认 3 秒）。

## 四、可用变量

写在 `prompt` 里，用 `{{变量名}}`：

| 变量 | 含义 |
|---|---|
| `{{date}}` | 本地日期，`2026-11-01` |
| `{{time}}` | 本地时间，`09:05:07` |
| `{{datetime}}` | `2026-11-01 09:05:07` |
| `{{weekday}}` | `星期一` |
| `{{library}}` | 库根目录名 |
| `{{file}}` | 触发这次任务的文件（库内相对路径）。定时任务没有此变量 |
| `{{content}}` | 触发文件的正文。定时任务没有此变量 |
| `{{todos}}` | 触发文件里**未完成**的待办项（`- [ ] xxx`）。定时任务没有此变量 |
| `{{files}}` | 库里全部 markdown 文件的相对路径清单（每行一个） |

变量名拼错不会报错，但会替换成空串，并在运行日志里记一条 `unknownVars`——
这样你能发现"AI 好像没读到我的数据"其实是变量名写错了。

`{{files}}` 会触发一次全库扫描，所以只在真的用到时才付这个代价。

## 五、结果写到哪里

`output.mode` 决定 AI 的回答怎么处理：

- `none`——**不落盘**，只在运行日志里留一段摘要。最安全，适合先试。
- `note`——**追加**到 `output.path`。文件不存在就创建；已存在就往下追加，前面自动加一段
  `## 2026-11-01 09:00:07` 的分隔标题（`heading: false` 可关）。
- `replace`——**覆盖** `output.path` 的全部内容。

### 写回可以回滚

所有落盘都先经过 **AI 写入护栏**：写入前的原内容会被快照到 `<库根>/.flymd/ai-guard/`。
所以定时任务写错东西不会让你panic：

- 用 MCP 客户端调 `rollback_write` 回滚；
- 或在 AI 助手的右键菜单里点「回滚上一次 AI 写入」；
- 或直接看运行日志里的 `snapshotId`，用它精确回滚那一次。

快照失败（比如内容超过 1 MB）会**中止写入**，不会留下写了一半的文件。

## 六、AI 配置从哪来

不需要重复配置。优先级如下（高的覆盖低的）：

1. recipe 里的 `ai:` 段（`baseUrl` / `apiKey` / `model`）—— 这条任务专用；
2. recipe 顶层的 `model:`；
3. **AI 助手插件里配好的那一份**——在「插件 → AI 助手」里填的 baseUrl / apiKey / model，
   recipes 直接复用。在 AI 助手里改一次 key，所有 recipes 立刻跟着生效；
4. 内置免费模式（不用填 key，走 Flymd 的公共代理，有额度限制）。

如果你还没配过 AI 助手，recipes 会走免费模式。

## 七、运行日志

每次执行都会往 `<库根>/.flymd/recipes/runs.jsonl` 追加一行：

```json
{"ts":"2026-11-01T09:00:03.120Z","recipeId":"daily-report","recipeName":"每日汇总",
 "trigger":"schedule","ok":true,"durationMs":4213,"outputPath":"AI/日报.md",
 "snapshotId":"20261101T090012Z-a3f9c1","excerpt":"……"}
```

能回答这几个问题：跑了没？成功了吗？写了哪个文件？能不能回滚？

`runs.jsonl` 是**设备本地**的，不会被 WebDAV 同步到远端；但 recipe 本身（`*.yaml`）会跟着库走。

## 八、常见问题

**Q：改了 yaml 要重启吗？**
切换文库或重启应用会重新加载。另外每次切库都会自动重载。

**Q：同一个库开了两个窗口会重复跑吗？**
会。两个窗口各自有一份引擎，定时任务会跑两次。这是当前版本的已知限制
（多窗口场景需要跨进程单例锁），手动触发和 on-save 影响较小。

**Q：定时任务会不会在我编辑某篇笔记时突然把文件改掉？**
只有 `output.path` 指向的文件会被写。定时任务不碰你正在编辑的文件，除非你把 `output.path`
写成了它——请避免这种情况。

**Q：怎么停掉一条任务？**
把 `enabled: false` 写进 yaml，或者把文件删掉。

**Q：控制台在哪看错误？**
Flymd 启动时的开发者工具（macOS: `Cmd+Alt+I`）。recipe 的解析错误和运行失败都会打在那里。

## 九、三个起步示例

`docs/Usage/examples/recipes/` 下有三个可直接改用的例子：

| 文件 | 作用 |
|---|---|
| `daily-report.yaml` | 每天早上 9 点把昨天的笔记汇总成日报，追加到 `AI/日报.md` |
| `todo-from-note.yaml` | 保存日记后自动补待办，追加到 `AI/待办.md` |
| `daily-review.yaml` | 每天晚上 21 点把当天日记提炼成三条要点，只记日志不落盘 |

## 十、安全边界

- `output.path` 必须是**库内相对路径**，绝对路径和 `..` 越界一律拒绝；
- 单次写入 ≤ 1 MB，超限拒绝并中止；
- AI 请求直连你配置的模型服务商，Flymd 不做中转；
- 写回前必过护栏快照，快照失败即中止写入。
