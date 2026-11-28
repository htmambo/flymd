# 安全与性能加固第二轮（sec-perf-round2）

**状态**: ✅ 已完成 (开始时间: 2026-11-28，完成时间: 2026-11-28)
> 对应 fullauto 状态：.omc/fullauto/sec-perf-round2/state.json

## 任务目标

落实 2026-11-28 项目审计给出的高优先级建议：

1. 修复插件 invoke 命令黑名单与实际 Tauri 命令表失配的问题，并加契约测试防止再次漂移。
2. 对插件可调用的敏感命令做 Rust 侧参数校验（任意文件读、XML-RPC SSRF、git 恢复路径越界）。
3. 收紧 `opener:allow-open-path` 的 `**` 授权，改为受控的 `open_path_guarded`；外部链接交给系统浏览器；CSP 去掉 `img-src` 的裸 `http:`；预览图片补 `referrerpolicy`。
4. 输出更新链路签名评估（本轮只评估与文档化，不引入密钥体系）。
5. 性能项：PDF worker 去重、favicon 压缩、WebDAV 懒加载、Mermaid 预热。

## 问题分析

- `src/extensions/pluginHost.ts` 的 `PLUGIN_INVOKE_DENYLIST` 有 23 个条目对应的命令已不存在，而 `read_file_bytes_any`、`git_restore_file_version`、`http_xmlrpc_post` 等真实敏感命令未被拦截。且插件与主窗口同 realm，`window.__TAURI_INTERNALS__.invoke` 可绕过 JS 层名单——名单只能作为“防误用护栏”，真正的安全边界需要后续窗口/进程隔离。
- `http_xmlrpc_post` 未校验目标 URL，可被用作 SSRF；响应体无上限。
- `read_file_bytes_any` 无大小上限，可能一次性读入超大文件导致内存压力。
- `git_restore_file_version` 用 `strip_prefix().unwrap_or(&file)` 处理越界路径，缺少“目标必须在仓库内”的硬校验。
- `opener:allow-open-path` scope 为 `**`，等价于任意程序启动原语；预览外链用 `target="_blank"` 交给 WebView 打开远程页面。
- 构建产物中 PDF worker 同时以 `?worker` 与 `?url` 两份形式产出（约 1.5MB + 1.3MB）；`Flymdnew.png` 608KB 被当作 favicon；`webdavSync` 3.5k 行被静态导入入口。

## 子任务列表

- [x] T1 插件命令边界：实际命令清单分类 + 契约测试 + 文档更新
- [x] T2 Rust 校验：`read_file_bytes_any` 大小上限、`http_xmlrpc_post` SSRF/响应上限、`git_restore_file_version` 路径包含
- [x] T3 opener/CSP：`open_path_guarded` 命令 + 前端替换 + 外链 `openUrl` + CSP 收紧 + 图片 referrerpolicy
- [x] T4 更新链路签名评估文档
- [x] T5 性能：PDF worker 去重、favicon 压缩、WebDAV 懒加载、Mermaid 预热
- [x] T6 CI：Android 工作流补 `permissions: contents: read`

## 每个子任务的改动内容

T1：
- `src/extensions/pluginHost.ts`：把黑名单修正为实际内部命令；新增 `PLUGIN_INVOKE_PUBLIC_API` 显式公开集合；导出供测试使用。
- 新增 `src/extensions/pluginInvokeBoundary.test.ts`：解析 `generate_handler!` 与 `public/plugins/*/main.js`，断言命令分类完整、互斥、无幽灵条目，内置插件只用公开命令。
- 更新 `docs/security/plugin-invoke-boundary.md`。

T2：
- `src-tauri/src/main.rs`：`read_file_bytes_any` 增加 256MB 上限；`http_xmlrpc_post` 增加 URL 校验（http/https、拒绝 link-local/unspecified/metadata）与 8MB 响应上限；`git_restore_file_version` 使用 canonicalize 保证目标在仓库内。
- 在 main.rs 增加 `#[cfg(test)]` 纯函数测试。

T3：
- `src-tauri/src/main.rs`：新增 `open_path_guarded(path)`，目录与白名单扩展名可打开；安装包仅允许 Downloads/temp，且必须命中 `download_file` 登记的 SHA-256 并在打开前重新哈希（不含 html/htm/svg）。
- `src/core/openPathSafe.ts`：前端封装；替换 `main.ts`、`ui/updateOverlay.ts`、`exporters/pdfContextExport.ts` 的 `openPath`。
- `src-tauri/tauri.conf.json`：移除 `opener:allow-open-path`，CSP `img-src` 去掉 `http:`。
- `src/main.ts`：预览外链点击改为 `openUrl`。
- `src/core/previewDomEnhance.ts` + 测试：远程图片加 `referrerpolicy="no-referrer"`。

T4：
- 新增 `docs/security/update-signing-assessment.md`。

T5：
- 新增 `src/core/pdfWorker.ts`，替换 `outline.ts` 与 `pluginHost.ts` 的 worker 初始化。
- 生成小尺寸 favicon 并更新 `index.html`。
- `src/main.ts` 改用 `webdavSyncFacade`；门面补 `setSyncBlockReasonProvider`。
- `src/main.ts` 在检测到 mermaid 围栏时并行预热 `loadMermaid()`。

T6：
- `.github/workflows/android-build.yml` 顶部补 `permissions: contents: read`。

## 预期效果和验收标准

- `pnpm typecheck`、`pnpm test`、`pnpm build`、`cargo check --tests`、`cargo test` 全绿。
- 契约测试能枚举全部命令；删除/新增命令未分类时失败。
- 构建产物不再同时包含两份 PDF worker；favicon < 64KB；入口静态闭包不新增 Mermaid。
- 恶意/越界参数在 Rust 侧被拒绝，有单元测试覆盖。
- 现有内置插件（git-history、typecho、ai-novel、s3-gallery 等）使用的命令仍被归类为公开 API。

## 风险评估和缓解措施

- 收紧 `opener` 可能影响“导出后打开文件/文件夹”：用受控命令保留该能力，安装包限制在 Downloads/temp。
- 移除 `img-src http:` 可能导致内网 http 图片不显示：在文档中记录；HTTPS 与本地 `asset:` 不受影响。
- 插件边界仍是 JS 层护栏，可被 `__TAURI_INTERNALS__` 绕过：本轮明确文档化，不把名单当安全边界；隔离列为后续项。
- 更新签名本轮只评估，不改发布流程，避免无密钥环境下的不可验证改动。

## 实施顺序和依赖关系

T1 → T2 → T3（T2/T3 都改 main.rs，需串行）→ T4（纯文档）→ T5（与 T3 的 opener 替换无冲突）→ T6 → 全量验证。

## 阶段 0 输出（spec）

- 路径：`.omc/fullauto/sec-perf-round2/spec.md`
- 包含 `## Assumptions Made` / `## Decisions Made`

## 实施计划

- 路径：`.omc/plans/fullauto-sec-perf-round2-impl.md`

## 外部审核意见（Phase 1）

- provider: coding-bridge
- verdict: 未参与（API HTTP 429：Token Plan Person monthly quota limit exceeded；fallback codex 未连接）
- 处置：按 skill §4 失败兜底第 3 档记录，主流程不阻塞；以本地 typecheck/test/build/cargo 与独立 review agent 复核替代。

## QA 记录

- `pnpm typecheck`：通过
- `pnpm test`：94 文件 / 1167 用例通过
- `pnpm build`：通过；入口静态闭包 0.63MB，不含 yaml/diff/filetree/mermaid；PDF worker 只保留一份 `pdf.worker.min-*.js`（1.5MB）
- `cargo check --manifest-path src-tauri/Cargo.toml --tests`：通过
- `cargo test --manifest-path src-tauri/Cargo.toml`：40 unit + 15 integration 通过
- `cargo test --manifest-path mcp-server/Cargo.toml`：36 + 60 通过
- `git diff --check`：通过
- 产物：`dist` 24MB → 22MB；favicon 597KB → 4.9KB PNG / 15KB ICO

## 外部审核意见（Phase 4）

- 独立复核代理 1（代码质量）：REJECTED → 已修复并复跑。
  - 协议相对外链 `//evil.example` 会绕过拦截：新增 `normalizeExternalWebUrl`（`//` → `https://`）与 `isAbsoluteNonLocalHref`，所有非本地文档链接一律 `preventDefault`。
  - 契约测试行尾注释会漏掉下一条命令、Windows 路径不安全：改为逐行剥离 `//` 注释 + `fileURLToPath`，并新增解析器单测。
  - PDF worker 的 `?url` + module worker 未验证、`workerSrc` 回退后重复加载：改回项目既有 `?worker` 单路径，`hasPdfjsWorker` 同时接受 `workerSrc`。
  - `img-src` 去掉 `http:` 影响 dev 内网图：新增 `devCsp`（dev 保留 `http:`）。
  - DNS SSRF 残余、安装包路径未单测、Mermaid 预热失败不重试：分别增加初始请求 DNS 解析校验、`installer_path_allowed` 单测、失败重置预热标记。
- 独立复核代理 2（安全）：REJECTED → 已修复并复跑。
  - `open_path_guarded` 可直接执行未校验安装包：安装包分支改为必须命中 `download_file` 登记的 SHA-256，并在打开前重新哈希（TOCTOU）。
  - `git_restore_file_version` / `git_file_diff` 的 `commit` 可参数注入：新增 `valid_git_rev`（4-40 位十六进制）。
  - 元数据地址黑名单不全：补齐 Alibaba 100.100.100.200、Azure 168.63.129.16、Oracle 192.0.0.192、AWS IPv6 IMDS。
  - `.html/.htm/.svg` 可打开会新增脚本执行面：移出白名单。
  - CSP `http:` 回归：以 `devCsp` 解决 dev；release 仍只允许 https。
- Phase 1 外部审核：coding-bridge 429（月配额超限），codex 未连接，记录为未参与。
- Round 2：代码质量与安全代理均返回 APPROVED；非阻塞建议（哈希线程池、块注释解析、git rev 兼容性说明）已处理。

## 验收结论

全部子任务完成；本地门禁全绿（typecheck / 1167 vitest / build 入口闭包 / cargo 40+15 / mcp 36+60 / diff --check）。
构建产物 `dist` 24MB → 22MB，PDF worker 去重 1.3MB，favicon 597KB → 4.9KB。
残余风险（插件同 realm、fs scope `**`、更新无签名、DNS rebinding TOCTOU）已在 `docs/security/` 记录，列为后续项。
