**状态**: 🔄 进行中 (开始时间: 2026-06-04)

# 库树结构样式分级化(连接线按 depth 切 alpha + 文件夹展开图标更亮)

## 背景

用户反馈"库"树视觉层次感不足:

1. **连接线无层次**:所有 `.lib-children::before`(竖线 rail)/ `.lib-children > .lib-node::before`(横线 stub)/ `.lib-node.expanded::after`(展开桥接竖线)都用同一颜色 `rgba(127,127,127,0.4)`,深层的子目录连接线和浅层无视觉差异,树的"深度感"完全靠缩进表达
2. **文件夹展开/收起视觉差异不够**:当前展开图标用 `--accent`,但与收起态的 `--muted` 对比不够强烈,user 希望"打开的图标比打开前要亮一些,这样可以区别一下"

## 现状

`src/fileTree.ts:705-758` 的 `buildDir` 递归构建,DOM 结构:

```
.lib-node.lib-dir(根, level=0)
└── .lib-children(level=1)
    ├── .lib-node.lib-dir(level=1)
    │   └── .lib-children(level=2)
    │       └── .lib-node.lib-file(level=2)
    └── .lib-node.lib-file(level=1)
```

- 连接线 = CSS 伪元素(无 JS/SVG),3 处统一 `rgba(127,127,127,0.4)`
- `--tree-line-height` 由 `updateTreeLine` / `updateAllTreeLines`(line 1173-1199)量算,只控制竖线高度
- depth 信息**缺失** — DOM 上无 `data-depth` / `data-level`,仅隐式在 DOM 嵌套层级里
- 文件夹图标:
  - 关闭:`.lib-ico { color: var(--muted); }`(style.css:2308)
  - 打开:`.lib-ico-folder-open { color: var(--accent); }`(line 2313)
  - hover/selected 仍保持 `--accent`
- 暗色模式兜底:`body.dark-mode [class*="lib-"]`(line 6772)覆盖子元素,不影响伪元素

## 实施方案(A 档 + 文件夹亮化,纯 CSS)

### 1. CSS:连接线按 DOM 嵌套层级切 alpha(无需 JS 改)

利用 `.lib-children` 的天然 DOM 嵌套表达层级,用祖先选择器分级设色:

```css
/* 0 阶(根目录的子层):最深 */
.library .lib-children::before { background: rgba(127,127,127, 0.4); }
/* 1 阶(根 .lib-children 内嵌的 .lib-children) */
.library .lib-children .lib-children::before { background: rgba(127,127,127, 0.32); }
/* 2 阶 */
.library .lib-children .lib-children .lib-children::before { background: rgba(127,127,127, 0.26); }
/* 3 阶 */
.library .lib-children .lib-children .lib-children .lib-children::before { background: rgba(127,127,127, 0.22); }
/* 4 阶及更深:兜底 */
.library .lib-children .lib-children .lib-children .lib-children .lib-children::before { background: rgba(127,127,127, 0.20); }
```

3 个伪元素(`.lib-children::before` 竖线 / `.lib-children > .lib-node::before` 横线 / `.lib-node.expanded::after` 桥接)同样分级。`--tree-line-height` 行为不变,继续由 JS 量算。

> 收益:零 JS 改动、零性能开销;DOM 嵌套即层级,不会失同步。

### 2. CSS:文件夹展开图标亮化

```css
/* 关闭:往背景色压 25%,让"收起"更中性 */
.library .lib-ico-folder { color: color-mix(in srgb, var(--muted), var(--bg) 25%); }
/* 打开:在 --accent 基础上往白色提 20%,强化"展开"焦点 */
.library .lib-ico-folder-open { color: color-mix(in srgb, var(--accent), white 20%); }
```

```css
/* 关闭:略压低(往背景色混合 25%),突出"收起"中性态 */
.library .lib-ico-folder { color: color-mix(in srgb, var(--muted), var(--bg) 25%); }
/* 打开:在 --accent 基础上提亮(往白色混合 20%),强化"展开"焦点 */
.library .lib-ico-folder-open { color: color-mix(in srgb, var(--accent), white 20%); }
```

hover/selected 沿用现有规则(覆盖到 `--accent`),不受影响 — 因为 specificity 一致时后定义覆盖。

### 4. 暗色模式适配

`body.dark-mode` 下重新定义 `--bg` / `--muted` 已由 theme 处理,`color-mix` 自动跟随;无需额外代码。

### 5. 风险缓解

- **alpha 不够层次**:5 阶(0.4/0.32/0.26/0.22/0.20),再深兜底 0.18
- **color-mix 兼容性**:Chrome 111+/Safari 16.2+/Firefox 113+ — 覆盖本项目目标平台
- **DOM 嵌套过深**:树深 > 5 层少见,5 层后用兜底值

## 验收

- [ ] buildDir 在每行写入 `--depth` 属性
- [ ] 浅层 vs 深层 rail 视觉上 alpha 不同(浏览器 DevTools 可查)
- [ ] 关闭文件夹图标比当前略压暗
- [ ] 打开文件夹图标明显比关闭态亮
- [ ] hover/selected 仍走 `--accent`(不受影响)
- [ ] 暗色模式下对比仍清晰
- [ ] `npm run build` ✅
- [ ] `npm test` 不退化(本次无逻辑改动)

## 实施计划

| # | 任务 | 状态 |
|---|------|------|
| T1 | style.css: 3 个伪元素按 DOM 嵌套层级切 alpha(5 阶) | ✅ |
| T2 | style.css: 文件夹关闭/打开图标 color-mix 调整 | ✅ |
| T3 | build 验证 | ✅ |
