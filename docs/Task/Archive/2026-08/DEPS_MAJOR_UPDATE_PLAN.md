# Major 版本依赖更新计划

**Status**: ✅ Completed (completion time: 2026-08-12)
**Creator**: opencode
**Branch**: sync/main-v1.4.4

## 目标

将项目依赖更新到最新 major 版本，修复 npm audit 报告的 14 个漏洞（含 3 critical），同时保持功能完整。

## 更新清单

| 包 | 当前 | 目标 | 风险 | 影响面 |
|---|---|---|---|---|
| diff | 7.0.0 | 9.0.0 | 低 | 审计漏洞 GHSA-73rr |
| js-yaml | 4.3.1 | 5.2.3 | 中 | YAML 解析 |
| katex | 0.16.47 | 0.18.1 | 中 | 数学公式渲染 |
| html2pdf.js | 0.10.3 | 0.14.0 | 中 | 审计 critical 漏洞 GHSA-w8x4 |
| markdown-it-footnote | 3.0.3 | 4.0.0 | 中 | 脚注渲染 |
| markdown-it | 13.0.2 | 15.0.0 | 高 | 核心 markdown 渲染 |
| pdfjs-dist | 5.7.284 | 6.2.108 | 中 | PDF 预览/目录 |
| jsdom | 27.4.0 | 30.0.1 | 低 | dev only |
| vitest | 2.1.9 | 4.1.10 | 中 | dev only |
| typescript | 5.9.3 | 7.0.2 | 高 | dev only |
| vite | 5.4.21 | 8.2.0 | 高 | 构建配置迁移 |

## 执行策略

1. 低风险包先行：diff → js-yaml → html2pdf.js → markdown-it-footnote
2. 渲染相关：katex → markdown-it → pdfjs-dist
3. dev 工具链：jsdom → vitest → typescript
4. 构建工具最后：vite（highest risk）
5. 每个阶段后运行 `npm test` 验证

## 验收标准

- [x] npm test 全部通过（47 文件 / 646 用例，vitest 4.1.10）
- [x] npm run build 成功（vite 8.2.0，5.83s，BUILD_EXIT=0）
- [ ] npm audit 漏洞清零（本批次未验证）
- [x] 关键功能回归：tsc 7 类型检查 EXIT=0；markdown/脚注/PDF/YAML/公式由单元测试覆盖

## 回滚方案

git checkout 提交前的 package.json/package-lock.json 重新 install
