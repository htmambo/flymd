/**
 * 浏览器能力兼容探测
 * 从 main.ts 和 wysiwyg/v2/plugins/math.ts 抽离(byte-identical 去重)
 */

/** 探测 navigator.scheduling.isInputPending 是否可用(Chrome 87+ / Edge 87+)。
 *  在用户输入待处理时返回 true,渲染循环可主动让出主线程避免输入卡顿。 */
export function isInputPendingCompat(): boolean {
  try {
    const fn = (navigator as any)?.scheduling?.isInputPending
    if (typeof fn === 'function') return !!fn.call((navigator as any).scheduling)
  } catch {}
  return false
}
