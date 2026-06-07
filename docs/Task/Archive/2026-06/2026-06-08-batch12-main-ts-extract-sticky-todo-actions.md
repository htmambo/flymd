# Batch 12:抽离 stickyTodoActions 工厂(便签模式待办交互)

> 状态:✅ 已完成(完成 2026-06-08,经 Codex 4 轮复审最终 R4 APPROVED)
> 提交:`7bf6e28`(已推送 origin)
> 范围:Phase B 第十一批 — main.ts 模块化拆分

---

## 目标(Goals)

继续 Phase B 拆分,把 main.ts 中"便签模式待办"3 个交互函数
抽离到独立模块,工厂 + 必填 deps(getter/setter 注入),
绕开 Vite ESM `require()` 限制,实现独立可测。

## 现状分析(Context)

- main.ts ~9945 行(Batch 11 拆分后),本批 3 个函数位于 6175-6346
- 候选 3 个函数共享 main-local 闭包:
  - `addStickyTodoButtons()`(171 行):DOM 改造,加 推送/提醒 按钮 + 时间图标 + tooltip
  - `handleStickyTodoPush(todoText, index)`(21 行):xxtui 插件推送
  - `handleStickyTodoReminder(todoText, index, btn?)`(38 行):xxtui 插件创建提醒 + 持久化
- 共享状态:`preview / currentFilePath / stickyNoteReminders / stickyNoteOpacity / stickyNoteColor / pluginHost / pluginNotice / alert`
- 共享类型:`StickyNoteColor / StickyNoteReminderMap`(已存在于 `./stickyNote`)

## 子任务清单(Subtasks)

- **T1 ✅** `src/modes/stickyTodoActions.ts` 新建(200 行,18 tests → 19 tests)
  - `createStickyTodoActions(deps)` 工厂
  - `addStickyTodoButtons / handleStickyTodoPush / handleStickyTodoReminder` 3 函数
  - `StickyNoteColor / StickyNoteReminderMap` 从 `./stickyNote` 复用
- **T2 ✅** `src/modes/stickyTodoActions.test.ts` 新建(19 tests,全 `toHaveBeenCalledWith` 全等断言)
  - addStickyTodoButtons:9 tests(DOM 改造、时间解析、提醒状态、幂等、tooltip)
  - handleStickyTodoPush:5 tests(含 throw 路径 catch 全角标点回归保护)
  - handleStickyTodoReminder:5 tests(成功持久化、无 @提示、坏格式、缺文件 key)
- **T3 ✅** main.ts 接线:6228-6240 工厂实例化 + 3149 调用站点替换
- **T4 ✅** main.ts 净 -161 行(添加 16,删除 177)
- **T5 ✅** Codex 4 轮:R1 候选选择 / R2 REJECTED / R3 REJECTED / R4 APPROVED
- **T6 ✅** 验证:tsc 0 错误、test 446/446(原 427 + 新增 19)

## 实施细节

### 关键设计

1. **工厂 + 必填 deps**(9 项)— 全部必填,无默认值:
   - 6 个 getter(`getPreview / getCurrentFilePath / getReminders / getOpacity / getColor / getPluginAPI`)
   - 1 个 setter(`setReminders`)
   - 2 个 action(`savePrefs / pluginNotice / alert`)
2. **类型从 `./stickyNote` 复用** — `StickyNoteColor` 收紧 `getColor / savePrefs` 签名,
   `StickyNoteReminderMap` 复用为 setter 参数类型。R2/R3 都确认不再模块内重定义。
3. **`pluginNotice` 签名收紧** — `level?: 'ok' | 'err'`,移除 main.ts 之前对
   `pluginNotice` 的 `'ok' | 'err' | 'warn' | 'info'` widening cast。
4. **assertion 全等收紧** — 所有 alert 调用从 `expect.stringContaining` 改为
   `expect(alert).toHaveBeenCalledWith('<exact string>')`,顶住中文标点漂移。
5. **catch 路径测试** — 新增 throw 路径回归保护测试,验证 catch 分支也用全角「：」。

### Codex 4 轮复审

- **R1** 候选选择:从 5 个候选中选 A(stickyTodoActions),为便签模式核心交互,3 函数共享 9 个 main-local 闭包,典型工厂注入场景
- **R2** REJECTED — 1 IMPORTANT(alert 改 ASCII 标点)、3 nit(StickyNoteReminderMap 重定义、getColor 宽 any、pluginNotice 拓宽)
- **R3** REJECTED — 1 IMPORTANT(push catch 路径 line 154 仍 ASCII 标点)+ 1 nit(main.ts:6173-6179 4 条残留旧注释)
- **R4** APPROVED — 0 blocker / 0 important / 0 nit,tsc 0 错误本地复跑通过

## pre-existing 行为保留

- **`textWithoutTime.trim()` 不折叠内部空白** — `'meeting @2025-12-01 14:30 details'` 经
  `textWithoutTime.trim()` 后变 `'meeting  details'`(双空格)。测试 `textWithoutTime === 'meeting  details'` 显式锁定此行为。
- **DOM 重建顺序** — `Array.from(item.childNodes)` 移除非 checkbox 子节点,然后 append
  `task-content` span + 可选 `task-time-icon` + `sticky-todo-actions` + `task-tooltip`。
  顺序与原 main.ts 完全一致。
- **幂等去重** — `if (item.querySelector('.sticky-todo-actions')) return`,重复调用 addStickyTodoButtons 安全。
- **持久化顺序** — 提醒成功后:更新 button UI → setReminders(next) → savePrefs({opacity, color, reminders}),
  与 main.ts 原顺序一致,确保 UI 立即反馈、状态立即落盘。
- **无 currentFilePath 时跳过持久化** — `if (fileKey)` 保护,避免给空字符串 '' 写入 reminders[''] 污染。
- **`saveStickyNotePrefs`(wrapped 版)替代 `saveStickyNotePrefsCore`** — wrapped 版才匹配
  `(prefs) => Promise<void>` 单参签名。
- **pluginNotice fallback 行为** — `pluginNotice('推送成功', 'ok', 2000)` 用 'ok' 而非 'info',
  与原 main.ts 行为一致。

## 验证(Verification)

- `npx tsc --noEmit` → **0 错误**
- `npm test -- --run` → **446/446 通过**(原 427 + 新增 19)
- main.ts 净 **-161 行**(添加 16,删除 177)
- 提交:`7bf6e28`(已推送 origin)
- Codex:R1 候选 / R2 REJECTED / R3 REJECTED / R4 APPROVED

## 备注

- 教训:R2 nit `pluginNotice` widening cast 容易被忽视 — main.ts 用 `as (...)` 把签名拓宽
  给工厂,看似解决 tsc 错误但类型不安全。R2 抓到后我们回填了正确的窄签名 + 移除 cast,
  更彻底。
- 教训:R3 抓的 catch 路径 ASCII 标点说明 R2 的 manual 复审不完整,只看了 4 处未看全部 5 处。
  R3 改时把 catch 路径加了测试覆盖,确保不会再次漂移。
- 教训:`expect.stringContaining` 是不够的断言 — R2 抓到的标点漂移恰好是该断言允许通过的子串。
  改成 `toHaveBeenCalledWith` 全等匹配后,任何字符差异都会 fail,中文 UI 字符串的回归保护更稳。
- 收益:便签模式 3 个交互函数独立可测,后续要在 push/reminder 流程加新功能(比如批量推送、
  提醒列表、@时间格式校验)只需改本模块,不动 main.ts。
- 收益:依赖注入 contract 显式化,新增字段(比如 stickyNote 主题色)只需扩 deps 即可,
  不必扫描 main.ts 全文件找闭包引用。
