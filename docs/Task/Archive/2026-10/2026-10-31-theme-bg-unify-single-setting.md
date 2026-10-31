# 主题背景统一为单一设置（取消「界面 / 阅读」分段）

**Status**: ✅ Completed (completion time: 2026-10-31)
**创建时间**: 2026-10-31
**创建者**: mavis（minimax Code）
**前置分析**: `docs/Analysis/THEME_BG_SINGLE_SETTING_ANALYSIS_2026-10.md`
**上游任务**: `docs/Task/Archive/2026-10/2026-10-31-theme-bg-section-merge.md`（分段控件版背景区合并）

---

## 一、任务目标与背景

主题面板当前有一块「背景」区，内含「界面 / 阅读」分段控件，两个取值域 `editBg` / `readBg` 各自独立。

用户要求**再进一步**：不保留分段，真正只用**一套设置**——面板只暴露一个背景控件，编辑区与阅读区共用同一个颜色。

可行性已在前置分析中论证完毕（技术上可行，作用域不相交，成本 0.5–1 人日）。本任务负责落地实现。

## 二、用户已确认的决策（本轮不可再议）

| # | 决策 | 取值 |
|---|---|---|
| D1 | 落地档位 | **方案 A**：单控件 + 镜像双写。存储键、字段名、插件契约零变更，无迁移 |
| D2 | 一次性归一方向 | **归到 `readBg`（纸面色）** |
| D3 | 羊皮风格 | **一并合并为一个开关** |

## 三、现状与问题分析

### 3.1 关键事实（已核实）

- `--bg`（界面色）：CSS 消费 59 处 / 15 文件；`--preview-bg`（纸面色）：10 处 / 4 文件。两者作用域基本不相交。
- `--bg` / `--preview-bg` 的**全部**写入点（6 处）都在 `src/theme.ts`，且全部写在 `.container` 内联 style 上；`body` / `:root` 从未被写入 → 挂到 `body` 的弹窗（`dialog.ts` ×8、`confirmDialog.ts`、`librarySettingsDialog.ts`、`pluginMenu.ts`、右键菜单、查找替换面板）读的是静态根值，**不受用户设置影响**。
- 标题栏 / 侧栏 / 标签栏用 `var(--chrome-bg, var(--bg))`；`--chrome-bg` 由 `deriveChromeColors(base)` 派生，base 按当前模式取 `editBg`（源码）或 `readBg`（阅读/所见）。
- 所见模式容器即 `var(--preview-bg) !important`（`editor.css:29`）。
- 羊皮纸 CSS 只设 `background-image`，与底色叠加不冲突：`.container.parchment-edit .editor` / `.container.parchment-read .md-content`。
- 网格背景 CSS `.container.edit-grid-bg:not(.wysiwyg-v2)` → 只作用于源码模式。
- `preview-plain`（`theme.ts:414-419`）在 `readBg` 为纯白且非夜间时给容器加类。

### 3.2 合并后的设计（核心）

**锚点唯一化**：`readBg` / `readBgDark` 成为背景的唯一事实源（与 D2 一致）。

- 渲染：`--bg` 与 `--preview-bg` 由**同一个**锚点值驱动 → 二者恒等。
- 写入：面板改色时**同时**写 `readBg`/`readBgDark` 与 `editBg`/`editBgDark`（镜像输出），保持插件 API 字段有意义的当前值。
- `editBg` / `editBgDark` 从此**不再作为渲染来源**，只作为镜像输出与插件兼容字段保留。

**外壳色派生统一**：`updateChromeColorsForMode(mode)` 保留导出签名（`main.ts` 有 6 处调用），但 mode 不再影响派生色——统一后外壳色只由锚点决定。

**羊皮风格合并**：新增 `parchment?: boolean` 作为唯一事实源，同时挂 `parchment-edit` + `parchment-read` 两个类名（CSS 选择器分别作用于 `.editor` / `.md-content`，**CSS 无需改动**）。

## 四、任务拆解与具体改动

### T1 `src/theme.ts` —— 类型与默认值

- `ThemePrefs`：
  - `editBg` / `editBgDark` 加注释：镜像输出字段，渲染不再读取（保留因插件契约 + 存储兼容）。
  - 新增 `parchment?: boolean`（羊皮风格唯一事实源）。
  - 新增 `preUnifyBg?: { editBg?: string; readBg?: string; editBgDark?: string; readBgDark?: string }`（合并前独立值的备份，保证 `git revert` 后可恢复；与仓库既有 `wysiwygBg` 兼容模式一致，**不新增存储键**）。
- `DEFAULT_PREFS`：
  - `readBg` 由 `getCssVar('--preview-bg') || '#fbf5e6'` 改为**静态 `'#fafafa'`**（对齐 `base.css:15` 的日间默认值）。原因：`getCssVar` 在深色系统上会读到 `#12100d`，成为日间默认值——锚点化后该抖动会影响全窗口底色，必须消除。`getCssVar` 若因此无其他调用则一并删除。
  - `editBg` 默认值与锚点对齐（避免新装即出现假分歧）。
- `loadThemePrefs()`：
  - 读回 `parchment`；缺失时按**并集**归一：`obj.parchment ?? (obj.parchmentEdit === true || obj.parchmentRead === true)`（并集保证任一模式已有的羊皮效果不会凭空消失）。
  - 读回 `preUnifyBg`。

### T2 `src/theme.ts` —— 渲染路径

- 新增内部解析函数 `resolveUnifiedBg(prefs)`：返回当前明暗下的锚点色（`isDarkMode ? readBgDark : readBg`，含默认值兜底）。
- `applyThemePrefs()`：
  - `--bg` 与 `--preview-bg` 均写锚点值（键集合仍为 `['--bg','--preview-bg']`，日/夜对称性测试继续成立）。
  - 外壳色派生改为直接用锚点值（原「按模式选 editBg/readBg」的分支删除）。
  - `preview-plain` 判据改用解析出的锚点值（语义不变，因锚点即 `readBg`）。
  - 羊皮类名：`parchment-edit` 与 `parchment-read` 均由 `prefs.parchment` 驱动。
- `updateChromeColorsForMode()`：保留签名与导出，mode 参数不再影响派生色（加注释说明原因）。`noUnusedParameters: false`，无需改名。

### T3 `src/theme.ts` —— 面板 markup 与事件

- `createPanel()` 的背景区：
  - **删除** `.theme-bg-segmented` 整块（两个 hidden radio + 两个 label）。
  - `.theme-swatches` 去掉 `data-target`；自定义色输入框去掉 `data-target`；应用按钮去掉 `data-target`。
  - 羊皮风格仍是**一个** checkbox（`#parchment-bg-toggle`），文案沿用 `theme.parchment`。
- 删除函数与绑定：
  - `syncBgControls()`、`flushColorDraft()`、`currentBgTarget()`。
  - 分段 radio 的 `change` 绑定；`data-bg-target` 事实源机制整体删除。
  - `data-for` 派生（色板归属）→ 单控件下恒为统一目标。
- 事件处理改写：
  - 色板点击 → 写锚点字段 + 镜像字段（暗色模式写 `*Dark` 对）。
  - 应用按钮 → 同上（`data-target` 定位改为直接取唯一输入框）。
  - 悬停预览 → 同时设 `--bg` 与 `--preview-bg`；还原预览 → 同时还原两者。
  - 羊皮风格 checkbox → 写 `parchment` + 镜像 `parchmentEdit` / `parchmentRead`。
  - 网格背景 → **取消** `disabled` 状态与 `theme-grid-bg-disabled` 类（其 CSS 本就只作用于源码模式，合并后不再需要分段区分）；tip 文案保留「仅在源码模式生效」。
- `syncBgColorInput()` / `fillSwatches()`：去掉 target 参数分支，改为读锚点值。
- 镜像写盘时：若 `editBg` 与 `readBg`（或暗色对）确实不同且 `preUnifyBg` 尚未记录，则先写入 `preUnifyBg` 备份。

### T4 `src/styles/theme-panel.css`

- 删除 `.theme-bg-segmented` / `.theme-bg-segment-input` / `.theme-bg-segment` / `:hover` / `:checked +` / `:focus-visible +` 相关规则。
- 删除 `.theme-grid-bg-option.theme-grid-bg-disabled` 规则（不再有禁用态）。
- **不新增任何 `:has()`**（Safari 13/14 兼容底线）。

### T5 `src/i18n.ts`

- 删除 `theme.bg.ui` / `theme.bg.read` / `theme.bg.uiTip` / `theme.bg.readTip`（中英同步）。
- 新增 `theme.bg.tip`：说明「界面与阅读共用同一背景色」。中英同步。

### T6 测试

- `src/styles/themeBgSegment.test.ts`（现 24 例）→ 重写为 `src/styles/themeBgUnify.test.ts`，覆盖：
  1. 面板中分段 radio 已移除、无 `data-bg-target` / `data-target` 残留
  2. 单控件改色 → `editBg` 与 `readBg`（含暗色对）同时更新；`--bg` 与 `--preview-bg` 同值
  3. 存量 `editBg ≠ readBg` → 锚点取 `readBg`；`--bg` 归一到 `readBg`
  4. 镜像写盘时把分歧值备份进 `preUnifyBg`
  5. 纯白 → `.preview-plain` 正确挂载 / 卸载
  6. 暗色模式：锚点取 `readBgDark`
  7. 羊皮风格：勾选后 `parchment-edit` + `parchment-read` 同时挂载；legacy 并集归一
  8. 网格背景开关不再被禁用
  9. 悬停预览同时改两个变量，离开还原
  10. 插件路径：`applyThemePrefs({editBg})` 单传 `editBg` 时以锚点为准（`readBg` 生效）
  11. 非法色守卫、`normalizeHexColor` 大写化
  12. 点色板不误关面板（上一轮 D3 回归）
  13. 代理按钮不串味（上一轮 D2 回归）
  14. i18n 键收敛
  15. CSS 无 `:has()`
- `src/styles/themeBackgroundTokens.test.ts`：适配新默认（静态 `readBg`）与新归一语义；日/夜键集合对称性断言保持。

### T7 `plugin.md`

- 在 `editBg` / `readBg` 字段说明处标注：背景已统一为单一设置，两字段互为镜像，独立设置不再生效；插件如需自定义背景请写 `readBg`（或直接覆盖 CSS 变量）。

### T8 验证与归档

- 门禁：`npx tsc --noEmit`、`npx vitest run`、`npx vite build`。
- 浏览器实测：面板形态、单控件改色（明/暗）、羊皮开关、网格开关、纯白 `preview-plain`、源码/阅读/所见三模式观感。
- 归档到 `docs/Task/Archive/2026-10/`，更新 `docs/Task/README.md` 索引。

## 五、预期效果与验收标准

1. 主题面板背景区**只有一个**色板 + 一个自定义色输入框 + 一个「应用」按钮 + 一个「羊皮风格」开关 + 一个「网格背景」开关；**无分段控件**。
2. 改一次颜色，源码模式编辑区、阅读纸面、所见容器、外壳（标题栏/侧栏/标签栏）**同时**变为该色。
3. `editBg` 与 `readBg` 在存储中保持相等（镜像不变量）。
4. 存量用户升级后：`readBg` 为锚点生效；原先独立的 `editBg` 被备份到 `preUnifyBg`，`git revert` 后可恢复。
5. `plugin.md` 中 `editBg` / `readBg` 字段仍存在（契约不破），但已标注镜像语义。
6. 门禁全绿：`tsc` 无错、`vitest` 全绿、`vite build` 通过。

## 六、风险评估与缓解

| # | 风险 | 缓解 |
|---|---|---|
| R1 | 存量两色归一导致源码模式编辑区底色突变（`editBg` → `readBg`） | D2 已确认归到 `readBg`；原值备份进 `preUnifyBg` |
| R2 | 插件只写 `editBg` 时设置不生效 | `plugin.md` 标注改写 `readBg`；`applyThemePrefs` 明确以锚点为准（有单测） |
| R3 | `getCssVar` 依赖系统明暗导致默认抖动 | 改为静态默认值（对齐 `base.css`） |
| R4 | 羊皮风格并集归一会给另一模式新增羊皮纸 | 并集保证「已有效果不消失」，符合统一语义；归一方向在任务文档记录 |
| R5 | 删除 DOM（分段 radio）与「不改 DOM 结构」约束冲突 | 约束是上一轮「只合并 UI」工作范围的产物；本轮需求本身即要求删除控件，已在分析文档 §7 R2 显式裁决 |
| R6 | 悬停预览只改一个变量导致预览不完整 | 预览与还原均同时改 `--bg` / `--preview-bg` |
| R7 | 回滚（`git revert`）后用户旧的独立色丢失 | `preUnifyBg` 备份（同一存储键内，不新增键） |

## 七、实施顺序与依赖

1. T1 → T2 → T3（`src/theme.ts` 内部逻辑，必须同批次完成，否则中间态不一致）
2. T4（CSS，可与 T3 同批）
3. T5（i18n）
4. T6（测试）→ T7（文档）
5. T8（门禁 → 浏览器实测 → 外审代码轮 → 归档）

依赖关系：T2 依赖 T1 的解析函数；T3 依赖 T2 的锚点语义；T6 依赖 T3 完成。

## 八、External Review Opinion

（各轮结论与处置见下，滚动更新）

### Round 1/10 — 需求轮（`review_plan`，provider=coding-bridge，session `8d7bd0b1-e415-4990-b8b2-a11ea59b9d48`）

**结论**：`VERDICT: REQS_CHANGES`（8 条风险）

处置见 `docs/Analysis/THEME_BG_SINGLE_SETTING_ANALYSIS_2026-10.md` §9，全部采纳（另采纳「剔除方案 C」与「A 先落地、B 后续」两条建议）。

### Round 2/10 — 计划轮（`review_plan`，provider=coding-bridge，session `00c43cb1-470b-4bd1-b963-47b3c6b476b5`）

**结论**：`VERDICT: REQS_CHANGES`（10 条）

| # | 外审意见 | 处置 |
|---|---|---|
| P2-1 | 暗色锚点选择未定义；「mode 不影响派生」若指恒用浅色锚点，暗色下会错乱 | **采纳** → 明确区分两个轴：**明暗轴**（`body.dark-mode`）决定取 `readBg` 还是 `readBgDark`；**模式轴**（源码/阅读/所见）不再影响颜色。写入 `resolveUnifiedBg()` 的注释与本文件 §3.2 |
| P2-2 | 存量暗色用户的 `readBg` 已被旧的 `getCssVar` 误捕值 `#12100d` 污染，静态默认只救新用户 | **采纳，升级为 P0** → ① `DEFAULT_PREFS.readBg` 改静态值；② `loadThemePrefs()` 载入期检测污染特征（`readBg` 与 `readBgDark` 同为 `#12100d`）→ `readBg` 重置为日间默认。**不修则锚点化后深色系统的浅色模式整窗近黑** |
| P2-3 | 备份触发面太窄（仅面板首次保存），插件 API 等路径会绕过 | **采纳** → 备份下沉到 `loadThemePrefs()` 的归一化路径（所有持久化路径的共同上游），且**幂等**（已有备份不覆盖） |
| P2-4 | `flushColorDraft` / `data-target` / `data-for` 可能被背景之外的控件复用 | **驳回（有代码证据）** → `rg` 实测：这 11 处引用**全部**在 `src/theme.ts` 且全部属于背景区（色板 / 自定义色输入框 / 应用按钮），全仓无外部复用 |
| P2-5 | `parchmentEdit` / `parchmentRead` 去留未说明；union 会给未开启过的编辑器凭空出现羊皮纸 | **部分采纳** → `rg` 确认 `plugin.md` **未提及** parchment，两字段不属公开契约，无破坏；仍保留为镜像输出。采纳「旧值一并备份进 `preUnifyBg`」。union 的副作用已记录于 §6 R4 |
| P2-6 | 测试影响面评估不足；i18n 可能缺其他语言包 | **采纳并已核实** → i18n **只有 zh / en 两个语言包**；受影响测试文件**只有 2 个**（`themeBgSegment.test.ts`、`themeBackgroundTokens.test.ts`） |
| P2-7 | `#fafafa` 与 `base.css` 重复硬编码，必然漂移 | **采纳** → 提取共享常量 + 新增一致性测试，断言 `base.css` 的 `--preview-bg` 字面量与 TS 常量相同 |
| P2-8 | 启动顺序风险：chrome 派生若早于 prefs 加载会读到空锚点 | **驳回（有代码证据）+ 防御** → `updateChromeColorsForMode` 的 6 处调用全在运行时模式切换点（`main.ts`），内部 `loadThemePrefs()` 有默认值兜底；`deriveChromeColors()` 对无法解析的颜色返回 `null` → 移除变量而非写入空值 |
| P2-9 | grid 开关失去禁用态后在阅读模式是无效果的死开关 | **采纳为「有意决策 + 验证项」** → 开关保持恒可用（它是**全局**设置，只作用于源码模式），tip 保留「仅在源码模式生效」；不再按模式禁用，避免面板随模式切换跳动。浏览器实测须验证「阅读模式勾选 → 切源码模式生效」 |
| P2-10 | 缺备份幂等、插件写 `editBg` 的镜像回写两类用例 | **采纳** → 补入 §4 T6 用例清单 |

### Round 3/10 — 代码轮（第 1 次，`review_code`，provider=coding-bridge，session `48e4c9f1-60e8-4c25-9749-d82a6fea3eef`）

**结论**：`VERDICT: REQS_CHANGES`（4 条）

| # | 外审意见 | 处置 |
|---|---|---|
| C1 | 备份污染：新用户无历史时若 `DEFAULT.editBg ≠ DEFAULT.readBg`，首载即满足差异条件写入 `preUnifyBg` | **驳回（有代码证据）** → ① 无 localStorage 时 `loadThemePrefs()` **提前 return**，根本走不到备份逻辑；② 新默认值 `editBg === readBg === DAY_BG_DEFAULT`，不存在「默认分歧」 |
| C2 | 归一顺序错：`readBg` 先被迁移改写再参与差异比较与备份，`preUnifyBg` 存的是迁移后值，丢失原始 legacy 状态 | **采纳（真实缺陷）** → 备份计算**前移**到归一化之前，改用原始 `rawReadBg`；新增用例断言备份里存的是原始值 `#12100d` 而非归一后的 `#fafafa` |
| C3 | 魔法值 `'#12100d'` 应提为常量；`editBg`/`editBgDark` 未同步归一，与 read 侧不对称 | **驳回（两项均不成立）** → ① 代码里已是常量 `LEGACY_DARK_CAPTURE = NIGHT_BG_DEFAULT`（外审看到的是压缩载荷时丢掉的常量名）；② 旧 `editBg` 默认是静态 `'#ffffff'`，**从未**被 `getCssVar` 污染 → 不存在需要归一的误捕值 |
| C4 | 重复逻辑：dark-mode 判断在两个函数里重复 | **采纳** → 抽取 `isDarkModeNow()`，4 处调用统一 |

### Round 4/10 — 代码轮（第 2 次，复查，`review_code`，provider=coding-bridge，session `a529c2ed-e7a4-4b6e-a7ff-9bd1103b0458`）

**结论**：`VERDICT: APPROVED`（3 条非阻塞建议）

| # | 外审建议 | 处置 |
|---|---|---|
| C5 | 健壮性：`obj.editBg` 等字段未做字符串校验，被污染为 truthy 非字符串时 `.trim()` 抛异常，连带整个 `loadThemePrefs` 失败 | **采纳** → 新增 `readColorField(value, fallback)` 收口（非字符串 / 空白串一律回退默认值），4 个背景字段全部走它；新增健壮性用例 |
| C6 | 确认 `preUnifyBg` 的恢复路径是「写回存储后重新走 `loadThemePrefs`」 | **记录，无动作** → 应用当前**没有**恢复入口，`preUnifyBg` 纯粹是给人工 / 回滚用的备份；即使写回存储，重载时 `loadThemePrefs` 会再次归一，行为安全 |
| C7 | `LEGACY_DARK_CAPTURE` 仅左侧 `toLowerCase`，需确认常量本身是全小写 | **驳回（已核实）** → `const NIGHT_BG_DEFAULT = '#12100d'` / `const LEGACY_DARK_CAPTURE = NIGHT_BG_DEFAULT`，常量定义即全小写，条件正常命中 |

> 备注：代码轮第 1 次调用时上游连续两次返回**空正文**（`reasoning_content` 耗尽预算），按协议「先调 prompt 重试」阶梯把载荷压到 ~700 字节后成功。

## 九、验收结果

**门禁**（全部通过）

- `npx tsc --noEmit` → 无错
- `npx vitest run` → **81 文件 / 994 用例全绿**（新增 `src/styles/themeBgUnify.test.ts` 25 例；删除 `src/styles/themeBgSegment.test.ts` 24 例；`themeBackgroundTokens.test.ts` +3 例）
- `npx vite build` → 通过

**浏览器实测**（dev server `http://127.0.0.1:5173/?v=12`，暗色模式）

| 验证项 | 结果 |
|---|---|
| 面板结构 | 无分段 radio、无 `data-bg-target` / `data-target` / `data-for` 残留；单色板 + 单输入框 + 单应用按钮 + 单羊皮开关 |
| 面板文案 | 标题「背景」+ 说明「界面、源码编辑区与阅读纸面共用同一背景色」 |
| 点色板 | `--bg` 与 `--preview-bg` **同时**变为 `#1a1410`（容器内联变量实测） |
| 自定义色输入框 | 自动显示当前生效色（`#12100D` → `#1A1410`） |
| 羊皮风格 | 勾选后容器同时挂 `parchment-edit` + `parchment-read`；取消后两者同时移除 |
| 网格背景 | 开关未被禁用 |
| 点色板不误关面板 | ✅ 面板保持打开（上一轮 D3 回归） |
| 源码模式 | 整窗（库树 / 标签栏 / 编辑区 / 行号栏）统一为 `#1a1410` |
| 阅读模式 | 纸面与周围留白同色 —— 即分析中预判的观感变化 |
| 环境复原 | 配色回 `#12100d`，模式回「所见」，羊皮关闭 |

**未提交**：本任务未执行 `git commit` / `git push`（用户未在本轮下达明确提交指令）。

