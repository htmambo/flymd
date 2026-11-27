// 启动错误浮层：从 index.html 的内联脚本外置。
// 外置原因：发行版 CSP 使用 script-src 'self'（不含 'unsafe-inline'），
// 内联脚本会被阻断；同时内联脚本本身也是注入面的一部分。
// DOM 中 #startup-errors 由 index.html 在脚本之前定义。
(function () {
  var box = document.getElementById('startup-errors')
  if (!box) return
  function show(msg) {
    box.style.display = 'block'
    box.textContent += msg + '\n'
  }
  window.addEventListener('error', function (e) {
    show('ERROR: ' + e.message + ' @ ' + (e.filename || '') + ':' + (e.lineno || 0))
  })
  window.addEventListener('unhandledrejection', function (e) {
    show('UNHANDLED REJECTION: ' + (e.reason && e.reason.stack ? e.reason.stack : String(e.reason)))
  })
})()
