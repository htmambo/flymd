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
| 1 | **发布线恢复** | 309 commits → upstream main → 打 tag 发版 | 无（见 §4） |
| 2 | **MCP Server** | 至少暴露 `read_note / list_notes / search / get_outline / list_tasks / get_backlinks` 6 个只读工具（flymd 的 RAG 插件与知识库索引是现成数据源），stdio 传输；这是接住 Claude Code / Cursor 的最低成本入口 | 依赖插件私有数据 API（`docs/Usage/PLUGIN_PRIVATE_DATA_GUIDE.md` 已存在） |
| 3 | **AI 写入护栏 + 回滚** | 复用已有 Git 版本控制插件，改为"AI 写入先落独立分支 / 快照，差异预览后合并"；成本最低的做法是每次 AI 改写前自动打快照 tag | 依赖现有 Git 插件 |

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

### 4.1 事实（取自 GitHub API 与本地 git）

- `htmambo/flymd` 是 `flyhunterl/flymd` 的 **fork**（`fork: true`, `parent: flyhunterl/flymd`）；upstream 900★，fork 0★
- **fork 的 `main` 与 upstream 的 `main` 完全一致**：均为 `e6f73b8 发布 v1.4.4`（2026-07-22）
- 开发全部堆在一条链式分支上，且互相为祖先（线性）：
  `optimized` (178) → `fix/macos-quit-close` (216) → `sync/main-v1.4.4` (280) → `fix/audit-round1-correctness` (**309**)
- 这 309 个提交跨度 **2026-06-16 → 2026-10-31**，共 **469 文件 / +86193 / −22716 行**；构成：`fix` 95、`refactor` 49、`docs` 47、`feat` 44、`perf` 14
- upstream 上仅有 1 个 open PR（他人提交的 Star History 图表），**与本次开发无关** → fork 的 309 个提交从未以 PR 形式进入 upstream
- `.github/workflows/build.yml` 触发条件：`workflow_dispatch` / `push tag v*` / `pull_request → main` → **发版完全依赖打 tag**
- 新增的 `web/`（Fastify 5 服务端 + Vue 3 客户端）也在这 309 个提交内，同样未对外可见

### 4.2 这 3.5 个月积压了什么（相对 upstream main 的 diff 分布）

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

> 这不是一次补丁，**是一次 minor 版本级别的重构 + 一个全新 Web 端**。压着不发，等于把"架构升级 + 新端形态"两个最能拉开身位的机会一起浪费掉。建议按 **v1.5.0** 发布而非补丁号。

### 4.3 已排除的连带风险

- **扩展市场未受影响**：`public/plugins/` 下 30 个插件目录，当前分支与 upstream main **完全一致**；`index.json` 中所有插件 `ref` 指向 `raw.githubusercontent.com/flyhunterl/flymd/main/public/plugins/...`，目标文件在 upstream 均存在 → 不会出现 404 或版本错配。
- **更新检查链路正常**：`src-tauri/src/main.rs:2941` 的更新检查指向 upstream releases，只要 upstream 恢复发版，提示即恢复。
- **发行渠道指向一致**：`PKGBUILD` / `PKGBUILD.source` / `linux/com.flymd.metainfo.xml` / `public/update-extra.json` / 12 个插件 `manifest.json` 的 `homepage` 全部指向 `flyhunterl/flymd`，无需改动。

### 4.4 后果

- 900★ 用户与 winget / AUR 用户停留在 **v1.4.4（2026-07-22）**，已落后 3.5 个月
- 期间竞品进度：SoloMD 4.0 → 4.6（Agent 面板 + 知识图谱层 + 关系网络）；Markra 密集发版且接入 ACP / Agent Skills
- README 里宣传的"智能大纲""插件生态""WebDAV 端到端加密"等能力，公开版本与开发分支已脱节
- `src-tauri/src/main.rs` 的更新检查仍指向 `https://api.github.com/repos/flyhunterl/flymd/releases`——发布线一断，用户连"有新版本"的提示都收不到

### 4.5 恢复路径（三选一）

> 下列动作涉及对公开仓库的推送与发版，属**对外可见操作**，执行前需要显式确认。

**方案 A（推荐）——标准 fork 协作流**
1. 把 `fix/audit-round1-correctness` 整理为可评审的若干 PR（建议按 `feat / perf / fix / docs` 拆分，或至少先提一个合并 PR）
2. 逐个 PR 到 `flyhunterl/flymd` 的 `main`
3. 合并后在 upstream 打 `v1.5.0` tag，触发 `build.yml` 三平台打包 + winget / AUR 提交流程
4. fork 仓库改名为个人开发镜像，或在 README 顶部注明"开发分支仓库"

**方案 B——单一主仓库**
- 把 upstream 转为个人主仓库（保留 `flyhunterl` 作为发布账号或转移所有权），fork 仅作备份
- 优点：发版链路最短，不必维护 PR 往返；缺点：迁移期需处理链接与徽章

**方案 C——只同步代码，暂不发版**
- 先把 309 个提交合并回 fork 的 `main`（甚至 PR 到 upstream 的 main），让代码收敛到主干
- 但**不**打 tag，暂不发布；用于降低后续合并冲突与 review 成本
- ⚠️ 代价：用户仍然拿不到更新，落后继续扩大

**建议组合**：C（先合并主干、降冲突）→ A（拆 PR 回 upstream）→ 打 tag 发 v1.5.0。

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
