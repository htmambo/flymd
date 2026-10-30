# 真机回归问题修复：超大文件启动冻结（perf 批次 H）

**状态**: ✅ 已完成（完成时间: 2026-10-30）
**触发**: 用户真机测试报告"运行时被卡住，疑似超大文件"，终端出现 `Gdk-CRITICAL gdk_wayland_window_configure: assertion 'height > 0' failed`

## 诊断过程与结论

### 证据链（应用日志 ~/.local/share/com.flymd/logs/flymd.log）

- 03:27:59 打开 杂记.md（1320 字节）→ 用户粘贴内容 → 03:30:28 保存为 **554,499 字符**（1.05MB，35,196 行，**3352 个代码围栏**）
- 03:30:45（与 Gdk 报错同秒）应用重启自动打开该文件：`打点:首次预览开始` 之后**日志戛然而止**——冻结点在 renderPreview
- 03:33:35 再次重启，同样序列再次冻结——可稳定复现

### 归因（逐层排除）

1. **纯字符串管线无罪**：对真实文件实测 protectExcel 22ms + callout 归一 8ms + md.render 103ms + strip 1ms ≈ **134ms**（批次 F 的抽取无回退）
2. **冻结根因 = 既有 O(N) 强制布局，被这个文件跨过阈值**（与本会话各批次无因果，行号测量机制在批次 R3 之前就存在）：
   - 行号栏初始测量：`applyTextPatch` 对整文件 → `remeasureRange(0, 35196)` → **35k 次 write+offsetHeight 强制布局**，且每次布局都要重排巨型 DOM
   - `decorateCodeBlocks`：**3352 个代码块 × 每块多次 getComputedStyle/getBoundingClientRect/isCodeContentClipped**，单任务连续跑完
3. **Gdk 断言为次要噪音**：发生在 DOM 就绪前 0.7s 的窗口创建阶段（`visible:false` 隐藏窗口在 Wayland 上的 configure），非致命、与冻结无因果；待冻结修复后真机确认窗口是否正常显示，若仍异常再单独立项查 T7 时序与 Wayland 的交互

## 修复（两处，行为等价）

- **H1 `decorateCodeBlocks` 分片异步**：每 100 块 yield 一次（setTimeout 0），装饰渐进生效、总耗时不变；`data-codebox` 守卫保证幂等与重入安全；唯一调用点 main.ts 改 await
- **H2 行号栏批量测量**：新增 `measureLineHeightsBatched(container, texts, lineHeight, batchSize=4096)`——去重后的行文本按 4096 行分块"一次挂行 → 一次读取"，把 O(N) 次强制布局压成 ⌈N/4096⌉ 次；测量公式与单 probe 逐字一致（`max(lineHeight, offsetHeight || 0)`，空行 `\u200b` 占位）；打字等小范围（≤16 行）仍走单 probe 路径

## 验证

- `tsc --noEmit`：0 错误
- `vitest run`：808/808（64 文件；新增 6 例：分片到位/幂等/mermaid 跳过 + 批量测量容器复原/空行占位/分块边界）
- `npm run build` + 闭包门禁通过；`cargo check` / `cargo test` 31/31（本批无 Rust 改动）
- 管线对真实文件的全量渲染（字符串层）134ms 实测留档

## 追加修复 H2'（真机二次反馈后）

用户复测反馈：窗口与渲染可见，但仍卡在等待。归因修正：H1 分片只切开了任务，**总布局次数不变**（~3352 次 × 每次重排巨型 DOM = 分钟级）。根治 = decorateCodeBlocks 跨块三相重构：

- **Pass A 纯写**：包装/行号列骨架/探针/角标按钮，分片让出主线程；expandBtn 初始隐藏防闪现
- **Pass B 纯读**：一次布局读齐全部块的 computed style / 矩形微对齐 / isCodeContentClipped
- **Pass C 纯写**：应用行高对齐/微对齐差值/展开按钮显隐；换行模式测量随迁（默认关闭，开启时每块一次内部批测，跨块合并留后续）

布局次数从 ~块数 次降为常数次；端态与逐块版逐字等价（各值计算式不变，已有 6 例测试复验通过）。

同步新增 renderPreview 分段耗时观测（管线/消毒/mermaid/挂载/装饰/链接图片，总计 ≥300ms 记入 flymd.log 的 `[启动耗时] 预览渲染分段`）——下次真机运行可直接从日志归因，不再依赖推测。

## 最终结论 H2''（真机分段日志实证）

用户三次复测后分段日志到手：**装饰 decorateCodeBlocks 134,424ms / 总计 134,896ms（99.6%）**，其余段全部健康（管线 90 / 消毒 115 / mermaid 189 / 挂载 5 / 链接图片 73 ms）。

H2' 三相重构后仍 134 秒的根因：**Pass A 的分片让出（34 次 setTimeout 间隙）让浏览器对已累积的巨型 DOM 反复中间布局+绘制**，WebKitGTK 上一次数秒 × 34 ≈ 134 秒——分片本身成了放大器。

最终形态：**Pass A 同步单任务（无让出）**。纯写不触发布局，整个装饰只在末尾经历唯一一次布局+绘制；预期装饰段从 134 秒降为秒级。同时启动尾巴（插件激活 2.4s / WebDAV 1.4s）不再与渲染竞争主线程——渲染先行完成后 ric 才会真正空闲触发。

用户确认：渲染完成后的滚动/交互正常（"现在看到应用正常了"），问题被隔离在装饰段。

## 最终定论 H3（真机分段日志三轮迭代后实证）

用户开启着"代码换行"模式（之前所有轮次均未察觉）。完整根因链：

1. **最初 87~102s**：换行模式下 `decorateCodeBlocks` 对每块调用 `applyHeights()` →
   `measureWrappedLineHeights`（每块一次强制布局）→ 3352 块 × ~26ms ≈ 87~102s。
   期间我把间歇日志间隙误归因为"浏览器绘制"，C1/C2 拆分、lsCache 均非要害
   （C:end 采样区间实际覆盖 C2+wrap 段，localStorage 归因是误判）。
2. **修复 = 换行测量跨块批量化**：先纯读齐全部块 clientWidth/字体（单次布局），
   再把所有块的探针行挂进同一个屏外宿主（单次附加），一次读取全部行高，单次写回。
   测量端态与逐块版一致（同探针样式、同高度公式）。
3. **实测（同文件）**：装饰段 134,424 → 72,550 → **8,608ms**；整个预览渲染
   **9,228ms**（入口 137 / 管线 119 / 消毒 129 / mermaid 286 / 挂载 11 / 装饰 8,608 /
   链接图片 75）。装饰内部：写入 358 / 读取 2,003 / 应用 1,333（批测 ~1.3s）。
4. 附加：`.codebox { content-visibility: auto; contain-intrinsic-size: auto 120px }`
   ——离屏代码块跳过布局/绘制（WebKitGTK 2.46+；不支持则忽略）。
5. 保留 lsCache 内存缓存层（大 DB 下热路径 localStorage 读取的通用防护）与
   装饰分相/逐语句内存打点（≥300ms 记录，含"最耗时语句"Top6）。
6. 观测方法论教训：**异步 logger 无法观测同步块内部**——本轮靠纯内存采样数组
   （performance.now 采样，装饰结束时单条落盘）才完成逐语句归因。

## 新发现 H4（复现实例日志 + CPU 观测）：真正的日常工作模式是所见模式

复现实例（无插件）在 preview 模式 5.5s 完成渲染后，日志出现 `默认启用所见模式`
（WYSIWYG_DEFAULT 预设，21:14:54），随后 WebKitWebProcess 以 104% CPU 持续运行
数分钟且无任何新日志——**所见模式在 553KB 文档上的启用链路存在分钟级同步计算**，
用户此前的"渲染一页后卡住、滚动迟钝"实为此状态的体感（preview 渲染 → 37s 后
自动切所见 → 卡）。

待查链路（enableWysiwygV2 + onChange）：milkdown create 的 remark 解析、
automd/inline-sync 的逐节点同步、初始事务触发的 markdownUpdated 全文管线、
以及 onChange 是否在所见模式回调 scheduleRenderPreview（若是，每次编辑=全量
553KB 预览重渲）。候选修复：入口分段打点定位、ProseMirror 顶层子节点
content-visibility、所见模式回调去耦（所见模式不应触发 md 预览全量渲染）、
超大文档所见模式准入提示。

## 追加修复 H5（渲染风暴：编辑模式每击键全量渲染）

用户三方对照（源码正常/所见与阅读卡）+ 渲染时间戳聚类定位到**渲染风暴**：
21:50:47-49 的 20 秒内 13 次 renderPreview（每 100-300ms 一次，编辑模式
wysiwyg:false）——每次 4.6-10s，击键期间连续排队渲染。

修复：renderPreview 入口新增守卫——纯编辑模式（未开分屏预览，经
flymdGetSplitPreviewEnabled 判定）且非打印时跳过渲染（预览面板不可见，
4.6s/次全量渲染纯属浪费），大纲改走 scheduleOutlineUpdateFromSource 源码路径。
切阅读/分屏/打印照常渲染。另：applyExternalContentToEditor 内容与编辑器一致时
跳过整个重载（消除启动期 ~20s 浪费性双渲染，已实测日志验证）。

遗留（所见专项继续）：ProseMirror pre 的 content-visibility 实验在 WebKitGTK
上形成布局反馈循环（闲置 CPU 60%→102%、RSS 3.2GB），已回滚；所见模式闲置
~60% CPU（caret-blink 动画头号嫌疑，动画暂停实测仅回收 12%）待 F12 性能器
或阈值方案定位。

## 待用户真机确认

1. 同一文件（杂记.md 1.05MB）启动不再冻结、预览与行号正常
2. 窗口正常显示（Gdk 断言若仍打印但窗口正常，可视为 Wayland 隐藏窗口的已知噪音）
3. 打字/滚动流畅度
4. 日志中 `[启动耗时] 预览渲染分段` 的装饰ms 应为数百 ms 量级（此前 134,424ms）

## 备注

- 本轮未经过 External Review MCP 审查（当前运行时未配置该 MCP）。
- 实施过程自查拦下一次 O(N²) 残留（`pendingTexts.indexOf`），已改为索引 Map。
- 若真机确认仍有可感知卡顿，下一梯队：decorateCodeBlocks 每块的 getComputedStyle 批量化、KaTeX 占位渲染切片调参、超大文件打开阈值提示（>N MB 询问）。
