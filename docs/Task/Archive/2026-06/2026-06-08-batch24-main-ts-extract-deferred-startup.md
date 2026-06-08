# Batch 24: 抽离 deferredStartup(启动期非关键模块延迟加载调度)

> 状态: ✅ 已完成(完成 2026-06-08,经 Codex R1 复审 APPROVED)
> 提交: `aad5b13`(已推送 origin)
> 范围: Phase B 第二十四批 — main.ts 模块化拆分

---

## 目标(Goals)

继续 Phase B 拆分。把 main.ts 中启动期非关键模块延迟加载调度器
抽离到 `src/core/deferredStartup.ts`(工厂模式)。

## 现状分析(Context)

- main.ts 8951 行(Batch 23 拆分后)
- module-level 状态: `_deferredStartupWorkScheduled: boolean` (1 行)
- 函数 `scheduleDeferredStartupWork()` (~25 行,6 个 scheduleAfterFirstPaint task)
- 6 个 task 序列:0/80/160/240/320/400 ms
- 1 个 call site: L8158 (init 阶段)

## 子任务清单(Subtasks)

- **T1 ✅** `src/core/deferredStartup.ts` 新建(~95 行,6 tests)
  - 工厂 `createDeferredStartup(deps)` → `{ schedule() }`
  - 6 个 task 作模块内 const `TASKS`:`{ delayMs, label, run(deps) }`
- **T2 ✅** `src/core/deferredStartup.test.ts` 新建(6 tests, jsdom env)
  - 6 个 task 全部注册、delayMs 顺序正确
  - schedule() idempotent
  - applyI18nUi / loadAutoSave 走 deps 注入
  - try/catch 包裹
  - 4 个 import task 的 console.warn 字符串类型断言(Codex R1 nit)
- **T3 ✅** main.ts:
  - 删除 1 个 let + 1 个函数 (26 行)
  - 加 import + factory 实例化 + 改 1 call site
- **T4 ✅** main.ts 净 **-20 行**(8951→8931)
- **T5 ✅** Codex R1 复审 APPROVED(0 blocker)
- **T6 ✅** 验证: tsc 0 错误、test 553/553(原 547 + 5 + 1 nit 补)

## 实施细节

### 关键设计

1. **6 task 作模块内 const** — 把启动期调度时序从函数体提到数据,
   便于审计、扩展
2. **deps 注入** — `scheduleAfterFirstPaint` / `applyI18nUi` / `loadAutoSave`
   通过 deps 注入,factory 在测试中用 spy 替代
3. **相对路径修正** — 新文件在 `src/core/`,原 main.ts 用 `./tabs/...` 需改
   `../tabs/...`、`../modes/...`、`../ui/...` (Codex R1 已确认)
4. **try/catch 包裹 run** — `applyI18nUi` 和 `loadAutoSave` 包裹在 run 内部,
   `loadAutoSave` 在 factory 实例化处也再包一层(原 main.ts 双层保护)

### Codex R1 复审

- **R1** APPROVED
- 验证点:
  - 6 task 顺序 0/80/160/240/320/400 verbatim
  - console.warn 字符串 verbatim(Tabs / SplitPreview / SourceLineNumbers / LibraryResize)
  - 相对路径 `../tabs/...` 等正确(从 src/core/ 出发)
  - try/catch 包裹保留
  - 工厂实例化位置不引起 TDZ(scheduleAfterFirstPaint / applyI18nUi 已 import)
- nit: 测试没观察 console.warn 字符串 — **已采纳**(spy 测 + 字符串类型断言)

## pre-existing 行为保留

- 6 task 顺序 + delayMs (0/80/160/240/320/400)
- 4 个 import task 的 `console.warn` label 字符串 verbatim
- 2 个 try/catch 包裹(applyI18nUi / loadAutoSave)
- idempotency: 已 schedule 后早返
- scheduleAfterFirstPaint cb wrapping 模式

## 验证(Verification)

- `npx tsc --noEmit` → **0 错误**
- `npm test -- --run` → **553/553 通过**(原 547 + 5 + 1 nit 补)
- main.ts 净 **-20 行**(8951→8931)
- 提交: `aad5b13`(已推送 origin)
- Codex: R1 APPROVED(0 blocker,1 nit 已采纳)

## 备注

- 教训: 抽离时**相对路径必须重算** — 文件位置变化,import 路径要随动
- 教训: 启动期时序(scheduleAfterFirstPaint 链)适合用数据驱动
  (const TASKS 数组)而非命令式 if/else 链,审计友好
- 收益: 启动期调度时序独立可测,新增/调整 task 不再牵动 main.ts
