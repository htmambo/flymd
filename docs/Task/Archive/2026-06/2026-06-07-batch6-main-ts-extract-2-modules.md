# Batch 6:main.ts 拆分(第五批)

**状态**: ✅ 已完成 (完成时间: 2026-06-07)
**提交**: `b737d88` (已推送 origin)

## 背景

Batch 5 完成时 main.ts 仍 11268 行。Batch 6 调研挑出 2 个 shippable 候选
(文档位置持久化 / 预览元数据条),两个都需要参数化:
- docPosition 需把 7 个 main-local 闭包状态(editor/preview/store/mode 等)→ deps getter factory
- previewMeta 需把 currentFilePath + 1 个全局 boolean → opts 对象 + 模块级状态

## 任务清单

- **T1 ✅** `src/core/docPosition.ts` 新建(110 行,factory + DocPos/DocPosMode type)+ 10 tests
- **T2 ✅** `src/ui/previewMeta.ts` 新建(170 行,3 exports + InjectPreviewMetaOpts)+ 10 tests jsdom
- **T3 ✅** main.ts 删除对应原定义(89 + 159 行)
- **T4 ✅** main.ts 插入 `createDocPositionStore({...})` factory 实例(13 行包装)
- **T5 ✅** main.ts 插入 `flymdFetchPageTitle` 全局暴露回原位(因 wysiwyg/v2:800 仍引用)
- **T6 ✅** 1 处 call site(3558 注入处)改 opts 传参:`{ metadataLabels, currentFilePath }`
- **T7 ✅** 清理 3 个未用 import(`resolveMetadataLabel` / `set/isPreviewMetaVisible` 已被新模块内化)
- **T8 ✅** Codex R2 复审 2 轮联合通过
- **T9 ✅** `npx tsc --noEmit` 0 错误
- **T10 ✅** `npm test` 328/328 通过(原 308 + 新增 20)
- **T11 ✅** commit + push

## 关键决策

### 决策 1:docPosition 用 **factory 模式** 而非闭包函数
- **选项 A**: 顶层 `let` + 普通函数,绑定 main.ts 闭包
- **选项 B**: `createDocPositionStore(deps)` factory 返回方法对象(本次采用)

**Why 选 B**:
- 状态量(计时器/缓存/加载 promise)可随实例封闭,测试可建独立实例
- deps 用 getter(`getStore: () => store`)而非快照值,主程序初始化时序灵活
  (factory 构造时 store 还未就绪也不影响,首次调用才取)
- 单元测试可注入 mock store,验证 getMap 缓存/防重入逻辑

**How to apply**: 状态量 ≥ 2 个 + 多方法,优先 factory;若 ≤ 1 个状态,可考虑单例。

### 决策 2:previewMeta 状态走**模块级闭包** 而非 factory
- 2 个状态(previewMetaVisible + localStorage)极轻
- 全局 UI 开关语义,跨调用共享同一份可见性
- factory 反而引入模板代码

**Why 不选 factory**:
- 同一份实例需要被所有调用点共享,factory 模式要导出实例 + getter
- `setPreviewMetaVisible` 是 toggle 操作,需要持久访问同一状态

**How to apply**: 全局 UI 开关类(visible/collapsed/expanded)走模块级 state + setter/getter。

### 决策 3:previewMeta 用 **opts 对象** 而非多个 getter
- **选项 A**: `injectPreviewMeta(container, meta, currentFilePath, metadataLabels)`
- **选项 B**: `injectPreviewMeta(container, meta, { currentFilePath, metadataLabels })`(本次采用)

**Why 选 B**:
- 2 个可选参数,位置参数易混淆顺序
- 后续若新增字段(如 `theme`)不影响 call site
- 与 Batch 5 contextMenuContext 的 deps 模式一致

**How to apply**: ≥ 2 个可选参数,优先 opts 对象。

## Codex 复审发现与修复

### 第一轮 (R2 REJECTED)

**Critical 问题**:`window.flymdFetchPageTitle` 全局暴露被误删。
- 原因:删 previewMeta 块时,块内紧跟的 1 行 `try { (window as any).flymdFetchPageTitle = fetchPageTitle } catch {}` 一并删除
- 影响:`src/wysiwyg/v2/index.ts:800` 仍引用 `window.flymdFetchPageTitle`,WYSIWYG 粘贴 URL 抓标题会回退
- 修复:把全局暴露回填到 `fetchPageTitle` 函数定义后(原块 1894-2049 中,行号已重定位到 5861)

**Important 问题**:3 个未用 import (`resolveMetadataLabel` / `setPreviewMetaVisible` / `isPreviewMetaVisible`)。
- 修复:清空 import 行,只保留实际使用的 `MetadataLabelMap` type + `injectPreviewMeta`

### 第二轮 (R2 APPROVED)

VERIFIED 全部修复 + 0 新问题。

## 验证(Codex R2 实测)

| 项目 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ 0 errors |
| `npm test` | ✅ 328/328(308+10+10) |
| docPosition 状态封装 | ✅ Codex 确认 factory 模式 + 依赖 getter + instance-local 缓存 |
| previewMeta 参数化 | ✅ Codex 确认 opts 模式 + 无 main.ts 闭包 |
| `flymdFetchPageTitle` 暴露 | ✅ Codex 第 2 轮确认已回填(2 轮往返) |
| 未用 import 清理 | ✅ Codex 第 2 轮确认已清理 |
| @ts-ignore 数量 | 10(未变) |
| main.ts 净行数 | -227(11279→11052) |
| 新增文件 | 4(src/core/docPosition.ts + .test.ts, src/ui/previewMeta.ts + .test.ts) |

## 关联

- Batch 1 (`d49c182/3cc28b8/139208f`)
- Batch 2 (`4d8bdc1`)
- Phase F 第三步 (`08b144c`)
- Batch 3 (`75ef51a` + `bbbddb9`)
- Batch 4 (`e4309f8` + `23829cf`)
- Batch 5 (`6e8c495` + `1b85b81`)
- **Batch 6 (`b737d88`): 本批**

## Codex 复审记录

**R1 调研**: 给出 3 个候选(docPosition / previewMeta / openFileWatcherHost),
Claude 选前 2 个稳妥的(前 2 个参数化清晰),openFileWatcherHost 因
DOM 耦合度最高(11+ 闭包)暂缓。

**R2 提交前**: Code review workflow,2 轮往返:
- **R2 首轮 REJECTED**: 抓 1 critical(全局暴露丢失)+ 1 important(未用 import)
- **R2 复审 VERIFIED + APPROVED**: 全部修复,0 blocker/0 important/0 nit

## 模式沉淀

**何时用 factory vs 单例**:
| 场景 | 推荐 | 理由 |
|---|---|---|
| 多方法 + 多状态 + 需测试隔离 | factory | 每个测试可建独立实例 |
| 单一全局开关 | 模块级 state + setter | 共享同一份状态,无需多实例 |
| 工具函数无状态 | 普通 export | factory 反而冗余 |
