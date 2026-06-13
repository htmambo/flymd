# 任务:所见模式复杂块(KaTeX / Mermaid)编辑稳定性改造

**状态**: 🔄 进行中 (开始时间: 2026-06-13)
**创建日期**: 2026-06-13
**责任人**: Claude + 用户
**范围**: `src/wysiwyg/v2/` 下的复杂块编辑通路(数学公式、流程图)
**前置依赖**:
- 当前分支 `perf/bundle-runtime-optimizations` 已包含 `6842e88` 的阅读模式 math/mermaid 修复
- README 索引: `docs/Task/README.md` 中 `2026-06-13-math-and-mermaid-render-fix.md`
- 实际工作分支: `fix/wysiwyg-complex-block-edit` (从 `perf/bundle-runtime-optimizations` 拉出)

---

## 1. 目标(Goals)

让所见(WYSIWYG)模式下,用户对复杂渲染块(KaTeX 行内/块级公式、Mermaid 图表、HTML 表格、Callout 等)的编辑体验达到"行业常见编辑器水平":

1. **位置永不错位**:浮层打开期间,文档结构变化不应导致编辑范围错位
2. **焦点不丢**:任何情况下,关闭浮层后 prosemirror 光标必回到合理位置
3. **有回退路径**:Mermaid/HTML 表格等"纯渲染"节点必须支持"编辑源码"入口
4. **错误可观测**:PM transaction 异常不再被静默吞掉
5. **与阅读模式保持一致**:用户在两模式间切换不应丢失编辑意图

**可验证终止条件**:
- 单元/集成测试:数学节点编辑、mermaid 节点编辑、callout 编辑三类核心场景各 ≥ 3 用例通过
- 人工核查:用户双击公式编辑 → 修改 → 关闭浮层后,相邻段落内容不变,光标位置正确
- 回归:`git diff main` 中无新增 console error、TS 编译无新增报错

---

## 2. 现状分析(Context)

参考用户上一轮根因分析的结论(本任务文档不再重复),核心问题点:

| # | 文件 / 位置 | 问题 | 严重度 |
|---|---|---|---|
| 1 | `wysiwyg/v2/index.ts:1950-2042` `updateMilkdownMathFromDom` | 缓存 `from/to` 失效,文档变化后位置错位 | 🔴 P0 |
| 2 | `wysiwyg/v2/index.ts:2212-2410` `enterLatexSourceEdit` | overlay 用绝对定位 + 瞬时 `getBoundingClientRect`,不跟随滚动 | 🟠 P1 |
| 3 | `wysiwyg/v2/index.ts:2368-2378` | 文档级 `mousedown` 捕获,与 PM 事件链打架 | 🟠 P1 |
| 4 | `wysiwyg/v2/index.ts:2218, 2336-2341` | `$$...$$` 反序列化 regex 对含 `$` 源截断 | 🟠 P1 |
| 5 | `wysiwyg/v2/plugins/mermaid.ts:2411+` | 渲染后无"编辑源码"回退入口 | 🔴 P0 |
| 6 | `wysiwyg/v2/index.ts:1959-1960` | `_suppressMathReparse` 500ms 硬定时,reparse 抢焦点 | 🟡 P2 |
| 7 | `wysiwyg/v2/plugins/math.ts:96-140` | 行内公式 NodeView 吞光标,`Home` 不回到公式外 | 🟠 P1 |
| 8 | `wysiwyg/v2/index.ts:2409`, `mermaid.ts:354` | 错误被 `try{}catch{}` 或 `console.error` 静默 | 🟡 P2 |

---

## 3. 方案对比(决策项)

下面把用户列出的两个方向具化成可执行方案。

### 方案 A:PM 节点属性驱动(NodeView 内嵌 editable,重写 overlay)

**核心思想**:把"textarea 浮层"换成 prosemirror NodeView 内部的 contenteditable 区域,让所有写入经 PM transaction 走。

#### A.1 关键差异点(对比方案 B)

| 维度 | 方案 A | 方案 B |
|---|---|---|
| 编辑通路 | NodeView 内 contenteditable + PM transaction | 保留 textarea overlay,冻结 editor |
| 数学节点 | `math_inline` NodeView 拆为 `display:inline-block` + 内部 `<span contenteditable="true">` 源码区 | 浮层期间 `editor.setOptions({editable:false})` |
| Mermaid | NodeView 双区:左 SVG(只读),右 `<pre contenteditable="true">` 源码 | overlay 改为浮在公式下方,只让 textarea 可输入 |
| 块级↔行内切换 | schema 节点互转:右键菜单"转换为行内/块级" | 浮层顶部"模式"下拉 |
| 错误处理 | PM transaction try/catch 抛到 overlay 顶部黄色错误条 | 浮层顶部错误条 + 写入失败时**不关闭** |
| 焦点回收 | PM 内部光标管理,自动 | apply 后 50ms `view.focus()`(当前实现) |
| 视图-源码一致性 | 同一 PM 节点,自动一致 | 需要浮层打开期间冻结 editor 才能保证 |

#### A.2 实施子任务

| ID | 任务 | 状态 |
|---|---|---|
| A.T1 | 在 `math_inline` / `math_block` NodeView 中拆分"渲染区 + 源码区"双层结构 | ⏳ |
| A.T2 | 移除 `enterLatexSourceEdit` textarea overlay,改为 NodeView 内部 contenteditable | ⏳ |
| A.T3 | 新增 mermaid 节点的双区 NodeView(SVG 只读 + 源码 `<pre contenteditable>`) | ⏳ |
| A.T4 | 修复 `_suppressMathReparse` 逻辑(改为在 PM transaction 中标记 source 节点,不再用 500ms 硬定时) | ⏳ |
| A.T5 | schema 扩展:`math_inline` ↔ `math_block` 互转命令(右键菜单) | ⏳ |
| A.T6 | 错误处理统一收口:PM transaction 异常 → 节点顶部黄色 error bar,不再静默 | ⏳ |
| A.T7 | callout / HTML 表格节点审查:确保复杂块都有"编辑入口",没有纯渲染节点 | ⏳ |
| A.T8 | 单元/集成测试:数学行内/块级、mermaid、callout 编辑场景 | ⏳ |
| A.T9 | 回归:阅读模式渲染管线无影响(主仓库 `main.ts` 部分不修改) | ⏳ |

#### A.3 风险与回滚

- **风险**:NodeView 内 contenteditable 与 PM selection 协同非常容易踩坑,尤其是行内公式中间光标的处理。
- **风险**:mermaid 双区 NodeView 的 `nodeView` 改写会牵动 `wysiwyg/v2/index.ts:2411 renderMermaidNow` 的整段 overlay 逻辑。
- **回滚**:`git revert` 整个 PR;由于 NodeView 是声明式,代码层面可一次性回退到 `6842e88` 之上。

---

### 方案 B:保留 overlay + editor 冻结锁(最小改造)

**核心思想**:不重写 NodeView,只在浮层打开期间冻结 editor,让所有 PM transaction 在浮层期间被拒,关闭后再放行。

#### B.1 关键差异点(对比方案 A)

| 维度 | 方案 A | 方案 B |
|---|---|---|
| 编辑通路 | NodeView 内 contenteditable | 保留 textarea overlay |
| 复杂度 | 高(需要重写 NodeView 内部) | 中(主要改事件链) |
| 兼容性 | 高(PM 事务自然一致) | 中(冻结期间用户无法编辑其他位置) |
| 改造范围 | `wysiwyg/v2/plugins/math.ts`、`mermaid.ts`、`index.ts` 三处 | 主要在 `index.ts:2212-2410` 浮层函数 |
| 用户体验 | 公式即所见,光标/输入全连贯 | 浮层打开时只能编辑公式,不能改其他位置 |

#### B.2 实施子任务

| ID | 任务 | 状态 |
|---|---|---|
| B.T1 | 新增"editor 冻结锁"工具:`acquireEditLock()` / `releaseEditLock()`,基于 `editable:false` + dispatch 拦截 | ⏳ |
| B.T2 | `enterLatexSourceEdit` 进入时 `acquireEditLock`,关闭时 `releaseEditLock` | ⏳ |
| B.T3 | overlay 位置随滚动/MutationObserver 实时更新(修复 #2) | ⏳ |
| B.T4 | 移除文档级 `mousedown` 捕获,改为 `focusout` 检测 + PM transaction 异常显式 try/catch(修复 #3、#8) | ⏳ |
| B.T5 | 反序列化 regex 改为基于 schema 的 tokenizer,不再用字符串 regex 截断(修复 #4) | ⏳ |
| B.T6 | `_suppressMathReparse` 改为基于"节点进入编辑态"标记,不再用 500ms 硬定时(修复 #6) | ⏳ |
| B.T7 | 新增 mermaid "编辑源码"入口:双击 SVG / 右键菜单 → 启动浮层(修复 #5) | ⏳ |
| B.T8 | 单元/集成测试:同 A.T8 | ⏳ |
| B.T9 | 回归:阅读模式渲染管线无影响 | ⏳ |

#### B.3 风险与回滚

- **风险**:冻结锁与外部自动保存/IME 补丁/快捷键的交互需要逐一排查,容易漏点。
- **风险**:用户从浮层切走(切 tab) 时,冻结锁未释放,整个 editor 卡死。
- **回滚**:`git revert` 整个 PR;由于改动集中在 `index.ts:2212-2410` 一段,回退成本低。

---

## 4. 实施差异总览

| 维度 | 方案 A(重写) | 方案 B(冻结) |
|---|---|---|
| **代码改动量** | 约 800-1200 行(`math.ts` / `mermaid.ts` / `index.ts`) | 约 300-500 行(主要集中在 `index.ts`) |
| **工期估算** | L(2-3 天) | M(1-1.5 天) |
| **可维护性** | 长期更优,NodeView 声明式 | 短期可用,overlay + 锁组合复杂度高 |
| **用户感知差异** | 行内公式可光标直接停留,所见即所得 | 公式仍需浮层,体验接近当前但更稳 |
| **测试覆盖** | 需新增 PM transaction 单元测试 + NodeView 集成测试 | 需新增 overlay 行为单元测试 |
| **回滚成本** | 中(改三个文件) | 低(改一个文件) |
| **契合"行业常见做法"** | 高(Typora / Notion 风格) | 中(传统浮层风格) |

---

## 5. 待用户确认的决策点

1. **方案选择**:A / B / 两者都做(先 B 修稳,再 A 改体验)
2. **mermaid 双区 NodeView**:方案 A 是否要做?方案 B 至少要做"编辑源码入口"
3. **范围**:本任务是否只做 math + mermaid?callout / HTML 表格是否同步纳入
4. **分支命名**:建议 `fix/wysiwyg-complex-block-edit`(基于当前 `perf/bundle-runtime-optimizations`)

---

## 6. 验收标准(Acceptance)

### 功能性

- [ ] 双击 KaTeX 公式进入编辑态,修改后关闭,相邻段落内容不变
- [ ] 双击 Mermaid 图表进入编辑态(方案 A:NodeView 双区;方案 B:浮层),可改源码并重新渲染
- [ ] 行内公式中按 `Home` 时光标回到公式外侧
- [ ] 浮层打开期间,文档其他位置不可编辑(方案 B) / 可编辑(方案 A)
- [ ] 块级 ↔ 行内公式互转(方案 A)

### 非功能性

- [ ] 单元测试 ≥ 9 用例全通过
- [ ] `npm run build` 通过,无新增 TS 报错
- [ ] 阅读模式渲染管线零回归(diff `main.ts` 中 `renderPreview` 段无变更)
- [ ] 现有 `markdownItKatexBlocks.test.ts` / `katexNormalize.test.ts` 全通过

### 可观测性

- [ ] PM transaction 异常显示在浮层 / NodeView 顶部错误条
- [ ] 不再有静默 `try{}catch{}` 吞掉错误

---

## 7. 备注

- 本任务文档归档目录预期:`docs/Task/Archive/2026-06/`
- 提交信息模板参考:`~/.claude/COMMIT_TEMPLATE.md`
- 任务执行前必须先创建分支(基于 `perf/bundle-runtime-optimizations`),并把任务文档状态更新为 🔄
