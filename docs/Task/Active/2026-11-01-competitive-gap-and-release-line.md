# flymd 竞品功能级差距与发布线恢复（2026-11-01）

**Status**: 📋 方案待决策（许可证部分已落地）
**范围**: SoloMD / Markra 功能级逐条 diff、可补缺口优先级、发布线断裂证据与恢复路径、许可证修正
**方法**: GitHub REST API 取数 + 两家竞品 README 全文拆解 + 本地 git 分支拓扑与提交统计
**关联文档**: [COMPETITIVE_ANALYSIS_2026-11.md](../../Analysis/COMPETITIVE_ANALYSIS_2026-11.md)（竞品全景）

---

## 一、总体结论

1. **flymd 的独有能力是真的护城河**——TODO 多渠道推送、PDF 高精度解析、桌面便签、文档脑图、AI 小说引擎、一键发布 Typecho/WordPress/Halo、插件市场、录音转文字/语音输入。竞品（SoloMD / Markra）**一条都没有**，这不是功能堆料，是场景独占。
2. **但 flymd 缺的恰好是 2026 年 AI 编辑器的"入场券"**：MCP Server、Agent 常驻面板、AI 写入护栏与回溯、定时/触发式 AI 任务、国际化。SoloMD 与 Markra 都已经上了，flymd 一个没有。
3. **发布线是断的，而且比功能缺口更紧急**：309 个提交（+86193/−22716 行）从未合并进 `main`，公开仓库停留在 2026-07-22 的 v1.4.4，**比竞品落后了整整一个产品代际**（SoloMD 期间从 4.0 迭代到 4.6，Markra 密集发版）。**补功能之前先修发布线**——否则做得再好，900★ 用户也看不到。

---

## 二、功能级 diff

### 2.1 flymd 领先项（应写进对比页，形成防御）

| 能力 | flymd | SoloMD | Markra | 判定 |
|---|---|---|---|---|
| TODO 多渠道推送（微信/短信/邮箱/钉钉/飞书） | ✅ xxtui 插件 | ❌ 仅 `list_tasks` 读任务 | ❌ | **独占** |
| PDF 高精度解析（手写/布局/公式/表格） | ✅ 插件 + MinerU 插件 | ❌ | ❌ | **独占** |
| 桌面便签（悬浮窗） | ✅ | ❌ | ❌ | **独占** |
| 文档脑图 | ✅ | ❌ tldraw 白板（性质不同） | ❌ | **独占** |
| AI 小说引擎（伏笔回收/人物状态/多模型协作） | ✅ 插件 | ❌ | ❌ | **独占** |
| 一键发布 Typecho / WordPress / Halo | ✅ | ❌ | ❌ | **独占** |
| 录音转文字 / 语音输入 | ✅ | ❌ | ❌ | **独占** |
| 扩展插件系统 + 扩展市场 | ✅ plugin.md 76KB 文档 | 🟡 MCP 工具 / recipes（接口不同） | 🟡 主题与 Skill 目录 | **领先** |
| 协同编辑 | ✅ 插件（local-collab-os） | ❌ | ❌ | **独占** |
| Git 版本控制 | ✅ 插件 | ✅ AutoGit | ❌ | 打平（实现不同） |
| 中文场景适配（GBK/繁简/中文校对） | 🟡 待确认 | ✅ GBK/Big5 自动识别 + CJK 校对 | 🟡 拼写检查字典 | ⚠️ **落后** |
| 插件生态规模 | 9+ 精选插件 | 11 recipes + Skill Pack + MCP 市场 | Agent Skills | 略落后 |

### 2.2 flymd 落后项（需补，按优先级）

| 能力 | SoloMD | Markra | flymd | 影响 |
|---|---|---|---|---|
| **MCP Server** | ✅ 随包 `solomd-mcp`，16 工具，stdio + Streamable HTTP | 🟡 ACP 协议 | ❌ **完全没有** | 🔴 **最大缺口**。Claude Code / Cursor / Codex 无法读你的笔记库；iwe、markamd 也都有 |
| **AI 写入护栏** | ✅ 每次写入独立 AutoGit 分支，Accept/Reject，写入上限 5 | ✅ 编辑前预览 | 🟡 插件级 | 🔴 AI 改文档无回滚保障 |
| **可回溯 trace** | ✅ `trace.jsonl` 逐步重放 | 🟡 会话可搜索/归档 | ❌ | 🟡 |
| **定时 / 触发式 AI 任务** | ✅ YAML recipes：cron / on-save / on-commit / on-tag-add | ❌ | ❌（待办推送是推送不是 AI 任务） | 🔴 竞品独有能力 |
| **Agent 常驻面板** | ✅ 右侧 Agent Panel，`[[wikilink]]` 引用 + 工具调用卡片 + 一键 Insert | ✅ AI 侧栏 | 🟡 插件形态 | 🔴 |
| **REST API**（localhost + token） | ✅ Alfred / Raycast / n8n 接入 | ❌ | ❌ | 🟡 |
| **YAML frontmatter 类型化编辑** | ✅ 属性检查器（类型/日期/状态/关系） | ❌ | ❌ | 🟡 |
| **关系网络（Neighborhood）** | ✅ 出链 + 反向关系图 | 🟡 双链 | ✅ 双向链接 + 关系图谱插件 | ⚠️ 打平 |
| **过滤视图持久化** | ✅ `.solomd/views/*.yml` | ❌ | ❌ | 🟡 |
| **收件箱工作流** | ✅ `⌘E` 标记已整理 | ❌ | ❌ | 🟡 |
| **ACP（Agent Client Protocol）** | ❌ | ✅ 本地 agent 接入 + 权限提示 | ❌ | 🟡 |
| **AGENTS.md 分层 + `.agents/skills/`** | ❌ | ✅ | ❌ | 🟡 生态标准，正在成形 |
| **国际��** | ✅ 13 语种 README + i18next | 🟡 中英 | 🟡 中英 | 🔴 出海受阻 |
| **拼写检查 / 个人词典** | ✅ Hunspell + CJK 校对 | ✅ 自管词典 + 按需语言包 | ❌ | 🟡 |
| **Vim 模式 / 幻灯片模式** | ✅ / ✅ | ❌ / ❌ | ❌ / ❌ | 🟡 |
| **Pandoc 导出** | ✅ | ✅（需配置） | ❌（PDF/DOCX 自研） | 🟡 |
| **图片存储 PicGo / PicList** | ❌ | ✅ | 🟡 S3/R2/兰空 | ⚠️ |
| **AI 内置联网搜索** | ❌ | ✅ 原生 + Bing + SearXNG | ❌ | 🟡 |
| **多模型供应商数** | 14 | 16 | 🟡 自研免费模型 + 硅基流动 | ⚠️ |
| **云盘目录模式**（iCloud/Dropbox 检测） | ✅ | ❌ | ❌ | 🟢 |
| **公开只读分享链接** | ✅ | ❌ | ❌ | 🟢 |
| **BYOK 花费统计** | ✅ | ❌ | ❌ | 🟢 |

### 2.3 双方都有的"标配"（不再构成差异）

WYSIWYG + 源码双模式、KaTeX、Mermaid、表格、分屏、标签页、大纲、搜索、语义搜索、Git/WebDAV 同步、端到端加密、多平台安装包、BYOK AI 改写、AI 改动预览、Web 编辑器。

> ⚠️ 关键判断：**flymd 现有的三个"卖点"已被追平**——双模式双编辑器（大家都做）、毫秒级启动（Textus 1.2s、SoloMD ~32MB 全线在打）、AI 写作（最没有壁垒的一项）。差异化叙事必须重建在 §2.1 的独占能力上，而不是继续强调性能与通用 AI。

---

## 三、缺口优先级建议

### P0 — 先修发布线，再补 MCP

| # | 事项 | 说明 | 依赖 |
|---|---|---|---|
| 1 | **发布线恢复** | ✅ **已完成**：309 commits 快进合并进 `main`，仓库地址切换到 `htmambo/flymd`，版本升至 v2.0.0 并打 tag 发版 | 无（见 §4） |
| 2 | **MCP Server** | ✅ **已完成**（commit `bbed898`）：独立 crate `mcp-server/`，6 个只读工具，真实库端到端联调通过。后续补目录排除机制（见 §3.2），单测增至 63 个 | 已落地，详见 §3.1 |
| 3 | **AI 写入护栏 + 回滚** | 复用已有 Git 版本控制插件，改为"AI 写入先落独立分支 / 快照，差异预览后合并"；成本最低的做法是每次 AI 改写前自动打快照 tag | 依赖现有 Git 插件 |

### 3.1 MCP Server 落地情况（2026-11-01）

| 项 | 状态 |
|---|---|
| 协议 | JSON-RPC 2.0 over stdio，MCP `initialize` 握手 + 协议版本协商（支持 2024-11-05 / 2025-03-26 / 2025-06-18） |
| 工具 | `list_notes` `read_note` `search` `get_outline` `list_tasks` `get_backlinks`，**全部只读** |
| 库根定位 | `--library` > `FLYMD_LIBRARY` > 应用设置文件（按平台，优先 `activeLibraryId`）> 当前目录 |
| 安全边界 | 拒绝绝对路径 / `..` / 指向库外的符号链接；单篇读取上限 4 MB；输出上限 12 万字符；stdout 与日志隔离 |
| 工程形态 | 独立 crate `mcp-server/`，**未改动 `src-tauri/main.rs`**；release 产物 1.3 MB，仅依赖 serde / serde_json / regex |
| 分发 | CI 按平台构建，作为独立工件随 Release 分发；并尽力注入应用包（macOS `.app/Contents/MacOS`、Windows/Linux 主程序同级目录）。资产名带平台后缀（`flymd-mcp-windows-x64.exe` / `flymd-mcp-macos-universal` / `flymd-mcp-linux-x64`）——GitHub Release 不允许同名资产，Linux 与 macOS 的产物默认都叫 `flymd-mcp` 会互相顶掉 |
| 文档 | [mcp-server/README.md](../../../mcp-server/README.md)（开发视角）、[docs/Usage/MCP_SERVER_GUIDE.md](../../Usage/MCP_SERVER_GUIDE.md)（用户视角） |
| 验证 | 63 个 Rust 单测 + 1023 个前端测试 + typecheck 全绿；对真实文库完成端到端握手联调 |

> ⚠️ **未做 `tauri.conf.json` 的 `externalBin`**：Tauri 在 sidecar 缺失时会让**整个 app 构建失败**，风险不可控。改为「独立工件为主渠道 + 尽力注入」的双轨方案。
>
> ⚠️ **写入通道仍未开放**：当前切片刻意只读。引入写能力前必须先做差异预览与回滚（见 P0-3）。

### 3.2 MCP 目录排除机制（2026-11-01）

**问题**：真实库实测时发现 `media/88-Template/`（Obsidian 模板目录）进了索引，模板里的
`- [ ] 红薯订阅` 被 `list_tasks` 当成用户的真待办喂给 AI。附件、模板这类目录不是笔记，
混进 AI 视野属于**数据污染**，且会随模板数量放大。

**方案**：目录排除做成**可配置**而非硬编码。排除是**全屏障**——被排除目录整棵不进索引
（影响 `list_notes` / `search` / `list_tasks` / `get_backlinks`），且 `read_note` 读到被排除
路径直接报错。否则 AI 只要猜到路径名就能绕过，排除形同虚设。

| 项 | 说明 |
|---|---|
| 配置来源 | 内置默认 → 用户级 `~/.config/com.flymd/mcp.json` → 库级 `<库根>/.flymd/mcp.json` → `FLYMD_MCP_EXCLUDE` → `--exclude`，**并集合并**而非互相替换 |
| 内置默认 | 技术目录（`.git` `.obsidian` `.flymd` `node_modules` …）+ 资源/模板目录（`media` `assets` `attachments` `templates` `template` `附件` `模板` …） |
| 匹配语义 | 不含 `/` → 按目录名任意层级命中；含 `/` → 按相对库根路径前缀命中；大小写不敏感；`allowDirs` 优先 |
| CLI | `--exclude <目录>`（可重复）、`--print-config`（打印生效配置 + 实际被排除目录 + 笔记总数） |
| 透明度 | 启动时往 stderr 打一行「已排除 N 个目录：…」；`--print-config` 可随时自查 |
| 代码 | 新增 `mcp-server/src/config.rs`（配置模型 + 匹配 + 来源合并）；`library.rs` 承载 `McpConfig` 并在索引/读取路径上执行 |

> ⚠️ **allow 的祖先目录必须放行**：若 allow 写 `media/重要笔记`，而 `media` 本身被排除，
> 遍历到 `media` 就停了，永远走不到被豁免的子目录——这是一个容易写错但必须覆盖的边界，
> 已有对应单测。
>
> 📌 **应用侧不受影响**：flymd 自身的文件树仍要正常展示 `media/`（用户要在应用里管理附件），
> 应用侧的跳过规则只针对技术目录。应用内的 AI 功能只处理当前文档，没有全库扫描，
> 所以污染是 MCP 独有的。

### P1 — 补齐 AI 编辑器入场券

| # | 事项 | 说明 |
|---|---|---|
| 4 | 定时/触发式 AI 任务（recipes） | YAML 声明式任务，cron / on-save / on-commit 触发；flymd 已有待办扫描能力可复用为 `on-save` 触发源 |
| 5 | Agent 常驻面板 | 与 AI 助手插件合并，右侧面板 + 会话历史 + 一键插入正文 |
| 6 | 国际化 | i18next，优先英 / 日 / 韩 / 越；SoloMD 已做 13 语种 |
| 7 | 竞品对比页 | 官网新增 `/compare/solomd`、`/compare/markra` 等；**注意：SoloMD 与 Markra 的对比页里都没提 flymd，说明 flymd 目前不在他们的对比坐标系里——需要主动进入** |

### P2 — 补齐通用编辑器体验

| # | 事项 |
|---|---|
| 8 | Pandoc 导出 / Vim 模式 / 幻灯片模式 / 拼写检查与个人词典 / AI 内置联网搜索 |
| 9 | REST API（localhost + token），供脚本与自动化调用 |
| 10 | PicGo / PicList 图片存储对接 |

---

## 四、发布线断裂：证据与恢复路径

> **2026-11-01 决策更新**：选择**方案 B 的变体**——不向原 upstream（`flyhunterl/flymd`，900★）提交 PR，直接以 `htmambo/flymd` 作为发布主线，版本号定为 **v2.0.0** 并立即打 tag 发版。下文保留原始事实记录作为背景。

### 4.1 事实（取自 GitHub API 与本地 git）

- `htmambo/flymd` 是 `flyhunterl/flymd` 的 **fork**（`fork: true`, `parent: flyhunterl/flymd`）；原 upstream 900★，fork 0★
- **fork 的 `main` 与 upstream 的 `main` 完全一致**：均为 `e6f73b8 发布 v1.4.4`（2026-07-22）
- 开发全部堆在一条链式分支上，且互相为祖先（线性）：
  `optimized` (178) → `fix/macos-quit-close` (216) → `sync/main-v1.4.4` (280) → `fix/audit-round1-correctness` (**309**)
- 这 309 个提交跨度 **2026-06-16 → 2026-10-31**，共 **469 文件 / +86193 / −22716 行**；构成：`fix` 95、`refactor` 49、`docs` 47、`feat` 44、`perf` 14
- upstream 上仅有 1 个 open PR（他人提交的 Star History 图表），**与本次开发无关** → fork 的 309 个提交从未以 PR 形式进入 upstream
- `.github/workflows/build.yml` 触发条件：`workflow_dispatch` / `push tag v*` / `pull_request → main` → **发版完全依赖打 tag**
- 新增的 `web/`（Fastify 5 服务端 + Vue 3 客户端）也在这 309 个提交内，同样未对外可见

### 4.2 这 3.5 个月积压了什么（相对 v1.4.4 的 diff 分布）

| 目录 | 改动文件 | 新增行 | 删除行 | 内容性质 |
|---|---|---|---|---|
| `docs/Task` | 86 | 10974 | 0 | 86 份任务/分析文档，文档债同步清空 |
| `src/styles` | 29 | 10491 | 0 | 样式体系重构 + `scripts/style-parity` 一致性校验（+1896） |
| `src/core` | 75 | 10180 | -34 | **全新模块**（+63 新文件）：`main.ts` 拆分落地 |
| `web/server` | 50 | 7348 | 0 | **全新** Fastify 5 服务端（RAG / AI 代理 / legacy mock） |
| `src/modes` | 34 | 5295 | -24 | 编辑模式层重构（源码/所见双模式） |
| `src/ui` | 27 | 3559 | -230 | UI 层：底部状态栏、about 面板等 |
| `src/wysiwyg` | 18 | 3239 | -284 | Milkdown 所见模式加固（HTML/源码编辑硬化） |
| `web/web-client` | 16 | 1659 | 0 | **全新** Vue 3 + Vite 7 客户端 |
| `src/extensions` | 16 | 1493 | -237 | 插件系统增强 |
| `src/tabs` | 11 | 1308 | -193 | 多标签页 |
| `src/windows` | 8 | 2310 | -34 | 多窗口支持 |
| `src/utils` | 15 | 815 | -14 | 工具层 |

> 这不是一次补丁，**是一次 minor 版本级别的重构 + 一个全新 Web 端**。压着不发，等于把"架构升级 + 新端形态"两个最能拉开身位的机会一起浪费掉。
> **最终定为 v2.0.0**——库私有化 v2 功能线（2026-09-11 的 7 个 PR）此前从未发布，`docs/Usage/` 已按"适用版本 flymd 2.0+"撰写，用 v1.5.0 反而与文档措辞冲突。

### 4.3 已排除的连带风险

- **扩展市场未受影响**：`public/plugins/` 下 30 个插件目录，切换前的当前分支与原 upstream main **完全一致**；`index.json` 中所有插件 `ref` 切换后指向 `raw.githubusercontent.com/htmambo/flymd/main/public/plugins/...`，目标文件在主线均存在 → 不会出现 404 或版本错配。
- **更新检查链路**：`src-tauri/src/main.rs` 的更新检查已同步切到 `htmambo/flymd` releases，v2.0.0 发布后老版本用户能收到升级提示（仅限已切到新仓库的构建）。
- **发行渠道指向一致**：`PKGBUILD` / `PKGBUILD.source` / `linux/com.flymd.metainfo.xml` / `public/update-extra.json` / 12 个插件 `manifest.json` 的 `homepage` 与 `index.json` 已统一指向 `htmambo/flymd`。

### 4.4 后果（切换前的历史状态，供参考）

- 原 upstream 用户与 winget / AUR 用户停留在 **v1.4.4（2026-07-22）**，落后 3.5 个月
- 期间竞品进度：SoloMD 4.0 → 4.6（Agent 面板 + 知识图谱层 + 关系网络）；Markra 密集发版且接入 ACP / Agent Skills
- README 里宣传的"智能大纲""插件生态""WebDAV 端到端加密"等能力，公开版本与开发分支已脱节

### 4.5 恢复路径（三选一）

> 下列动作涉及对公开仓库的推送与发版，属**对外可见操作**，执行前需要显式确认。

**✅ 方案 B（已采纳，2026-11-01）——`htmambo/flymd` 直接作为发布主线**
1. 309 个提交快进合并进 `main`（原 upstream 无独有提交，零冲突）
2. 追加许可证修正与 MCP 服务器两个提交
3. 全仓仓库地址由 `flyhunterl/flymd` 切换为 `htmambo/flymd`（30 个文件）
4. 版本号 1.4.4 → **2.0.0**（`package.json` / `Cargo.toml` / `tauri.conf.json` / `Cargo.lock`）
5. `scripts/get-version.sh` 的 `UPSTREAM_REPO` 默认值改为 `htmambo/flymd`（该脚本从 git tag 取版本，是打包的事实来源）
6. 在 `htmambo/flymd` 打 `v2.0.0` tag → 触发 `build.yml` 三平台打包 + 生成 draft Release
- 优点：发版链路最短，不维护 PR 往返；缺点：原 upstream 的 900★ 用户不会自动收到升级提示

**方案 A（未采纳）——标准 fork 协作流**
1. 把 `fix/audit-round1-correctness` 整理为可评审的若干 PR
2. 逐个 PR 到原 upstream 的 `main`
3. 合并后打 `v1.5.0` tag，触发三平台打包 + winget / AUR 提交流程

**方案 C（未采纳）——只同步代码，暂不发版**
- 先把 309 个提交合并回 `main`，但**不**打 tag，暂不发布；用于降低后续合并冲突与 review 成本
- ⚠️ 代价：用户仍然拿不到更新，落后继续扩大

> ⚠️ **遗留项（切换到新主线后需另行处理）**：winget `flyhunterl.FlyMD` 与 AUR `flymd` 的清单仍指向原仓库，需要各自提交更新后，v2.0.0 才能通过这两个渠道分发。
- 先把 309 个提交合并回 fork 的 `main`（甚至 PR 到 upstream 的 main），让代码收敛到主干
- 但**不**打 tag，暂不发布；用于降低后续合并冲突与 review 成本
- ⚠️ 代价：用户仍然拿不到更新，落后继续扩大

**实际执行**：B（`htmambo/flymd` 作为发布主线）→ 地址切换 → 版本升至 v2.0.0 → 打 tag 发版。

---

## 五、许可证修正（本次已落地）

### 5.1 问题

| 位置 | 修正前 | 问题 |
|---|---|---|
| `package.json:5` | `"license": "LicenseRef-flyMD-NC-1.0"` | SPDX 自定义 ref 表示"非商用"，**与 README 自述直接冲突**——README.md:466 / README.en.md:449 明确写"允许任何用途（**包括商业用途**）" |
| `LICENSE` | 15 行自定义声明，正文只有一句"基于 GPL-3.0 发布"+ 指向 gnu.org 的链接 | **不含 GPL-3.0 全文** → GitHub 自动识别为 **NOASSERTION**，仓库页不显示许可证标签，企业合规扫描与 `licensee` 类工具全部失效 |
| `src-tauri/Cargo.toml` | 无 `license` 字段 | crates.io 元数据缺失 |

补充法理问题：**GPL-3.0 第 10 条禁止附加限制**，"NC（非商用）"不是 GPL-3.0 的合法变体，因此 `LicenseRef-flyMD-NC-1.0` 不是一个可成立的许可证标识——要么声明整体失效，要么实际不构成 GPL-3.0。

### 5.2 已执行的修改

| 文件 | 修改 |
|---|---|
| `package.json` | `"license": "GPL-3.0"`（SPDX 标准标识） |
| `LICENSE` | 替换为 **GPL-3.0 全文**（gnu.org 原文，35149 bytes / 674 行，md5 `1ebbd3e34237af26da5dc08a4e440464`），GitHub 可自动识别为 GPL-3.0 |
| `src-tauri/Cargo.toml` | 补 `license = "GPL-3.0"` |

### 5.3 未改动、需你确认的部分

- **商业双许可路径**：README 已写明"需闭源商业场景请联系 flyhunterl <flyhunterl@gmail.com>"，本修正**不改变**这个模型——GPL-3.0 主许可 + 可另行授予的商业许可，是合法的双许可结构。
- 如需要，建议**另建 `COMMERCIAL-LICENSE.md`** 存放商业授权条款正文（当前只有 README 里的一句话 + 邮箱），并在 README 的许可协议章节加一个链接。**本次未创建该文件**，因为商业条款内容只有你有权确定。
- 原 `LICENSE` 里的中英文双语声明已被 GPL-3.0 全文替换；其中文声明的等价内容已完整保留在 `README.md` §许可协议 与 `README.en.md` §License。

---

## 六、定位建议

1. **收敛叙事**：把对外主打从「毫秒级启动 + 双模式 + AI 写作」换成「**唯一把待办推送到微信/钉钉/飞书、把 PDF 解析成可编辑 Markdown、并能一键发到博客的本地编辑器**」。这是竞品结构性做不到的事，抄不动。
2. **补 MCP**：这是当前唯一"不补就会掉队"的项。SoloMD（16 工具）、iwe、markamd 都已把笔记库暴露给 Claude Code / Cursor；flymd 的 RAG 索引与插件私有数据 API 已经具备数据基础，实现成本可控。
3. **先发版再谈功能**：309 个提交里已含双状态栏、主题背景统一、窗口缩放修复、Linux/Wayland 修复、web 端等用户可感知改进，压着不发等于白做。

---

## 七、取数与引用

- GitHub REST API：`https://api.github.com/repos/{owner}/{repo}`、`.../compare/main...flyhunterl:main`、`.../branches`、`.../pulls`，快照时间 **2026-11-01**
- 竞品 README 全文：`zhitongblog/solomd`（296 行）、`markrahq/markra`（284 行）
- 本地 git：`git rev-list --count origin/main..<branch>`、`git merge-base --is-ancestor`、提交类型分布统计
- 许可证原文：https://www.gnu.org/licenses/gpl-3.0.txt
