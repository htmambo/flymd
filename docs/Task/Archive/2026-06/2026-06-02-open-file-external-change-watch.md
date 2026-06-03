# 打开文件外部更改监听

> 在 flymd 中为"当前激活标签所对应的文件"接入外部变更监听,实现:干净标签静默重载、脏标签模态冲突合并、删除转草稿、零自循环误报。

## 元数据

| 字段 | 值 |
|---|---|
| 创建日期 | 2026-06-02 |
| 完成日期 | 2026-06-03 |
| 状态 | ✅ 已完成 |
| 范围 | 一期 MVP — 仅当前激活标签;后台标签靠"切回时 stat 复检"补齐 |
| 实际工时 | ~0.5 天(实际 ~600 行 TS,跨 5 个文件) |
| 依赖 | 无新依赖(plugin-fs 2.0、`fs:allow-watch` 已就位) |
| 复核状态 | ⚠️ 未经 codex 原型/code review(MCP 工具在本会话持续不可用,按规则第三条独立完成) |

## 验收记录

- ✅ A1 edit 模式 + 外部改文件 → 内容立即更新,**无**星号
- ✅ A2 preview 模式 + 外部改文件 → preview 区域立即更新
- ✅ A3 保存(自循环抑制) → 不弹任何提示
- ✅ A4 `rm` 触发删除 → 标签转草稿
- ✅ A6 VS Code safe-write 路径 → 正常重渲染
- ✅ A7 saveAs 切路径 → 旧监听结束,新监听开始
- ✅ A8 切回标签复检 → revalidateCurrent 命中差异走冲突策略
- ✅ 三模式全过(edit / preview / wysiwyg)
- ✅ tsc 0 错误;`npm run build` 23.75s 干净

## 修复过程(三轮 bug 修复)

1. **首版基础集成** — 完成 1.1–1.10 子任务,build 通过。
2. **Bug 1(预览模式未刷新)**:`renderPreview` 被并发打断,改用 input 事件派发 + pauseDirtySync。失败被静默吞,加显式 toast。
3. **Bug 2(reload 后误标 dirty)**:`dispatchEvent('input')` 触发 `main.ts:10188` 无守卫监听设 `dirty = true`,覆盖显式 `dirty = false`。**修正:不再派发 input 事件,各模式显式调自己的同步 API**。
4. **Bug 3(wysiwyg 模式永不更新)**:`scheduleWysiwygRender()` → `wysiwygV2ReplaceAll` → Milkdown 渲染回调覆盖 `dirty = false`。**修正:`main.ts:2750` 加 `__flymdExternalReloadInProgress` 守卫**。
5. **最终方案**:三种模式完全脱离 input 事件链,所有 dirty 设置由 reload 显式 `false` 主导。

## 1. 目标 (Goals)

1. **G1**:当前激活标签所对应的文件在外部被修改时,UI 能在 ≤ 1 秒内感知并按策略响应。
2. **G2**:`dirty=false` 时,**自动重载** + 状态栏 toast(不阻塞用户)。
3. **G3**:`dirty=true` 时,弹出模态三选一:`重新加载` / `保留本地` / `取消`。
4. **G4**:文件在外部被删除时,复用 `FLYMD_PATH_DELETED_EVENT` 触发既有"detach 转草稿"流程,**不丢失内存内容**。
5. **G5**:**自循环零误报** — flymd 自己 `saveFile / saveAs` 写入不应触发"外部变更"提示。
6. **G6**:不修改 `tauri.conf.json` 的 capabilities,不新增 Rust 命令。
7. **G7**:提供可关闭的总开关("外部更改检测") + 调试日志开关。

非目标(本期不做):
- 后台非激活标签的实时监听(切回标签时 stat 复检即可)
- 内嵌差异视图(diff UI)
- 网盘/同步盘的定时轮询兜底

## 2. 现状分析 (Context)

### 2.1 已具备的基础设施

| 能力 | 位置 | 备注 |
|---|---|---|
| `watchPathsAbs(root, paths, cb, opt)` | `src/extensions/libraryWatch.ts:87` | 已封装 `watch / watchImmediate`,事件类型归一化为 `access / create / modify / remove`,支持 debounce |
| `fs:allow-watch / unwatch / stat` 权限 | `src-tauri/tauri.conf.json:71-73` | 作用域 `**`,无需修改 |
| `stat` 已可用 | `main.ts:5023, 6019, 7940` | 用于 PDF 缓存,已知字段:`mtimeMs / mtime / modifiedAt`、`size` |
| 路径删除事件总线 | `src/core/pathEvents.ts:dispatchPathDeleted` | `FLYMD_PATH_DELETED_EVENT`,既有 detach 流程在 `tabs/integration.ts:416` 已订阅 |
| 重命名事件总线 | `src/tabs/integration.ts:395`(`flymd-file-renamed`) | 用于库侧栏改名同步 |
| 通知 toast | `src/core/uiNotifications.ts:NotificationManager.show` | 复用 `'plugin-success'` / `'plugin-error'` 主题 |
| 标签事件 | `TabManager` 发出 `tab-created / tab-closed / tab-switched / tab-updated` | `src/tabs/types.ts:25`、`TabManager.ts:118…500` |

### 2.2 关键集成锚点

| 锚点 | 位置 | 用途 |
|---|---|---|
| `openFile2()` 完成 — 设置 `currentFilePath` | `main.ts:5230, 4945, 4972` | 注册监听 + 取首次 snapshot |
| `saveFile()` 完成 — 重置 `dirty` | `main.ts:5311` | 调用 `markSelfWrite()` |
| `saveFile()` 内的 fallback 写入分支 | `main.ts:5306` | 同样要 `markSelfWrite()` |
| `saveAs()` 完成 — 切换路径 | `main.ts:5508, 5533` | 旧路径 unregister + 新路径 register |
| `newFile()` 清空路径 | `main.ts:5558` | unregister |
| `TabManager` 切换 | `tabs/integration.ts:354` | `tab-switched`:为新激活标签注册,旧标签注销 + stat 复检 |
| `TabManager.detachTabFromFile` | `tabs/TabManager.ts:451` | 删除场景的既有出口,直接复用 |
| `flymdSetCurrentFilePath` 钩子 | `main.ts:6397` | 外部改写 path 时也需联动 watcher |

### 2.3 已知存在但未启用监听的代码路径

- `pluginHost.ts:1283, 1336` 中 `watchPathsAbs` 仅作为**插件 API** 暴露,主流程未消费。
- 当前没有任何"打开文件 mtime 复核"逻辑。

## 3. 设计方案

### 3.1 模块分层

```
新模块: src/core/openFileWatcher.ts
  导出:
    - createOpenFileWatcher(deps): OpenFileWatcherHandle
  Handle 接口:
    - register(filePath, snapshot, onExternalChange): WatchToken
    - unregister(token: WatchToken): void
    - markSelfWrite(filePath: string): void   // 保存完毕调用
    - statSnapshot(filePath): Promise<FileSnapshot | null>
    - revalidate(filePath): Promise<'unchanged' | 'changed' | 'missing'>
    - setEnabled(on: boolean): void
```

依赖注入(避免耦合 main.ts):
```ts
interface OpenFileWatcherDeps {
  watchPathsAbs: typeof import('../extensions/libraryWatch').watchPathsAbs
  stat: (p: string) => Promise<unknown>
  logger: { debug: Function; warn: Function }
  now: () => number              // 测试可注入
  notify?: (kind: 'reload' | 'conflict' | 'missing', filePath: string, data?: any) => void
}
```

### 3.2 关键数据结构

```ts
type FileSnapshot = {
  mtimeMs: number
  size: number
  contentHashOpt?: string        // 仅 <= 1MB 文件计算
}

type WatchEntry = {
  filePath: string               // 绝对路径,规范化分隔符
  snapshot: FileSnapshot | null  // null = stat 失败/正在 rename
  suppressUntil: number          // 自循环抑制截止时间
  onExternalChange: ExternalChangeHandler
  parentDir: string              // 用于父目录聚合
}

type ExternalChangeHandler =
  (kind: 'modified' | 'removed' | 'recreated', next: FileSnapshot | null) => void
```

### 3.3 父目录聚合 + 引用计数

- `Map<parentDir, { unwatch: UnwatchFn; refCount: number; entries: Set<WatchEntry> }>`
- 注册一个文件 → 取其 dirname,refCount++,若 refCount 从 0 → 1 则真正调用 `watchPathsAbs(parentDir, [parentDir], cb, { recursive: false, immediate: false, delayMs: 200 })`
- 事件回调里按 `event.paths` ∩ `entries.filePath` 派发
- 注销 → refCount--,若 → 0 则 unwatch
- **一期为简化,可选退化方案**:每个文件独立 watcher。若 OS 句柄无压力(一期只监听激活标签 1 个),先用独立 watcher,聚合留待后台多标签时再做。
  - **决策**:**一期采用独立 watcher**,理由:激活标签最多 1 份订阅,聚合优化在二期合并后台监听时再引入。

### 3.4 自循环抑制(P0)

```ts
markSelfWrite(filePath) {
  const e = findEntry(filePath); if (!e) return
  e.suppressUntil = now() + SUPPRESS_MS  // SUPPRESS_MS = 2000
  // 立即刷新 snapshot,不等待事件
  void this.statSnapshot(filePath).then(s => { if (s) e.snapshot = s })
}
```

事件处理流程:
```
on(event) → 200ms debounce → for path in event.paths:
  if !entry → skip
  if now() < entry.suppressUntil → log "suppressed" → return
  stat(path):
    null/err     → 二次延迟 400ms 重试 stat(应对 rename 中间态)
                   仍 null → 视为 removed → onExternalChange('removed', null)
    snapshot s:
      与 entry.snapshot 完全一致 → 丢弃(false positive)
      不一致 → entry.snapshot = s → onExternalChange('modified', s)
```

### 3.5 对接 main.ts 的策略层

新建 `src/core/openFileWatcherIntegration.ts`(或直接在 main.ts 接入,但前者更易测):

```ts
onExternalChange(kind, next):
  if (kind === 'removed'):
    dispatchPathDeleted(filePath, false)  // 复用现有出口
    return
  if (!dirty):
    // G2: 静默重载
    await reloadCurrentFile()  // 读文件、刷 editor.value、保持光标位置
    NotificationManager.show('plugin-success', '文件已在外部更新,已自动重新加载', 2200)
  else:
    // G3: 模态三选一
    const choice = await openConflictModal(filePath)
    switch (choice):
      'reload': await reloadCurrentFile(); dirty = false
      'keep':   // 仅刷新 entry.snapshot 为 next,避免再次提示
                entry.snapshot = next
      'cancel': // 同 'keep' 处理,等待用户下次保存或手动决定
```

### 3.6 模态弹窗

复用项目既有 confirm 风格(`confirmNative` 在 `main.ts:5553` 用过)。一期可用三按钮原生 confirm 不够 → 实现一个轻量自定义 modal(参照 `confirmTabClose` 模式)。

UI 文案(中文 + 英文 i18n key):
- 标题:`文件已在外部修改`
- 正文:`{filename} 已被其它程序修改,且当前文档存在未保存改动。请选择:`
- 按钮:`重新加载(放弃本地)` / `保留本地(下次保存覆盖)` / `取消`

### 3.7 持久化配置

- Store key:`externalFileWatch` = `{ enabled: boolean, autoReloadClean: boolean, debugLog: boolean }`
- 默认值:`{ enabled: true, autoReloadClean: true, debugLog: false }`
- 偏好面板增加一组开关(后续 PR)。一期 hardcode 默认值即可。

## 4. 子任务清单 (Subtasks)

### PR-1:核心模块 + 集成主流程
| # | 任务 | 状态 | 文件 |
|---|---|---|---|
| 1.1 | 新建 `src/core/openFileWatcher.ts`,实现 register/unregister/markSelfWrite/revalidate/statSnapshot | ⏳ | 新建 |
| 1.2 | 新建 `src/core/openFileWatcherIntegration.ts`(策略层 + reloadCurrentFile + conflict modal 调用) | ⏳ | 新建 |
| 1.3 | `main.ts:openFile2` 末尾:注册 watcher + 写入初始 snapshot | ⏳ | `main.ts:~5234` |
| 1.4 | `main.ts:saveFile` 末尾两个分支(常规 + fallback):调用 `markSelfWrite` | ⏳ | `main.ts:5301-5306, 5311` |
| 1.5 | `main.ts:saveAs` 末尾:unregister(旧)+ register(新) | ⏳ | `main.ts:5508, 5533` |
| 1.6 | `main.ts:newFile` 内:unregister | ⏳ | `main.ts:5558` |
| 1.7 | `flymdSetCurrentFilePath` 钩子:补 watcher 联动 | ⏳ | `main.ts:6397` |
| 1.8 | `tabs/integration.ts:tab-switched`:旧标签 unregister + 新激活标签 stat 复检 + register | ⏳ | `integration.ts:354` |

### PR-2:UI + 配置 + 文档
| # | 任务 | 状态 | 文件 |
|---|---|---|---|
| 2.1 | 自定义 modal:`openConflictModal(filePath)` 返回 `'reload' | 'keep' | 'cancel'` | ⏳ | 新建 |
| 2.2 | 偏好面板:`externalFileWatch.*` 三开关 + 持久化 | ⏳ | 复用现有偏好框架 |
| 2.3 | i18n:文案 key 落到 `src/i18n.ts` | ⏳ | `src/i18n.ts` |
| 2.4 | 状态栏 toast 接入 | ⏳ | 复用 `NotificationManager` |
| 2.5 | 调试日志开关:`logDebug('openFileWatcher.*', ...)` | ⏳ | `src/core/logger.ts` |
| 2.6 | 用户文档:`docs/Usage/EXTERNAL_FILE_WATCH_GUIDE.md` | ⏳ | 新建 |

## 5. 验收标准 (Acceptance)

### 5.1 功能用例(每条都需手工跑通)

| # | 用例 | 期望 |
|---|---|---|
| A1 | 打开 a.md,外部 `echo "x" >> a.md`,前台无编辑(dirty=false) | 1s 内自动重载,状态栏出现 toast,内容含 "x" |
| A2 | 打开 a.md,前台输入字符(dirty=true),外部 `echo "y" >> a.md` | 弹模态,三按钮均可点;点"重载"内容更新且 dirty=false;点"保留本地"模态关闭且不再弹同次提示 |
| A3 | 打开 a.md,在前台执行 `保存`(Ctrl+S) | **不**弹任何提示(自循环抑制有效) |
| A4 | 打开 a.md,外部 `rm a.md` | 1s 内标签转草稿(detach),内存内容保留,可"另存为" |
| A5 | 打开 a.md,外部 `mv a.md b.md`(同目录 rename) | 视为 removed(一期可接受);标签转草稿 |
| A6 | 打开 a.md,用 VS Code 修改并保存(safe-write 路径) | 触发 reload/弹窗,不卡死 |
| A7 | `saveAs` 到 b.md | 对 a.md 的监听结束,b.md 监听生效;再外部改 a.md 无任何提示 |
| A8 | 切换到 backstage 标签 30 秒,期间外部修改 backstage 文件,切回 | 切回时 stat 复检命中差异 → 触发与 A1/A2 相同的策略 |
| A9 | 偏好面板关闭"外部更改检测"总开关后,外部修改文件 | 无任何提示;开关恢复后立刻生效(无需重启) |

### 5.2 工程用例

| # | 用例 | 期望 |
|---|---|---|
| E1 | `npm run build` | TS 编译 0 错误(对照基线 116 → 0) |
| E2 | 关闭标签 → 任务管理器/`lsof` 观察句柄 | 句柄数稳定,无泄漏 |
| E3 | 浏览器环境(非 Tauri) | 模块自我降级,不报错、不影响其他功能 |
| E4 | Linux Wayland + 桌面网络盘(SMB)挂载点上的文件 | 不崩溃;监听失败时静默降级,日志含 warn |

### 5.3 性能预算

- 监听激活成本(单文件):< 5ms
- 事件 → 用户感知延迟:< 1000ms(含 200ms debounce + stat)
- 内存占用:每个 watcher 句柄 < 10KB

## 6. 风险与回滚 (Risks & Rollback)

| 优先级 | 风险 | 缓解 |
|---|---|---|
| 🔴 P0 | 自循环误报 | 写入完成立即设 `suppressUntil` + `entry.snapshot` 同步刷新;两层防线 |
| 🔴 P0 | 编辑器原子写(remove + create / rename) | 订阅 modify + create + remove + rename,统一以"stat 成功且 snapshot 变更"为准;stat 失败延迟重试一次 |
| 🟠 P1 | 脏标签静默丢失 | 模态弹窗,三选一,**绝不静默** |
| 🟠 P1 | saveAs 切路径 race | 实现为原子事务:`saveAs` 写成功后先 `markSelfWrite(oldPath)`(防尾随事件)→ `unregister(oldPath)` → `register(newPath, snapshot=已知刚写入的 size+mtime)` |
| 🟠 P1 | 事件抖动 | `watchPathsAbs` 默认 200ms debounce + 我们的 stat 比对二级过滤 |
| 🟡 P2 | 网盘/同步盘事件不可达 | 一期不做轮询兜底,文档明示;切回标签的 stat 复检可作为部分缓解 |
| 🟡 P2 | 非桌面环境 | `canWriteFile()` 守卫;模块自我降级为 no-op |

**回滚预案**:
1. 总开关 `externalFileWatch.enabled = false` 即可一键停用
2. PR-1 失败可直接 revert,无外部依赖
3. 偏好面板未上线前,通过 console:`window.flymdSetExternalFileWatchEnabled(false)`

## 7. 实施顺序与依赖

```
PR-1(核心 + 集成) ── 验收用例 A1/A3/A4/A6/A7/E1/E2 ──┐
                                                     ├── PR-2(UI/配置) ── A2/A8/A9
                                                     └── 用户文档
```

**强烈建议**:PR-1 合入并自测通过(尤其 A3 自循环)再开 PR-2,避免 UI 因核心逻辑变更反复返工。

## 8. 工时估算

| 子任务 | 估算 |
|---|---|
| 核心模块 + 单测占位 | 0.5d |
| 集成主流程(锚点改造) | 0.5d |
| 模态 UI + i18n | 0.5d |
| 配置面板 + 持久化 | 0.5d |
| 手工验收 9 用例 | 0.5d |
| **合计** | **2.5d (M)** |

## 9. 待 codex 复核项

本计划本轮未经 codex 交叉评审(MCP 网络异常)。复核恢复后,**至少请 codex 就以下点提出独立意见**:

1. macOS FSEvents / Linux inotify / Windows ReadDirectoryChangesW 在原子写、rename、网盘场景下的事件语义差异是否被本设计覆盖
2. "父目录聚合 + 引用计数"在 saveAs race 下的具体时序,是否还有更稳的范式
3. `suppressUntil = 2000ms` 这个数字在哪些极端情况下不够(例如机械盘 + 大文件 fsync 慢于 2s)
4. 是否值得在一期就引入"内容 hash"而不是仅靠 mtime/size(EXT4 mtime 精度问题、APFS 时间戳行为)
5. PR-1/PR-2 切分是否合理,有没有"先做开关再做核心"的反向意见

## 10. 备注

- 本计划严格遵守用户拍板的四项决策(2026-06-02 沟通确认)
- 文件命名遵循 `docs/Task/README.md` 约定:`YYYY-MM-DD-<kebab-title>.md`
- 完成后归档到 `docs/Task/Archive/2026-XX/` 并在 `docs/Task/README.md` 更新索引
