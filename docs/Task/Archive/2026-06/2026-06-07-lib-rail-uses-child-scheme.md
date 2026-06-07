# 库树连接线：rail 颜色从「父级 scheme」改为「子级 scheme」

| 字段 | 内容 |
|------|------|
| 创建日期 | 2026-06-07 |
| 责任人 | 果农 + Claude（协作）+ Codex 复审 |
| 状态 | ✅ 已完成 / 已验收(完成 2026-06-07) |
| 关联 | `LIB_TREE_DEPTH_STYLING_PLAN.md`（2026-06-04）、`2026-06-05-lib-icon-depth-color-cascade-fix.md` |

## 0. 任务背景

用户反馈（截图）：

> 截图里"笔记"下的红色 rail 一直贯穿到所有子级缩进区，但 2024-07-19 / 2024-08-31 等子级（绿色 scheme 2）实际位于"网络收藏"（绿色）下。竖线 rail 颜色=父级（绿），与子级自己（也绿/橙/蓝）不同色，看起来"无主"。
>
> 提议：**竖线 rail 颜色跟子级同色**——视觉上"那条 rail 就属于那一列子级"。

旧方案（父级色）的副作用：
- rail 颜色 = 父级行 scheme，但 stub（横线）= 子级 scheme → **同一缩进区里 rail 与 stub 颜色不连贯**
- 同父不同子时（如"网络收藏"下多个子文件夹），子级缩进区被同一根父级 rail 穿过 → **各子文件夹视觉上"挤在"同色 rail 下**，"父-子"分组感弱

新方案（子级色）：
- rail 颜色 = 第一个子节点 scheme（用 `:has()` 取）
- 兄弟子文件夹各有自己的 rail 颜色
- rail 与 stub 颜色**连贯**（都在子级缩进区里）
- 类比 VS Code 文件树缩进线

## 1. 实施步骤

### T1. 移除 `fileTree.ts:737` 的 `kids.dataset.scheme`
- 原因：不再需要把父级 scheme 写进 kids 容器
- 改为让 CSS 通过 `:has(> .lib-node[data-scheme="N"])` 自取子级 scheme
- 根行 kids（如"笔记"下的根 kids 容器，level=0 时由 lib-root 装）需要兜底：如果无子级，无影响；如有子级，按"第一个子节点 scheme"

### T2. 改 `style.css:2307-2311` rail 规则
- 删 `body.lib-color-depth .lib-children[data-scheme="N"]::before` 5 条
- 改为 `body.lib-color-depth .lib-children:has(> .lib-node[data-scheme="N"])::before` 5 条
- `:has()` 在所有现代浏览器（含 WebKitGTK）已支持
- 默认 background 仍为 `rgba(127,127,127,0.4)` 兜底

### T3. 调整注释
- `style.css:2294-2297` 注释从「rail 颜色 = 父级行颜色」改为「rail 颜色 = 第一个子节点 scheme」
- 关闭开关时的兜底行为不变

### T4. 验证
- `npm run build` 通过
- `npm test` 139/139
- 用户在 5+ 级嵌套下逐级目视确认

## 2. 风险评估

| 风险 | 缓解 |
|---|---|
| `:has()` 在老 WebKit 不支持 | 当前目标是 Tauri 2 + WebKitGTK 现代版，已支持；如未来需要兼容可降级到 JS 注入 |
| 空目录下 kids 容器无子级 → 选不中任何 `:has` → 走默认灰 | 默认 background 仍是中性灰，符合"无子级无配色"语义 |
| 根行"笔记"的 kids 容器（装 level=1 子级） | `:has(> .lib-node[data-scheme="1"])` → 红，OK |

## 3. 验收标准

- [x] rail 颜色 = 第一个子节点 scheme（`:has(> .lib-node[data-scheme=N])` 取首子）
- [x] rail 与 stub 同色（缩进区里 rail 和子节点前横线视觉上是同一根线）
- [x] 关闭"彩色库树"开关后，回退到中性灰
- [x] build + test 全绿（`npm run build` 28.64s ✅ exit 0；`npm test` 139/139 ✅）
- [x] codex 复审：R1 发现根容器 line 1238 残留 `dataset.scheme='1'`（已删）；R2 误报「根行 scheme=1 与根 rail scheme=2 不连贯」——经评估属过度一致追求，REJECT（根行只有 1 个，根 rail 不连贯只发生在树最顶端，对可读性影响极小；强行修会破坏 `(level%5)+1` 公式或增加复杂度）

## 4. 提交

- 待 git commit（不 push，等用户确认）
