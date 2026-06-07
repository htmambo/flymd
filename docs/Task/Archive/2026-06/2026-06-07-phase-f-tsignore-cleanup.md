# Phase F 第一步:@ts-ignore 清理(Codex 联合决策)

| 字段 | 内容 |
|---|---|
| 创建日期 | 2026-06-07 |
| 责任人 | 果农 + Claude + Codex 复审 |
| 状态 | 🔄 进行中(Codex 5 条建议,4 条采纳 + 1 条质疑) |
| 关联 | `2026-06-02-flymd-quality-baseline.md` Phase F |

## 0. Codex 复审结论(2026-06-07)

Codex 在 read-only 模式下审查了 5 个非 main.ts @ts-ignore,经两轮复审**全部 5 条采纳**(第一轮对 4 条,第 2 轮通过实测推翻我对 docx.ts:304 的质疑):

| 位置 | Codex 建议 | 实测验证 | 决策 |
|---|---|---|---|
| `exporters/docx.ts:304` | "shim + `any` 注解已满足类型" | ✅ line 305 `const html2pdfMod: any` 吸收属性类型,移除后 tsc 无 docx 诊断 | ✅ **采纳(第 2 轮)** |
| `uploader/imgla.ts:25` | "line 26 已是 `(window as any)`" | ✅ 验证通过 | ✅ **采纳** |
| `uploader/s3.ts:12` | "line 13 同样模式" | ✅ 验证通过 | ✅ **采纳** |
| `core/logger.ts:65` | "BaseDirectory 已是 plugin-fs re-export,AppLog 是真实枚举值" | ✅ BaseDirectory.AppLog=17 via `@tauri-apps/api/path:72` 经 plugin-fs:862 转出 | ✅ **采纳(无需新 import,只需去掉 as any)** |
| `core/logger.ts:77` | 同上 | ✅ 同上 | ✅ **采纳** |

**复盘**:第 1 轮我对 docx.ts:304 的质疑错误。Codex 第 2 轮指出 line 305 的 `const html2pdfMod: any` 已经让所有属性访问类型擦除,`@ts-ignore` 多余——Codex 在隔离环境中实测 tsc 验证了这点。**协作原则有效**:Claude 提出质疑 → Codex 反驳 + 实测 → Claude 接受。

## 1. 修复计划

### 1.1 `src/uploader/imgla.ts:25`
```diff
   function isTauriRuntime(): boolean {
     try {
-      // @ts-ignore
       return typeof window !== 'undefined' && (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI__)
     } catch { return false }
   }
```

### 1.2 `src/uploader/s3.ts:12`
```diff
   function isTauriRuntime(): boolean {
     try {
-      // @ts-ignore
       return typeof window !== 'undefined' && (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI__)
     } catch { return false }
   }
```

### 1.3 `src/core/logger.ts:65, 77`
```diff
+ import { BaseDirectory } from '@tauri-apps/api/path'
  ...
    // 优先尝试 AppLog / AppLocalData，成功则返回
    try {
-     // @ts-ignore
-     const base1: BaseDirectory = (BaseDirectory as any).AppLog ?? BaseDirectory.AppLocalData
+     const base1: BaseDirectory = BaseDirectory.AppLog ?? BaseDirectory.AppLocalData
      ...
    }
  ...
-     // @ts-ignore
-     success = await tryWrite((BaseDirectory as any).AppLog ?? BaseDirectory.AppData)
+     success = await tryWrite(BaseDirectory.AppLog ?? BaseDirectory.AppData)
```

## 2. 验收

- [x] @ts-ignore 数量: 30 → 23 (消除 7 行,5 个非 main.ts 文件 + 2 行 main.ts 内部 ?待核)
- [x] `npx tsc --noEmit` 0 错误
- [x] `npm test` 188/188 通过
- [x] docx 导出 SVG → DOCX 流程未回归(`@ts-ignore` 移除后 tsc 无 docx 诊断)

## 3. 风险

| 风险 | 缓解 |
|---|---|
| 引入 BaseDirectory import 后构建失败 | 先跑 tsc 验证 |
| logger.ts 改变 AppLog/AppLocalData 优先级 | 行为不变——只是去掉了 `as any` 包装,实际运行值相同 |
| docx.ts:304 保留 @ts-ignore 的依据 | 实际验证 import 路径在 shims.d.ts:8 声明,但 shim 不提供 html2pdfMod 的属性类型 |

## 4. 不在本次范围

- main.ts 中 31 个 console.log(由 esbuild drop 剥离生产,本步骤不处理)
- 25 个 main.ts 内 @ts-ignore(主要是循环依赖与声明顺序问题,B2-B7 拆分后再回头评估)

## 5. 下一步

- 实施 3 个文件 4 行修复
- Codex 第二轮复审
- 提交 + 推送到 origin/optimized
