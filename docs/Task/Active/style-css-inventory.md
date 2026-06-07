# style.css 注释段清单（E1 调研产物）

> **生成时间**：2026-06-07
> **目的**：Phase B（style.css 拆分）E1 子任务输出
> **依据**：`grep` 统计 `src/style.css` 当前 9,329 行

## 1. 体量与密度

| 指标 | 数值 |
|---|---|
| 总行数 | 9,329 |
| 大注释段（`===` 风格） | 26 段 |
| 变量定义段起点 | line 37 |

## 2. 26 段注释分布

| 行号 | 主题 | 估算行数 | 拆分目标 |
|---|---|---|---|
| 37 | 设计系统变量 | ~270 | `base.css` + `theme-light.css` + `theme-dark.css` |
| 305 | Ribbon 库切换区 | ~92 | `library.css` |
| 397 | 滚动条自动隐藏 | ~1895 | `scrollbar.css` (新增) |
| 2292 | 库树连接线 | ~50 | `library.css` |
| 4110 | 扩展菜单管理器 | ~467 | `extensions.css` (新增) |
| 4577 | UI 美化补充 | ~203 | `library.css` |
| 4780 | 全局滚动控制 | ~544 | `scrollbar.css` |
| 5324 | Markdown 代码渲染 | ~436 | `preview.css` |
| 5760 | 代码块装饰 | ~139 | `preview.css` |
| 5899 | 行距优化 | ~225 | `preview.css` |
| 6124 | 同步日志类型 | ~158 | `extensions.css` |
| 6282 | 打印样式 | ~119 | `print.css` (新增) |
| 6401 | 视觉增强 | ~138 | `base.css` |
| 6539 | 更新弹窗 | ~71 | `dialog.css` |
| 6610 | 查找替换 | ~137 | `dialog.css` |
| 6747 | 夜间模式 | ~654 | `theme-dark.css` + `body.dark-mode` 分散到各主题 |
| 7401 | 右键菜单 | ~229 | `dialog.css` |
| 7632 | 专注模式 | ~132 | `focus-mode.css` |
| 7766 | 自定义标题栏 | ~160 | `window.css` (新增) |
| 8261 | 便签模式控制 | ~121 | `sticky-note.css` |
| 8382 | 便签透明窗口 | ~267 | `sticky-note.css` |
| 8649 | 便签待办项 | ~191 | `sticky-note.css` |
| 8840 | (待识别) | ~126 | 待定 |
| 8966 | Obsidian Callout | ~363 | `preview.css` |

> 8840 处行号对应的标题未匹配到，是另一个 `========` 段。补充识别。

## 3. 拆分草案

```
src/styles/
├── base.css              # 设计系统变量 + 复位 + 字体 (~270 行)
├── theme-light.css       # 亮色主题变量 (~80 行)
├── theme-dark.css        # 暗色主题变量 + body.dark-mode 全部 (~700 行)
├── scrollbar.css         # 滚动条 + 全局滚动控制 (~2500 行)
├── library.css           # 库侧栏 / 文件树 / Ribbon / UI 增强 (~345 行)
├── extensions.css        # 扩展菜单管理器 + 同步日志 (~625 行)
├── preview.css           # 阅读模式 + Callout + 代码块 + 行距 (~1000 行)
├── editor.css            # 源码模式 + WYSIWYG (~1200 行) [需 E1.2 细化]
├── dialog.css            # 弹窗 / 命令面板 / 设置 / 右键菜单 (~500 行)
├── focus-mode.css        # 专注模式 (~130 行)
├── sticky-note.css       # 便签模式 (~580 行)
├── window.css            # 自定义标题栏 + 窗口样式 (~160 行)
├── print.css             # 打印样式 (~120 行)
├── mobile.css            # 移动端（保留独立）
└── index.css             # 仅做 @import 编排
```

## 4. 风险点

1. **CSS 顺序敏感**：当前 9,329 行按特定顺序覆盖；拆分后 `@import` 顺序必须保持
2. **变量定义依赖**：所有段都引用 `:root` / `body.dark-mode` / `body.light-mode` 里的 CSS 变量，base + theme 必须**最先 import**
3. **特异性敏感**：一些规则用 `body.dark-mode .xxx` 强特异性；拆分后跨文件特异性不变（CSS 是全局作用域）
4. **生产环境 CSS 合并**：Vite 会把 `@import` 内联到生产 bundle，对产物体积无影响

## 5. 下一步行动

1. **E1.2** 补全 8840 行的注释段识别
2. **E1.3** 列出 26 段中所有用 `!important` 的规则（高优先级，迁移需小心）
3. **E1.4** 列出 26 段中所有 `body.dark-mode` 强特异性规则（分散到各主题文件的归属判断）
4. **E2** 严格按"基→主题→通用"顺序逐组迁移

## 6. 拆分执行顺序

```
E1 调研  ✅ (本文件)
  ↓
E1.2 补全 8840 / E1.3 important 规则清单 / E1.4 dark-mode 归属
  ↓
E2.1  base.css + theme-light.css + theme-dark.css 提取（最先做，被全部依赖）
  ↓
E2.2  通用 scrollbar / library / dialog / extensions 提取
  ↓
E2.3  模式相关 preview / editor / wysiwyg 提取
  ↓
E2.4  场景相关 focus-mode / sticky-note / print 提取
  ↓
E3 style.css 收敛为仅 @import 'styles/index.css'
  ↓
E4 视觉回归验证（5 主题 × 3 模式 × 2 OS）
```
