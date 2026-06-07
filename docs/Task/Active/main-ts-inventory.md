# main.ts 调用点清单（B1 调研产物）

> **生成时间**：2026-06-07
> **目的**：Phase B（main.ts 拆分）B1 子任务输出
> **依据**：`grep` 统计 `src/main.ts` 当前 12,025 行

## 1. 体量与密度

| 指标 | 数值 | 备注 |
|---|---|---|
| 总行数 | 12,025 | — |
| 顶层函数/箭头 | 477 个 | 高密度 |
| import 语句 | 103 行 | 高度耦合外部模块 |
| `addEventListener` | 144 处 | DOM/Tauri 事件挂载 |
| `register*(...)` | 10 处 | 命令/菜单注册 |
| `@invoke` / `invoke(...)` | 18 处 | Tauri 后端调用 |
| `listen(...)` | 4 处 | Tauri 事件订阅 |
| `emit(...)` | 0 处 | 用 `broadcastEvent` 替代 |

## 2. 拆分策略（基于数据）

### 2.1 按调用点分布推测职责

| 调用类型 | 推测归属 | bootstrap 模块 |
|---|---|---|
| 144 处 `addEventListener` | DOM 事件 + 一些 Tauri 事件 | `initDom.ts` + `initTauri.ts` |
| 10 处 `register*(...)` | 菜单/命令注册 | `initMenus.ts` |
| 18 处 `invoke` | 全部进 Tauri 模块 | `initTauri.ts` |
| 4 处 `listen` | 全部进 Tauri 模块 | `initTauri.ts` |

### 2.2 commands 拆分（无副作用纯逻辑）

预估可拆出 **commands/file/**、**commands/view/**、**commands/edit/**、**commands/window/**、**commands/tools/** 5 个族，每族 3-15 个命令。

### 2.3 bootstrap 拆分（副作用初始化）

| 模块 | 预估行数 | 职责 |
|---|---|---|
| `bootstrap/initDom.ts` | 200-400 | DOM 元素查询、视图初始化、tab 容器、库侧栏容器、预览容器 |
| `bootstrap/initTauri.ts` | 400-600 | invoke / listen / 单实例 / 文件托管 / 命令注册 |
| `bootstrap/initShortcuts.ts` | 200-400 | 快捷键（注意输入法/便签/专注模式差异） |
| `bootstrap/initMenus.ts` | 300-500 | 菜单/上下文菜单/命令面板 |
| `bootstrap/initExtensions.ts` | 200-300 | 扩展宿主启动、内置扩展注册 |
| `bootstrap/initLifecycle.ts` | 100-200 | 启动/退出阶段钩子、错误兜底、telemetry |

## 3. 风险点（提前识别）

1. **闭包内隐式共享状态**：477 个函数大概率有大量 IIFE / 闭包，需识别
2. **循环引用**：bootstrap/initX 之间可能互相依赖
3. **side-effect 顺序敏感**：当前 12,025 行一次性按顺序执行，拆开后必须保持同样顺序
4. **全局挂载**：`window.flymd*` 全局对象被其他模块直接访问

## 4. 下一步行动

1. **B1.2** 深入 grep 477 个函数，按"纯函数 vs side-effect"分类
2. **B1.3** grep 所有 `window.flymd*` 全局挂载点（预估 30+）
3. **B1.4** 输出"拆分前后等价性证明"——保证拆分不引入回归
4. **B2-B6** 严格按调研结果执行

## 5. 拆分执行顺序（强依赖）

```
B1.1 调研  ✅ (本文件)
  ↓
B1.2 函数分类 / B1.3 全局挂载点 / B1.4 等价性证明
  ↓
B2 commands 拆分（无副作用纯逻辑，先动这部分最安全）
  ↓
B3 initDom 拆分
  ↓
B4 initTauri 拆分（依赖 B2 提供的命令）
  ↓
B5 initShortcuts 拆分
  ↓
B6 initExtensions 拆分
  ↓
B7 main.ts 收敛（≤ 800 行）
```
