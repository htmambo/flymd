# 插件 invoke 安全边界（2026-09）

## 背景

`3f0bf6f perf(startup): 大库场景下启动期主线程让出与整树文档预扫描` 引入了 `scan_dirs_doc_presence`
等内部命令供主应用使用，但插件运行时通过 `ctx.invoke(cmd, args)` 调用 Tauri 命令是 **raw 暴露**——
等价于让插件以应用权限执行任意命令。

## 威胁模型

| 威胁 | 攻击面 | 后果 |
|---|---|---|
| 任意文件读取 | `read_text_file_any`、`stat_any`、`list_dir_any` | 信息泄露 |
| 任意文件写/删 | `write_file_atomic`、`force_remove_path`、`move_to_trash` | 持久破坏 |
| 整树扫描 | `scan_dirs_doc_presence` | 性能/隐私 |
| 上传图床管理 | `flymd_record/list/delete_uploaded_image`、`flymd_piclist_upload` | 越权删除 |
| 列表/搜索 | `flymd_list_markdown_files`、`flymd_search_files_content` | 元数据泄露 |
| 办公文档 | `office_to_markdown`、`office_supported` | 子进程启动 |
| Git 操作 | `git_status/diff/log/commit/pull/push/...` | 仓库篡改 |
| 内部 HTTP | `http_request`、`http_upload`、`http_download` | 网络通道 |
| AI 调用 | `ai_novel_api` | API 配额滥用 |

## 防御模型：denylist 黑名单

由于插件 API 已稳定且第三方插件可能依赖某些命令，**不引入 allowlist（白名单）**。
新增 denylist 集中拦截"内部/敏感"命令，列入 8 类共 28 项。

实现位置：`src/extensions/pluginHost.ts` 顶部 `PLUGIN_INVOKE_DENYLIST` + `pluginInvoke()`。

两处暴露点（运行时 ctx L1028 / 插件设置 ctx L2620）已统一替换。

## 未来工作

**真正的纵深防御仍在 Rust 端 scope 校验**——denylist 是黑名单模型，新增内部命令时
**必须**同步更新本表。后续可：

1. 在 Tauri command 宏层加权限（`#[tauri::command(rename_all = "snake_case")]` + 权限 attribute）
2. 在 Rust 端 `scan_dirs_doc_presence` 顶部校验 root 是否在 `app_data_dir` / `app_local_data_dir` / `app_config_dir` 之一内
3. 用 `cfg!(target_os = "windows" || target_os = "macos")` 权威返回当前进程的"默认 FS"取代前端启发式大小写检测

## 单元测试覆盖

`src/fileTreePathKey.test.ts`（15 用例）覆盖 denylist 周边路径归一与段级前缀匹配。
`src-tauri/tests/scan_dirs_doc_presence.rs`（11 用例）覆盖后端命令语义。
