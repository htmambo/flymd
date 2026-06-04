**状态**: 🔄 进行中 (开始时间: 2026-06-04)

# 库树结构样式分级化(彩虹色循环 + 文件夹展开图标更亮)

## 背景

用户反馈"库"树视觉层次感不足,要求:

1. **不同深度的文件夹 + 连接线使用不同颜色**:彩虹色循环,即使重复也因层级间隔能区分
2. **文件夹打开的图标比打开前更亮**:用于区分展开/收起

## 现状(同前)

- `buildDir` 递归构建,DOM 嵌套即层级
- 连接线 = CSS 伪元素,统一灰色
- depth 信息**缺失** — DOM 上无 `data-depth` / `data-level`
- 文件夹图标:关闭=`--muted`,打开=`--accent`

## 实施方案:彩虹循环 + 最小 JS 改动

### 1. JS:`buildDir` 给每行写 `data-depth`

`fileTree.ts:705` `buildDir` 加 `level: number = 0` 参数;在 `row` 上 `row.dataset.depth = String(level)`;递归时 `+1`。

调用点(5 处):
- `renderRoot` 创建的 `topRow` = `data-depth="0"`
- `buildDir` 5 个调用点(line 343/736/754/1233/1299)都需传 level

### 2. CSS:6 色调色板(2 阶循环)

6 色 Tailwind 500 调色板(亮色模式用),暗色模式用 400 调色板(略浅以适配深色背景):

```css
:root {
  --lib-depth-0: #ef4444;  /* red-500 */
  --lib-depth-1: #f97316;  /* orange-500 */
  --lib-depth-2: #eab308;  /* yellow-500 */
  --lib-depth-3: #22c55e;  /* green-500 */
  --lib-depth-4: #3b82f6;  /* blue-500 */
  --lib-depth-5: #a855f7;  /* violet-500 */
  /* 2 阶循环 */
  --lib-depth-6: var(--lib-depth-0);
  --lib-depth-7: var(--lib-depth-1);
  --lib-depth-8: var(--lib-depth-2);
  --lib-depth-9: var(--lib-depth-3);
  --lib-depth-10: var(--lib-depth-4);
  --lib-depth-11: var(--lib-depth-5);
}
```

### 3. CSS:`[data-depth="N"]` 选择器,12 阶完整循环

```css
/* 关闭文件夹图标:每个深度一个色 */
[data-depth="0"] .lib-ico-folder { color: var(--lib-depth-0); }
[data-depth="1"] .lib-ico-folder { color: var(--lib-depth-1); }
/* ... */
/* 打开文件夹图标:同色 + filter 提亮 */
[data-depth="0"] .lib-ico-folder-open { color: var(--lib-depth-0); filter: brightness(1.25); }
/* ... */
/* 连接线 rail / 横线 stub / 桥接竖线:每个深度一个色 */
[data-depth="0"] .lib-children::before { background: var(--lib-depth-0); }
[data-depth="1"] .lib-children::before { background: var(--lib-depth-1); }
/* ... */
```

12 阶之后兜底为 `--lib-depth-5`(紫)。

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
| T1 | style.css: 新增 6 色调色板(亮/暗模式 + body.light-mode) | ✅ |
| T2 | style.css: 12 阶 `[data-depth="N"]` 规则(连接线 + 文件夹图标) | ✅ |
| T3 | fileTree.ts: buildDir 加 level 参数,row 写 data-depth | ✅ |
| T4 | build + test 验证 | ✅ |

## 修复历史

- **v1(commit 2abd243)** — 用 color-mix() 实现,WebKitGTK 不支持,用户截图无视觉变化
- **v2(当前)** — 改用彩虹循环调色板 + 最小 JS 改动(`buildDir` 写 `data-depth` 属性),CSS 用 `[data-depth="N"]` 选择器,12 阶循环,深树仍可辨
