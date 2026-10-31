# 主题背景「编辑 / 阅读」能否合并为一套设置 —— 可行性分析

**状态**：分析完成，待用户拍板落地形态
**日期**：2026-10-31
**背景**：`docs/Task/Archive/2026-10/2026-10-31-theme-bg-section-merge.md` 已把主题面板的背景区合并为一块（分段控件版，UI 合并但保留 `editBg`/`readBg` 两个取值域）。本轮追问的是更激进的一档：**取消分段控件，真正只保留一个设置项**。

---

## 一、结论

**技术上完全可行，无技术阻塞，成本约 0.5–1 人日。**

可行性的根本依据不是"两个变量能不能赋同一个值"，而是：**两个变量的作用域（shell / paper）在消费侧几乎不相交，合并不会引发任何选择器冲突或作用域污染**。

但合并有一个**不可回避的代价**：存量用户的 `editBg` 与 `readBg` 两个历史色**必须归一为一个**，无法做到"既合并、又完全不动任何一个色"。这是合并的固有成本，不是实现缺陷。

---

## 二、已核实的事实基础

### 2.1 变量消费分布（`rg` 实测，去重后）

| 变量 | 消费点 | 文件数 | 语义 |
|---|---|---|---|
| `--bg` | 59 处 | 15 | 应用界面色（外壳） |
| `--preview-bg` | 10 处 | 4 | 纸面色（阅读 / 所见内容表面） |

`--bg` 逐文件：`dialog.css:11`、`theme-panel.css:8`、`window.css:6`、`extensions.css:6`、`editor.css:4`、`dark-mode.css:4`、`notifications.css:3`、`library.css:3`、`cm6Editor.css:3`、`tabbar.css:2`、`preview.css:2`、`context-menu.css:2`、`code-rendering.css:2`、`base.css:2`、`ui-enhance.css:1`

`--preview-bg` 逐文件：`editor.css:5`、`dark-mode.css:2`、`code-block-decoration.css:2`、`preview.css:1`

两者消费的文件集合**只重叠 3 个**（`editor.css` / `dark-mode.css` / `preview.css`），且重叠处是不同规则（`--bg` 给编辑器/外壳，`--preview-bg` 给纸面）。**合并不会产生选择器冲突。**

### 2.2 写入点唯一

`--bg` / `--preview-bg` 的全部写入点共 6 处，**全部在 `src/theme.ts`，且全部写在 `.container` 元素的内联 style 上**（`getContainer()` → `document.querySelector('.container')`）。

```
theme.ts:380-385   applyThemePrefs()  日/夜两分支
theme.ts:1422-1423 预览悬停回填
theme.ts:1432-1437 撤销回填
theme.ts:1446-1450 恢复回填
```

**`body` / `:root` 从未被写入**。这一条决定了下面 2.3 的结论。

### 2.3 三个「早已同源」的发现（决定了合并的视觉影响面比想象小）

**① 挂到 `body` 的弹窗不吃用户的「编辑背景」**

`src/dialog.ts`（8 处）、`src/ui/confirmDialog.ts:52`、`src/ui/librarySettingsDialog.ts:169`、`src/extensions/pluginMenu.ts:166`、`src/main.ts:5696`（右键菜单）、`src/main.ts:6745`（查找替换面板）全部 `document.body.appendChild(...)`。

`body` 是 `.container` 的**祖先**，CSS 自定义属性只能向下继承 → 这些弹窗读到的是 `base.css` / `dark-mode.css` 里的**静态根值**（`--bg: #ffffff` / `#0b0c0e`），与用户设置无关。

> 推论：**统一后弹窗观感完全不变**。统一不会"整窗染成纸面色"。

**② 标题栏 / 侧栏 / 标签栏已经是「纸面色的衍生色」**

`library.css:8`、`tabbar.css:26`、`window.css:9,49,97` 用的是 `var(--chrome-bg, var(--bg))` —— `--chrome-bg` 恒被 JS 写入（`deriveChromeColors` 派生，阈值亮度 ±6~14），`var(--bg)` 只是回退。

而 `updateChromeColorsForMode(mode)`（`theme.ts:335`）按当前模式取 base：

```ts
case 'wysiwyg': case 'preview': base = readBg   // 阅读/所见 → 纸面色
default: /* edit */            base = editBg   // 源码 → 界面色
```

> 推论：**阅读/所见模式下，外壳本来就跟纸面色同源**（只差 ±6~14 的亮度微调）。统一后这一区域基本无感。

**③ 所见模式的容器本来就是纸面色**

`editor.css:29`：`.container.wysiwyg-v2 { background: var(--preview-bg) !important; }`

> 推论：**所见模式统一后零变化**。

### 2.4 其他关键事实

- **阅读模式的「纸」没有立体感**：`editor.css:274-278` 的 `.preview` 是 `background-color: var(--preview-bg); box-shadow: none;` → 纸与容器底色之间**只有靠颜色差**，没有描边或投影。这正是统一后最明显的观感损失点。
- **`preview-plain` 特判**：`theme.ts:414-419`，当 `readBg` 为纯白且非夜间时给容器加 `.preview-plain`（`editor.css:281-291`，仅关闭羊皮纸纹理 + 去阴影）。
- **羊皮纸只是叠加层**：`.container.parchment-edit .editor` / `.container.parchment-read .md-content` 只设 `background-image`，与底色叠加不冲突。
- **网格背景只作用于源码模式**：`.container.edit-grid-bg:not(.wysiwyg-v2)`。
- **存储**：`localStorage` 键 `flymd:theme:prefs`，字段 `editBg` / `readBg` / `editBgDark` / `readBgDark`，另有已退役的 `wysiwygBg` / `parchmentWysiwyg`（保留以原样回写，保证 `git revert` 后用户设置不丢 —— 这是仓库**既有的兼容模式**）。
- **插件契约**：`plugin.md:1986-2053` 把 `editBg` / `readBg` 列为**公开插件 API 字段**。

---

## 三、合并后到底会变什么（逐场景）

| 场景 | 变化 | 说明 |
|---|---|---|
| 所见模式 | **无变化** | 容器本就是 `--preview-bg` |
| 阅读模式 · 纸面 | **无变化** | `--preview-bg` 值不变 |
| 阅读模式 · 纸与留白的边界 | **变化（损失）** | 纸面与容器底色同色，`box-shadow: none` → 纸不再"浮"起来 |
| 源码模式 · 编辑区底色 | **变化** | `--bg` 从 `editBg` 变为统一值 |
| 源码模式 · 侧栏/标签栏 | **变化** | `--chrome-bg` 的 base 从 `editBg` 变为统一值 |
| 标题栏 / 侧栏（阅读模式） | **无变化** | base 本就是 `readBg` |
| 全部弹窗 | **无变化** | 读静态根值 |
| 主题面板自身 | **变化** | 面板在容器内，吃 `--bg` |

**结论：合并的实际影响面 = 源码模式的编辑区与侧栏 + 阅读模式的「纸-留白边界」。比"整窗同色"的直觉印象小得多。**

---

## 四、代价：合并会失去什么

1. **界面色与纸面色独立设置的能力**（真实能力，非理论）。
   典型用法：暗色冷调界面 + 暖调纸面护眼阅读。仓库**默认配色本身就是这样**：
   `editBgDark: #0b0c0e`（中性黑）× `readBgDark: #12100d`（暖黑），
   `editBg: #ffffff`（纯白）× `readBg: #fafafa`（中性灰）。
   统一后这套「冷界面 + 暖纸」的组合消失，用户无法再调出。
2. **「纯白背景」语义变味**。当前纯白只作用于纸面；统一后选纯白会让源码模式编辑区也是纯白。
3. **源码模式的专属底色**。习惯「阅读区暖、编辑区冷」的用户会失去这一层。
4. **存量两个色必须归一**（不可避免）。归一后其中一个色的独立值永久丢失，除非做备份键。
5. **插件 API 语义漂移**（若采用方案 A）。字段保留但独立性失效，插件单独写 `readBg` 会在下次面板保存时被镜像覆盖。

### 不受合并影响的（明确排除，避免误判）

- 网格背景：`gridBackground` 是 class 开关，语义上本就只属于源码模式 → 不受影响。统一后应**取消"仅在源码模式生效"的禁用态**，改为无条件可用。
- 羊皮纸：`parchmentEdit` / `parchmentRead` 是 `background-image` 叠加层，与底色不冲突 → 不受影响。
- 主题切换、暗色切换、PDF 导出（`pdf.ts:527` 硬编码 `--preview-bg: #fafafa`）：不受影响。

---

## 五、方案对比

### 方案 A —— 单控件 + 镜像双写（推荐）

面板只暴露**一个**背景控件；其值**同时写入** `editBg` 与 `readBg`（含 `editBgDark` / `readBgDark`）。`--bg` 与 `--preview-bg` 仍分别渲染，但值相同。

- ✅ 存储键、字段名、插件契约**零变更**；无迁移
- ✅ 回滚 = `git revert`，无数据损失（前提：首次交互前不动旧值，见 6.2）
- ✅ 满足"真正一套设置"的诉求
- ⚠️ 插件单独写 `editBg` / `readBg` 会被下次面板保存覆盖 → 需在 `plugin.md` 标注"两字段已镜像，独立设置不再生效"

### 方案 B —— 彻底单值

删除 `readBg` / `readBgDark`，`--preview-bg` 改由 `--bg` 派生或退役。

- ✅ 语义最干净，没有"两个字段一个值"的冗余
- ❌ **破坏插件公开契约**（`plugin.md` 明文列出 `readBg`）
- ❌ 需要迁移 `flymd:theme:prefs` 存量值
- ❌ 回滚需靠迁移脚本反向还原
- 建议：**作为 A 稳定后的后续版本再做**（届时可引入 `prefs` schema version 字段铺路）

### 方案 C —— 保留分段 + 加「统一」开关

与"真正一套设置"直接矛盾，**从候选中剔除**。

---

## 六、推荐落地方案（方案 A 细化）

### 6.1 事实源设计

单一控件 = 唯一事实源；`editBg` / `readBg` 降级为**镜像输出**，不再是独立事实源。
`data-bg-target` 三层事实源机制（radio 意图 → 容器 `data-bg-target` 生效目标 → 控件 `data-target`）随分段控件一并删除，改为单层。

### 6.2 存量归一策略（关键）

存量用户的 `editBg ≠ readBg` 是常态。**必须先定策略，否则"双字段恒等"不变量在升级当天即被打破**：

- **控件显示值**：取 `readBg`（纸面色是内容表面，也是 `preview-plain` 的判据键，用户情感锚点更强）。
- **首次用户交互前**：**不改动** `editBg`，`--bg` 仍按 `editBg` 生效 → 升级瞬间零视觉变化。
- **首次用户交互时**：同时写 `editBg` / `readBg`（及暗色变体），此后两字段恒等。
- **一次性归一不可避免**：由于控件只展示一个值，"控件显示 A 而实际 `--bg` 是 B"是不可接受的 UI 矛盾，因此**必须在首次交互时把 `--bg` 也归一到控件值**。归一方向随控件显示值一起定（默认归到 `readBg`）。

### 6.3 文件级改动清单

| 文件 | 改动 |
|---|---|
| `src/theme.ts` | 删除 `.theme-bg-segmented` 相关 markup 与 `syncBgControls()`；新增单控件写路径（双字段镜像）；`fillSwatches` / `syncBgColorInput` 去掉 target 参数分支；`loadThemePrefs` 增加镜像归一 |
| `src/styles/theme-panel.css` | 删除 `.theme-bg-segmented` / `.theme-bg-segment*` 规则（**不得引入 `:has()`**） |
| `src/i18n.ts` | 废弃 `theme.bg.ui` / `theme.bg.read` / `theme.bg.uiTip` / `theme.bg.readTip`，收敛为单一「背景」标签；中英同步 |
| `src/styles/themeBgSegment.test.ts` | 重写为「单一背景控件」用例（现 24 例） |
| `src/styles/themeBackgroundTokens.test.ts` | 调整变量不变量断言（现 14 例） |
| `plugin.md` | 标注 `editBg` / `readBg` 已镜像、独立设置不再生效 |

### 6.4 里程碑

1. M1 单控件改造（`theme.ts` + CSS + i18n），`editBg`/`readBg` 双写
2. M2 存量归一逻辑 + `preview-plain` 联动修正
3. M3 测试重写与补充
4. M4 `plugin.md` 契约说明更新
5. M5（可选，后续版本）方案 B：删字段 + schema version 迁移

### 6.5 测试计划

主题相关 spec 清单：`src/styles/themeBgSegment.test.ts`、`src/styles/themeBackgroundTokens.test.ts`、`src/styles/styleScopeAudit.test.ts`、`src/styles/markdownContentMount.test.ts`。

新增 / 重写用例：

1. 单控件写入 → `editBg` 与 `readBg`（含暗色变体）同时更新，且 `--bg` / `--preview-bg` 同值
2. 存量 `editBg ≠ readBg` → 控件显示 `readBg`；首次交互前 `--bg` 仍为 `editBg`；首次交互后两者归一
3. 纯白 → `.preview-plain` 正确挂载 / 卸载
4. 暗色模式：单控件在亮/暗两套色板间切换正确
5. 网格背景开关在统一后不再被禁用
6. 羊皮纸叠加不覆盖底色
7. 回滚安全：镜像写盘后 `git revert` 不丢用户值
8. 面板 DOM 唯一性：分段 radio 已移除，无残留 `data-bg-target`
9. 插件路径：`applyThemePrefs({editBg})` 单独传值时的行为定义

### 6.6 回滚策略

`git revert` 可回滚代码。但**镜像写盘会覆盖用户原有的 `readBg`** → 回滚后用户丢失旧纸面色。

对策：镜像写入时，把被覆盖的旧值备份到 `flymd:theme:prefs:pre-unify`（一次性），回滚后可人工恢复。

### 6.7 工作量

- 方案 A：**0.5–1 人日**（M1–M4）
- 方案 B：追加迁移 + 契约破坏处理 **+1–1.5 人日**

---

## 七、风险登记

| # | 风险 | 处置 |
|---|---|---|
| R1 | 存量两色冲突，合并当天归一策略未定义 | 6.2 已定义：控件显示 `readBg`，首次交互前不动 `editBg`，首次交互时归一 |
| R2 | "不改 DOM 结构"约束与"删除分段控件"需求冲突 | **裁决**：该约束是上一轮「只合并 UI」工作范围的产物；本轮需求本身即要求删除控件，删除 `createPanel()` 里这对 radio 属需求内动作。同时需清理 `radio:checked` 相关 CSS |
| R3 | 纯白背景语义变味 | 归一后 `--preview-plain` 判据从 `readBg` 改为统一值；需补测试用例 3 |
| R4 | 插件 API 语义漂移（隐性破坏） | `plugin.md` 明确标注两字段已镜像；插件若需独立纸面色应直接覆盖 CSS 变量 |
| R5 | 明暗轴在单控件内如何呈现 | 现有单控件已按 `body.dark-mode` 在 `editBg`/`editBgDark` 间切换，合并后同一模式继续适用（仅字段对从 2 对变 1 对） |
| R6 | 回滚丢用户旧纸面色 | 6.6 备份键方案 |
| R7 | `body` / `body` 级弹窗读静态根 `--bg` | 已在 2.3 ① 标注；**统一后弹窗不变**，非风险，但属"一个背景"的用户预期落差，需在文档说明 |
| R8 | 羊皮纸 / 网格是否也要跟着合并 | 本轮**不动**；网格取消禁用态即可，羊皮纸两个开关保持独立（它们是纹理，不是底色） |

---

## 八、待用户拍板的点

1. **是否实施**（方案 A / 方案 B / 暂不实施）
2. **一次性归一方向**：归到 `readBg`（纸面色，推荐）还是 `editBg`（界面色）
3. **是否接受**"阅读模式纸-留白边界消失"这一观感损失
4. 方案 B（真删字段）是否推迟到 A 稳定后的下一版本

---

## 九、外部审查意见与处置

**审查轮次**：需求轮（`review_plan`，provider=coding-bridge，session `8d7bd0b1-e415-4990-b8b2-a11ea59b9d48`）

**结论**：`VERDICT: REQS_CHANGES`（8 条风险）

| # | 外审意见 | 处置 |
|---|---|---|
| 1 | 存量数据冲突在 A 方案下同样存在，未定义归一策略 | **采纳** → §6.2 已定义完整归一策略；新增用例 2 |
| 2 | "不改 DOM 结构"约束与"删除分段控件"矛盾 | **采纳** → §7 R2 已显式裁决 |
| 3 | 未回答"丢失什么能力" | **采纳** → §4 逐条列出 |
| 4 | A 方案下 plugin API 语义漂移是隐性破坏 | **采纳** → §7 R4 + §6.3 `plugin.md` 改动项 |
| 5 | 明暗轴在单控件内的呈现未澄清 | **采纳** → §7 R5 澄清（沿用现有 `body.dark-mode` 切换模式） |
| 6 | 测试与回滚完全缺失 | **采纳** → §6.5 测试计划（9 类）+ §6.6 回滚备份键 |
| 7 | 已知边界（body / `#app` 读静态根 `--bg`）未标注 | **采纳** → §2.3 ① 与 §7 R7 |
| 8 | 无成本估算、文件级清单、里程碑 | **采纳** → §6.3 / §6.4 / §6.7 |
| — | 建议剔除方案 C（与"真正一套设置"矛盾） | **采纳** → §5 已剔除 |
| — | 建议"推荐 A 为落地、B 为后续" | **采纳** → §五 / §6.4 M5 |
