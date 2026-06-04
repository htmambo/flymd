**状态**: ✅ 已完成 (完成时间: 2026-06-04)

# 文本对比框 3 个缺陷修复

## 背景

`showFileWatchDiffDialog`(`src/dialog.ts:135`)外部冲突对比框有 3 个 UX 缺陷:

1. **缺"全部应用"按钮**:多个 hunk 时,用户须逐个点击 `→` 复制到右侧,效率低
2. **单个复制后右 textarea 跳到顶部**:`rightTextarea.value = newRight` 重置 `scrollTop=0`,且 `jumpTo(1)` 只滚左 pane
3. **空行/空格类差异"复制无效"**:`copyHunkToRight / copyHunkToLeft` 在 `block === ''` 时误用 `[]` 替换,空行被吞掉(已通过 repro 验证)

## 根因

- 缺陷 1:功能性缺失
- 缺陷 2:HTML `value` 赋值重置 scrollTop + 同步滚动实现不完整
- 缺陷 3:`src/core/diffMerge.ts:308 / 336` 的 `block.length === 0 ? [] : block.split('\n')` — 错误判空

## 修复方向

| # | 修复 | 文件 |
|---|------|------|
| 1 | 加"全部应用到右侧"按钮 + i18n | `dialog.ts` + `i18n.ts` |
| 2 | 复制后右 textarea scroll 保护(caret 行号估算) | `dialog.ts` |
| 3 | `copyHunkToRight / copyHunkToLeft` 改 `hunk.rows.length === 0` 判空 | `diffMerge.ts` |
| — | 加 2 个回归 case | `diffMerge.test.ts` |

## 实施计划

| # | 任务 | 状态 |
|---|------|------|
| T1 | i18n 加 `filewatch.diff.btn.applyAll` | ✅ |
| T2 | diffMerge 两处空行修复 | ✅ |
| T3 | diffMerge 回归测试 2 case | ✅ |
| T4 | dialog.ts 加"全部应用到右侧"按钮 | ✅ |
| T5 | dialog.ts 复制后滚动保护 | ✅ |
| T6 | 验证 build + test | ✅ |
| T7 | 三视角验证 | 🔄 |

详细: `.omc/plans/fullauto-impl.md`, spec: `.omc/fullauto/spec.md`

## 验收

- 桌面端:全部应用按钮可用,多 hunk 一键合并到右侧
- 桌面端:复制后右 textarea 滚动位置贴近新 caret
- 桌面端:含空行差异的 hunk 复制后空行正确插入/删除
- `npm run build` ✅ / `npm test` ✅
