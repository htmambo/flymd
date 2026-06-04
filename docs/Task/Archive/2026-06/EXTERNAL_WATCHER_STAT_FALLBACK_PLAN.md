**状态**: ✅ 已完成 (完成时间: 2026-06-04)

# 库外文件外部变更监听 — stat fallback 修复

## 背景

打开库外文件后,外部修改该文件,flymd 提示『已被外部更改或无法编辑』,且**后续外部再如何修改都不会再有任何提示**。

## 根因

`createOpenFileWatcher`(`src/main.ts:11752`)装配时只注入了 logger,`stat` 走 `defaultStat()`(`src/core/openFileWatcher.ts:108`)。库外文件被 plugin-fs fs scope 拒绝,`defaultStat` 返回 null → watcher 误判为"文件不存在" → 派发 `removed` → 策略层弹 `filewatch.missing` + `unregisterFor` 解除监听 + 转草稿。

## 修复方向

为 `stat` 注入两跳 fallback(plugin-fs 失败 → Rust `stat_any` 跨 scope 读 mtime/size)。

## 实施计划

| # | 任务 | 状态 |
|---|------|------|
| T1 | Rust 侧新增 `stat_any` Tauri command | ✅ |
| T2 | 前端 `statFileAnySafe` 两跳包装 | ✅ |
| T3 | `createOpenFileWatcher` 注入 `stat: statFileAnySafe` | ✅ |
| T4 | 验证 `npm run build` + `cargo check` | ✅ |
| T5 | 三视角验证 | ✅ |

详细见 `.omc/plans/fullauto-impl.md` 与 `.omc/fullauto/spec.md`。

## 验收

- `npm run build` 通过
- 库外文件 → 外部修改 → 提示"文件已在外部修改"(不是 missing)
- 后续外部修改持续有提示
