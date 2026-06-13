// KaTeX 公式容错：修复“复制粘贴导致的双反斜杠”问题
// 典型症状：用户输入 `\\xrightarrow` / `\\circ` / `\\ce{...}`，KaTeX 会把它当成换行 + 普通文本，导致渲染失败。
// 原则：只做最小、低风险的修复——仅把 `\\<已知宏名>` 归一为 `\<宏名>`，避免影响真正的 `\\` 换行用法。

const FIXABLE_MACROS = new Set<string>([
  // mhchem
  'ce',
  'pu',
  // 反应箭头/符号（常见复制场景）
  'xrightarrow',
  'xleftarrow',
  'xleftrightarrow',
  'rightarrow',
  'leftarrow',
  'leftrightarrow',
  'uparrow',
  'downarrow',
  // 单位/温度常见
  'circ',
  // 文本/字体
  'text',
  'mathrm',
  'mathbf',
  'mathit',
])

// 剥除外层 LaTeX 文档级数学定界符：\(...\) / \[...\]
// 背景：用户从 Word / 网页复制公式时常带这两层定界符；KaTeX 在 renderToString 输入中不认，
// 直接抛 ParseError。flymd 自身的 markdown 定界符是 $$...$ / $...$，内层内容不应再含 \(...\)。
// 仅当外层严格对称（开头 \( 或 \[、结尾 \) 或 \]）且整段都被一对定界符包裹时剥除，
// 避免误伤 LaTeX 源码内部合法的 \(...\) 用法。
function stripLatexDisplayDelimiters(s: string): string {
  // 入口 normalizeKatexLatexForInline 已统一 trim，这里不再重复
  // 注意：`\\(` 是用户实际写的 `\(`（一个反斜杠 + 左括号），所以正则里用 `\\\(` 匹配
  const round = s.match(/^\\\(([\s\S]*)\\\)$/)
  if (round) return round[1]
  const square = s.match(/^\\\[([\s\S]*)\\]$/)
  if (square) return square[1]
  return s
}

export function normalizeKatexLatexForInline(latex: string): string {
  // 入口 trim：markdown 源中 $$...$$ 公式前后常带空格（用户排版 / 所见模式自动加的零宽空白等），
  // 对 KaTeX 渲染无意义且会阻断后续 \(...\) / \[...\] 定界符检测。统一先 trim。
  const s = (latex || '').toString().trim()
  // 先剥外层 \(...\) / \[...\]
  let out = stripLatexDisplayDelimiters(s)
  if (!out.includes('\\\\')) return out
  // 将 `\\macro` → `\macro`（仅限白名单宏）
  out = out.replace(/\\\\([A-Za-z]+)\b/g, (m, name: string) => {
    if (FIXABLE_MACROS.has(name)) return `\\${name}`
    return m
  })
  return out
}

