# 插件 invoke 安全边界（2026-11 修订）

## 结论先行

`ctx.invoke` 上的命令名单是**防误用护栏，不是安全边界**。插件代码以 Blob URL 的 ESM 形式运行在
主窗口同一 realm，可以直接调用 `window.__TAURI_INTERNALS__.invoke(...)`，绕过 `pluginInvoke` 的任何判断。
因此本文档描述的是“减少事故面”，而不是“隔离恶意插件”。真正的隔离方案见文末「后续方向」。

## 背景

`src/extensions/pluginHost.ts` 通过 `pluginInvoke(cmd, args)` 包装 `ctx.invoke`：

- `PLUGIN_INVOKE_DENYLIST`：应用内部命令，插件一律不可调用；
- `PLUGIN_INVOKE_PUBLIC_API`：显式列出的插件公开 API；
- 两者必须互斥，并集等于 `src-tauri/src/main.rs` 中 `generate_handler!` 注册的全部命令。

2026-11-28 审计发现旧名单有 23 个条目对应的命令早已不存在，同时 `read_file_bytes_any`、
`git_restore_file_version`、`http_xmlrpc_post` 等真实敏感命令未被拦截。本轮按真实命令表重建了分类，
并增加契约测试防止再次漂移。

## 命令分类（唯一事实源）

以代码为准：

- 内部命令：`src/extensions/pluginHost.ts` 的 `PLUGIN_INVOKE_DENYLIST`
  —— `move_to_trash`、`write_file_atomic`、文件锁四件套、`scan_dirs_doc_presence`、
  `flymd_search_files_content`、`check_update`、`download_file`、`run_installer`、
  `ai_guard_*`、`set_network_proxy`、`office_*`、`docx_to_markdown`、
  `read_file_bytes_any`、`open_path_guarded`。
- 公开 API：`PLUGIN_INVOKE_PUBLIC_API`。官方插件（`public/plugins/*`）实际依赖的
  `read_text_file_any`、`write_text_file_any`、`force_remove_path`、`list_dir_any`、`git_*`、
  `http_xmlrpc_post`、`upload_to_s3`、`flymd_imgla_*` 等均在此列。

契约测试 `src/extensions/pluginInvokeBoundary.test.ts` 断言：

1. 两份名单互斥；
2. 并集等于 `generate_handler!` 的真实命令集合（新增/删除命令未分类即失败）；
3. `public/plugins/*/main.js` 中 `context.invoke('...')` 用到的真实命令必须属于公开 API。

## 本轮新增的 Rust 侧硬化

即使名单被绕过，以下命令本身也收紧了参数：

- `read_file_bytes_any`：256MB 上限，metadata 预检 + `take(MAX+1)` 防追加竞态。
- `http_xmlrpc_post`：仅 http/https；拒绝 link-local、0.0.0.0/8、Azure/Alibaba/Oracle/AWS
  等云元数据地址；流式读取，响应体上限 8MB；初始主机名做 DNS 解析校验，独立 client 在每一跳
  重定向上重新校验（阻断 302 → 169.254.169.254）。私网/回环保留（Typecho 自托管场景）。
  残余：解析结果未锁定，重定向跳只做字面量校验，DNS rebinding TOCTOU 需 IP 锁定才能根治。
- `git_restore_file_version`：canonicalize 后强制目标位于仓库内，拒绝越界与 symlink 逃逸。
- `git_restore_file_version` / `git_file_diff`：`commit` 只接受 4-40 位十六进制，阻断
  `--output=/path` 之类借 `git show` 写仓库外文件的参数注入。
- `open_path_guarded`：前端文件/目录打开的唯一入口，扩展名白名单（不含 html/htm/svg）；
  安装包仅限 Downloads/temp，且必须命中 `download_file` 登记的 SHA-256 并在打开前重新哈希。

> 兼容性提醒：`git_restore_file_version` / `git_file_diff` 的 `commit` 现在只接受 4-40 位十六进制。
> 从历史列表拿到完整 hash 的插件（官方 git-history）不受影响；若第三方插件传 `HEAD` 或分支名，
> 需要改为传 hash。

## 为什么仍然不是安全边界

1. 同 realm：插件 ESM 可直接访问 `window.__TAURI_INTERNALS__`、`document`、`fetch`。
2. capability 仍给主窗口 `fs:allow-*` 且 scope 为 `"**"`，`assetProtocol.scope` 也是 `"**"`。
3. 插件从市场/GitHub 安装，无签名或内容哈希校验。
4. 公开 API 里的 `read_text_file_any` / `write_text_file_any` / `force_remove_path` 本身就是大权限；
   官方插件依赖它们，短期无法移除。

## 后续方向（按收益排序）

1. **窗口/进程隔离**：插件运行在独立 Webview 或 sidecar 进程，只通过消息桥调用宿主白名单方法；
   主窗口 capability 不再授予 `**` 文件权限。
2. **签名与固定版本**：插件市场索引增加内容哈希，安装时校验；官方插件用发布密钥签名。
3. **按库根动态授权**：用 Tauri scope 运行时 API 替代 `"**"`，只放行用户主动打开的库目录。
4. 若短期无法隔离，至少在安装确认里明确提示“该扩展将以应用权限读写本机文件”。

## 验证

- `pnpm vitest run src/extensions/pluginInvokeBoundary.test.ts`
- `cargo test --manifest-path src-tauri/Cargo.toml hardening_round2_tests`
