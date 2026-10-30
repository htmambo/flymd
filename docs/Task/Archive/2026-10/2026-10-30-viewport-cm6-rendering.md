# 阅读模式视口渲染与 CM6 大文档编辑改造

**状态**: ✅ 已完成（完成时间：2026-10-30）
**创建时间**: 2026-10-30
**责任人**: Kimi Code
**范围**: 阅读模式渲染架构、大文档编辑引擎、兼容功能、测试与真机性能验证

## 目标

1. Stage 1：阅读模式只渲染视口附近的顶层 Markdown 块，消除整篇 DOM 和全量代码块装饰。
2. Stage 2：增加 CM6 大文档 Live Preview，避免 Milkdown 整篇构建，保持文本、dirty、标签与外部变更语义。
3. 同一 1,078,087 字节 / 35,197 行文档验证打开、滚动、窗口重激活、查找、复制、导出和编辑。

## 基线与证据

- 当前阅读模式 `md.render → innerHTML → 全量 decorateCodeBlocks`，真实预览约 4.2–4.4 秒且启动重复渲染。
- 当前 Milkdown 大文档构建曾耗时 11–24 秒。
- 真实文件裸 `markdown-it` 解析为 25,978 tokens / 10,894 顶层块，约 46–87ms；分组 HTML 拼接与整篇输出一致。
- 现有未提交改动全部保留；不擅自 commit、tag 或 push。

## 总体架构

### Stage 1：阅读视口渲染

新增独立模块：

- `core/markdownBlocks.ts`：预处理、全量 parse、共享 env、平衡顶层块、稳定块键、源码行/标题/任务/脚注索引。
- `core/virtualPreview.ts`：视口计算、上下 spacer、可见块挂载、块高度索引、异步尺寸重测、源码查找/复制/锚点定位。
- `main.ts`：只负责装配现有渲染器、消毒、Mermaid/KaTeX、任务映射、图片链接与日志。

核心规则：

- 只在非所见阅读模式且 `forPrint=false` 时启用；打印/PDF/DOCX 从源文本整篇渲染，不依赖虚拟 DOM。
- 不为离屏块创建占位 DOM；只保留上下两个 spacer 和可见块。
- token 流与共享 env 全量生成一次，块渲染复用同一 env，保留引用定义和脚注语义。
- 高度先按源码行/类型估算，挂载后实测；图片、数学、Mermaid、字体、宽度、主题和缩放变化均触发批量重测。
- 重测前记录稳定块键与块内偏移，更新上方高度后恢复等价 scrollTop。
- 相同源码版本的重复渲染复用模型，不重新 parse 或 remount。
- 不安全的跨块原始 HTML 或虚拟化异常回退 legacy；legacy 完整保留。
- 超过 256KiB 的单块使用只读 capped 内部滚动器，首个 64KiB chunk，后续按需加载；源文本、查找、复制和导出保持完整。块缓存最多 16 chunks（1MiB）/活动文档。

### Stage 2a：CM6 基础编辑与同步

新增 `modes/cm6Editor.ts` 和同步适配器：

- `codemirror/basicSetup + @codemirror/lang-markdown`，支持编辑、撤销、IME、选择、滚动和焦点。
- textarea Markdown 是唯一事实源；每次 CM6 `docChanged` 同步整篇镜像到 textarea，不做防抖。
- 所有程序性写入（AI、任务、watcher、标签、工具栏）通过同一适配器更新 CM6；开发环境断言两边文本一致。
- 回退前再次读取 CM6 快照并恢复选区/焦点；镜像失败也不覆盖较新文本。异常回退推迟到 `compositionend`。
- 外部变更保持现有策略：dirty 时 keep/reload/diff/cancel，绝不直接覆盖；仅干净文档可自动重载。
- 编辑过程中不根据体积切换引擎；撤销历史不跨引擎迁移。重新打开或用户明确切换时才重新路由。

引擎路由：

- `largeDocEngine=auto`：≥200KiB UTF-8 或 ≥10,000 行使用 CM6，其他使用 Milkdown。
- `largeDocEngine=cm6`：所有文档使用 CM6。
- `largeDocEngine=milkdown`：保留传统 Milkdown 路径。
- 默认 `auto`；CM6 初始化异常回退到可响应的源码模式，不以大文档 Milkdown 冻结作为兜底。

### Stage 2b：Live Preview 装饰

- 视口安全的标题、强调、粗体、删除线、行内/围栏代码、引用、链接和任务装饰。
- 数学与 Mermaid 只在可见且不在活动编辑/IME 范围时挂载 widget。
- 明确不宣称 Milkdown 专属富表格单元格编辑、slash/覆盖层和拖拽块编辑已实现 CM6 对等；这些能力保留在 Milkdown 引擎。

## 功能开关与回滚

- `flymd:readingRenderer=virtual|legacy`，默认 `virtual`，仅影响阅读预览。
- `flymd:largeDocEngine=auto|cm6|milkdown`，默认 `auto`，仅影响编辑引擎。
- 两个开关独立，六种组合均有效；未知值回退默认值，旧版本忽略新键。
- 不新增其他持久化状态格式；缓存仅当前模型 + 最多两个非活动标签模型。

## 实施步骤

- ✅ S1.1 块模型、实际插件 golden、缓存与病态输入测试。
- ✅ S1.2 视口 DOM、高度索引、可见块增强与性能埋点。
- ✅ S1.3 查找、大纲、锚点、任务、脚注、跨块复制与 detached 导出兼容。
- ✅ S1.4 第一阶段完整测试与真实文件门禁，未通过不进入 Stage 2。
- ✅ S2.1 CM6 依赖、基础编辑器、同步适配、路由、标签/IME/撤销/故障注入。
- ✅ S2.2 Live Preview 装饰与可见 widget。
- ✅ S2.3 全量验证、真机对比、代码审查与归档。

## 实施与验收记录

- Stage 1：真实 1,078,087 字节 / 35,197 行文档包含 10,894 个顶层块，视口只挂载 34 块、255 个 DOM 元素；多次预览约 424–678ms。
- Stage 2：CM6 大文档正常启用，不再触发大文件 Milkdown 构建；多次启用约 143–1041ms，并在大文档首屏后预热 chunk 降低加载抖动。
- Live Preview：完全可见且未被选中的公式/Mermaid 块才替换；点击/键盘先落光标再恢复源码；部分可见或超高块保留源码，避免高度振荡。
- 数据安全：同步镜像、待同步销毁快照、销毁幂等、迟到事件隔离、外部冲突策略、混合行尾拒绝和一致行尾偏移均有专项测试。
- 兼容：查找、大纲、锚点、任务、脚注、精确部分选区复制、全选源码、打印/导出、CRLF/BOM/Unicode、目录树边界均覆盖。
- 最终门禁：Vitest 925/925、Rust 31/31、typecheck、生产构建、入口闭包和 `git diff --check` 全通过。
- 审查：Stage 1、CM6 生命周期、行尾映射、Live Preview 均获源码级 APPROVED；Stage 2b 计划审查获 APPROVED。

## 验收标准

硬门禁：

- 当前 Linux / WebKitGTK 2.52.6 环境，动态模块就绪后，从读取内容到首个可交互渲染帧，5 次测量中位数 <1 秒并记录最大值。
- 阅读模式不存在整篇 DOM；可见 DOM 有明确上界，滚动只处理挂载块。
- 大文档 CM6 不触发 Milkdown `Editor.create`；文本同步、故障回退和外部冲突测试零数据丢失。
- 查找、大纲、锚点、任务、跨块复制、全量导出、撤销和中文 IME 行为通过。
- 全部既有/新增测试、typecheck、生产构建和 Rust 测试通过。

测量目标（不作为易抖动的 CI 定时断言）：

- 滚动长任务目标 <50ms；记录 parse、首屏、增强、hydration 与滚动耗时。
- 记录缓存命中、fallback 原因、文档尺寸、标志值与 CM6/textarea 偏差。

## External Review Opinion

- Round 1/10（requirement）：NEEDS_CHANGES。要求阈值、特性矩阵、回退、量化指标和病态块处理。
- Round 2/10（requirement）：NEEDS_CHANGES。要求引擎状态机、超大块正向行为、共享 env 和工期。
- Round 3/10（requirement）：NEEDS_CHANGES。要求零丢失回退、外部冲突、只读病态块和开关语义。
- Round 4/10（requirement）：NEEDS_CHANGES。要求脏缓冲外部冲突、回退量化、阈值方向与 TTI 测量协议。
- Round 5/10（requirement）：APPROVED。保留现有 dirty 冲突策略，移除启发式回退和编辑中引擎切换，确认测量协议、缓存上界与阶段门禁。
- Round 6/10（plan）：NEEDS_CHANGES。要求补充量化指标、异步高度、查找复制、显式 CM6 extensions 与回滚细节。
- Round 7/10（plan）：APPROVED。确认同步镜像、超大块阈值、overscan、脚注尾块、滚动锚定和本地 kill-switch 均可实施。

## 假设与范围边界

- 用户要求第一阶段后继续进行第二阶段；采用“大文档默认 CM6，小文档保留 Milkdown”的渐进迁移，而非一次性重写所有 Milkdown 插件。
- 阅读模式病态块只读降级不影响编辑源码；编辑器始终持有完整文本。
- 性能真机硬门与 CI 结构断言分离；未达硬门时默认回退 legacy/milkdown，不降低验收标准。
- 预计单人顺序工作量：Stage 1 4–7 人日、Stage 2a 4–6 人日、Stage 2b 4–7 人日；门禁不为估时让步。
