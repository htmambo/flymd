// 代码块装饰：语言角标、行号与复制按钮（仅阅读模式生成行号；不改动 hljs 结构，避免 HTML 等语言错位）
import { isCodeContentClipped } from './ui/codeExpandClip'
import { isCodeWrapEnabled } from './core/codeWrap'
import { logInfo, logDebug } from './core/logger'
import { CODEBOX_CV_CLASS } from './core/contentVisibility'


// 大文档分片常量已移除（perf 批次 H2'' 最终结论）：任何分片让出都会触发对巨型 DOM
// 的中间布局/绘制，反而放大总耗时；三相 + 同步 Pass A 是正确形态。

// perf 批次 I：代码块数量超过此阈值才启用离屏渲染裁剪（content-visibility）。
// 200 块已属罕见场景（普通笔记远低于此），命中范围小，异常行为面可控。
const HEAVY_CODE_BLOCK_THRESHOLD = 200

// 装饰分相（perf 批次 H2'，真机 3352 块冻结的根治）：
// 原实现逐块"写（包装/行号列）→ 读（getComputedStyle/Rect）"交替，每块强制布局一次，
// 巨型 DOM 上 3352 块 = 上万次布局（分钟级）。改为跨块三相：
//   Pass A 纯写（包装/行号列骨架/探针/角标按钮）——**同步单任务，无分片让出**：
//     纯写不触发布局；实测任何中途让出都会让浏览器对已累积的巨型 DOM 反复
//     布局+绘制（真机数据：34 个分片间隙 × 数秒/次 = 装饰 134 秒，占总时长 99.6%）
//   Pass B 纯读（一次布局读齐全部 computed style / 矩形 / 裁剪判定）
//   Pass C 纯写（应用行高对齐/微对齐/展开按钮显隐/换行模式测量）
// 端态与逐块版逐字等价（各值来源与计算式不变）；布局+绘制从 ~块数 次降为常数次。
// —— 换行高度共享重测表（perf 批次 H 终版）——
// 不再为每块建 ResizeObserver：3352 个 RO 的初始回调与 content-visibility 尺寸
// 切换会形成持续布局风暴（真机实测启用所见后 ~63% CPU 持续）。注册到共享表，
// 由唯一的 RO（观察预览容器）+ 字体就绪事件统一触发跨块批量重测。
// perf 批次 I：target = content-visibility 载体（.codebox）。
// content-visibility: auto 生效时，被跳过子树的内部元素没有盒子，IntersectionObserver
// 不会触发；观察载体本身（它始终有盒子）才能可靠收到进入视口的信号。
type WrapReg = { code: HTMLElement; lines: string[]; lnWrap: HTMLDivElement; pre: HTMLElement; target: HTMLElement; measured: boolean }
const wrapRegistry = new Set<WrapReg>()
let wrapSharedRO: ResizeObserver | null = null
let wrapRebatchTimer: ReturnType<typeof setTimeout> | null = null
// 视口驱动懒测量（perf 批次 H 终版）：content-visibility 激活后，读取离屏块的
// clientWidth 会强制该块完整布局——"全量批测"实际退化为全页逐块布局（单次 38s）。
// 改为 IntersectionObserver 驱动：只测视口附近（±1500px）的块（它们已布局，读取
// 免费），滚动时增量测量新接近的块，远端块永不测量。
let wrapSharedIO: IntersectionObserver | null = null
const WRAP_IO_ROOT_MARGIN = '1500px 0px'

function wrapRectNearViewport(pre: HTMLElement): boolean {
  try {
    const r = pre.getBoundingClientRect()
    const vh = window.innerHeight || 800
    return r.bottom > -WRAP_NEAR_PX && r.top < vh + WRAP_NEAR_PX
  } catch {
    return false
  }
}
const WRAP_NEAR_PX = 1500

function buildWrapProbe(code: HTMLElement, lines: string[]): { probe: HTMLDivElement; rows: HTMLElement[] } | null {
  try {
    const width = code.clientWidth
    if (!width || width <= 0) return null
    const cs = getComputedStyle(code)
    const probe = document.createElement('div')
    probe.style.position = 'absolute'
    probe.style.visibility = 'hidden'
    probe.style.pointerEvents = 'none'
    probe.style.left = '-99999px'
    probe.style.top = '0'
    probe.style.whiteSpace = 'pre-wrap'
    probe.style.overflowWrap = 'anywhere'
    probe.style.boxSizing = 'border-box'
    probe.style.width = width + 'px'
    probe.style.fontFamily = cs.fontFamily
    probe.style.fontSize = cs.fontSize
    probe.style.fontWeight = cs.fontWeight
    probe.style.lineHeight = cs.lineHeight
    probe.style.letterSpacing = cs.letterSpacing
    try { (probe.style as any).tabSize = cs.tabSize } catch {}
    const rows: HTMLElement[] = []
    for (const line of lines) {
      const d = document.createElement('div')
      // 空行用 nbsp 占位，保证占满一行行高
      d.textContent = line.length ? line : ' '
      rows.push(d)
      probe.appendChild(d)
    }
    return { probe, rows }
  } catch {
    return null
  }
}

/** 跨块批量换行测量：单次挂载 + 单次读取（全部块共用一次强制布局）。返回与 jobs 一一对应。 */
function batchMeasureWrapHeights(jobs: Array<{ code: HTMLElement; lines: string[] }>): number[][] {
  const out: number[][] = []
  const host = document.createElement('div')
  const allRows: HTMLElement[][] = []
  for (const job of jobs) {
    const built = buildWrapProbe(job.code, job.lines)
    if (!built) { out.push([]); allRows.push([]); continue }
    host.appendChild(built.probe)
    allRows.push(built.rows)
  }
  try { document.body.appendChild(host) } catch {}
  for (const rows of allRows) out.push(rows.map((el) => el.offsetHeight))
  host.remove()
  return out
}

function wrapApplyHeights(reg: WrapReg, heights: number[]): void {
  try {
    if (!reg.pre.isConnected) return
    const lnSpans = Array.from(reg.lnWrap.querySelectorAll('.ln')) as HTMLElement[]
    for (let i = 0; i < lnSpans.length && i < heights.length; i++) {
      lnSpans[i].style.height = heights[i] + 'px'
    }
  } catch {}
}

function wrapRebatchAll(): void {
  try {
    for (const reg of wrapRegistry) if (!reg.pre.isConnected) wrapRegistry.delete(reg)
    // 只重测视口附近的块（离屏块读取 clientWidth 会强制其布局，见上）
    const near = [...wrapRegistry].filter((r) => r.pre.isConnected && wrapRectNearViewport(r.pre))
    if (!near.length) return
    const heights = batchMeasureWrapHeights(near.map((r) => ({ code: r.code, lines: r.lines })))
    near.forEach((reg, i) => wrapApplyHeights(reg, heights[i]))
  } catch {}
}

function scheduleWrapRebatch(): void {
  try {
    if (wrapRebatchTimer) return
    wrapRebatchTimer = setTimeout(() => { wrapRebatchTimer = null; try { wrapRebatchAll() } catch {} }, 300)
  } catch {}
}

function ensureWrapSharedRO(preview: HTMLElement): void {
  if (wrapSharedRO) return
  try {
    wrapSharedRO = new ResizeObserver(() => scheduleWrapRebatch())
    wrapSharedRO.observe(preview)
  } catch {}
  try { (document as any).fonts?.ready?.then(() => scheduleWrapRebatch()) } catch {}
}

function ensureWrapSharedIO(): void {
  if (wrapSharedIO) return
  try {
    wrapSharedIO = new IntersectionObserver((entries) => {
      try {
        const near: WrapReg[] = []
        for (const e of entries) {
          if (!e.isIntersecting) continue
          for (const reg of wrapRegistry) {
            if (reg.target === e.target && !reg.measured) { near.push(reg); reg.measured = true; break }
          }
        }
        if (!near.length) return
        const heights = batchMeasureWrapHeights(near)
        near.forEach((reg, i) => wrapApplyHeights(reg, heights[i]))
      } catch {}
    }, { rootMargin: WRAP_IO_ROOT_MARGIN })
  } catch {}
}
// 每次渲染后对新块启用观察（由 decorateCodeBlocks 调用）
function observeWrapBlocks(): void {
  if (!wrapSharedIO) ensureWrapSharedIO()
  try {
    for (const reg of wrapRegistry) {
      if (!reg.measured) { try { wrapSharedIO?.observe(reg.target) } catch {} }
    }
  } catch {}
}

export async function decorateCodeBlocks(preview: HTMLElement): Promise<void> {
  try {
    const codes = Array.from(preview.querySelectorAll('pre > code.hljs')) as HTMLElement[]
    // perf 批次 I：代码块数量超阈值时，对离屏代码块启用 content-visibility
    // （跳过布局/绘制），显著改善大文档滚动帧率。普通文档不启用，行为与此前完全一致。
    //
    // 关键：标记**不能**在测量之前生效。Pass B 要读 pre 的 scrollHeight/clientHeight
    // 来判定超高块（展开按钮显隐）；若此时 content-visibility 已生效，离屏块子树
    // 被跳过布局、读到的尺寸为 0，判定会全部失真。因此标记推迟到 Pass C（纯写段）
    // 逐块施加：测量时布局正常，测量完成后浏览器在下一次布局时即可跳过离屏子树。
    const heavyCode = codes.length > HEAVY_CODE_BLOCK_THRESHOLD
    // wysiwyg 判定对所有块一致，提到循环外（closest 非布局读取）
    let isWysiwyg = false
    try {
      const containerEl = preview.closest('.container') as HTMLElement | null
      isWysiwyg = !!(containerEl && (containerEl.classList.contains('wysiwyg') || containerEl.classList.contains('wysiwyg-v2')))
    } catch {}

    type DeferredDecor = {
      box: HTMLElement
      pre: HTMLElement
      code: HTMLElement
      lnWrap: HTMLDivElement | null
      expandBtn: HTMLButtonElement
      probe: HTMLSpanElement | null
      lines: string[] | null
    }
    const deferred: DeferredDecor[] = []

    // —— Pass A（纯写，无任何布局读取）：同步单任务跑完，中途不让出——
    // 让出 = 浏览器绘制中间状态 = 对已累积的巨型 DOM 反布局（真机实测 34 次让出
    // × 数秒/次 = 134 秒）。纯写本身不触发布局，单任务结束后才进入唯一的布局/绘制。
    const _tPassA = performance.now()
    try { logDebug('[decorate] Pass A 开始', { 块数: codes.length }) } catch {}
    for (const code of codes) {
      const pre = code.parentElement as HTMLElement | null
      if (!pre || pre.getAttribute('data-codebox') === '1') continue
      if (code.classList.contains('language-mermaid')) continue

      const lang = ((Array.from(code.classList).find(c => c.startsWith('language-')) || '').slice(9) || 'text').toUpperCase()

      // 外层容器（不改动 code 内部结构）
      const box = document.createElement('div')
      box.className = 'codebox'
      if (pre.parentElement) pre.parentElement.insertBefore(box, pre)
      box.appendChild(pre)

      // 仅在阅读模式生成行号列
      let lnWrap: HTMLDivElement | null = null
      let probe: HTMLSpanElement | null = null
      let lines: string[] | null = null
      if (!isWysiwyg) {
        try {
          const raw = code.textContent || ''
          lines = raw.endsWith('\n') ? raw.slice(0, -1).split('\n') : raw.split('\n')
          lnWrap = document.createElement('div')
          lnWrap.className = 'code-lnums'
          lnWrap.setAttribute('aria-hidden', 'true')
          let buf = ''
          for (let i = 0; i < lines.length; i++) buf += '<span class="ln">' + (i + 1) + '</span>'
          lnWrap.innerHTML = buf
          // 行号列宽按位数动态计算：CSS 固定 3.5em 约容纳 3 位数字，超过 999 行时
          // 按实际位数加宽（等宽字体 + tabular-nums 下每位数字恰为 1ch），
          // 并同步加宽 pre 的 padding-left 让位（需 important 压过 CSS 里的固定公式）
          const digits = String(lines.length).length
          if (digits > 3) {
            const colWidth = `calc(${digits}ch + 0.6em + 0.5ch)` // 数字区 + 左内边距 0.6em + 右内边距 0.5ch
            lnWrap.style.width = colWidth
            pre.style.setProperty('padding-left', `calc(var(--code-pre-pad-y, 20px) + ${digits}ch + 0.6em + 0.5ch + 1px)`, 'important')
          }
          pre.appendChild(lnWrap)
          // 微对齐探针：插入动作留在 Pass A（纯写），矩形读取统一在 Pass B
          probe = document.createElement('span')
          probe.style.display = 'inline-block'
          probe.style.width = '0'; probe.style.height = '0'; probe.style.padding = '0'; probe.style.margin = '0'
          code.insertBefore(probe, code.firstChild)
        } catch {}
      }

      // 角标与复制按钮
      const badge = document.createElement('div')
      badge.className = 'code-lang'
      badge.textContent = lang
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'code-copy'
      // 与所见模式一致的图标按钮(feather copy 图标);
      // 反馈走 codeCopyEvents 图标分支:成功对勾/失败叉,1.2s 还原
      btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>'
      box.appendChild(badge)
      box.appendChild(btn)

      // 缩放按钮（复制按钮左侧，点击行为在 codeCopyEvents 的全局委托中统一处理）：
      // 仅当内容实际超高（限高生效）时显示，展开状态由 .codebox 上的 .code-expanded 标记
      // 显示值依赖 isCodeContentClipped 读取 → Pass B 判定、Pass C 应用；初始隐藏防闪现
      const expandBtn = document.createElement('button')
      expandBtn.type = 'button'
      expandBtn.className = 'code-expand'
      expandBtn.title = '全高显示代码块'
      expandBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line><line x1="3" y1="21" x2="3" y2="14"></line></svg>'
      expandBtn.style.display = 'none'
      box.appendChild(expandBtn)

      pre.setAttribute('data-codebox', '1')
      deferred.push({ box, pre, code, lnWrap, expandBtn, probe, lines })
    }

    // —— Pass B（纯读，零写入）：一次布局读齐全部测量值 ——
    // 内存打点（perf 批次 H 定位专用）：同步块内异步 logger 落不了盘，
    // 用纯内存采样数组在装饰结束时一次性输出
    const _traceMarks: Array<{ at: string; ms: number }> = []
    let _traceLast = performance.now()
    const _traceTick = (at: string) => {
      const now = performance.now()
      _traceMarks.push({ at, ms: Math.round(now - _traceLast) })
      _traceLast = now
    }
    const _tPassB = performance.now()
    const msPassA = Math.round(_tPassB - _tPassA)
    try { logDebug('[decorate] Pass B 开始', { 块数: deferred.length, 写入ms: msPassA }) } catch {}
    const measured = deferred.map((d) => {
      try {
        let lhStr = ''
        let padTop = 0
        let delta = 0
        if (d.lnWrap && d.probe) {
          _traceTick('B:前半-getComputedStyle')
          const cs = getComputedStyle(d.code)
          const csPre = getComputedStyle(d.pre)
          // 行高与字号（像素）
          lhStr = cs.lineHeight
          const fsStr = cs.fontSize
          const lh = parseFloat(lhStr || '0')
          const fs = parseFloat(fsStr || '0')
          const pt = parseFloat(csPre.paddingTop || '0')
          // 以 half-leading 修正：offset = max((lh - fs)/2, 0)
          let offset = 0
          if (isFinite(lh) && isFinite(fs) && lh > fs) offset = (lh - fs) / 2
          padTop = Math.max(0, pt + offset)
          // 微对齐：测量第一行在 pre 内的实际像素起点，修正与行号列的起点差（通常为 0~2px）
          const preRect = d.pre.getBoundingClientRect()
          const probeRect = d.probe.getBoundingClientRect()
          const yFirst = (probeRect.top - preRect.top) + d.pre.scrollTop  // 代码第一行相对 pre 顶部位置
          delta = Math.round(yFirst - padTop)
        }
        _traceTick('B:isCodeContentClipped前')
        // perf 批次 I：离屏裁剪的占位高度。
        // content-visibility:auto 的 contain-intrinsic-size 必须等于**真实内容盒高度**，
        // 否则滚动条比例失真——实测（Chrome 155，3000 块）固定 120px 占位会让
        // 文档高度虚高 1.59 倍；按块写入真实高度后高度比回到 1.0000。
        // 必须在打标之前测量：打标后离屏子树跳过布局，clientHeight 只会读到占位值。
        let boxContentH = 0
        try {
          const csBox = getComputedStyle(d.box)
          const bPadT = parseFloat(csBox.paddingTop || '0') || 0
          const bPadB = parseFloat(csBox.paddingBottom || '0') || 0
          const bh = d.box.clientHeight - bPadT - bPadB
          if (isFinite(bh) && bh > 0) boxContentH = bh
        } catch {}
        const clipped = isCodeContentClipped(d.pre)
        _traceTick('B:块完成')
        return { d, lhStr, padTop, delta, clipped, boxContentH }
      } catch {
        return null
      }
    })
    _traceTick('B:end(map完成)')

    // —— Pass C（纯写，应用测量结果）——
    // 关键：拆成 C1（全部探针移除）与 C2（全部样式应用）两个纯写段。
    // 实测（真机 3352 块）：块内"样式写 → DOM 突变"交错会让 WebKit 在每次突变时
    // updateStyleIfNeeded 重算全部累积脏样式 → O(N²)（Pass C 曾达 102 秒）。
    // C1 在干净树上突变、C2 之后零突变，把交错断开 → O(N)。
    const _tPassC = performance.now()
    _traceTick('C:start')
    const msPassB = Math.round(_tPassC - _tPassB)
    const wrapEnabled = isCodeWrapEnabled()
    _traceTick('C:wrapEnabled后')
    const _tC1 = performance.now()
    for (const m of measured) {
      if (!m) continue
      try { if (m.d.probe) m.d.probe.remove() } catch {}
    }
    _traceTick('C1:end(探针移除)')
    const msC1 = Math.round(performance.now() - _tC1)
    const _tC2 = performance.now()
    for (const m of measured) {
      if (!m) continue
      try {
        if (m.d.lnWrap) {
          // 与代码实际行高对齐：读取 computed line-height（像素）并应用到行号列
          if (m.lhStr && m.lhStr !== 'normal') m.d.lnWrap.style.lineHeight = m.lhStr
          const finalPad = (isFinite(m.delta) && Math.abs(m.delta) <= 4) ? (m.padTop + m.delta) : m.padTop
          m.d.lnWrap.style.paddingTop = finalPad + 'px'
        }
        m.d.expandBtn.style.display = m.clipped ? '' : 'none'
        // perf 批次 I：测量完成后再逐块打离屏裁剪标记（Pass C 是纯写段，不触发布局）
        // 占位高度按块写入内联样式：contain-intrinsic-size 决定离屏块占多高，
        // 写错会让整个文档的滚动比例失真（见 Pass B 注释里的实测数据）。
        // 为什么不做"按块高度阈值"再筛一遍：门控 heavyCode 的语义是
        // "本文档代码块很多（>200）才值得开裁剪"，开之后**逐块都裁**收益最大
        // （实测 3000 块 × 3 行的小块场景，布局成本仍快 6.6 倍）；而占位误差
        // 已由"按块实测真实高度"消除，再加一道块级阈值只会白白丢掉收益。
        // 所见模式不打标：所见模式内容可编辑，占位高度会随编辑失真；
        // 且所见模式的滚动由 milkdown 自己的 DOM 承担，不走预览 DOM。
        if (heavyCode && !isWysiwyg && m.boxContentH > 0) {
          m.d.box.style.containIntrinsicSize = 'auto ' + Math.round(m.boxContentH) + 'px'
          m.d.box.classList.add(CODEBOX_CV_CLASS)
        }
      } catch (e) {
        // 不阻断装饰流程,但留痕:打标失败会让该块占位高度失真
        try { console.warn('[decorate] 离屏裁剪打标失败:', e) } catch {}
      }
    }
    const msC2 = Math.round(performance.now() - _tC2)
    if (wrapEnabled) {
      // —— 换行高度懒测量（perf 批次 H 终版）——
      // 注册到共享表，由 IntersectionObserver 驱动：仅视口附近（±1500px）的块
      // 参与批量测量；滚动接近时增量测量，远端块永不测量（读取离屏块宽度会
      // 强制其布局，全量批测在 content-visibility 下退化为全页逐块布局）。
      for (const reg of wrapRegistry) if (!reg.pre.isConnected) wrapRegistry.delete(reg)
      const pending: WrapReg[] = []
      for (const m of measured) {
        if (!m || !m.d.lnWrap || !m.d.lines) continue
        try {
          // 观察 content-visibility 载体（.codebox）；无载体时退回 pre
          const target = (m.d.pre.closest('.codebox') as HTMLElement | null) || m.d.pre
          const reg: WrapReg = { code: m.d.code, lines: m.d.lines, lnWrap: m.d.lnWrap, pre: m.d.pre, target, measured: false }
          pending.push(reg)
          wrapRegistry.add(reg)
        } catch {}
      }
      ensureWrapSharedIO()
      ensureWrapSharedRO(preview)
      observeWrapBlocks()
      // 首批：当前视口附近的块立即测量（ IO 回调对本轮新注册块同样会触发，
      // 这里显式同步处理一次，避免行号列首屏短暂无高度）
      const firstBatch = pending.filter((r) => wrapRectNearViewport(r.pre))
      if (firstBatch.length) {
        _traceTick('W:首批测量开始')
        const heights = batchMeasureWrapHeights(firstBatch.map((r) => ({ code: r.code, lines: r.lines })))
        firstBatch.forEach((reg, i) => { wrapApplyHeights(reg, heights[i]); reg.measured = true })
        _traceTick(`W:首批测量完成(${firstBatch.length}块)`)
      }
    }
    // perf 批次 H 分相观测：装饰 ≥300ms 时记录各相耗时与逐语句内存采样
    const msPassC = Math.round(performance.now() - _tPassC)
    _traceTick('C:end(含wrap段)')
    const msTotalDecorate = msPassA + msPassB + msPassC
    if (msTotalDecorate >= 300) {
      try {
        const top = [..._traceMarks].sort((a, b) => b.ms - a.ms).slice(0, 6)
        logInfo('[启动耗时] 代码块装饰分相', {
          块数: deferred.length,
          写入ms: msPassA,
          读取ms: msPassB,
          应用ms: msPassC,
          探针移除ms: msC1,
          样式应用ms: msC2,
          总计ms: msTotalDecorate,
          最耗时语句: top.map((t) => `${t.at}:${t.ms}ms`).join(' | '),
        })
      } catch {}
    }
  } catch {}
}
