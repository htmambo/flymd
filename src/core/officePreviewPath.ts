// Office 预览缓存路径判定（纯函数，无副作用）。
// 缓存根：temp_dir()/flymd-office-preview/<hash>/<原 stem>.md|pdf。
// 该目录是系统临时区：里面的文件绝不允许成为库根、库条目或启动恢复对象，
// 否则"预览一个 Word 文档"会把当前库翻切成只含临时副本的"临时库"。
// 判定按路径分段精确匹配目录名，兼容 macOS/Linux 的 / 与 Windows 的 \ 分隔符。

export const OFFICE_PREVIEW_CACHE_DIR_NAME = 'flymd-office-preview'

export function isOfficePreviewCachePath(pathRaw: unknown): boolean {
  try {
    const s = String(pathRaw || '').replace(/\\/g, '/')
    if (!s) return false
    return s.split('/').some(seg => seg === OFFICE_PREVIEW_CACHE_DIR_NAME)
  } catch {
    return false
  }
}

// 归一化：Office 转换预览标签强制阅读模式（mode 锁 'preview'、所见模式关闭）。
// 直接就地修改传入的 state 对象；返回是否发生了归一化。
// 调用方在返回 true 时应同步 UI 副作用（如关闭源码+阅读分屏）。
export function normalizeOfficePreviewTabState(
  filePath: unknown,
  state: { mode?: string; wysiwygEnabled?: boolean },
): boolean {
  try {
    if (!state || !isOfficePreviewCachePath(filePath)) return false
    let changed = false
    if (state.mode !== 'preview') { state.mode = 'preview'; changed = true }
    if (state.wysiwygEnabled) { state.wysiwygEnabled = false; changed = true }
    return changed
  } catch {
    return false
  }
}
