// 拖拽幽灵窗脚本（从 drag-ghost.html 内联脚本外置）。
// 外置原因：发行版 CSP 的 script-src 不含 'unsafe-inline'，内联脚本会被阻断，
// 幽灵窗将永远显示静态占位文本且不再响应拖拽更新。
(function () {
  try {
    const sp = new URLSearchParams(location.search)
    const t = sp.get('text') || ''
    const el = document.getElementById('text')
    if (el) el.textContent = t
  } catch {}
})()

;(function () {
  try {
    const sp = new URLSearchParams(location.search)
    const owner = sp.get('owner') || ''
    const name = owner ? 'flymd:drag-ghost:' + owner : 'flymd:drag-ghost'
    if (typeof BroadcastChannel !== 'function') return
    const bc = new BroadcastChannel(name)
    bc.onmessage = function (ev) {
      try {
        const d = ev && ev.data
        const payload = d && typeof d === 'object' ? d : null
        if (!payload) return
        if (payload.type !== 'text') return
        const el = document.getElementById('text')
        if (el) el.textContent = String(payload.text || '')
      } catch {}
    }
    window.addEventListener('beforeunload', function () {
      try {
        bc.close()
      } catch {}
    })
  } catch {}
})()
