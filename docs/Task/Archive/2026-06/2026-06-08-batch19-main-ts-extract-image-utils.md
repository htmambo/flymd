# Batch 19:抽离 imageUtils 工具(图片扩展名/转 dataURL)

> 状态:✅ 已完成(完成 2026-06-08,经 Codex R1 复审 APPROVED)
> 提交:`b74b17b`(已推送 origin)
> 范围:Phase B 第十八批 — main.ts 模块化拆分

---

## 目标(Goals)

继续 Phase B 拆分,把 main.ts 中 2 个图片工具纯函数抽离到独立模块。
2 函数都是 stateless / 0 deps,无需工厂,直接命名导出。

## 现状分析(Context)

- main.ts 9098 行(Batch 18 拆分后)
- `extIsImage(name)` (3 行):正则检测图片扩展名
- `fileToDataUrl(file)` (13 行):FileReader 包装,File → data URL
- 7 call site(4 extIsImage + 3 fileToDataUrl),散布在拖拽/粘贴/上传流程

## 子任务清单(Subtasks)

- **T1 ✅** `src/core/imageUtils.ts` 新建(20 行,7 tests)
  - 命名导出 `extIsImage` / `fileToDataUrl`(无工厂)
- **T2 ✅** `src/core/imageUtils.test.ts` 新建(7 tests,jsdom)
  - extIsImage:8 扩展名识别 / 大小写不敏感 / 非图片 / 路径含目录
  - fileToDataUrl:基本转换 / 不同内容不同输出 / sanity happy-path
- **T3 ✅** main.ts 添加 import + 删除 2 函数体
- **T4 ✅** main.ts 净 **-14 行**(添加 1,删除 15)
- **T5 ✅** Codex R1 复审 APPROVED(0 blocker)
- **T6 ✅** 验证:tsc 0 错误、test 510/510(原 503 + 7 新增)

## 实施细节

### 关键设计

1. **命名导出而非工厂** — 2 函数都是 pure / stateless / 0 deps
   - 工厂模式主要为 test-time replacement 服务,本批无此需求
   - Codex R1 确认:命名导出是此场景的合理设计
2. **call site 无 prefix 改动** — 命名导入后,call site 仍写 `extIsImage(...)` /
   `fileToDataUrl(...)`,行为不变
3. **deps 对象属性兼容** — `fileToDataUrl: (f: File) => fileToDataUrl(f)` 引用 import 版本
4. **保留 ASCII 标点** — 原文注释 "避免手动拼接带来的内存与性能问题" 用 ASCII 逗号,
   按 1:1 抽出不动,不强改风格(Codex R1 抓到但未列为 blocker)

### Codex R1 复审

- **R1** APPROVED
- 验证点:regex 字符串 verbatim、FileReader 配置 verbatim、try/catch 包裹 verbatim
- 唯一 nit:test 名字 'rejects' 但实际是 happy-path → 已修
- 唯一 nit(未 blocker):注释 ASCII vs 全角标点 → 按 1:1 抽出原则保留

## pre-existing 行为保留

- `extIsImage`: regex `/\.(png|jpe?g|gif|svg|webp|bmp|avif)$/i` 一字不改
- `fileToDataUrl`:
  - new FileReader
  - onerror: reject(fr.error || new Error('读取文件失败'))
  - onload: resolve(String(fr.result || ''))
  - readAsDataURL
  - try/catch 包裹 FileReader 构造

## 验证(Verification)

- `npx tsc --noEmit` → **0 错误**
- `npm test -- --run` → **510/510 通过**(原 503 + 新增 7)
- main.ts 净 **-14 行**(9098→9084)
- 提交:`b74b17b`(已推送 origin)
- Codex:R1 APPROVED(0 blocker)

## 备注

- 教训:工厂模式不是银弹。pure / stateless / 0 deps 的工具函数,命名导出更简洁
- 教训:1:1 抽出原则要严格执行,即使原文标点是 ASCII,也不在本批强改风格
- 收益:图片工具独立可测,扩展名列表/转码逻辑调整不影响 main.ts
