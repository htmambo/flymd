# 大文件 CM6 视图的行号跟随「源码行号」偏好

**状态**: ✅ Completed (completion time: 2026-10-31)
**创建时间**: 2026-10-31
**责任人**: MCode（minimax Code）
**范围**: `src/core/sourceLineNumbersPref.ts`（新增）、`src/modes/cm6Editor.ts`、`src/modes/cm6ModeHost.ts`、`src/modes/sourceLineNumbers.ts`、`src/theme.ts`、`src/i18n.ts`
**基线提交**: `3eb6b34`（分支 `fix/audit-round1-correctness`）
**前置任务**: `docs/Task/Archive/2026-10/2026-10-31-theme-background-unification.md`

---

## 1. 目标（Goals）

1. **「源码行号」开关在大文件 CM6 源码视图下真实生效**：关闭 → CM6 行号栏消失；开启 → 出现；运行时切换即时生效，不需要重启。
2. **偏好读写收敛为唯一事实源**：主题面板、textarea 行号列、CM6 行号栏三处消费方共用同一份读取/写入与同一枚变更事件，杜绝三份副本漂移。
3. **提示文案分支同步**：CM6 视图里行号栏就在眼前，不应再弹「切到源码模式即可看到」。

## 2. 现状分析（Context）

### 2.1 用户反馈

> 「还有一种模式没有修复：大文件的所见模式，默认使用的是源码，但是并不是真正的源码模式，这时的行号没有跟随真正的源码模式的设置：行号隐藏没生效。」

### 2.2 根因（代码事实）

大文件走 CM6 引擎时（`src/main.ts:1990 enableCm6Mode`）：

```ts
wysiwyg = true          // 对外仍是"所见模式"
wysiwygV2Active = false // 但不是 Milkdown 所见
mode = 'edit'
container.classList.add('wysiwyg-v2', 'wysiwyg-cm6')
```

于是**两套行号列都管不到它**：

| 行号列 | 归属 | 在 CM6 视图下的状态 |
|--------|------|---------------------|
| `.editor-gutter`（textarea） | `src/modes/sourceLineNumbers.ts` | 按设计不激活：`flush()` 里 `nextLineNumbersActive = _pref && mode === 'edit' && !wysiwyg && !stickyNote`，而此处 `wysiwyg === true` → 恒 false |
| `.cm-gutters`（CM6） | `src/modes/cm6Editor.ts:72` | **恒显**：`lineNumbers()` 无条件写进扩展列表，与偏好毫无关联 |

偏好变更事件 `flymd:sourceLineNumbers:changed`（`src/theme.ts` 派发）只有 textarea 行号模块订阅（`sourceLineNumbers.ts:893`），**CM6 完全没有订阅**。

→ 结论：大文件 CM6 视图下，「源码行号」开关**完全无效**（既关不掉，也开不了）。

### 2.3 与「源码行号」提示文案的交互

`src/theme.ts` 的提示分支按 `mode === 'edit' && !wysiwyg` 判定"是否处于源码模式"。CM6 视图恰好是 `mode === 'edit' && wysiwyg === true` → 会被判为"非源码模式" → 弹「切到源码模式即可看到」。但 CM6 视图里行号栏就在眼前（修好后随偏好显隐），这句提示是错的，必须一并调整。

### 2.4 行为矩阵（视图 × 偏好 → 行号显隐 / 提示去留）

| 视图 | 内部状态 | 偏好=开 | 偏好=关 | 切开关是否弹提示 |
|------|---------|--------|---------|--------------|
| textarea 源码模式 | `mode='edit'`, `wysiwyg=false` | `.editor-gutter` 显示 | `.editor-gutter` 隐藏 | **不弹**（效果即时可见） |
| 源码+阅读分屏 | `mode='edit'`, `wysiwyg=false` | 同上 | 同上 | **不弹** |
| Milkdown 所见模式 | `mode='edit'`, `wysiwyg=true`，非大文件 | 无行号列 | 无行号列 | **弹**（本视图确实没有行号列） |
| 阅读模式 | `mode='preview'` | 无行号列 | 无行号列 | **弹** |
| **大文件 CM6 视图** | `mode='edit'`, `wysiwyg=true`，容器带 `wysiwyg-cm6` | `.cm-gutters` 显示 | `.cm-gutters` 隐藏 | **不弹**（行号栏就在眼前） |

判定依据统一为「**当前视图里是否存在源码行号列**」：textarea 源码模式有 → 有列；CM6 视图有 → 有列；Milkdown 所见 / 阅读没有 → 无列，弹提示。

### 2.5 边界情况与取值规则

| 边界 | 规则 |
|------|------|
| 偏好 key 不存在 | 视为**开启**（与现状一致：`!== 'false'` 即开） |
| 偏好脏值（`'0'` / `'off'` / `''` 等） | 只有字符串 `'false'` 视为关闭，其余一律视为开启（**保持现有语义不变**，避免老用户行为漂移） |
| 引擎切换（CM6 ↔ Milkdown ↔ textarea 重建） | 每次新建 CM6 实例时按**当前偏好**初始化，不闪 gutter |
| 跨窗口修改偏好 | **不做实时同步**：`lsCache` 会在 `storage` 事件时失效缓存条目，下次读取即最新值，但已运行的 CM6 实例不会立即重排（窗口级偏好实时同步不在本次范围） |
| 布局影响 | gutter 显隐会引起正文水平位移；CM6 重配置只重建 gutter 扩展，不动文档、选择区与垂直滚动位置 |


## 3. 子任务清单（Subtasks）

- [x] T1 需求轮外审（session `d0fa5b9b-f519-4b79-a524-3ae0d4404912`，REQS_CHANGES → 已处置，见 §8）
- [x] T2 本任务文档 + 计划轮外审（session `82c03581-e5ba-46fb-9c92-39c87c51ccd0`，APPROVED → 6 条改进已处置）
- [x] T3 新增 `src/core/sourceLineNumbersPref.ts`：key / 读取 / 写入 / 变更事件常量（唯一事实源）
- [x] T4 `theme.ts` / `sourceLineNumbers.ts` 改用共享模块，删除本地副本
- [x] T5 `cm6Editor.ts`：`Compartment` 包裹 `lineNumbers()`，构造时按偏好装载，新增 `setLineNumbersEnabled()`
- [x] T6 `cm6ModeHost.ts`：初始化按偏好；订阅偏好变更事件；destroy 时解绑
- [x] T7 `theme.ts` 提示分支：按 §2.4 矩阵判定「当前视图是否有源码行号列」
- [x] T8 i18n tooltip 文案覆盖 CM6 视图
- [x] T9 测试：偏好模块单测 + CM6 链路单测 + textarea / Milkdown 路径回归用例
- [x] T10 门禁：typecheck / vitest / build + 浏览器实测（大文件 CM6 视图显隐切换）
- [x] T11 代码轮外审（session `7e947db0-4e72-4e0a-9b30-da82015b1617`，APPROVED）+ 归档 + README 索引

## 4. 验收标准（Acceptance）

1. `tsc --noEmit` 无错；`vitest` 全绿；`vite build` 通过（含入口静态闭包）。
2. 偏好关闭时创建 CM6 编辑器 → DOM 中**不存在** `.cm-gutters`；开启 → 存在；运行时 `setLineNumbersEnabled()` 切换 → 增删即时生效。
   - 已核实：全仓无 `foldGutter`，`cm6LivePreview.ts` 不注入任何 gutter 扩展 → `lineNumbers()` 是唯一 gutter 扩展，移除它即彻底移除 `.cm-gutters`。
3. CM6 宿主订阅 `flymd:sourceLineNumbers:changed`，`destroy()` 后不再响应（无残留监听）。
4. 偏好读写只有一处实现：`theme.ts` / `sourceLineNumbers.ts` / CM6 链路均从 `src/core/sourceLineNumbersPref.ts` 取。
5. 浏览器实测：大文件（CM6 视图）下关掉「源码行号」→ CM6 行号栏消失；打开 → 出现；均无需重启。
6. §2.4 矩阵逐格成立：CM6 视图与 textarea 源码模式切开关**不弹**提示；Milkdown 所见 / 阅读模式**仍弹**。
7. 偏好模块自身单测：默认开启、脏值仅 `'false'` 关闭、写入后派发变更事件。
8. textarea 行号列与 Milkdown 提示分支的回归用例（防止改接共享模块引入回归）。

## 5. 风险与回滚（Risks & Rollback）

| 风险 | 处置 |
|------|------|
| `Compartment.reconfigure` 重建行号栏导致 CM6 滚动位置跳动 | CM6 官方推荐用法；重配置只影响 gutter 扩展，不动文档与选择区；实测确认滚动位置保持 |
| 隐藏 CM6 行号栏后正文左边界回缩，观感变化 | 与 textarea 行号列隐藏的行为一致（本就是同一个开关）；CM6 gutter 占位由 CM6 自行处理，无残留间隙 |
| 事件订阅在宿主销毁后泄漏 | `destroy()` 中显式 `removeEventListener`；新增用例断言销毁后再派发事件不抛错、不改 DOM |
| 共享偏好模块引入新的模块边界 | 纯函数、无副作用（除派发事件），位于 `src/core/`，与 `lsCache` 同层，不新增运行时依赖 |

**回滚**：`git revert` 本次提交即可。偏好存储键名与事件名均未变更，回滚后行为与改动前完全一致。

## 6. 工时估算（Estimate）

S（0.5 人日，含测试与外审）

## 7. 备注（Remarks）

- CM6 的 `lineNumbers()` 扩展在 `Compartment` 里重配置是 CM6 官方推荐做法；不要用 CSS 隐藏 `.cm-gutters`——那样 CM6 仍会为 gutter 预留宽度，留下空白。
- 不新造「CM6 行号」独立开关：用户预期是「源码行号」这一个开关统管所有源码视图，包括大文件回退视图。

## 8. 外审处置记录

### 8.1 需求轮（session `d0fa5b9b-f519-4b79-a524-3ae0d4404912`，REQS_CHANGES）

| 外审意见 | 处置 |
|---------|------|
| ① 可行性缺口：若还有 `foldGutter` 等其它 gutter 扩展，只重配 `lineNumbers()` 移不掉 `.cm-gutters` | **核实后驳回**：全仓检索无 `foldGutter`；`cm6LivePreview.ts` 不注入任何 gutter 扩展 → `lineNumbers()` 是唯一 gutter 扩展，移除即彻底移除 `.cm-gutters`。核实结论已写入验收标准第 2 条 |
| ② 需求 3 范围含糊，未给条件矩阵 | **采纳**：补 §2.4 行为矩阵（5 视图 × 偏好开关 → 行号显隐 / 提示去留），提示判定统一为「当前视图是否存在源码行号列」 |
| ③ 回归覆盖缺口：改接共享模块属现网代码重构，但只覆盖 CM6 链路 | **采纳**：验收标准补第 7、8 条——偏好模块自身单测 + textarea 行号列与 Milkdown 提示分支回归用例 |
| ④ 边界未列：默认值、脏值解析、引擎切换、跨窗口 storage | **采纳**：补 §2.5 边界表（默认开启；仅 `'false'` 视为关闭，保持现有语义；每次新建 CM6 按当前偏好初始化；跨窗口**不做**实时同步并写明原因） |
| ⑤ 布局影响：gutter 显隐引起水平位移，滚动位置需人工验证 | **采纳**：写入 §2.5 与验收标准第 5 条，浏览器实测时确认垂直滚动位置不变 |
| ⑥ 未提回滚方案与工时预估 | **采纳**：文档 §5 已有回滚（`git revert`，键名与事件名均未变），§6 工时 S |

### 8.2 计划轮（session `82c03581-e5ba-46fb-9c92-39c87c51ccd0`，**APPROVED**）

放行，并提 6 条实施期改进项：

| 意见 | 处置 |
|------|------|
| ① 合并前必须逐行核对两处旧 getter 的语义等价（缺省值/大小写/空白容错） | **已核对**：`theme.ts` 与 `sourceLineNumbers.ts` 的旧实现逐字等价（`lsGetStringCached(key) !== 'false'`，异常回退 `true`），setter 仅 `theme.ts` 一处 → 可安全收敛 |
| ② 自动换行下的滚动偏移需覆盖"开启换行的大文件" | **不适用**：CM6 扩展清单里**没有** `lineWrapping()`，CM6 视图不自动换行；实测切换行号时垂直滚动位置与文档内容均不变 |
| ③ 跨窗口不同步可低成本补齐 | **本次不做**：`lsCache` 的 `storage` 事件只失效缓存、不派发自定义事件；补齐会造成"行号栏实时同步、主题面板开关不实时同步"的半同步状态，体验更差。已在 §2.5 写明边界 |
| ④ `CustomEvent` 的 `detail` 缺类型约束 | **采纳**：共享模块导出 `SourceLineNumbersChangedDetail`，调用点用 `CustomEvent<SourceLineNumbersChangedDetail>` |
| ⑤ 门禁未含 lint | **不适用**：仓库无 eslint 配置（`package.json` 无 lint 脚本、无 eslint 配置文件），门禁就是 typecheck / test / build |
| ⑥ `reconfigure([])` 建议用具名常量 | **采纳**：`NO_EXTENSIONS` / `LINE_NUMBERS_EXTENSION` 常量 |

### 8.3 代码轮（session `7e947db0-4e72-4e0a-9b30-da82015b1617`，**APPROVED**）

| 意见 | 处置 |
|------|------|
| ① **最高优先级**：CM6 容器类在其它模式可能残留 → 阅读模式不弹提示，违反规格 | **核实后驳回**：`wysiwyg-cm6` 由 `enableCm6Mode` 挂载、`destroyCm6Mode` 卸载，**同生共死**；实测从 CM6 视图切到阅读模式后容器 class 变为 `container md-github with-library with-library-left`——`wysiwyg-v2` / `wysiwyg-cm6` 均已移除，阅读模式照常弹提示 |
| ② `setLineNumbersEnabled` 的销毁时序：可能对已销毁的 view dispatch | **核实为已满足**：`Cm6Editor.destroy()` 先置 `destroyed = true` 再 `view.destroy()`；`Cm6ModeHost.destroy()` 先置 `destroyed = true`、再解绑监听、最后销毁引擎 |
| ③ 监听注册早于引擎构造完成 | **核实为已满足**：宿主构造函数里先 `new Cm6Editor(...)`，再注册 `compositionend` 与偏好监听 |
| ④ 类名字符串耦合，重命名会静默失效 | **采纳**：抽出共享常量 `CM6_VIEW_CLASS`（`src/modes/editorEngine.ts`），`main.ts` 挂载/卸载与 `theme.ts` 读取统一引用；单测锁定字面量只出现在常量定义处 |
| ⑤ 每次切换都新建 `lineNumbers()` 扩展实例，触发全量 facet 重算 | **采纳**：扩展实例缓存为模块级常量，并按当前状态短路（值未变则不 dispatch） |
| ⑥ 偏好写入失败仍派发事件、无 detail 派发时回读可能读到陈旧值 | **部分采纳**：写入失败仍派发是**正确**行为（用户意图即目标状态）；无 detail 派发属外部调用，回退到读取存储值并已在代码注释标注为兜底 |

## 9. 验收结果（Acceptance Result）

| # | 验收项 | 结果 |
|---|--------|------|
| 1 | typecheck / vitest / build 全绿 | ✅ 见 §10 最终门禁 |
| 2 | 偏好关闭时 CM6 无 `.cm-gutters`；开启有；运行时切换即时增删 | ✅ 单测 + 浏览器实测 |
| 3 | CM6 宿主订阅偏好事件，destroy 后不再响应 | ✅ 单测（销毁后再派发事件不调用 `setLineNumbersEnabled`） |
| 4 | 偏好读写只有一处实现 | ✅ 单测断言四个消费方均从共享模块导入，且不再出现键名/事件名字面量 |
| 5 | 浏览器实测大文件视图显隐切换、无需重启 | ✅ 见 §10 实测记录 |
| 6 | §2.4 矩阵逐格成立 | ✅ CM6 视图与 textarea 源码模式不弹提示；Milkdown 所见 / 阅读模式仍弹 |
| 7 | 偏好模块单测（默认开启 / 脏值 / 派发事件） | ✅ `src/core/sourceLineNumbersPref.test.ts` 4 例 |
| 8 | textarea 行号列与 Milkdown 提示分支回归用例 | ✅ `src/modes/sourceLineNumbers.install.test.ts` 扩展 + `sourceLineNumbersPref.test.ts` |

### 9.1 浏览器实测记录（CM6 大文件视图）

实测方式：临时把 `resolveEditorEngine` 强制返回 `'cm6'`（不改产品逻辑，验完已还原），并临时把提示时长拉到 30s（便于观察"是否弹提示"），两者均已还原。

| 步骤 | 预期 | 实测 |
|------|------|------|
| 进入 CM6 视图 | 行号列可见（1–11） | ✅ 截图确认 |
| 关闭「源码行号」 | 行号列立即消失，正文左移，无 gutter 残留空白 | ✅ 截图确认 |
| 打开「源码行号」 | 行号列立即恢复（1–11），内容与滚动位置不变 | ✅ 截图确认 |
| CM6 视图内切开关 | **不弹**「切到源码模式」提示 | ✅ 30s 观察窗口下通知容器为空 |
| 切到阅读模式 | 容器类移除 `wysiwyg-v2` / `wysiwyg-cm6` | ✅ DOM 断言 |

## 10. 最终门禁

2026-10-31 归档前最后一次全量运行：

| 门禁 | 命令 | 结果 |
|------|------|------|
| 类型检查 | `npx tsc --noEmit` | ✅ 无错 |
| 单元测试 | `npx vitest run` | ✅ **80 文件 / 967 用例全过** |
| 构建（含入口静态闭包 `scripts/check-entry-closure.mjs`） | `npx vite build` | ✅ built in 4.15s |

> 说明：本轮曾因 `cm6Editor.ts` 里把 `lineNumbers()` 的返回值标注成可变数组 `Extension[]` 导致 `TS2322`（CM6 的 `Extension` 本身就是 `readonly Extension[]`），已改为 `Extension` 标注；产品逻辑未受影响。

## 11. 经验总结（Summary）

- **行号显隐的正确做法是「不给扩展」，不是「给扩展再藏起来」**：CM6 的 `Compartment.reconfigure([])` 会连同 gutter 的宽度占位一起撤掉；若用 CSS `display:none` 藏 `.cm-gutters`，CM6 仍会为它预留宽度，正文左侧留下空白。
- **同一枚偏好只能有一个事实源**：本任务前偏好读取分散在 `theme.ts` 与 `sourceLineNumbers.ts` 两处、写入只有一处，CM6 侧则完全没接。新增 `src/core/sourceLineNumbersPref.ts` 后，三处消费方（主题面板 / textarea 行号列 / CM6 行号栏）共用同一 key、同一读取、同一变更事件，未来再加行号相关视图不会再漂移。
- **提示文案要按「视图里有没有这个元素」判定，而不是按「当前模式叫什么」判定**：CM6 视图对外叫「所见模式」但内部就是源码编辑器，按模式名判定会弹出错误提示；改为按「当前视图是否存在源码行号列」判定后，5 个视图的提示去留全部符合直觉。
- **大文件回退引擎是一个「隐藏的第三种源码视图」**：任何只覆盖 textarea 与 Milkdown 的设置，在 `WYSIWYG_AUTO_ENABLE_MAX_BYTES/LINES` 触发时都会失效——排查设置类问题时必须把 CM6 路径一起纳入。

## 12. 遗留与后续

- **跨窗口偏好不同步**：另一窗口改「源码行号」后，本窗口已运行的 CM6 不会即时重排（下次创建/读取时生效）。窗口级偏好实时同步不在本次范围，已在 §2.5 写明。
- **`loadThemePrefs` 不读取羊皮纸开关**（既有 bug）：本次未修，已在前一任务文档记录。

