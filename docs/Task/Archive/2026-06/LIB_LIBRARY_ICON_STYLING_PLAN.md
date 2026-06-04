**状态**: ✅ 已完成 (完成时间: 2026-06-04)
**创建人**: 果农
**范围**: src/style.css

## 目标

补完库树首页(根行)Home 图标 `.lib-ico-library` 在 scheme 配色方案下的样式,使其在彩色库树模式下与子文件夹色系一致,不再显得突兀。

## 现状分析

- 根行 `renderRoot` 调 `makeFolderIcon(root, true)`,分支返回 `makeLibrarySvg()`(Lucide home 房子图标,class `lib-ico-library`)
- 根行 `data-scheme="1"` 已在 `fileTree.ts:1230` 写入
- 现有 `.lib-ico-folder` / `.lib-ico-folder-open` 各 5 条 scheme 规则(scope `body.lib-color-depth`),直接对 path 写 `stroke: var(--lib-color-N)`,绕开 WebKitGTK SVG currentColor 链断
- **缺漏**:`.lib-ico-library` 没有任何 scheme 规则,根行图标停在 `var(--muted)` 灰色,与下方彩虹子文件夹对比明显,被反馈"突兀"

## 子任务清单

- [x] **T1** style.css: 新增 5 条 `.lib-ico-library` scheme 规则(scope `body.lib-color-depth`),与 `.lib-ico-folder` 结构对称
- [x] **T2** 验证: `npm run build` ✅(18.91s) + `npm test` 139/139 ✅(2 个 fail suite 是 web/server 预存模块加载问题,与本次无关)
- [x] **T3** 归档: Active → Archive/2026-06 + 更新 README 索引
- 提交: `b1e04d6`

## 验收标准

1. 开启"彩色库树"开关时,根行 home 图标颜色与该行下首层子文件夹的方案 1 颜色一致
2. 关闭"彩色库树"开关时,根行 home 图标回退到 `var(--muted)`(原配色)
3. hover/selected 状态下走 `--fg`(由现有 `.library .lib-node:hover .lib-ico` / `.library .lib-node.selected .lib-ico` 兜底,无需新规则)
4. 不影响其他图标(file/pdf/folder/folder-open)
5. `npm run build` 与 `npm test` 全绿

## 风险与回滚

- **风险**: 5 条规则中只有 `data-scheme="1"` 实际命中(根行 scheme 永远为 1),其余 4 条为对称占位 → 极低风险,与其他图标规则保持一致的写法,可读性更好
- **回滚**: `git revert <commit>` 即可,改动仅 5 行 CSS

## 工时估算

S(单文件 + 5 行 CSS + 文档)

## 备注

本次是 LIB_COLOR_DEPTH_TOGGLE_PLAN 的一处漏网之鱼(同次提交未覆盖 home 图标),用户实测发现后补完。
