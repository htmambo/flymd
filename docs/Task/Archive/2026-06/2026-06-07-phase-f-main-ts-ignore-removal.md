# Phase F 第三步:main.ts 死代码删除 + @ts-ignore 清理

**状态**: ✅ 已完成 (完成时间: 2026-06-07)
**提交**: `08b144c` (已推送 origin)

## 背景

Phase F 第二步完成时 main.ts 还有 21 个 `@ts-ignore` 指令,经调研归类为:
- **TYPE-REAL**(2 个)— 类型实为可达但类型系统不认
- **TDZ**(5 个)— 临时性死区错误
- **UNCLEAR**(4 个)— 需逐处审查
- **非激活**(3 个)— 注释中或被 `# @ts-ignore` 装饰的装饰器

Codex R1 复审发现一个比单纯删 `@ts-ignore` 更深层的结构问题:**main.ts:557-701 存在 145 行死代码块**——三个函数声明(`handleBeforeInput`、`handleInput`、`rememberPrev`)被嵌套在 `hashMermaidCode` 函数体的 `for` 循环块内,块级作用域使其在函数外部完全不可见,只能通过 `@ts-ignore` 绕过类型检查再以同名字符串引用。

## 任务清单

- **T1 ✅** Python 脚本精确删除 main.ts:557-701 共 145 行
- **T2 ✅** Edit 删除 main.ts:8606-8609 共 4 行(2 个 `addEventListener` 注册 + 2 个 `@ts-ignore`)
- **T3 ✅** Codex R2 复审通过(0 blocker/0 important/0 nit)
- **T4 ✅** `npx tsc --noEmit` 0 错误
- **T5 ✅** `npm test` 188/188 通过
- **T6 ✅** commit + push

## 验证(Codex R2 实测)

| 项目 | 结果 |
|---|---|
| hash 循环完整性 | ✅ 558 行 `}` 闭合,563 行 `hashMermaidCode` `}` 闭合 |
| try/catch 平衡 | ✅ `ensureEditorKeyHooksBound` 8521 行起,8699 行 catch 闭合 |
| imePatch 行为覆盖 | ✅ 围栏(213-224)/配对(30-50, 226-248, 382-396)/IME(90-93, 183-186, 253-269, 405-414) |
| main.ts 物理键路径 | ✅ 8542/9169/9333/9410 行仍保留 keydown 处理 |
| @ts-ignore 净减 | 21 → 10 (-11) |
| main.ts 净行数 | -149 |

## 关键决策

**决策**: 删除而非修复。
**Why**:
- 死代码块本身就是 Bug:函数声明被嵌套进 `hashMermaidCode` 循环块作用域,无法外部访问
- 同名 listener 引用通过 `@ts-ignore` 绕过类型检查,运行时本应抛 ReferenceError
- `src/imePatch.ts` 早已在 main.ts:1 导入,是同名函数的权威实现
- 行为等价的活路径已存在(imePatch + main.ts keydown),删除不会损失功能

**How to apply**: 后续清理阶段先识别结构性问题(死代码/重复实现/未使用导出),再决定是删是改。`@ts-ignore` 多数时候是结构问题的症状,不是疾病本身。

## 关联

- Phase F 第一步(`b1c75c6`):非 main.ts 范围 `@ts-ignore` 清零(30→23)
- Phase F 第二步(`aaa84b4`):main.ts console.log 降噪
- **Phase F 第三步(`08b144c`):本步,main.ts `@ts-ignore` + 死代码**
- 后续 Phase B2-B7:main.ts 模块拆分(进行中)

## Codex 复审记录

**R1 调研**: Claude + Codex 联合分析 21 个 `@ts-ignore` 时发现死代码块,提议 3 个修复方案(全删/保留/重构),Claude 选 A(全删)。

**R2 提交前**: Code review workflow,验证:
- 死代码块结构边界是否完整
- 周围 try/catch 是否仍平衡
- imePatch 是否覆盖已删行为
- 物理键路径是否保留

R2 结论: **APPROVED** (0 blocker / 0 important / 0 nit)
