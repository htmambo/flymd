# Batch 4:main.ts 拆分(第三批)

**状态**: ✅ 已完成 (完成时间: 2026-06-07)
**提交**: `e4309f8` (已推送 origin)

## 背景

Batch 3 完成时 main.ts 仍 11506 行、191 个顶层函数。Batch 4 调研挑出 3 个 shippable
候选 cluster(任务列表 / 大纲标题缓存 / 最近文件),全部 shippable,无 main.ts 闭包依赖或
可通过参数化消除闭包。

## 任务清单

- **T1 ✅** `src/plugins/markdownItTaskList.ts` 新建(95 行,scanTaskList + applyMdTaskListPlugin)+ 16 tests
- **T2 ✅** `src/ui/outlineHeadsCache.ts` 新建(75 行,type + 4 函数)+ 15 tests(jsdom)
- **T3 ✅** `src/core/recentFiles.ts` 新建(38 行,RECENT_MAX + 2 函数)+ 10 tests
- **T4 ✅** main.ts 移除对应定义、改 import 引用
- **T5 ✅** 参数化 `getRecentFiles(store)` / `pushRecentFile(store, path, max?)`(替代闭包全局 store)
- **T6 ✅** 8 处 call site(7 pushRecent + 1 getRecent in renderRecentPanel)补传 store
- **T7 ✅** Codex R2 复审 APPROVED
- **T8 ✅** `npx tsc --noEmit` 0 错误
- **T9 ✅** `npm test` 290/290 通过(原 249 + 新增 41)
- **T10 ✅** commit + push

## 关键决策

### 决策 1:outline cache 用**模块闭包**而非显式 cache state 注入
- **选项 A**: 函数接受 `OutlineHeadsCache | null` 引用,由 main.ts 持有
- **选项 B**: 模块顶层 `let _outlineHeadsCache: ...`,对外只暴露函数(本次采用)

**Why 选 B**:
- 原始 main.ts 闭包方式已存在,迁移到独立模块时不引入新耦合模式
- 大纲状态是"全局唯一"——同时只有一个 preview/wysiwyg 在用
- 5 个外部调用点(main.ts:1537/5352/5324/5370 + 模块自身)原本就是函数调用,改成显式 state 注入会让调用方样板代码变多
- 测试用 `clearOutlineHeadsCache()` 重置 cache,语义明确

**How to apply**: 对"全局唯一的状态 + 简单 CRUD 接口"组合,模块闭包即可,不必强行搞 DI。

### 决策 2:scanTaskList 放 `plugins/` 而非 `utils/`
**Why**:
- `applyMdTaskListPlugin` 是 markdown-it 插件,语义上属于"插件扩展"——和 `wysiwyg/v2/plugins/` 同级
- `scanTaskList` 跟它形影不离(主给任务列表点击穿透用),放一起减少跳转
- `src/plugins/` 目录此前无文件,但作为"插件扩展"语义目录自然存在
**How to apply**: 后续若有 markdown-it 插件或 markdown 解析器扩展,优先放 `src/plugins/`。

### 决策 3:recent files 用**参数化 store** 而非 setter 注入
**Why**:
- `getRecentFiles(store)` / `pushRecentFile(store, path)` 显式传 store,可测性最高
- 8 处 call site 改写是机械的(`pushRecent(x)` → `pushRecent(store, x)`)
- 允许 `store = null` 静默降级,适配初始化期和重置期

**How to apply**: 抽离涉及"全局 store/cache/registry"时,先看能否用 first-param 参数化——比 setter 模式调用方样板更少。

## 验证(Codex R2 实测)

| 项目 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ 0 errors |
| `npm test` | ✅ 290/290(249+16+15+10) |
| scanTaskList 实现等价 | ✅ Codex 确认 `s.indexOf('[', start) + 1` 与原版一致 |
| applyMdTaskListPlugin 注入 | ✅ main.ts:1341 import,3437 安装 |
| `_outlineHeadsCache` 封闭 | ✅ 仅模块内可见,main.ts 通过 3 个 helper 调用 |
| 8 处 store 参数化 | ✅ 7 pushRecent + 1 getRecent 全补传 |
| `RECENT_MAX` 清理 | ✅ main.ts 不再引用 |
| plugin runtime 暴露 | ✅ 原未暴露,新模块也不暴露(无 API 表面变更) |
| @ts-ignore 数量 | 10(未变) |
| main.ts 净行数 | -147(11506→11359) |

## 关联

- Batch 1 (`d49c182/3cc28b8/139208f`)
- Batch 2 (`4d8bdc1`)
- Phase F 第三步 (`08b144c`)
- Batch 3 (`75ef51a` + `bbbddb9`)
- **Batch 4 (`e4309f8`): 本批**

## Codex 复审记录

**R1 调研**: 给出 3 个候选 + defer 列表,Claude 全采纳。

**R2 提交前**: Code review workflow,验证 7 项:
- scanTaskList 实现等价
- applyMdTaskListPlugin md.core.ruler 注册
- _outlineHeadsCache 封装(无 main.ts 直接访问)
- 8 处 store 参数化无遗漏
- RECENT_MAX 清理完整
- plugin runtime API 表面不变
- 整体安全提交

R2 结论:**APPROVED** (0 blocker / 0 important / 0 nit)
