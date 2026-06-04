**状态**: ✅ 已完成 (完成时间: 2026-06-04)

# 库树彩虹色开关(主题设置)— scheme 索引方案

## 背景

v4 修复后库树默认按层级显彩虹色。用户希望:
1. 在主题设置面板加开关,默认开启
2. 关闭时库树回退到原配色(灰线 + 灰图标)
3. 设计上更优雅:用 scheme 索引代替硬编码 12 阶循环

## 现状(同前)

- 36+ 条 depth-based 颜色规则硬编码 12 阶,verbose 且不可关闭
- 主题设置面板已有 8 个开关,模式成熟

## 实施方案:scheme 索引 + 6 变量

### 配色方案定义

共 6 个 scheme 变量(scheme 0 是原配色兜底):

| scheme | 角色 | 浅色 | 暗色 |
|--------|------|------|------|
| 0 | 原配色(--muted/--accent) | gray-500 | gray-400 |
| 1 | 彩虹 1 | red-500 | red-400 |
| 2 | 彩虹 2 | orange-500 | orange-400 |
| 3 | 彩虹 3 | yellow-500 | yellow-400 |
| 4 | 彩虹 4 | green-500 | green-400 |
| 5 | 彩虹 5 | blue-500 | blue-400 |

### 1. JS:scheme 由 depth 算出

`fileTree.ts:buildDir` 在 `row` 上同时写 `data-scheme`:

```ts
const scheme = ((level % 5) + 1)
;(row as any).dataset.scheme = String(scheme)
;(kids as any).dataset.scheme = String(scheme)  // kids 继承父 scheme
```

5 个 scheme 规则,深度 5+ 自动循环回 1。`data-depth` 保留(行布局仍可用)。

### 2. CSS:6 变量 + 5 阶 scheme

```css
:root {
  --lib-color-0: var(--muted);      /* 原配色兜底 */
  --lib-color-1: #ef4444;            /* red-500 */
  --lib-color-2: #f97316;            /* orange-500 */
  --lib-color-3: #eab308;            /* yellow-500 */
  --lib-color-4: #22c55e;            /* green-500 */
  --lib-color-5: #3b82f6;            /* blue-500 */
}
/* 暗色模式 400 调色板 */
@media (prefers-color-scheme: dark) { :root:not(.light-mode) { ... } }
body.light-mode { ... 500 ... }
```

### 3. CSS:rules 用 `[data-scheme="N"]` 选择器

每种元素 5 条规则(scope 到 `body.lib-color-depth`):

```css
body.lib-color-depth [data-scheme="1"] .lib-ico-folder path { stroke: var(--lib-color-1); }
body.lib-color-depth [data-scheme="2"] .lib-ico-folder path { stroke: var(--lib-color-2); }
body.lib-color-depth [data-scheme="3"] .lib-ico-folder path { stroke: var(--lib-color-3); }
body.lib-color-depth [data-scheme="4"] .lib-ico-folder path { stroke: var(--lib-color-4); }
body.lib-color-depth [data-scheme="5"] .lib-ico-folder path { stroke: var(--lib-color-5); }
```

5 × 4(rails/stubs/bridges/closed-folder)+ 5(open-folder stroke/fill)+ 5(open-filter)= **30 条规则**(原 12 阶 × 3 = 36 反而更少)

### 4. theme.ts:加开关

- `LIB_COLOR_DEPTH_KEY = 'flymd:lib:colorDepth'`
- `getLibColorDepthEnabled()` — 默认 `true`
- `setLibColorDepthEnabled(enabled)` — 写 localStorage + 切 `body.lib-color-depth` class
- 启动时 `applySavedTheme()` 调 `setLibColorDepthEnabled(getLibColorDepthEnabled())` 应用 class
- 面板加 toggle,事件回调 `setLibColorDepthEnabled(checked)`

### 5. 关闭 toggle 行为

- body 无 `lib-color-depth` class
- 5 条 scheme 规则全不生效
- `.library .lib-ico { color: var(--muted) }` 自动接管图标(已存在)
- 原 `.library .lib-children::before` 默认 `rgba(127,127,127, 0.4)` 接管(已存在)
- 文件夹打开态:加回 `.library .lib-ico-folder-open { color: var(--accent) }`(008ce14 的原规则)

## 风险与缓解

- **JS 算 scheme 边界**:`(level % 5) + 1` 永远返回 1-5,depth 0-4 严格映射,depth 5+ 循环
- **class 切换时机**:在 `applySavedTheme()` 调用,body 已存在,无 race
- **DOM 不重渲染**:CSS 切换即时生效
- **data-scheme 命名**:与 data-depth 风格一致,便于未来扩展

## 验收

- [ ] 默认开启:刷新应用,库树显彩虹色
- [ ] 关闭开关:库树回退灰线 + 灰图标
- [ ] 重新开启:恢复彩虹色
- [ ] 持久化:重启应用,设置保持
- [ ] 暗色/亮色模式兼容
- [ ] 深度 0-4:5 种不同颜色
- [ ] 深度 5+:循环回 scheme 1
- [ ] `npm run build` ✅
- [ ] `npm test` 139/139 ✅

## 实施计划

| # | 任务 | 状态 |
|---|------|------|
| T1 | i18n: 加 `theme.libColorDepth` zh + en | ✅ |
| T2 | fileTree.ts: 算 scheme,row + kids 写 data-scheme | ✅ |
| T3 | style.css: 6 变量 + 5 阶 scheme 规则(scope body.lib-color-depth)+ 原配色 fallback | ✅ |
| T4 | theme.ts: 加 localStorage 读写 + body class + toggle UI | ✅ |
| T5 | build + test 验证 | ✅ |

## 验收

- [x] 默认开启:刷新应用,库树显彩虹色
- [x] 关闭开关:库树回退灰线 + 灰图标
- [x] 重新开启:恢复彩虹色
- [x] 持久化:重启应用,设置保持
- [x] 暗色/亮色模式兼容(各自 400/500 调色板)
- [x] 深度 0-4:5 种不同颜色
- [x] 深度 5+:循环回 scheme 1(JS 算 (level%5)+1)
- [x] `npm run build` ✅
- [x] `npm test` 139/139 ✅

## 提交

- `a5af81c` — feat(library): 主题设置加"彩色库树"开关(默认开启,scheme 索引方案)
