# 库树图标深层(≥5级)配色被钉死修复

**状态**: ✅ 开发完成,待用户实测验收 (完成时间: 2026-06-05)
**创建人**: Claude (经 Codex read-only 复核)

## 一、目标与背景

彩色库树开启时,文件夹/文件图标应随层级在 5 阶配色间循环(scheme 1→2→3→4→5→1…)。
实测:0~4 级正常循环,**≥5 级图标颜色始终钉死在第 5 色**,不再回到第 1 色。
连接线(竖线 rail / 横线 stub)在所有层级均正常循环——只有图标异常。

## 二、根因分析

- JS 层 `fileTree.ts:722-723` 计算 `dataset.scheme = (schemeBase % 5) + 1`,**循环正确**,非问题点。
- DOM:`.lib-node` 行与其子容器 `.lib-children` 是**兄弟**(同 append 到上层 `.lib-children`);
  图标 svg 位于 `.lib-node` 行内。故图标 path 的祖先链 = 自身行 `.lib-node` + 逐层向上的 `.lib-children` 容器,
  这些载体携带 scheme 1~5 各值。
- CSS `style.css:2365-2398` 用**后代选择器**着色:`body.lib-color-depth [data-scheme="N"] .lib-ico-* path { stroke: var(--lib-color-N) }`。
  深层图标会**同时命中多条**(祖先链中每个出现过的 scheme 各一条),5 条规则**特异性完全相同 (0,3,2)**。
  CSS 规则:同特异性下**源码顺序靠后者胜** → `[data-scheme="5"]` 恒胜。
- scheme-5 载体最早出现在第 4 级目录的子容器 `.lib-children[data-scheme="5"]`,自此其下(≥5 级)所有图标祖先链都含 scheme-5 → 全部被钉死第 5 色。
- 连接线免疫:rail 用**载体自身伪元素** `.lib-children[data-scheme="N"]::before`,非后代选择器,只匹配自己那一条,故正确。

## 三、修复方案

改用 **CSS 自定义属性「就近继承」**(与源码顺序无关,只取最近定义该变量的祖先):
scheme 载体只设变量 `--lib-ico-stroke`,图标 path 消费该变量。图标的最近 `[data-scheme]` 祖先即自身行,故各级取回各自配色。

- 收紧作用域到 `.library`(变量不外泄)。
- `path` 仍直写 `stroke`/`fill`,绕开 WebKitGTK 偶发失效的 SVG currentColor 链(见 [[webkitgtk-svg-currentcolor-pitfall]]);`var()` 第二参 `currentColor` 兜底。
- 打开态 `filter: brightness(1.25)` 无 scheme 依赖,5 条合并为 1 条。
- 仅替换 `style.css:2359-2398`,40 行 → ~20 行;rail 规则(2294-2332)与关闭态兜底(2400-2403)不动。

## 四、子任务

1. ✅ Codex read-only 复核根因与方案
2. ✅ 替换 `src/style.css:2359-2398` 图标 scheme 区为变量继承方案(40 → 20 行)
3. ✅ `npx tsc --noEmit` 通过,无连带错误
4. ✅ Codex read-only 代码审核通过
5. ⏳ 用户实测验收后归档文档 + 更新 README

## 五、验收标准

- 构造 ≥6 级嵌套目录:图标配色按 1→2→3→4→5→1→2… 严格循环,不再钉死第 5 色。
- 关闭"彩色库树"开关:图标回退 `--muted`/`--accent` 原配色,与修复前一致。
- 连接线配色、hover/selected 行为不变。

## 六、风险与缓解

- **变量继承在 SVG stroke/fill 上是否生效(WebKitGTK)**:项目已有 `--lib-color-0: var(--muted)` 证明变量引用变量可用;path 直写属性符合既有规避模式。低风险。
- **作用域 `.library` 前缀**:已由现存 `.library .lib-ico{...}` 规则证明 `.library` 为图标祖先,匹配集不变。
- **hover/selected**:彩色态下原本即不改图标描边色(注释与实际行为不符,属既有现状),本次保持不变,不扩大改动面。

## 七、实施结果与审核

- 实改:仅 `src/style.css:2359-2398`,后代选择器 5×N 条 → 变量载体 5 条 + path 消费 4 条;rail(2294-2332)与关闭态兜底(2400-2403)未动。
- `npx tsc --noEmit`:无错误。
- `grep` 确认无残留旧图标后代选择器(命中项仅为注释)。
- Codex 复审通过:深层正确循环;rail/关闭态/hover/selected 无回归;`.lib-ico-folder` 不误匹配 `.lib-ico-folder-open`;全局 `fill:currentColor` 被安全覆盖;`git diff --check` 干净。

## 八、备注

- 工作区在本任务介入前已存在 `--lib-color-2..5` 配色值调换(`style.css:73-79`)及 `fileTree.ts` 行尾分号微调,均**非本任务引入**,已原样保留,是否保留由用户定夺。
- 待用户在 ≥6 级嵌套目录实测确认后,再归档至 `Archive/2026-06/` 并更新 `README.md`。
