**状态**: ✅ 已完成 (完成时间: 2026-06-04)

# 库外文件外部变更 watch 事件投递修复

## 背景

commit `2e799d7`(stat fallback)修复后,用户实测反馈:
- 切标签时会出现外部更改提示(`revalidateCurrent` 路径 OK)
- **未切标签时,外部修改文件没有任何提示**(watch 事件路径不通)

## 根因(待验证)

`openFileWatcher` 调 `watchPathsAbs(parentDir, [originalPath], cb, { recursive: false })`(`src/core/openFileWatcher.ts:245-258`)。`watchPathsAbs` 内部走 `@tauri-apps/plugin-fs` 的 `watch(pathsAbs, …, { recursive })`(`src/extensions/libraryWatch.ts:117,119`)。

复用了库监听相同的 plugin-fs 调用,而 plugin-fs 的 fs scope(`tauri.conf.json:63-79`)只放行白名单目录。**库外文件的 watch 事件接收,极可能跟 stat 一样被 plugin-fs scope 静默拒绝** —— `watch` 即使不抛错(返回 unwatch 函数),实际事件也不会送达。

参考:读盘路径已通过 `read_text_file_any` 跨 scope 解决;stat 已通过本次新增的 `stat_any` 解决。**watch 投递需走同类方案**:
- 方案 A:新增 Rust `watch_any` 命令(用 `notify` crate 或直接读 OS inotify/FSEvents,跨 scope)
- 方案 B:放宽 plugin-fs 的 fs scope(把 `**` 加进 watch allow 范围)

## 假设

- A 更精准(只放行 watch),B 攻击面大(放行 plugin-fs 全部命令)
- 项目没有 OS notify crate 依赖,需要先看 Cargo.toml
- 若引入 `notify` 代价过大,fallback 到 B 方案

## 实施计划

| # | 任务 | 状态 |
|---|------|------|
| T1 | 调研:确认 plugin-fs watch 库外路径是否静默失败 | ✅(plugin-fs scope 已 `**`,但 watch 在库外路径投递仍不可靠) |
| T2 | 决策:watch_any vs 放宽 scope vs 轮询 | ✅(选 C 轮询,0 新 dep 0 新 Rust) |
| T3 | 实现:openFileWatcher 内部 polling 兜底 | ✅ |
| T4 | 验证:`npm run build` + `npm test` | ✅ |

## 验收

- 不切标签,外部修改库外文件,flymd 立即提示
- 多次外部修改持续有提示(不依赖切标签)
