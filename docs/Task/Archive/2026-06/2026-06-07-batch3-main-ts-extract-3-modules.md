# Batch 3:main.ts 拆分(第二批)

**状态**: ✅ 已完成 (完成时间: 2026-06-07)
**提交**: `75ef51a` (已推送 origin)

## 背景

Phase F 第三步完成后,main.ts 仍有 11692 行、191 个顶层函数。Batch 1/2 已抽离
scheduling/libraryPrefs/isInputPendingCompat 等小工具。Batch 3 调研目标:挑出真正
shippable 的下一批——纯函数或可解耦工具。

## 任务清单

- **T1 ✅** `src/utils/visualColumn.ts` 新建(35 行,3 纯函数)+ 12 tests
- **T2 ✅** `src/core/frontMatter.ts` 新建(80 行,2 工具)+ 17 tests
- **T3 ✅** `src/utils/previewPath.ts` 新建(132 行,5 工具 + 1 常量)+ 32 tests
- **T4 ✅** main.ts 移除对应定义、改 import 引用
- **T5 ✅** `normalizePreviewFsPath` / `resolvePreviewLocalDocPath` 参数化(显式 second arg `currentFilePath` 替代闭包全局)
- **T6 ✅** 2 处 call site 补传 `currentFilePath` 语义保持
- **T7 ✅** Codex R2 复审 APPROVED
- **T8 ✅** `npx tsc --noEmit` 0 错误
- **T9 ✅** `npm test` 249/249 通过(原 188 + 新增 61)
- **T10 ✅** commit + push

## 关键决策

### 决策 1:visualColumn 放 `utils/`
**Why**: 3 个纯函数(advanceVisualColumn/calcVisualColumn/offsetForVisualColumn),无 main.ts 闭包依赖、无 DOM、无 IO。是教科书级 pure utility。
**How to apply**: 后续若有"光标/列号/行列换算"逻辑,优先放进这里而非新建散文件。

### 决策 2:frontMatter 放 `core/` 而非 `utils/`
**Why**:
- `splitYamlFrontMatter` 通过 `window.flymdRuntime.splitYamlFrontMatter` 暴露给插件运行时——这是"核心文档行为"语义
- 已存在的 `core/diffMerge.test.ts` 表明 core/ 接受单元测试
- core/ 模块依赖 yaml 解析(js-yaml)——util 风格更纯,放 core 更准
**How to apply**: 文档级/Markdown 解析级行为放 `core/`,轻量字符串/数字/时间工具放 `utils/`。

### 决策 3:previewPath 用**参数化**而非**注入依赖**两种风格
- **选项 A**: 模块顶层 `let currentFilePath: string | null = null` + setter(导入方可写)
- **选项 B**: 函数参数显式传入(本次采用)

**Why 选 B**:
- 函数纯度最高——同一函数在不同上下文给不同 `currentFilePath` 是合理诉求(如批量预览)
- 无隐藏全局状态污染
- 单元测试时不需要 setup/teardown
- 2 处 call site 的修改是机械的(`resolvePreviewLocalDocPath(href)` → `resolvePreviewLocalDocPath(href, currentFilePath)`)
- Codex R2 验证语义等价

**How to apply**: 抽离函数时,先看是否能消除闭包依赖(变参数)——比 setter 风格更好测、更好复用。

## 验证(Codex R2 实测)

| 项目 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ 0 errors |
| `npm test` | ✅ 249/249(188+12+17+32) |
| `currentFilePath` 参数化语义 | ✅ Codex 确认等价 |
| plugin runtime `splitYamlFrontMatter` | ✅ main.ts:11099 仍 re-export |
| 旧定义清理 | ✅ main.ts 中无残留 |
| 2 处 call site 更新 | ✅ 1599/3737 补传 currentFilePath |
| @ts-ignore 数量 | 10(未变) |
| main.ts 净行数 | -186(11692→11506) |

## 关联

- Batch 1 (`d49c182/3cc28b8/139208f`): scheduling/libraryPrefs/isInputPendingCompat 等
- Batch 2 (`4d8bdc1`): 修订策略后,搬真无状态工具
- Phase F 第三步 (`08b144c`): 死代码删除 + @ts-ignore 21→10
- **Batch 3 (`75ef51a`): 本批**

## Codex 复审记录

**R1 调研**: 给出 3 个候选 cluster(visualColumn/frontMatter/previewPath),明确每条的耦合程度、行数、ship 建议。Claude 全采纳。

**R2 提交前**: Code review workflow,验证:
- 6 项(参数化语义/测试期望值/插件 API/import 摆放/无残留引用/安全提交)
- R2 结论:**APPROVED** (0 blocker / 0 important / 0 nit)

R2 唯一观察(非阻断):import 摆放位置在 1333 而非 720 顶端。Codex 验证这与 main.ts 现有"append-style 集群"模式一致(720/1332 附近均有同类 import),不视为违规。
