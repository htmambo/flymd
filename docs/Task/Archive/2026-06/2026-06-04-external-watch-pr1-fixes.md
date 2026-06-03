# 打开文件外部更改监听 — PR-1.1 修复

> 基于 codex 对 PR-1(commit a16cec8)的正式 review,修复 1 个 P0 + 8 个 P1 阻断 bug。

## 元数据

| 字段 | 值 |
|---|---|
| 创建日期 | 2026-06-04 |
| 状态 | ⏳ 待执行 |
| 范围 | PR-1 修订(不影响 PR-2 业务) |
| 预计工时 | M(半天,300-500 行 diff) |

## 来源

codex 正式 review 详见会话历史,本文件不重述 review 全文。

## 待修清单

### P0(1 条) — 必修

| # | 文件 | 问题 | 修复要点 |
|---|---|---|---|
| 0 | `main.ts:11556-11582` | WYSIWYG 外部重载会**静默丢 YAML Front Matter 外部改动**:`reloadCurrentFileFromDisk` 写 ed.value,但 `currentFrontMatter` 只在构建 WYSIWYG 时设,之后用户编辑会用旧 front matter 拼回 | reloadCurrentFileFromDisk 内如果 wysiwyg=true,解析新 ed.value 的 front matter 并更新 `currentFrontMatter`;或者抽出"setMarkdown into WYSIWYG"的统一入口 |

### P1(8 条) — 必修

| # | 文件 | 问题 | 修复要点 |
|---|---|---|---|
| 1 | `main.ts:5546-5550, 5517-5521` (saveAs) | **`unregisterFor(target)` 是注销新路径不是老路径**——**真 bug** | 改:先 `const oldPath = currentFilePath`(写之前),写后 `unregisterFor(oldPath)` 再 `registerFor(target)`;两处都改 |
| 2 | `tabs/integration.ts:361-376` (tab-closed) | `TabManager` 先从数组移除才 emit `tab-closed`,监听端 `getTabs().find(t.id === event.tabId)` 已找不到 | 方案 A:在 `TabManager.closeTab` 之前 emit(推荐);方案 B:事件 detail 带 filePath |
| 3 | `main.ts:5301-5319` (saveFile + saveAs) | 自循环抑制窗口启动偏晚:**先 `await writeTextFile`,再 `markSelfWrite`**,期间 watch 事件可能先到 | 引入 `beginSelfWrite(path)`(写**前**调用,设 suppressUntil) + `finishSelfWrite(path)`(写**后**调用,刷新 snapshot) |
| 4 | `src/core/openFileWatcher.ts:176-192` (startWatch) | 异步 watchPathsAbs 启动期间,unregister 看到 unwatch=null 无法释放;resolve 后赋值给已 dispose 的 entry,留下孤儿监听 | 加 generation/cancelled 标志;resolve 后若 entry 已失效/已 dispose,立即 `unwatch()` |
| 5 | `main.ts:4976, 6494, 7887` (多处 currentFilePath 赋值) | PDF 打开、Typecho rename、库内 rename 直接赋值 currentFilePath,**绕开** `flymdSetCurrentFilePath` 钩子 | 方案 A:收敛到内部 `setCurrentFilePathAndWatch(path)` 函数,所有赋值点改用;方案 B:flymdSetCurrentFilePath 钩子内部已处理 watch 迁移(已实现,见 main.ts:6397+),这里只是给提醒"所有赋值需走钩子" |
| 6 | `main.ts:reloadCurrentFileFromDisk` + tab 状态 | 冲突模态"重新加载"后,`reloadCurrentFileFromDisk` 写 ed.value + dirty=false,但 **tab.dirty 没同步**——setInterval 检测 false→true 不会反向设回 | 改:reload 成功后派发 `flymd-file-reloaded` 事件,TabManager 监听后 markCurrentTabSaved()(同步 content + dirty=false) |
| 7 | `src/core/openFileWatcher.ts:372` (setEnabled) | setEnabled(false) 只改布尔,句柄不释放;setEnabled(true) 不会重新 startWatch | 改:enabled=false 时调用所有 entry 的 unwatch 并清空,enabled=true 时对所有 entry 重新 startWatch |
| 8 | `src/core/openFileWatcher.ts:78` (HASH_THRESHOLD_BYTES) | HASH_THRESHOLD_BYTES 常量定义但**未使用**,承诺的小文件 hash 没实现 | 决策:**实现** ≤1MB 文件的轻量 hash(Web Crypto SubtleCrypto.digest('SHA-1', ...));或在注释里删除该承诺 |

## 实施顺序(降低风险)

```
1. #1 saveAs race(2 行,真 bug,必须先修)        ── 30min
2. #2 tab-closed 联动                          ── 30min
3. #3 begin/finishSelfWrite 拆分               ── 1h
4. #4 异步 watch race                          ── 1h
5. #6 conflict-reload 同步 tab                 ── 30min
6. #0 WYSIWYG front matter                      ── 1h
7. #7 setEnabled 完整语义                       ── 1h
8. #5 currentFilePath 收敛(可选)               ── 30min
9. #8 hash 实现(可选)                          ── 30min
10. tsc + build + codex 复审                   ── 30min
```

## 验收

- [ ] A1-A8 全部仍然通过(原 PR-1 用例)
- [ ] **新 A9**:saveAs 后,旧路径上后续外部修改**不应**弹提示
- [ ] **新 A10**:WYSIWYG 模式下,外部改 YAML 头后,reload 保留新 front matter,用户编辑后保存,新 front matter 还在
- [ ] **新 A11**:tab 关闭后,被关闭文件上的后续外部修改**不应**触发提示
- [ ] **新 A12**:偏好关闭总开关后,所有外部变更静默;开启后恢复监听
- [ ] tsc 0 错误;build 干净
- [ ] codex 复审通过

## 风险

- #4 异步 race 修复可能引入新的事件丢失,要 A1-A8 全过
- #0 WYSIWYG front matter 涉及 enableWysiwygV2 的 body 字段,需确认
- #5 是大改(全 main.ts currentFilePath 赋值),可能影响其他路径,放最后且**只做提示性 fix**
