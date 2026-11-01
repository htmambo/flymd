# flymd 竞品调研：GitHub 同类应用横向对比（2026-11-01）

**Status**: ✅ 完成
**范围**: GitHub 上与 flymd 功能重叠的 Markdown 编辑器 / AI 笔记 / 文档解析类项目
**方法**: GitHub Search API + REST API 拉取 star / license / 语言 / 最后推送时间，取数于 2026-11-01；功能描述以仓库 README、topics 与官方文档为准
**取数脚本**: `gh api search/repositories` / `gh api repos/<owner>/<repo>`

---

## 一、总体结论

- **flymd 不是"又一个 Markdown 编辑器"，而是被拆成三层竞争**：
  1. **通用编辑器层**（MarkText / Zettlr / MarkFlowy / SoloMD / Markra / Textus…）——同形态、同用户群，直接抢 star 与心智；
  2. **垂直能力层**（待办推送 / PDF 解析 / 博客发布 / RAG 知识库）——flymd 的差异化基本靠插件和自研能力在这一层领先；
  3. **知识库层**（Obsidian / Logseq / Joplin / Trilium / SilverBullet）——不直接抢写作场景，但决定"长期留存"。
- **最大直接威胁是 SoloMD（MIT）**：Tauri 2 + Vue 3 + CodeMirror 6，约 15–32MB，已逐条对标 flymd 的 README 卖点——Agent 面板、14 家 BYOK、MCP 服务器、AutoGit 版本历史、GitHub 同步 + 端到端加密、iOS/Android 移动端、CJK 编码识别，且**许可证比 flymd 更宽松**。
- **flymd 的真实护城河只有四项**，其余在开源生态中均已被覆盖或可轻易补齐：① TODO 多渠道推送（微信/短信/钉钉/飞书）；② PDF 高精度解析插件（对标 MinerU/Docling 级别）；③ 桌面便签 + 脑图；④ 一键发布 Typecho/WordPress/Halo。
- **性能叙事已成红海**：Textus 1.2s 启动 / ~180MB、markamd、marklab、writer-computer、MarkFlowy 都在主打"毫秒级启动 / 极低内存"。flymd README 的"毫秒级启动、8 万字无卡顿"需要持续用可复现 benchmark 支撑，否则不再构成差异点。

---

## 二、通用编辑器层（最直接同类）

### 2.1 Tauri 系活跃项目

| 项目 | Stars | 技术栈 | 许可 | 最后推送 | 与 flymd 的重叠 / 差距 |
|---|---|---|---|---|---|
| [zhitongblog/solomd](https://github.com/zhitongblog/solomd) | 1458 | Tauri 2 + Vue 3 + CM6 | MIT | 2026-10-31 | **最强对手**：BYOK×14、Agent 面板、MCP×16 工具、AutoGit、GitHub 同步+E2EE、移动端、Obsidian 替代。**无** TODO 推送 / PDF 解析 / 便签 / 博客发布 |
| [drl990114/MarkFlowy](https://github.com/drl990114/MarkFlowy) | 2422 | Tauri + React + ProseMirror | AGPL-3.0 | 2026-10-31 | 高性能本地优先；同样走 ProseMirror 路线。**无** flymd 的插件生态深度 |
| [markrahq/markra](https://github.com/markrahq/markra) | 943 | Tauri + React | AGPL-3.0 | 2026-10-30 | Typora 式 WYSIWYG + 原生 AI（改动先预览）+ **WebDAV 同步**。**无** 插件系统 / PDF / 待办 |
| [CatVinci-Studio/Textus](https://github.com/CatVinci-Studio/Textus) | 559 | Tauri + React + Rust | MIT | 2026-11-01 | 本地 Ollama / DeepSeek AI 写作；无云服务。**无** 同步 / 插件 / PDF |
| [mattenarle10/markamd](https://github.com/mattenarle10/markamd) | 511 | Tauri 2 + React 19 + CM6 | MIT | 2026-10-27 | "context bundle"（多文件打包喂 AI）方向独特；**明确无插件 API** |
| [kuku-mom/kuku](https://github.com/kuku-mom/kuku) | 232 | Tauri | MIT | 2026-10-18 | 本地优先 workspace + wiki + AI 编辑 + 加密同步 |
| [thejacedev/Noteriv](https://github.com/thejacedev/Noteriv) | 106 | Tauri | MIT | 2026-10-29 | 轻量，图谱视图 + **插件 API** + Git/WebDAV 同步 + AI MCP |
| [likehao19/InkNote](https://github.com/likehao19/InkNote) | 90 | Tauri 2 + React + CM6 | MIT | 2026-10-31 | 5–9MB 极限轻量，Typora 式所见即所得 |
| [Razee4315/Paperling](https://github.com/Razee4315/Paperling) | 590 | Tauri + React | Apache-2.0 | 2026-10-31 | 极简分心-free，无 AI/同步 |
| [joelbqz/writer-computer](https://github.com/joelbqz/writer-computer) | 1766 | Tauri 2 + React + CM6 | GPL-3.0 | 2026-10-29 | 尊重 `.gitignore`、多窗口、遥测默认关闭 |
| [purocean/yn](https://github.com/purocean/yn) | 6771 | Electron | AGPL-3.0 | 2026-10-31 | 高度可扩展 + 版本控制 + AI Copilot + 文档批注；体积重但插件化最强 |
| [marswaveai/ColaMD](https://github.com/marswaveai/ColaMD) | 1290 | Electron | MIT | 2026-10-25 | 极简优雅 |
| [do-md/domd](https://github.com/do-md/domd) | 586 | React 组件 | NOASSERTION | 2026-09-23 | 30KB Markdown 原生 WYSIWYG 组件，专为 **AI 流式编辑**设计，可作 flymd 编辑器层参考 |

### 2.2 经典 / 大盘项目

| 项目 | Stars | 许可 | 状态 | 说明 |
|---|---|---|---|---|
| [marktext/marktext](https://github.com/marktext/marktext) | 63410 | MIT | Electron，仍在推 | Typora 开源对应物，社区多次分叉续命；无 AI |
| [Zettlr/Zettlr](https://github.com/Zettlr/Zettlr) | 13844 | GPL-3.0 | 活跃 | 学术主力：Zotero 引用、Pandoc 导出、项目工作区；**刻意不做 AI** |
| [silverbulletmd/silverbullet](https://github.com/silverbulletmd/silverbullet) | 6427 | MIT | 活跃 | 自托管浏览器端 Markdown + Lua 脚本层 |
| [doocs/md](https://github.com/doocs/md) | 13494 | WTFPL | 活跃 | 微信 Markdown 编辑器（排版侧参照，非桌面编辑器） |
| [mdnice/markdown-nice](https://github.com/mdnice/markdown-nice) | 4675 | GPL-3.0 | **2023 停更** | 主题化 Markdown 排版 |
| [iwe-org/iwe](https://github.com/iwe-org/iwe) | 1807 | Apache-2.0 | 活跃 | Rust 实现，Markdown 知识图谱 + LSP + MCP，**非 GUI 编辑器** |

### 2.3 知识库层（长期留存竞争）

| 项目 | Stars | 许可 | 说明 |
|---|---|---|---|
| [usememos/memos](https://github.com/usememos/memos) | 64205 | MIT | 自托管随手记，Go + 服务端 |
| [laurent22/joplin](https://github.com/laurent22/joplin) | 56964 | AGPL | 隐私笔记 + 同步（WebDAV/ Joplin Cloud） |
| [logseq/logseq](https://github.com/logseq/logseq) | 45438 | AGPL-3.0 | 双链 + 大纲，插件生态强 |
| [TriliumNext/Trilium](https://github.com/TriliumNext/Trilium) | 38636 | AGPL-3.0 | 层级知识库，600+ open issues |
| [obsidian-tasks-group/obsidian-tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) | 4074 | MIT | **TODO 管理事实标准**（Obsidian 生态） |

> Obsidian 本体闭源（免费个人使用 + 付费 Sync），是"公不公平竞争"讨论的高频靶子，但用户体量仍是 flymd 的主要外流口。

---

## 三、flymd 差异化能力逐项对标

| flymd 能力 | GitHub 上的对标项目 | 星标 | 结论 |
|---|---|---|---|
| **PDF 高精度解析**（插件 / MinerU 插件） | [opendatalab/MinerU](https://github.com/opendatalab/MinerU) | 82902 | 上游引擎，flymd 走插件调用路线，合理 |
| | [docling-project/docling](https://github.com/docling-project/docling) | 69935 | MIT，同一赛道主要替代 |
| | [datalab-to/marker](https://github.com/datalab-to/marker) | 40737 | PDF→MD+JSON |
| | [chatdoc-com/OCRFlux](https://github.com/chrisryugj/kordoc)（OCRFlux） | 2531 / 2879 | 轻量多模态解析 |
| **TODO 多渠道推送**（微信/短信/钉钉/飞书） | obsidian-tasks（4074）仅做任务管理，**无多渠道推送** | — | ✅ **flymd 明显空白区**，最强差异点 |
| | memos / Joplin / Trilium 均无内建推送 | — | ✅ |
| **AI 写作** | SoloMD（14 BYOK + MCP）、Textus（Ollama）、Markra（原生 AI）、domd（AI 流式组件） | 1458 / 559 / 943 / 586 | ⚠️ **已饱和**，无法作为差异点 |
| **本地知识库 RAG** | iwe（1807）、neurostack（47）、lumenfolio（25） | 低星 | 🟡 赛道小众，flymd RAG 有先发优势但无护城河 |
| **博客一键发布**（Typecho/WordPress/Halo） | doocs/md（微信排版）、markdown-nice | 13494 / 4675 | 🟡 桌面端直接对标者少，flymd 有位置 |
| **WebDAV 同步 + 端到端加密** | SoloMD（GitHub 同步 + E2EE）、Markra（WebDAV）、Noteriv（Git/WebDAV） | 1458 / 943 / 106 | ⚠️ 已是标配，flymd 需靠"白名单 + 加密"细化 |
| **插件系统** | Obsidian / VS Code 生态 | — | ⚠️ 生态规模无法正面竞争，flymd 应走"垂直场景插件"路线 |
| **Git 版本控制** | SoloMD AutoGit、yn 内置 | 1458 / 6771 | ⚠️ 已覆盖 |
| **桌面便签 + 脑图** | 多数项目无 | — | ✅ **空白区**，但需评估使用频次 |
| **AI 小说引擎**（插件） | 无直接对标 | — | ✅ 空白区，垂类差异明显 |
| **Android 端** | SoloMD（iOS+Android）、Obsidian（移动端）、Markitty（Windows/Android/iOS） | — | 🟡 移动端是基础分，非差异点 |

---

## 四、威胁排序

1. **SoloMD（MIT, 1458★）** —— 威胁最大。功能清单与 flymd README 高度重合，且许可证更宽松（MIT vs flymd 的 NOASSERTION）、文档与对比页更完整、移动端已就位。**建议**：优先做差异化（待办推送 + 便签 + 脑图 + 博客发布 + PDF），而非继续补通用编辑器能力。
2. **MarkFlowy（AGPL, 2422★）** —— 同为 ProseMirror + 高性能本地优先，性能叙事正面对撞。
3. **Markra（AGPL, 943★）** —— Typora 式手感 + AI + WebDAV，用户重叠度高。
4. **MarkText（MIT, 63410★）** —— 体量级老牌 Typora 替代，维护放缓但心智牢固。
5. **Obsidian / Logseq / Joplin** —— 长期留存的真正对手，但形态不同，威胁是"用户根本不用专用编辑器"。

---

## 五、顺带发现的两个自身问题（与竞品定位直接相关）

### 5.1 发布线断裂：309 个提交从未合并进 main（2026-11-01 已解决）

> **初稿更正记录**：初稿把两个仓库判为"地址分叉"，随后核实 `htmambo/flymd` 是 `flyhunterl/flymd` 的 **fork**（`fork: true`）。真正的问题是**发布线断裂**，且比地址问题严重得多。2026-11-01 已按"fork 即发布主线"的决策解决。

**问题（当时状态）**：
- `flyhunterl/flymd` = 原 upstream，900★，最后推送 2026-07-22（v1.4.4）；`htmambo/flymd` = fork，0★
- fork 的 `main` 与 upstream 的 `main` 完全一致，均停在 `e6f73b8 发布 v1.4.4`（2026-07-22）
- 开发堆在一条线性分支链上（互为祖先）：`optimized`(178) → `fix/macos-quit-close`(216) → `sync/main-v1.4.4`(280) → `fix/audit-round1-correctness`(309)
- 这 309 个提交（2026-06-16 → 2026-10-31，469 文件，+86193/−22716）**从未合并进 `main`**，公开版本与开发分支脱节达 3.5 个月
- 期间 SoloMD 4.0→4.6、Markra 密集发版，差距被拉大

**解决方式（2026-11-01）**：
- **决策：不向原 upstream 提 PR，`htmambo/flymd` 直接作为发布主线**
- 309 个提交快进合并进 `main`（零冲突，upstream 无独有提交），并追加许可证修正与 MCP 服务器
- 全仓仓库地址由 `flyhunterl/flymd` 切换为 `htmambo/flymd`（README 徽章、扩展市场 `index.json` 的 raw 引用、更新检查 API、PKGBUILD、metainfo、插件 manifest、About 面板等共 30 个文件）
- 版本号由 1.4.4 升至 **2.0.0**（库私有化 v2 功能线此前从未发布，`docs/Usage/` 已按 v2.0 措辞撰写）
- `scripts/get-version.sh` 的 `UPSTREAM_REPO` 默认值同步改为 `htmambo/flymd`（该脚本从 git tag 取版本，是打包的事实来源）
- ⚠️ **遗留**：winget `flyhunterl.FlyMD` 与 AUR `flymd` 的清单仍指向原仓库，需各自提交更新后才能分发 v2.0.0

### 5.2 许可证声明自相矛盾（本次已修正）

- `LICENSE` 文件：声明为 **GPL-3.0**（"本项目基于 GNU 通用公共许可证 第 3 版发布"），但**不含全文**，仅链接 gnu.org
- `package.json`：`"license": "LicenseRef-flyMD-NC-1.0"`（**非商用**）——与 README 自述"允许任何用途（**包括商业用途**）"直接冲突
- GitHub API 识别结果：**NOASSERTION**（LICENSE 是自定义声明而非标准 GPL 全文）
- `src-tauri/Cargo.toml`：无 `license` 字段

三个问题：
1. **GPL-3.0 与"非商用"在法理上互斥**——GPL-3.0 第 10 条已禁止附加限制，"NC" 不是 GPL-3.0 的一个变体。当前写法要么让 license 声明整体失效，要么实际不构成 GPL-3.0。
2. **竞品压力**：SoloMD / InkNote / Textus / markamd / Paperling 均为 MIT，MarkFlowY / Markra / yn 为 AGPL-3.0（均有标准 LICENSE 全文）。flymd 的 NOASSERTION 会让企业合规扫描和二次开发者直接放弃，也让 `npm` / crates.io 等渠道的自动识别失效。
3. **已修正**：`package.json` → `GPL-3.0`；`LICENSE` → GPL-3.0 全文（35149 bytes，md5 `1ebbd3e34237af26da5dc08a4e440464`）；`src-tauri/Cargo.toml` → 补 `license = "GPL-3.0"`。商业双许可路径（README 已留 flyhunterl@gmail.com）保持不变。

**建议**：二选一并保持三处（LICENSE 文件、package.json、README 徽章）一致——要么走标准 GPL-3.0 全文，要么走标准 MIT 全文 + 独立 `TRADEMARK`/`NOTICE` 说明商业限制，不要混用 SPDX 自定义 ref。

---

## 六、取数与复核

- 全部 star / license / 语言 / 最后推送时间取自 GitHub REST API（`gh api`），快照时间 **2026-11-01**；star 数为动态值，复核时以 API 为准。
- 功能描述来源：各仓库 README、仓库 topics、官方文档站；第三方评测（floatboat、solomd.app、nimbalyst、nite07）仅用于交叉印证，**不作为独立事实源**。
- 未纳入：无 GitHub 仓库的闭源同类（Typora、Obsidian 本体、Notion、飞书文档）与纯前端小工具（因不构成桌面端替代竞争）。

### 引用来源

- GitHub REST API: `https://api.github.com/repos/{owner}/{repo}`、`https://api.github.com/search/repositories`
- https://github.com/htmambo/flymd
- https://github.com/zhitongblog/solomd
- https://github.com/drl990114/MarkFlowy
- https://github.com/markrahq/markra
- https://github.com/CatVinci-Studio/Textus
- https://github.com/mattenarle10/markamd
- https://github.com/purocean/yn
- https://github.com/marktext/marktext
- https://github.com/Zettlr/Zettlr
- https://github.com/opendatalab/MinerU
- https://github.com/docling-project/docling
- https://github.com/datalab-to/marker
- https://github.com/obsidian-tasks-group/obsidian-tasks
- https://github.com/iwe-org/iwe
- https://github.com/silverbulletmd/silverbullet
- https://github.com/doocs/md
