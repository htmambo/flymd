# 性能优化批次 G 计划（预览 DOM 增强段抽取：外链/图片/懒加载）

**状态**: ✅ 已完成（完成时间: 2026-10-30）
**依据**: 批次 F 的后续（P0-7 路线图第二步：DOM 增强段在快照保护下抽出）
**前轮**: 批次 F（cd70bee，纯字符串管线已锁定）

## 任务目标

renderPreview 内的两段 DOM 遍历（`a[href]` 外链安全、`img[src]` 懒加载/资产路径/失败回退链）抽到 `src/core/previewDomEnhance.ts` 并用 jsdom 测试锁定。谓词函数（isPreviewHashLink / resolvePreviewLocalDocPath / resolveLocalImageAbsPathFromSrc / guessSyncedDocImageAbsPath / ensurePreviewHeadingIds）已在既有独立模块，本批只搬移消费循环：

1. **G1**: `enhancePreviewLinks(root, { currentFilePath })`——页内锚点与本地文档链接去 target/rel，外链补 `_blank + noopener noreferrer`（逐字搬移）
2. **G2**: `enhancePreviewImages(root, deps)`——非打印时补 `loading=lazy`；本地图片解析绝对路径 → `data-abs-path`/`data-raw-src` → `convertFileSrc` 资产 URL；失败回退链（同步设备路径重映射 → data: URL 兜底，含 MIME 映射表抽为纯函数 `mimeFromImagePath`）；wysiwyg 光标 nudging 留在 main.ts，经 `onImageRendered` 回调注入
3. **G3**: jsdom 测试——链接三类分支、lazy 属性、资产 URL 转换、错误→重映射→data URL 两级回退、MIME 映射表

**本批不做**：块级缓存本体、KaTeX 时间切片段、tasklist/callout 事件绑定段（与 main.ts 状态耦合深，留块级缓存批次一并处理）。

## 验证

五门禁 + 新增 jsdom 测试。Tauri API（convertFileSrc/exists/readFile）直连既有静态依赖（tauri chunk 本就在入口闭包），无闭包回归。

## 验证结果（2026-10-30）

- `tsc --noEmit`：0 错误
- `vitest run`：802/802（63 文件；新增 jsdom 测试 8 例）
- `npm run build`：成功，闭包门禁通过（convertFileSrc/exists/readFile 直连既有 tauri chunk，无闭包回归）
- `cargo check` / `cargo test`：31/31（本批无 Rust 改动，纪律性复跑）

## 实施记录

- main.ts 两段 DOM 遍历（~130 行）替换为 enhancePreviewLinks/enhancePreviewImages 调用；wysiwyg 光标 nudging 闭包经 onImageRendered 回调留在调用方
- 测试校准两处：isPreviewHashLink 实际在 core/previewAnchor（非 utils/previewPath）；jsdom 下 img.complete 恒为 false，回调走 load 监听路径（once 语义已锁定）
- 中途一次编辑事故（onImageRendered 占位残句 + 旧循环残留）在自查中当场发现并整段重写，未进入门禁

## 备注

- 本轮未经过 External Review MCP 审查（当前运行时未配置该 MCP）。
- P0-7 路线剩余：块级渲染缓存（源文本哈希 → HTML 复用）与可见区分块挂载——两段 DOM 增强已具备独立可测形态，可按块粒度接入。

## 风险与回滚

- 两段循环逐字搬移 + 行为锁测试；main.ts 只留调用与回调
- 回滚 = 还原 main.ts 两处调用 + 删新模块
