# 性能优化实施计划（启动速度 + 运行效率）

**状态**: ✅ 已完成 (完成时间: 2026-10-18)
> 对应 fullauto 状态：.omc/fullauto/perf-2026-10/（state.json 已按归档协议删除，spec/validation 保留审计）
> 分析依据：docs/Analysis/PERFORMANCE_ANALYSIS_2026-10.md

## 任务目标

基于 2026-10-18 完成的性能分析，落地实施其中「批次 1-5 的安全子集 + 快赢项」，覆盖：

1. 启动速度：窗口 reveal 提前、非 Windows 窗口显示时机对齐、yaml/diff 移出 preload 集合、启动期重复 IPC 合并
2. 运行效率：watch 事件全树重扫改为前缀增量失效、renderPreview 链路收敛、mermaid 并发渲染、所见/分屏滚动与缓存快赢项
3. 后端效率：S3 client 缓存、共享 reqwest client、ai_novel 阻塞 sleep 改异步

明确排除（留后续任务）：fileTree 异步门面、prewarmExtensionsPanel 行为变更、所见模式 markdownUpdated 合并与 math 局部重解析（批次6）、预览块级缓存/虚拟化、watch 单路合并、localStorage 会话保存改造。

## 问题分析

详见 docs/Analysis/PERFORMANCE_ANALYSIS_2026-10.md。要点：

- P0 首帧时刻被串行 await 链卡住（main.ts 启动 IIFE），且非 Windows 平台 Rust setup() 提前 show 使前端 reveal 设计落空
- P0 库内任何文件变动触发 `scan_dirs_doc_presence` 全树重扫，且 prefetch 在树渲染关键路径上
- P0 预览全量渲染无增量；所见模式每击键全文序列化 + 多趟全文处理
- P1 S3 命令每次重跑 aws-config provider 链；reqwest client 每命令新建
- P2/P3 快赢：dotBlink 空转 interval、_pdfOutlineCache 无上限、scanTaskList 无条件全扫、decorateCodeBlocks 冗余二次调用、mermaid 顺序 await、分屏滚动同步无 rAF

## 子任务列表

- [ ] **T1 启动链路重构**（main.ts）：reveal 提前 + 重复 IPC 合并 + recent 校验并行 + 启动写盘延后
- [ ] **T2 入口减负**（main.ts / frontMatter.ts / dialog.ts / diffMerge 调用点）：yaml/diff 动态 import，frontMatter 拆分为字符串模块 + yaml 模块
- [ ] **T3 watch 增量失效**（fileTree.ts）：事件路径前缀失效 + prefetch 移出渲染关键路径
- [ ] **T4 渲染链路收敛**（main.ts / core/mermaid 调用点）：scanTaskList 条件化、删冗余 decorate、mermaid 并发渲染
- [ ] **T5 滚动快赢**（modes/sourcePreviewSplit.ts）：分屏滚动同步 rAF 节流
- [ ] **T6 缓存与定时器快赢**（modes/dotBlink.ts + 测试、modes/outline.ts）：删空转 interval、_pdfOutlineCache 加 LRU 上限
- [ ] **T7 窗口显示时机**（src-tauri/src/main.rs）：非 Windows 改为前端就绪事件 + 兜底定时器
- [ ] **T8 S3/reqwest 客户端缓存**（src-tauri/src/main.rs + Cargo.toml）：SdkConfig/Client 按 key 缓存、共享 reqwest client、ai_novel thread::sleep → tokio::time::sleep

## 每个子任务的改动内容

### T1 启动链路重构（src/main.ts 启动 IIFE，约 8525-9100 行段）

- reveal 前只保留：DOM 骨架、applySavedTheme/initThemeUI、platform class/window drag/resize、initStore(Store.load)、compact titlebar + focus mode 恢复（合并 Promise.all）、bindEvents、revealMainWindowOnce（2×RAF → show → setFocus → 新增 emit 就绪事件给 Rust）
- reveal 后（ric/idle）：initExtensionsPanel + coreExtensions 动态 import、maybeAutoImportPortableBackup、syncOutlineDockFromStore（含可能写盘）、outline layout / library side / docked 设置
- 合并重复 IPC：get_pending_open_path、get_cli_args 结果记忆化，两处调用复用
- pickRecentSetToOpen：每文件 isDirectoryPath+stat 校验改 Promise.all 并行
- 验收：启动序列时序语义等价（除窗口更早显示外无行为变化）；tsc + vitest 全绿

### T2 入口减负

- main.ts:772 `import { load as yamlLoad } from 'js-yaml'` 改用时动态 import（使用点 main.ts:8689 附近）
- core/frontMatter.ts 拆分：splitYamlFrontMatter（纯字符串）留原模块；parseFrontMatterMeta（依赖 js-yaml）移到新模块 core/frontMatterMeta.ts；同步更新所有 import 方（含 plugin runtime re-export 若有）
- src/dialog.ts:7 静态 import diffMerge 改用时动态 import（冲突 diff 视图触发点）
- 验收：构建后 dist/index.html 的 modulepreload 不再含 yaml 与 diff chunk；tsc + vitest 全绿

### T3 watch 增量失效（src/fileTree.ts）

- refreshTree 路径（约 1614-1634）：invalidate 调用传事件路径前缀（invalidateDirDocPresenceScan 已支持 prefix 参数，需确认实现）；无事件上下文时保持全清
- prefetchDirDocPresence 移出 renderRoot 关键路径：先渲染（允许 hint 暂时缺失），后台 prefetch，完成后仅当 hint 与已渲染不一致时做增量刷新（或兜底 renderRoot）
- 验收：外部单文件改动不再触发全树 walk（Rust 日志/计数可验证）；树渲染不再等待扫描完成；tsc + vitest 全绿

### T4 渲染链路收敛（src/main.ts）

- scanTaskList：仅当文本含任务列表语法（快速正则预检）时执行，否则清空 _taskMapLast
- 删除 renderPreview 尾部对 preview 的第二次 decorateCodeBlocks 冗余调用（约 3048 行，先核实守卫语义）
- renderMermaidIn：未缓存图并发渲染（Promise.all，保留单图 try/catch 与错误回填）
- 验收：大文档渲染趟数下降；mermaid 多图文档首次渲染并发；tsc + vitest 全绿

### T5 分屏滚动 rAF（src/modes/sourcePreviewSplit.ts）

- editor scroll → syncPreviewScrollFromEditor 加 rAF 节流（读写布局合帧）
- 验收：滚动同步行为不变；tsc + vitest 全绿

### T6 缓存与定时器快赢

- dotBlink.ts：删除 800ms interval（CSS 动画驱动闪烁，interval 纯空转），保留 start/stop/isOn API 语义；同步更新 dotBlink 测试（Batch 23 建立的 fake-timer 用例）
- outline.ts：_pdfOutlineCache 加 LRU 上限（20 条，超限时按插入序淘汰最旧）
- 验收：tsc + vitest 全绿

### T7 窗口显示时机（src-tauri/src/main.rs）

- setup() 中 Linux/macOS 分支（约 2508-2512）：删除立即 show+set_focus，改为注册「前端就绪」命令/事件触发 show+set_focus；保留兜底定时器（与 Windows 的 2500ms 对齐）
- 前端 revealMainWindowOnce（main.ts:3187-3201）在 show 后通过 invoke 通知 Rust（与 T1 联动）
- 验收：cargo check + cargo test 通过；窗口仍在所有路径最终显示（前端路径 + 兜底路径）

### T8 S3/reqwest 客户端缓存（src-tauri/src/main.rs + Cargo.toml）

- 新增 tauri::State 管理的 AppState：reqwest::Client（统一超时）+ S3 (SdkConfig, Client) 缓存 Map（key=endpoint+region+ak+sk+pathStyle 哈希）
- upload_to_s3 / flymd_delete_uploaded_image 改用缓存；http_xmlrpc_post / flymd_piclist_upload / check_update / download_file 改用共享 client
- ai_novel_api 重试的 std::thread::sleep 改 tokio::time::sleep（Cargo.toml tokio 加 "time" feature）
- 验收：cargo check + cargo test（含既有集成测试）通过

## 预期效果和验收标准

- 首帧：窗口 reveal 不再被 10+ 串行 await 与扩展面板 chunk 加载阻塞；非 Windows 不再先显示空窗壳
- 入口：dist/index.html modulepreload 移除 yaml(46KB)/diff(8.5KB) chunk
- 大库运行期：单文件外部改动不再全树重扫；树渲染不等待扫描
- 编辑链路：预览渲染趟数收敛；mermaid 多图并发；分屏滚动不逐事件强制布局
- 质量门禁：`npx tsc --noEmit` 0 错误、`npm test` 全绿、`npm run build` 成功、`cargo check` 0 错误、`cargo test` 全绿
- 无法在本环境验证（需人工）：GUI 实测首帧耗时、大库实测卡顿——已在风险中标注

## 风险评估和缓解措施

| 风险 | 缓解 |
|---|---|
| T1 启动时序重排引入回归（某后置任务其实被首帧后代码依赖） | 重排前后跑全量 vitest； reveal 仅提前、不删除任何步骤；每步保留原日志打点 |
| T7 窗口显示时机改动导致 Linux/macOS 窗口不显示 | 保留兜底定时器（前端事件缺失时仍能显示）；改动范围最小化 |
| T3 前缀失效漏扫导致目录 doc 提示过期 | 失效路径按目录向上冒泡到已失效祖先；保守降级=保留全清路径用于批量/未知事件 |
| T4 删冗余 decorate 调用实际有副作用 | 修改前用守卫标记（data-codebox）语义验证：第二次调用本就被守卫跳过 |
| T8 S3 缓存 key 含密钥，驻留内存 | 进程生命周期内可接受（原行为每次重新读取磁盘凭证）；key 用哈希不落盘 |
| dotBlink 删除 interval 后被插件引用 isOn 时序 | 保留 isOn 状态与 API；仅删 interval 驱动 |

## 实施顺序和依赖关系

- Wave 1（并行）：T1（main.ts 启动段）、T3（fileTree.ts）、T7+T8（Rust main.rs，同文件串行做）
- Wave 2：T2（main.ts 顶部 import，依赖 T1 完成避免冲突）、T4+T5+T6（main.ts 渲染段 + 独立小文件）
- QA：typecheck → vitest → build → cargo check → cargo test
- 外部审核：spec（Phase 0 末）、plan（Phase 1 末）、每波改动聚合复审（coding-bridge）

## 阶段 0 输出（spec）

- 路径：.omc/fullauto/perf-2026-10/spec.md（v2，已合入 Phase 0 外部审核修订）
- 包含：## Assumptions Made / ## Decisions Made（D-4'、D-6、D-7 为 v2 修订项）

## 外部审核意见（Phase 0）

- provider: coding-bridge（SESSION 6ab5ee52）
- verdict: **APPROVED（有条件通过）**——A1-A8 合入后生效；A2（窗口几何必须在 reveal 前）、A4（mermaid 按文档序回填+受限并发 4）、A6（共享 client 逐点审计 per-request 复原语义）为硬性修订
- 主要风险（已合入 spec v2）：
  - R1 T1 步骤映射不完备（libraryPrivate 归属缺失）+ 阶段划分引入的新竞态窗口 → A1 映射表 + A3 容错约束
  - R3 mermaid Promise.all 完成序≠文档序破坏 FR-2 → A4 预建占位/按序回填/并发 4
  - R4 共享 reqwest client 抹掉 per-site 配置（UA/timeout 缺失可致 403/挂起）+ Mutex 跨 await 持锁 → A6 逐点审计/例外清单/短临界区
  - R5 T3 后台仍 root 全扫与 NFR-3 矛盾 + 路径分隔符归一化缺失 + 后台失败静默 → A5 前缀限定预取/归一化/.catch 标脏/N=64
  - R6 diffMerge 裸 import 副作用时机 + modulepreload 锚点过弱 → A7 副作用核实 + 静态闭包校验脚本
  - R7 flymd_window_ready 未注册 generate_handler! + 双 show 竞态 + revealMainWindowOnce 双任务冲突 → A8 注册/compare_exchange/归属 T7 单一任务
- 次要采纳：pickRecentSetToOpen 用 allSettled+保序过滤；get_pending_open_path memoize 前核实 Rust consume 语义；dotBlink 保留 CSS 驱动副作用；scanTaskList 正则补 `1)` 形式；T3 阈值 N=64；T7 标记并入 T8 AppState
- 工程化采纳：执行顺序 W1-W4（T1 最后）；回滚按任务文件集；reveal/PhaseB 加 performance.mark；renderPreview 快照测试列入 Deferred（需先抽取管线）

## 阶段 1 输出（实施计划）

- 路径：.omc/plans/fullauto-perf-2026-10-impl.md

## 外部审核意见（Phase 1）

- provider: coding-bridge（SESSION e690e8fb；首次全量 prompt 300s 超时，精简重试 96s 成功——经验：review prompt 保持精简）
- verdict: **APPROVED**（修订为各周开工前置条件，不改变任务分解与排序）
- 已合入修订：文件集不相交校验（W1 三车道/W3 双车道文件域确认互不相交）；无头验收代理（T7 compare_exchange 单测、T1 mock invoke 调用序断言、残余时序标注「仅人工核查」）；每卡补测试清单+统一验收口径（含 cargo test）；T8 前置确认 ai_novel async 上下文；check-entry-closure.mjs 先跑基线再接入 build
- 实施计划路径：.omc/plans/fullauto-perf-2026-10-impl.md

## 阶段 2/3 输出（执行 + QA）

- T1-T8 全部落地；执行代理多次 403/503 中断，修复批次与 T1 收尾由 main 助手直接完成
- 单文件外审：W1-W3 聚合 3 轮（均首轮 REJECTED → 修复批次 10 项）→ 复审 APPROVED（SESSION c878d8f7，normRel fail-safe 补丁已合）；T1 第 1 轮 REJECTED（SESSION 6257d506，采纳 R1 补捞/R3 串行）→ 第 2 轮 APPROVED（SESSION e714cc2b）
- 逐项裁决与 Runtime Decisions：.omc/plans/fullauto-perf-2026-10-impl.md

## QA 记录

Phase 3 五道门禁全绿（2026-10-18，最终代码态）：tsc 0 错 / vitest 59 文件 743/743 / build+闭包校验 OK（入口闭包 5 文件无 yaml/diff）/ cargo check 通过（1 个 pre-existing 警告）/ cargo test 27/27。项目无 lint 脚本，以 tsc 充当。qa_cycles=1，无三次重复错误。详见 impl plan `## QA 记录`。

## 验证

- 路径：.omc/fullauto/perf-2026-10/validation.md
- R1：功能 APPROVED / 安全 APPROVED / 代码质量 REJECTED（测试重写误删 15 用例为唯一阻塞）
- R1 修复：恢复测试（vitest 743→758）、S3 缓存 helper 提取、常量命名、注释补齐；Windows CAS 绕过登记已知债务
- R2：三视角全部 APPROVED；fix-delta 外审 APPROVED（SESSION c9f33fd0）

## 外部审核意见（Phase 4）

- provider: coding-bridge（SESSION f261c63e）
- verdict: **APPROVED**（hardening 补丁：不需要）
- 流程改进建议（下迭代，不阻塞本期）：mermaid 串行链 watchdog 超时 > 测试清单减项门禁 > before/after 性能基线；T3 大树基准；S3 LRU 演进；yamlLoad 容错下沉 loader
- 回滚方案：impl plan `## 回滚` 已有（按任务文件集 `git checkout --`），评审未见该节属信息缺失而非缺失
