// WYSIWYG auto-newline helpers.
// 抽离自 main.ts:在 WYSIWYG 模式输入特定字符后,自动在光标位置插入换行。
//
// 涉及 2 个函数:
//   - autoNewlineAfterBackticksInWysiwyg: 输入 ``` 或 ~~~ 后判断是否闭合围栏,是则
//     在光标处插入换行(并设置 hold 标志等用户回车再渲染)
//   - autoNewlineAfterInlineDollarInWysiwyg: 输入 $ 后,若行内数学刚闭合(奇->偶)且
//     不在围栏内,补足 2 个换行避免与公式渲染重叠
//
// 2 个模块级 hold 标志(wysiwygHoldFenceUntilEnter / wysiwygHoldInlineDollarUntilEnter)
// 走 getter/setter pair 注入:main.ts 在 2123-2124 / 2151-2152 仍会重置它们。

interface Deps {
  getWysiwyg: () => boolean
  getEditor: () => HTMLTextAreaElement
  getDirty: () => boolean
  setDirty: (v: boolean) => void
  getHoldFence: () => boolean
  setHoldFence: (v: boolean) => void
  getHoldInlineDollar: () => boolean
  setHoldInlineDollar: (v: boolean) => void
  refreshTitle: () => void
  refreshStatus: () => void
}

export interface WysiwygAutoNewlinesApi {
  autoNewlineAfterBackticksInWysiwyg: () => void
  autoNewlineAfterInlineDollarInWysiwyg: () => void
}

export function createWysiwygAutoNewlines(deps: Deps): WysiwygAutoNewlinesApi {
  // 围栏判定正则:行首允许最多 3 个空格,围栏字符 3 个以上
  const fenceRE = /^ {0,3}(```+|~~~+)/

  function isInsideFence(before: string): boolean {
    const preLines = before.split('\n')
    let insideFence = false
    let fenceCh = ''
    for (const ln of preLines) {
      const m = ln.match(fenceRE)
      if (m) {
        const ch = m[1][0]
        if (!insideFence) { insideFence = true; fenceCh = ch }
        else if (ch === fenceCh) { insideFence = false; fenceCh = '' }
      }
    }
    return insideFence
  }

  function autoNewlineAfterBackticksInWysiwyg() {
    try {
      if (!deps.getWysiwyg()) return
      const editor = deps.getEditor()
      const pos = editor.selectionStart >>> 0
      if (pos < 3) return
      const last3 = editor.value.slice(pos - 3, pos)
      if (last3 === '```' || last3 === '~~~') {
        const v = editor.value
        // 判断是否为“闭合围栏”：需要位于行首（至多 3 个空格）并且之前处于围栏内部，且围栏字符一致
        const before = v.slice(0, pos)
        const lineStart = before.lastIndexOf('\n') + 1
        const curLine = before.slice(lineStart)
        const preText = v.slice(0, lineStart)
        const preLines = preText.split('\n')
        let insideFence = false
        let fenceCh = ''
        for (const ln of preLines) {
          const m = ln.match(fenceRE)
          if (m) {
            const ch = m[1][0]
            if (!insideFence) { insideFence = true; fenceCh = ch }
            else if (ch === fenceCh) { insideFence = false; fenceCh = '' }
          }
        }
        const m2 = curLine.match(fenceRE)
        const isClosing = !!(m2 && insideFence && m2[1][0] === last3[0])

        // 在光标处插入换行，但将光标保持在换行前，便于继续输入语言标识（如 ```js\n）
        editor.value = v.slice(0, pos) + '\n' + v.slice(pos)
        editor.selectionStart = editor.selectionEnd = pos
        deps.setDirty(true)
        deps.refreshTitle()

        // 若检测到闭合，则开启“需回车再渲染”的围栏延迟
        if (isClosing) {
          deps.setHoldFence(true)
        }
      }
    } catch {}
  }

  function autoNewlineAfterInlineDollarInWysiwyg() {
    try {
      if (!deps.getWysiwyg()) return
      const editor = deps.getEditor()
      const pos = editor.selectionStart >>> 0
      if (pos < 1) return
      const v = editor.value
      // 仅在最新输入字符为 $ 时判定
      if (v[pos - 1] !== '$') return
      // 若是 $$（块级），不处理
      if (pos >= 2 && v[pos - 2] === '$') return

      // 判断是否在代码围栏内，是则不处理
      const before = v.slice(0, pos)
      if (isInsideFence(before)) return

      // 当前整行（用于检测行内 $ 奇偶）
      const lineStart = before.lastIndexOf('\n') + 1
      const lineEnd = (() => { const i = v.indexOf('\n', lineStart); return i < 0 ? v.length : i })()
      const upto = v.slice(lineStart, pos) // 行首到光标（含刚输入的 $）

      // 统计“未被转义、且不是 $$ 的单个 $”数量
      let singles = 0
      let lastIdx = -1
      for (let i = 0; i < upto.length; i++) {
        if (upto[i] !== '$') continue
        // 跳过 $$（块级）
        if (i + 1 < upto.length && upto[i + 1] === '$') { i++; continue }
        // 跳过转义 \$（奇数个反斜杠）
        let bs = 0
        for (let j = i - 1; j >= 0 && upto[j] === '\\'; j--) bs++
        if ((bs & 1) === 1) continue
        singles++
        lastIdx = i
      }

      // 若刚好闭合（奇->偶）且最后一个单 $ 就是刚输入的这个
      if (singles % 2 === 0 && lastIdx === upto.length - 1) {
        // 行内数学已闭合：延迟渲染，待用户按下回车键后再渲染
        deps.setHoldInlineDollar(true)
        // 仅在当前位置之后补足至少 2 个换行
        let have = 0
        for (let i = pos; i < v.length && i < pos + 3; i++) { if (v[i] === '\n') have++; else break }
        const need = Math.max(0, 3 - have)
        if (need > 0) {
          const ins = '\n'.repeat(need)
          editor.value = v.slice(0, pos) + ins + v.slice(pos)
          const newPos = pos + ins.length
          editor.selectionStart = editor.selectionEnd = newPos
          deps.setDirty(true)
          deps.refreshTitle()
          deps.refreshStatus()
        }
      }
    } catch {}
  }

  return {
    autoNewlineAfterBackticksInWysiwyg,
    autoNewlineAfterInlineDollarInWysiwyg,
  }
}
