# Batch 9:抽离 networkProxyFetchShim / windowPlacement

**状态**: ✅ 已完成 (完成时间: 2026-06-08)
**提交**: `c6e5b54`(已推送 origin)
**复审**: Codex R3 APPROVED(0 blocker / 0 important / 2 nit)

## 目标

继续 Phase B main.ts 模块化拆分。本批抽离 2 个自包含模块:
1. `networkProxyFetchShim`:全局 fetch 代理(通过 Tauri plugin-http 走 Rust 网络栈)
2. `windowPlacement`:Tauri 窗口几何兜底(缩放系数、尺寸下限、启动居中)

## 现状分析

- main.ts HEAD 10744 行,本批前批次已抽离 8 个模块
- `initNetworkProxyFetchShim`(原 1518-1687,170 行)纯全局 fetch 适配,无 main.ts 闭包依赖
- `getWindowScaleFactorSafe/ensureMinWindowSize/centerWindow`(原 7007-7106,100 行)纯 Tauri 窗口几何

## 子任务清单

### T1 ✅ `src/core/networkProxyFetchShim.ts` 新建
- 导出 `createNetworkProxyFetchShim(deps?): { install, uninstall, isInstalled, update, _resetState }` 工厂
- 导出便捷 `initNetworkProxyFetchShim(deps?)` 等价构造
- deps 可选:`win / storage / importHttp` 全部可选
- 内部封装:`nativeFetch / httpFetch / httpBody / httpImportPromise` 状态
- 暴露 install/uninstall/update/isInstalled API;`update()` 顺序与原块一致(初始 update 在 listener 注册之前)
- 9 个测试:默认不安装/启用后 install/uninstall 还原/update 切换/flymd:netproxy:changed 事件/http 模块缺降级/非 http(s) 降级/Request 实例搬运

### T2 ✅ `src/windows/windowPlacement.ts` 新建
- 新建 `src/windows/` 目录(后续 Tauri 窗口工具的归宿)
- 导出 `createWindowPlacement(deps): { getWindowScaleFactorSafe, ensureMinWindowSize, centerWindow }` 工厂
- deps 必填:`getCurrentWindow / currentMonitor / invoke` — 调用方注入静态 ESM import(避免 Vite ESM 不支持 require)
- 可选 `win`(默认全局 window)
- 10 个测试:scaleFactor 三级兜底/越界拒绝/ensureMinWindowSize 上下限/centerWindow 可见阈值/screen*scaleFactor 退化/错误吞咽

### T3 ✅ main.ts 接线
- 新增 2 个 import:`initNetworkProxyFetchShim` + `createWindowPlacement`
- 顶层 `const windowPlacementApi = createWindowPlacement({ getCurrentWindow, currentMonitor, invoke })`
- 删除 initNetworkProxyFetchShim 旧块(原 1518-1687,170 行)
- 删除 3 个 window 函数旧块(原 7007-7106,100 行)
- 3 处调用点改写:`startScaleFactor` / `ensureMinWindowSize` / `centerWindow`

### T4 ✅ 验证
- `npx tsc --noEmit` 0 错误
- `npm test` 390/390 通过(原 371 + 新增 19)
- main.ts 净 -269 行(8+ / 277-):10744 → 10475

## 验收标准

- [x] tsc 0 错
- [x] 全测试通过
- [x] 行为等价(语义保留)
- [x] Codex R3 APPROVED
- [x] 提交 + 推送完成

## Codex 复审过程(3 轮)

- **R1**: 选 2 个候选(networkProxyFetchShim + windowPlacement)
- **R2**: REJECTED(2 P0 + 1 P1 + 2 nit)
  - P0.1: windowPlacement 兜底用 `require()` 在 Vite ESM 失败 → 改必填 deps + 静态 import 注入
  - P0.2: `try { ensurePreviewLinkHandlingBound() } catch {}` 误删 → 已在原位回填
  - P1.1: 未追踪的 4 个新文件 → commit 一起 add
  - nit: ordering update/listener 顺序 → 修
- **R3**: APPROVED(0 blocker, 2 P1 — 已知,commit 时解决)

## 风险与回滚

- **TDZ**:`const windowPlacementApi = createWindowPlacement(...)` 在 import 后立即执行,但 factory 内部不调 Tauri(只捕获引用),无风险
- **`ensurePreviewLinkHandlingBound` 调用顺序**:补回原位置(1480),函数声明 hoist 保证 TDZ 安全
- **回滚方案**:`git revert c6e5b54`

## 工时估算

实际: ~1.5 小时(2 个模块 + 19 测试 + 2 轮 codex 复审纠错)

## 备注

- 累计 Phase B 抽离模块数:10(原 8 + networkProxyFetchShim + windowPlacement)
- main.ts 累计净减:约 1570 行(11692 → 10475)
- 测试覆盖:188 → 390(累计 +202 测试)
- 新建目录 `src/windows/` — 后续 Tauri 窗口工具的归宿
- 后续 batch 候选(待 R1 提名):menuManager 拆分 / plugin runtime 暴露块 / 杂项 setter 集中化
