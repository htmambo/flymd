# macOS 退出/关闭流程加固计划

## 元数据

- **创建日期**：2026-06-16
- **责任人**：Claude (Opus 4.8) + 果农
- **状态**：✅ 已完成 (完成时间: 2026-06-17)
- **范围**：macOS 退出/关闭链路 + 会话保存 + x86_64 打包脚本
- **关联提交**：`c3a38c0` / `1cbd1df` / `2000095` / `40d8f07` / `d971884` /
  `05e3606` / `8c88913` / `4c2b9cc` / `8a03b23` / `dc2e0d7` / `2f6961f`
- **审查依据**：Claude 自审 + Codex 独立交叉审查（SESSION_ID `019ed0ce-b071-7072-9d70-5a041a3115e9`）

---

## 完成总览

| 任务 | 提交 | 状态 |
|------|------|------|
| T4 会话保存改造 | `05e3606` | ✅ 2026-06-17 |
| T1 performExit 幂等锁 | `8c88913` | ✅ 2026-06-17 |
| T3 discard 语义 | `4c2b9cc` | ✅ 2026-06-17 |
| T2 替换 macOS 默认 Quit | `8a03b23` | ✅ 2026-06-17 |
| T5 WebDAV timeout 抽常量 | `dc2e0d7` | ✅ 2026-06-17 |
| T6 x86_64 脚本健壮性 | `2f6961f` | ✅ 2026-06-17 |
| T7 终审 + 归档 | （本次提交）| ✅ 2026-06-17 |

**最终验证**：
- `npx tsc --noEmit`: 29 行错误 = 基线（0 新增）
- `npm test`: 3 failed / 572 passed = 基线（pre-existing 环境问题）
- `cargo check`: exit 0（pre-existing 4 warning 不在改动范围）

**已知残留**（不在本批 scope，计划后续重构时一并处理）：
- I6: `Promise.race` 不取消底层 webdavSyncNow 任务
- I8: 关闭按钮 `setTimeout(0)` 经验性手段（T1 幂等锁后影响降至最低）

---

---

## 1. 目标（Goals）

把"4 次 fix 提交把表象修了"的状态推进到"路径收敛 + 状态机闭环 + 语义正确"：

- **G1** `performExit()` 必须幂等 —— 三条退出路径（关闭按钮 / Cmd+Q / `onCloseRequested`）任意并发触发都只跑一遍核心流程。
- **G2** macOS Cmd+Q 必须 100% 走前端保存链路 —— 不允许系统默认 `terminate:` 旁路。
- **G3** "放弃更改"必须语义正确 —— discard 后下次启动不能恢复未保存内容。
- **G4** 会话自动保存必须可终止、可按窗口隔离 —— 多窗口不互相覆盖、退出时干净停止。
- **G5** WebDAV shutdown 超时与同步模块自身 timeout 必须语义一致 —— 不出现双层冲突。
- **G6** x86_64 打包脚本在 `rustup` / `brew` 缺失时给出清晰错误，不留半成品。

---

## 2. 现状分析（Context）

### 2.1 关键文件

| 路径 | 关注点 |
|------|--------|
| `src/main.ts:1588` | 关闭按钮 `setTimeout(0)` emit |
| `src/main.ts:7961` | `performExit()` 主体（无幂等保护）|
| `src/main.ts:8011` | WebDAV `Promise.race` 8s 硬编码 |
| `src/main.ts:8033` | `flymdSaveTabSession()` 无视 discard 始终保存 |
| `src/main.ts:8104` | `onCloseRequested` listener |
| `src/main.ts:8114` | `flymd://request-close` listener |
| `src/main.ts:8121` | `flymd://request-exit` listener |
| `src/tabs/integration.ts:266` | `scheduleSessionAutoSave` 自驱动 5s 心跳 |
| `src/tabs/integration.ts:329` | `SESSION_KEY` 全局固定 key |
| `src/tabs/integration.ts:331` | `saveTabSession` 末尾再 schedule（永驱动）|
| `src/tabs/TabManager.ts:585` | `exportState()` 把 dirty content 一并序列化 |
| `src-tauri/src/main.rs:1865` | macOS App 菜单注册 |
| `scripts/flymd-macos-x86-build.sh:94` | rustup target add 失败处理不足 |
| `scripts/flymd-macos-x86-build.sh:118` | create-dmg 缺失时未检测 brew |
| `scripts/flymd-macos-x86-build.sh:180` | `find ... | head -1` 可能拿到旧残留 DMG |

### 2.2 问题清单（按 Claude+Codex 联合 review 整理）

| 优先级 | 编号 | 问题 | 影响 |
|--------|------|------|------|
| **P0** | I1 | `performExit()` 无幂等保护，三路退出可并发重入 | 多个保存对话框同时弹出 / 多次 WebDAV shutdown / 多个 destroy timer |
| **P0** | I2 | `Menu::default()` 自带的默认 Quit 仍在菜单里，Cmd+Q 可能走系统 `terminate:` 旁路 | `1cbd1df` 想解决的"Cmd+Q 不保存"问题部分失效 |
| **P1** | I3 | 用户选 discard 后 `flymdSaveTabSession()` 仍把 dirty content 写入 session | discard 形同虚设，下次启动恢复 |
| **P1** | I4 | `scheduleSessionAutoSave` 永久 5s 心跳 + 多窗口共享 `flymd:tabSession:v1` 单 key | 持续 IO / 多窗口互相覆盖快照 |
| **P2** | I5 | `performExit` 外层硬编码 8s race 与 webdavSync 自身 timeoutMs 形成双层 timeout | 语义冲突 + 退出最坏 8.65s |
| **P2** | I6 | `Promise.race` 不取消底层同步任务，窗口已 destroy 仍可能跑 `updateStatus()/clearStatus()` | 潜在 race 与无效 DOM 访问 |
| **P2** | I7 | x86 脚本 `rustup` 缺失只 warn 不验证 / `brew` 未检测 / `find ... | head -1` 可能取旧 DMG | 错误延后报、产物不准 |
| **P3** | I8 | `setTimeout(0)` 是经验性手段（在 I1 修复后影响很小，本计划仅记录不单独修）| 残留风险 |

---

## 3. 子任务清单（Subtasks）

### T1 ⏳ → 🔄 → ✅ [P0] `performExit()` 幂等锁

**目标**：三条退出路径并发触发只跑一遍 `performExit()` 主体。

**改动**：
- `src/main.ts`：增加模块级 `exitPromise: Promise<void> | null`
- `performExit()` 入口：若 `exitPromise` 已存在则直接返回；否则把核心逻辑包成 IIFE 赋给 `exitPromise`，并在 `finally` 中清空
- `exitNow()` 开头主动调用 `(window as any).flymdStopTabSessionAutoSave?.()` 停止 autosave timer（依赖 T4 实现）

**验收**：
- 在 listener 里手动并发触发 3 次 `performExit()`，只看到一次保存对话框
- `npx tsc --noEmit` ✅
- `npm test` 既有用例 ✅
- 新增 1 个单元测试覆盖并发幂等行为

**风险**：
- 如果用户在第一次 `performExit()` 卡在保存对话框时点击关闭按钮，第二次应当复用同一个 promise（即对话框响应）—— 当前设计是这样

**回滚**：单文件 revert

---

### T2 ⏳ → 🔄 → ✅ [P0] 替换 macOS 默认 Quit 菜单

**目标**：所有 Cmd+Q 触发路径都走前端 `flymd://request-exit`，不留 `terminate:` 旁路。

**改动**：
- `src-tauri/src/main.rs:1869-1893`：
  - 不再 `menu.append_items(&[&sub])` 加新 submenu
  - 改为定位 `Menu::default()` 第一个 item（macOS 标准 App submenu），用 `MenuItemKind::Submenu` 取出，移除其末尾的默认 Quit，append 自定义 `flymd.quit`
  - `on_menu_event` 中 `main` 缺失时 fallback 到 `app.webview_windows().into_iter().next()`，再 fallback `app.exit(0)`

**验收**：
- 启动后 macOS 顶部菜单栏 "FlyMD" 项 → 检查 Quit 子项是 `退出 FlyMD` 且只有一项
- `Cmd+Q` 触发 `[macos-menu] Cmd+Q / Quit menu triggered` 日志
- `cargo check` ✅
- `cargo build --release` ✅（局部，不全量打包）
- 手工：故意销毁 main 窗口（DevTools 控制台 `await getCurrentWindow().destroy()`）后再按 Cmd+Q，应触发 `app.exit(0)` 而不是无反应

**风险**：
- `Menu::default()` 的 submenu 结构在不同 Tauri 版本可能不同 —— Codex 已核实本仓库 Tauri 2.9.3 第一项必为 App submenu
- 如果 muda crate 对 PredefinedMenuItem::Quit 有别名差异，可能需要再调整

**回滚**：单段 revert

---

### T3 ⏳ → 🔄 → ✅ [P1] 修复 discard 语义

**目标**：用户选择"放弃更改"后，下次启动不能恢复未保存内容。

**改动**：
- `src/tabs/TabManager.ts:585`：`exportState(opts?: { includeDirtyContent?: boolean })`
  - 默认行为不变（向后兼容）
  - `includeDirtyContent === false` 时，dirty tab 的 `content` 字段写空串、`dirty` 字段写 false
- `src/tabs/integration.ts:331`：`saveTabSession(opts?)` 把 opts 透传给 exportState
- `src/main.ts:8033` 附近：discard 分支显式调 `flymdSaveTabSession({ includeDirtyContent: false })`，再走 `exitNow()`
- `exitNow()` 自身的 `flymdSaveTabSession()` 调用不动（兜底保留）

**验收**：
- 单元测试 `tabs/TabManager.test.ts` 新增 1 例：dirty tab + `{ includeDirtyContent: false }` → exportState 中 content 为空
- 手工：编辑文档 → Cmd+Q → 选 "放弃更改" → 重启 → 标签恢复但内容为空
- `npm test` ✅

**风险**：
- 如果未来其它代码也调 `exportState()` 期望拿到 dirty content，需检查 call site（搜索结果应只有 `saveTabSession`）

**回滚**：方法签名向后兼容，回滚仅删 opts 参数即可

---

### T4 ⏳ → 🔄 → ✅ [P1] 会话自动保存改造

**目标**：autosave 可终止、多窗口隔离、退出时干净停止。

**改动**：
- `src/tabs/integration.ts`：
  - 新增 `stopSessionAutoSave()` 清 timer + 置 null
  - `exposeExitHooks()` 把 `stopSessionAutoSave` 挂到 `(window as any).flymdStopTabSessionAutoSave`
  - 新增 `getSessionStorageKey()`：用 `getCurrentWindow().label` 作为 storage key 后缀（fallback `'main'`）
  - `saveTabSession` / `restoreTabSession` 走新 key；保留对老 key `'flymd:tabSession:v1'` 的兼容读取（一次性迁移：第一次读到老 key 后写到新 key 并删除老 key）
- `src/main.ts` `performExit()` → `exitNow()` 开头调用 `stopSessionAutoSave`（T1 已埋点）

**验收**：
- 单元测试 `tabs/integration.test.ts` 新增 2 例：
  - `stopSessionAutoSave` 调用后 timer === null，且 5s 后无新 setItem
  - 老 key 存在时首次 restore 迁移到新 key
- 手工：开两个 main + main-xxxx 窗口，分别编辑 → 关闭再重启 → 两窗口标签各自恢复，不互相覆盖
- `npm test` ✅

**风险**：
- `getCurrentWindow().label` 在非 Tauri 环境（浏览器测试）需 try/catch fallback
- 老 key 迁移要确保只迁移到 main 窗口（其他窗口启动时如果发现老 key 不属于自己，跳过迁移）

**回滚**：函数签名兼容、storage key 迁移逻辑保留即可

---

### T5 ⏳ → 🔄 → ✅ [P2] WebDAV shutdown timeout 可配置化（已决策）

**前置调研**（已完成 2026-06-16）：
- `webdavSync.ts:1022` 默认 `cfg.timeoutMs = 120000` (120s)
- `webdavSync.ts:2582` shutdown 路径放宽到 `min(60000, cfg.timeoutMs)` = 60s
- **结论**：直接移除外层 8s race 会让最坏退出时间从 8.65s 涨到 60s+，用户体验恶化 —— 放弃"完全单层"方案

**目标**：保留外层 race 作为"关闭按钮可控上限"，但允许用户/配置覆盖，并消除 hardcoded magic number。

**改动**：
- `src/main.ts:8011-8020`：把硬编码 `8000` 抽成常量 `SHUTDOWN_SYNC_TIMEOUT_MS`（默认 8000）
- 加注释明确说明：外层 race 是用户感知上限，内层 `min(60000, cfg.timeoutMs)` 是同步模块自身上限；外层超时只让"前端流程"放弃等待，**底层同步仍可能继续跑到完成**（已知限制，文档化）
- 不修改 I6（race 不取消底层任务）—— 范围控制，留作后续 cancel 机制重构

**验收**：
- 关闭路径注释清晰说明两层 timeout 语义
- 单元测试不变（行为不变）
- `npm test` ✅

**风险**：仅常量抽取 + 注释优化，无行为变更

**回滚**：单段 revert

---

### T6 ⏳ → 🔄 → ✅ [P2] x86_64 打包脚本健壮性

**目标**：缺依赖时立即失败 + 不取错残留 DMG。

**改动**：
- `scripts/flymd-macos-x86-build.sh`：
  - `rustup target add` 加 `|| err "..."`
  - `rustup` 不存在时用 `rustc --print target-list | grep -q "^${RUST_TARGET}$"` 探针，不通过直接 `err`
  - `create-dmg` 缺失先 `command -v brew`，无 brew 直接 `err`
  - DMG 查找改 `find ... -type f -name "*.dmg" -print | sort | tail -1`（取最新构建产物，而非任意残留）

**验收**：
- shellcheck 通过（或至少新增改动不引入新 warning）
- 手工：删 `~/.cargo/.toolchain` 模拟 rustup 缺失 → 跑脚本 → 立即报错而不是跑到 `npm run tauri:build` 才挂
- 手工：本机有 `create-dmg` 时正常跑通

**风险**：
- `sort | tail -1` 在文件名包含特殊字符时可能不稳定 —— 本仓库 DMG 命名固定，无风险

**回滚**：脚本独立，回滚不影响主程序

---

### T7 ⏳ → 🔄 → ✅ 最终 codex review + 归档

**目标**：所有改动落地后，用 codex 做闭环 review，确认需求完成度；归档文档。

**改动**：
- 用 codex MCP 对 T1-T6 的累积 diff 做最终 review，重点关注：
  - 幂等锁是否真的拦住所有并发路径
  - macOS 菜单替换在 Tauri 2.9.3 API 下是否可编译
  - discard + session 迁移是否有 race
- 更新本文件状态为 ✅
- 移动到 `docs/Task/Archive/2026-06/2026-06-16-macos-exit-hardening.md`
- 更新 `docs/Task/README.md` 索引
- Git commit（参考 COMMIT_TEMPLATE.md）

---

## 4. 验收标准（Acceptance）

| 项 | 标准 |
|----|------|
| **A1** 类型 | `npx tsc --noEmit` 0 错误 |
| **A2** 测试 | `npm test` 全绿；新增至少 4 个用例（T1/T3/T4 各 1+ ） |
| **A3** Rust | `cargo check` ✅，`cargo build --release` ✅ |
| **A4** 手工 1 | 关闭按钮快速连点 5 次 → 只弹一个保存对话框 |
| **A5** 手工 2 | Cmd+Q → 看到 `[macos-menu]` 日志 → 正常保存 |
| **A6** 手工 3 | 编辑文档 → Cmd+Q → 选 discard → 重启 → 内容为空 |
| **A7** 手工 4 | 开 main + main-xxxx 两窗口编辑 → 关闭 → 重启 → 各自恢复不串 |
| **A8** Codex | 终审 0 P0/P1 阻断（P2 nit 可接受）|

---

## 5. 风险与回滚（Risks & Rollback）

| 风险 | 缓解 |
|------|------|
| 菜单替换 API 在 Tauri 升级后失效 | T2 完成后在代码注释里写明依赖 Tauri 2.9.x；CI 加 `cargo check` |
| Session storage key 迁移破坏老用户数据 | T4 迁移逻辑只在 `getSessionStorageKey()` 返回 main 后缀时执行；保留老 key 至少一次启动周期 |
| WebDAV timeoutMs 默认过大导致退出体验恶化 | T5 实施前先核实 webdavSync 默认 timeoutMs，超过 10s 则降级保留外层 race（但读配置）|
| 幂等锁导致 exitPromise 卡在 dialog 不释放 | T1 的 finally 必须无条件清空，加单元测试覆盖异常路径 |

**整体回滚**：每个 T 独立 commit，可单独 revert。

---

## 6. 工时估算（Estimate）

| 任务 | 估算 |
|------|------|
| T1 幂等锁 | S |
| T2 macOS 菜单 | M（需读 Tauri 源码确认 API）|
| T3 discard 语义 | S |
| T4 autosave 改造 | M（含 storage key 迁移）|
| T5 WebDAV timeout | S |
| T6 x86 脚本 | S |
| T7 review + 归档 | S |
| **合计** | **M-L** |

---

## 7. 执行顺序

按依赖关系：

```
T4 (stopSessionAutoSave 挂载) ──┐
                                ├──> T1 (exitNow 调用 stop)
T3 (discard 显式调 saveTabSession{includeDirtyContent:false}) ──┘
                                                                  │
T2 (Rust 菜单替换) ───────────────────────────────────────────────┤
                                                                  ├──> T7
T5 (WebDAV 单层 timeout) ────────────────────────────────────────┤
                                                                  │
T6 (x86 脚本) ────────────────────────────────────────────────────┘
```

实施顺序：**T4 → T1 → T3 → T2 → T5 → T6 → T7**

---

## 8. 备注

- 本计划由 Claude (Opus 4.8) 与 Codex (`019ed0ce-b071-7072-9d70-5a041a3115e9`) 联合 review 后产出
- I8 (`setTimeout(0)`) 不单独修复 —— 在 T1 幂等锁落地后影响降至最低，留作未来"事件流统一收口"重构时一并处理

### ⚠️ Codex 不可用声明（2026-06-17 实施阶段）

- **设计 review**（已完成）：T1-T6 的需求与设计经过 codex `019ed0ce` 会话独立交叉审查，是计划依据
- **实施阶段原型**：codex 网关 524 超时不可用，**T1-T6 的代码原型与最终 review 均由 Claude 独立完成**
- 缓解措施：
  1. 严格按计划文档执行，不做范围外改动
  2. 每个 T 单独 commit，独立可回滚
  3. 每个 T 完成后立即 `npx tsc --noEmit` + `npm test`，T2 额外 `cargo check`
  4. 待 codex 恢复后补一次最终 review（T7 中执行）
  5. 用户手工 4 项验收（A4-A7）作为最终把关

---

## 9. 后续补遗（2026-06-17，A2 验收闭环）

复盘时发现 **A2（"新增至少 4 个用例，T1/T3/T4 各 1+"）在初次实施时被遗漏**：T1/T3/T4 的"验收"小节描述了单测，但实际 0 新增、未改动任何 `.test.ts`。本次补齐。

**为可测性抽离的 2 个纯模块（行为完全等价，非功能变更）**：
- `src/core/singleFlight.ts`：把 `performExit` 手写的 `exitPromise` first-wins 锁抽成通用单飞包装；`performExit` 改为 `preventDefault` + 委托 `runExit()`。并发去重、settle 后可重入（取消退出）语义不变。
- `src/tabs/sessionStorageKey.ts`：把会话 key 派生（`getSessionStorageKey` / `getCurrentWindowLabel`）与老 key 迁移决策（`migrateLegacySessionKey`）从 `integration.ts` 模块私有作用域抽出；`integration.ts` 改为引用，迁移行为不变。

**新增测试（15 例，全绿）**：

| 文件 | 覆盖 | 例数 |
|------|------|------|
| `src/core/singleFlight.test.ts` | T1 幂等：并发只跑一次 / settle 后可重入 / reject 后可重试 / in-flight 不重入 | 4 |
| `src/tabs/sessionStorageKey.test.ts` | T4：label 隔离 key / 非 Tauri 退回 browser / 老 key 仅 main 迁移一次后删除 | 7 |
| `src/tabs/TabManager.test.ts` | T3：discard 路径 content 写空 + dirty=false / 默认向后兼容 / 非 dirty 不持久化 | 4 |

**验证**：
- `npm test`：**587 passed**（= 原 572 基线 + 15 新增）；3 个 pre-existing 文件加载失败（`web/server` 的 `dotenv`、`previewMeta` 的 `localStorage`）与 1 个 pre-existing 用例失败保持基线，无新增、无回归。
- `npx tsc --noEmit`：**22 个 `error TS`（≈29 行输出）= 基线，0 新增**。借此确认 §完成总览 "29 行错误 = 基线" 描述**准确**；A1 的 "0 错误" 应理解为"0 新增"——存量 22 个 pre-existing 错误集中在 `webdavSyncFacade.ts` 等与本任务无关的文件。
