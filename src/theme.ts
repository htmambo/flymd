// 主题系统（中文注释）
// - 目标：
//   1) 提供“主题”入口（按钮由 main.ts 注入），显示一个面板选择颜色与排版
//   2) 支持源码/阅读两种独立背景色（所见模式与阅读模式共用同一纸面背景）
//   3) 预留扩展 API：注册颜色、注册排版、注册整套主题
//   4) 首次启动应用保存的主题自动生效
// - 实现策略：
//   使用 .container 作用域内的 CSS 变量覆盖（--bg / --preview-bg），避免影响标题栏等外围 UI。
//   背景语义收敛为两套：源码编辑区（textarea / CM6 / 行号栏）= --bg；
//   阅读模式与所见模式 = --preview-bg（所见与阅读已共用 .md-content 排版层，
//   纸面背景再拆一份只会制造第二套事实源，并让夜间分支漏清理内联变量）。

// 运行期依赖（仅在需要时使用）
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { getSourceLineNumbersEnabled, setSourceLineNumbersEnabled } from './core/sourceLineNumbersPref'
import { CM6_VIEW_CLASS } from './modes/editorEngine'
import { readFile, writeFile, mkdir, exists, remove, BaseDirectory } from '@tauri-apps/plugin-fs'
import { homeDir, desktopDir, join } from '@tauri-apps/api/path'
import { invoke } from '@tauri-apps/api/core'
import { t } from './i18n'
import { getPasteUrlTitleFetchEnabled, setPasteUrlTitleFetchEnabled } from './core/pasteUrlTitle'
import { getPasteRemoteImagesEnabled, setPasteRemoteImagesEnabled } from './core/pasteRemoteImages'
import { getSymbolAutoCompletionEnabled, setSymbolAutoCompletionEnabled } from './core/symbolAutoCompletion'
import { getContentFontSize, setContentFontSize } from './core/uiZoom'
import { NETWORK_PROXY_DEFAULT_NO_PROXY, normalizeNetworkNoProxy } from './core/networkProxy'
import { getUpdateCheckDisabled, setUpdateCheckDisabled } from './core/updateCheckPrefs'
import { getDefaultOutlineTabEnabled, setDefaultOutlineTabEnabled } from './core/defaultOutlineTab'
import { isCodeWrapEnabled, setCodeWrapEnabled } from './core/codeWrap'
import { NotificationManager } from './core/uiNotifications'
export type MdStyleId = 'standard' | 'github' | 'notion' | 'journal' | 'card' | 'docs' | 'typora' | 'obsidian' | 'bear' | 'minimalist'

export interface ThemePrefs {
  /**
   * 编辑背景 —— **镜像输出字段**。
   * 背景已合并为单一设置，实际生效色以 {@link ThemePrefs.readBg} 为准；
   * 本字段仅在写入时与 readBg 同步，保留是为了不破坏 plugin.md 的公开字段
   * 与既有存储结构 —— 渲染路径不再读取它，请勿新增消费点。
   */
  editBg: string
  /**
   * 阅读背景（纸面色）—— **统一背景的唯一事实源（锚点）**。
   * 明暗轴由 body.dark-mode 决定取本字段还是 {@link ThemePrefs.readBgDark}。
   */
  readBg: string
  /**
   * @deprecated 所见背景已并入阅读背景（--preview-bg），不再被消费。
   * 仅保留此字段以原样回写旧配置，保证 git revert 后用户设置不丢——请勿新增消费点。
   */
  wysiwygBg: string
  /** 夜间模式编辑背景 —— 镜像输出字段（同 editBg）。 */
  editBgDark?: string
  /** 夜间模式阅读背景 —— 夜间模式的锚点。 */
  readBgDark?: string
  /** 羊皮风格（统一开关）：源码编辑区与阅读/所见正文同时启用。 */
  parchment?: boolean
  /** 源码模式羊皮风格 —— 镜像输出字段（同 parchment）。 */
  parchmentEdit?: boolean
  /** 阅读模式羊皮风格 —— 镜像输出字段（同 parchment）。 */
  parchmentRead?: boolean
  /**
   * 合并为单一设置**之前**的独立取值备份。
   * 仅在两域确实分歧且尚未备份过时写入一次（幂等），保证 git revert 后
   * 用户原先各自独立的背景值与羊皮开关可以恢复。
   */
  preUnifyBg?: {
    editBg?: string
    readBg?: string
    editBgDark?: string
    readBgDark?: string
    parchmentEdit?: boolean
    parchmentRead?: boolean
  }
  /**
   * @deprecated 所见模式羊皮风格开关已随「所见背景」设置一并移除；
   * 阅读羊皮纸通过 .md-content 同时作用于所见模式。仅保留字段以原样回写旧配置。
   */
  parchmentWysiwyg?: boolean
  mdStyle: MdStyleId
  themeId?: string
  /** 自定义正文字体（预览/WYSIWYG 正文），为空则使用默认/排版风格 */
  bodyFont?: string
  /** 正文字体是否作用于整个界面 UI（菜单 / 按钮 / 插件容器等） */
  bodyFontGlobal?: boolean
  /** 自定义等宽字体（编辑器与代码），为空则使用系统等宽栈 */
  monoFont?: string
  /** 源码模式网格背景 */
  gridBackground?: boolean
  /** 文件夹图标 */
  folderIcon?: string
  /** 排版：行高 (1.2-2.5) */
  lineHeight?: number
  /** 排版：段落间距 (0-2em) */
  paragraphSpacing?: number
  /** 排版：内容最大宽度 (0=自适应, 600-1200px) */
  contentMaxWidth?: number
  /** 排版：首行缩进 (0-4em) */
  textIndent?: number
}

export interface ThemeDefinition {
  id: string
  label: string
  /** 只保留源码/阅读两种纸面色；所见背景已并入阅读背景 */
  colors?: Partial<Pick<ThemePrefs, 'editBg' | 'readBg'>>
  mdStyle?: MdStyleId
}

const STORE_KEY = 'flymd:theme:prefs'
const LIB_COLOR_DEPTH_KEY = 'flymd:lib:colorDepth'

/**
 * 日间背景默认色 —— 与 base.css 的 `--preview-bg: #fafafa` 对齐。
 * 必须与 CSS 字面量保持一致（themeBgUnify.test.ts 有断言锁定，防止两边漂移）。
 */
const DAY_BG_DEFAULT = '#fafafa'
/** 夜间背景默认色 —— 与 base.css 暗色分支的 `--preview-bg: #12100d` 对齐。 */
const NIGHT_BG_DEFAULT = '#12100d'
/**
 * 旧版本用 getCssVar('--preview-bg') 取默认值，在深色系统上会读到**夜间**值，
 * 并在用户改动任意主题设置时被一并写进存储 → 浅色模式下纸面变近黑。
 * 背景锚点化后该污染值会影响整个窗口，故载入时按此特征重置回日间默认。
 */
const LEGACY_DARK_CAPTURE = NIGHT_BG_DEFAULT

const DEFAULT_PREFS: ThemePrefs = {
  editBg: DAY_BG_DEFAULT,
  readBg: DAY_BG_DEFAULT,
  /** @deprecated 仅作旧配置回写用，见 ThemePrefs.wysiwygBg */
  wysiwygBg: '#e9edf5',
  editBgDark: NIGHT_BG_DEFAULT,
  readBgDark: NIGHT_BG_DEFAULT,
  mdStyle: 'standard',
}

const _themes = new Map<string, ThemeDefinition>()
const _palettes: Array<{ id: string; label: string; color: string }> = []
const THEME_FONT_DB_KEY = 'flymd:theme:fonts'
const THEME_FONTS_DIR = 'fonts'
const THEME_NET_PROXY_KEY = 'flymd:net:proxy'
let _themeUiBound = false
let _themePanelReady = false
let _themeRuntimeBootstrapped = false

// 当前视图里是否存在"源码行号列"：
//   - textarea 源码模式（含源码+阅读分屏）：`.editor-gutter`
//   - 大文件 CM6 源码视图：`.cm-gutters`（容器类 wysiwyg-cm6 由 enableCm6Mode 挂载）
// 只有存在行号列时，切开关的效果才是即时可见的，才不需要额外提示。
function hasSourceLineNumberColumn(mode: string | null, wysiwyg: boolean | null): boolean {
  if (mode === 'edit' && wysiwyg === false) return true
  try {
    return !!document.querySelector(`.container.${CM6_VIEW_CLASS}`)
  } catch {
    return false
  }
}

// 库树彩虹色开关:默认开启。开启时 body 加 lib-color-depth class,5 阶 scheme 规则生效;
// 关闭时移除 class,5 阶 scheme 规则全不生效,沿用 --muted/--accent 原配色
function getLibColorDepthEnabled(): boolean {
  try {
    return localStorage.getItem(LIB_COLOR_DEPTH_KEY) !== 'false'
  } catch {
    return true
  }
}

function setLibColorDepthEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(LIB_COLOR_DEPTH_KEY, enabled ? 'true' : 'false')
  } catch {}
  try {
    document.body.classList.toggle('lib-color-depth', enabled)
  } catch {}
}

// 工具：读当前 :root/.container 上的变量（若无则返回空串）
function getContainer(): HTMLElement | null {
  return document.querySelector('.container') as HTMLElement | null
}

type CustomThemeFont = { id: string; name: string; rel: string; ext: string; family: string }

function loadThemeFontDb(): CustomThemeFont[] {
  try {
    const raw = localStorage.getItem(THEME_FONT_DB_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr as CustomThemeFont[] : []
  } catch {
    return []
  }
}

function getThemeFontFormat(ext: string): string {
  const e = String(ext || '').toLowerCase()
  if (e === 'ttf') return 'truetype'
  if (e === 'otf') return 'opentype'
  if (e === 'woff2') return 'woff2'
  return 'woff'
}

async function injectThemeFontFace(font: CustomThemeFont): Promise<void> {
  try {
    if (!font?.id || !font?.rel || !font?.family) return
    if (document.querySelector(`style[data-user-font="${font.id}"]`)) return
    const bytes = await readFile(`${THEME_FONTS_DIR}/${font.rel}` as any, { baseDir: BaseDirectory.AppLocalData } as any) as Uint8Array
    const fmt = getThemeFontFormat(font.ext)
    const mime = fmt === 'woff2' ? 'font/woff2' : (fmt === 'woff' ? 'font/woff' : 'font/ttf')
    const blob = new Blob([bytes as any], { type: mime })
    const url = URL.createObjectURL(blob)
    const style = document.createElement('style')
    style.dataset.userFont = font.id
    style.textContent = `@font-face{font-family:'${font.family}';src:url(${url}) format('${fmt}');font-weight:normal;font-style:normal;font-display:swap;}`
    document.head.appendChild(style)
  } catch {}
}

function loadThemeNetProxyPrefs(): { enabled: boolean; proxyUrl: string; noProxy: string } | null {
  try {
    const raw = localStorage.getItem(THEME_NET_PROXY_KEY)
    if (!raw) return null
    const v = JSON.parse(raw || '{}') as any
    return {
      enabled: !!v.enabled,
      proxyUrl: typeof v.proxyUrl === 'string' ? v.proxyUrl : '',
      noProxy: normalizeNetworkNoProxy(typeof v.noProxy === 'string' ? v.noProxy : ''),
    }
  } catch {
    return null
  }
}

function bootstrapThemeRuntime(): void {
  if (_themeRuntimeBootstrapped) return
  _themeRuntimeBootstrapped = true
  try {
    const fonts = loadThemeFontDb()
    for (const font of fonts) void injectThemeFontFace(font)
  } catch {}
  try {
    const prefs = loadThemeNetProxyPrefs()
    if (!prefs) return
    void invoke('set_network_proxy', {
      enabled: !!prefs.enabled,
      proxyUrl: String(prefs.proxyUrl || '').trim(),
      noProxy: String(prefs.noProxy || '').trim(),
    }).catch(() => {})
  } catch {}
}

// 工具：解析颜色字符串（十六进制或 rgb/rgba），用于计算菜单栏/标签栏/侧栏等“外圈 UI”的衍生色
function parseColor(input: string): { r: number; g: number; b: number } | null {
  try {
    if (!input) return null
    let s = input.trim().toLowerCase()

    // 十六进制形式
    if (s.startsWith('#')) {
      s = s.slice(1)
      if (s.length === 3) {
        const r3 = s[0]
        const g3 = s[1]
        const b3 = s[2]
        s = r3 + r3 + g3 + g3 + b3 + b3
      }
      if (s.length !== 6) return null
      const r16 = Number.parseInt(s.slice(0, 2), 16)
      const g16 = Number.parseInt(s.slice(2, 4), 16)
      const b16 = Number.parseInt(s.slice(4, 6), 16)
      if ([r16, g16, b16].some(v => Number.isNaN(v))) return null
      return { r: r16, g: g16, b: b16 }
    }

    // rgb / rgba 形式
    if (s.startsWith('rgb')) {
      const m = s.match(/rgba?\s*\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/)
      if (!m) return null
      const r = Number.parseFloat(m[1])
      const g = Number.parseFloat(m[2])
      const b = Number.parseFloat(m[3])
      if ([r, g, b].some(v => !Number.isFinite(v))) return null
      return { r, g, b }
    }

    // 其它格式暂不支持
    return null

  } catch {
    return null
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  const to2 = (v: number) => clamp(v).toString(16).padStart(2, '0')
  return `#${to2(r)}${to2(g)}${to2(b)}`
}

/**
 * 验证十六进制颜色格式（支持 #RGB 和 #RRGGBB）
 */
function isValidHexColor(color: string): boolean {
  const trimmed = color.trim()
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(trimmed)
}

/**
 * 标准化十六进制颜色（将 #RGB 转为 #RRGGBB）
 */
function normalizeHexColor(color: string): string {
  const trimmed = color.trim().toUpperCase()
  if (/^#[0-9A-F]{3}$/.test(trimmed)) {
    // #RGB → #RRGGBB
    const r = trimmed[1]
    const g = trimmed[2]
    const b = trimmed[3]
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return trimmed
}

function deriveChromeColors(baseColor: string): { chromeBg: string; chromePanelBg: string } | null {
  const rgb = parseColor(baseColor)
  if (!rgb) return null

  // 简单亮度估算：区分“偏亮/偏暗”，以决定往深/浅微调
  const brightness = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b
  const isDark = brightness < 128

  // 外圈背景比内容区只略微拉开亮度，避免对比度过大
  const surfaceDelta = isDark ? 8 : -6   // 标题栏/标签栏
  const panelDelta = isDark ? 14 : -10  // 侧栏等面板

  const chromeBg = rgbToHex(rgb.r + surfaceDelta, rgb.g + surfaceDelta, rgb.b + surfaceDelta)
  const chromePanelBg = rgbToHex(rgb.r + panelDelta, rgb.g + panelDelta, rgb.b + panelDelta)
  return { chromeBg, chromePanelBg }
}

// 根据当前容器背景色更新“外圈 UI”变量；若计算失败则回退到可选的备用颜色
function updateChromeColorsFromContainer(container: HTMLElement, fallbackBase?: string): void {
  try {
    const root = document.body
    let base = ''
    try {
      const cs = window.getComputedStyle(container)
      base = cs.backgroundColor || ''
    } catch {}

    if (!base && fallbackBase) base = fallbackBase
    const derived = base ? deriveChromeColors(base) : null

    if (derived) {
      root.style.setProperty('--chrome-bg', derived.chromeBg)
      root.style.setProperty('--chrome-panel-bg', derived.chromePanelBg)
    } else {
      root.style.removeProperty('--chrome-bg')
      root.style.removeProperty('--chrome-panel-bg')
    }
  } catch {}
}

/** 当前是否处于夜间模式（body 上的 dark-mode 类）。 */
function isDarkModeNow(): boolean {
  try { return document.body.classList.contains('dark-mode') } catch { return false }
}

/**
 * 从持久化数据里取颜色字段。
 * 非字符串（存储被外部污染）或空白串一律回退默认值 —— 否则后续的
 * `.trim()` 会在非字符串上抛异常，把整个 loadThemePrefs 拖进 catch 分支。
 */
function readColorField(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  return value.trim() ? value : fallback
}

/**
 * 统一背景的锚点值（唯一事实源）。
 *
 * 背景合并为单一设置后，两个轴的职责被明确分开：
 *   - **明暗轴**：由 `body.dark-mode` 决定取 `readBg`（日间）还是 `readBgDark`（夜间）；
 *   - **模式轴**（源码 / 阅读 / 所见）：**不再影响**颜色 —— 界面、源码编辑区与阅读纸面共用同一色。
 *
 * `editBg` / `editBgDark` 已降级为镜像输出，渲染路径不再读取它们。
 */
function resolveUnifiedBg(prefs: ThemePrefs): string {
  const isDarkMode = isDarkModeNow()
  return isDarkMode
    ? (prefs.readBgDark || DEFAULT_PREFS.readBgDark || NIGHT_BG_DEFAULT)
    : (prefs.readBg || DEFAULT_PREFS.readBg || DAY_BG_DEFAULT)
}

/**
 * 把统一背景色写入锚点字段，并同步镜像字段。
 * 明暗轴决定写哪一对（readBg / readBgDark），editBg 一侧永远是镜像。
 */
function setUnifiedBg(prefs: ThemePrefs, color: string): void {
  const isDarkMode = isDarkModeNow()
  if (isDarkMode) {
    prefs.readBgDark = color
    prefs.editBgDark = color
  } else {
    prefs.readBg = color
    prefs.editBg = color
  }
}

// 根据当前模式更新外圈UI颜色（标题栏、侧栏等）
// 背景已统一为单一设置 → 外圈颜色恒由锚点值派生，不再随模式变化。
// mode 参数仅为兼容既有调用点（main.ts / mainTopMenus.ts）保留。
export function updateChromeColorsForMode(mode: 'edit' | 'wysiwyg' | 'preview'): void {
  try {
    const prefs = loadThemePrefs()
    const derived = deriveChromeColors(resolveUnifiedBg(prefs))
    const root = document.body

    if (derived) {
      root.style.setProperty('--chrome-bg', derived.chromeBg)
      root.style.setProperty('--chrome-panel-bg', derived.chromePanelBg)
    } else {
      root.style.removeProperty('--chrome-bg')
      root.style.removeProperty('--chrome-panel-bg')
    }
  } catch {}
}

export function applyThemePrefs(prefs: ThemePrefs): void {
  try {
    const c = getContainer()
    if (!c) return

    // 清理历史版本遗留的内联变量：旧版日间模式会写「所见纸面色」变量，
    // 而旧版夜间分支从不清理它 → 夜间下残留浅色纸面色，所见容器/CM6 行号栏等
    // 消费该变量的元素在暗色下仍是亮色。此变量现已退役，只做一次性清理。
    try { c.style.removeProperty('--wysiwyg-bg') } catch {}

    // 检测是否为夜间模式（系统深色或用户手动开启）
    const isDarkMode = isDarkModeNow()

    // 统一背景：锚点值同时驱动 --bg（界面 / 源码区）与 --preview-bg（纸面）。
    // 日/夜两分支写入的变量集合必须完全一致（见 styles/themeBackgroundTokens.test.ts）
    const unifiedBg = resolveUnifiedBg(prefs)
    c.style.setProperty('--bg', unifiedBg)
    c.style.setProperty('--preview-bg', unifiedBg)

    // 外圈 UI 颜色：统一背景后恒由锚点值派生（不再随模式变化）
    // 直接使用锚点值推导外圈颜色，不从 DOM 读取
    const derived = deriveChromeColors(unifiedBg)
    if (derived) {
      const root = document.body
      root.style.setProperty('--chrome-bg', derived.chromeBg)
      root.style.setProperty('--chrome-panel-bg', derived.chromePanelBg)
    }

    // 阅读模式"纯白背景"特殊处理：当背景为纯白且非夜间模式时，移除羊皮纸纹理，让预览真正呈现纯白纸面
    try {
      const readColor = unifiedBg.trim().toLowerCase()
      const isPureWhite = readColor === '#ffffff' || readColor === '#fff'
      c.classList.toggle('preview-plain', !isDarkMode && isPureWhite)
    } catch {}

    // 字体变量（为空则移除，回退默认）
    try {
      const bodyFont = (prefs.bodyFont || '').trim()
      const monoFont = (prefs.monoFont || '').trim()
      const root = document.body

      // 容器内的正文 / 等宽字体
      if (bodyFont) c.style.setProperty('--font-body', bodyFont)
      else c.style.removeProperty('--font-body')
      if (monoFont) c.style.setProperty('--font-mono', monoFont)
      else c.style.removeProperty('--font-mono')

      // 将需要的字体变量同步到 body，供全局 UI / 插件容器使用
      if (root) {
        // 正文字体全局生效：仅在用户显式开启且配置了 bodyFont 时，才覆盖 UI 字体变量
        if (prefs.bodyFontGlobal && bodyFont) {
          root.style.setProperty('--font-ui', bodyFont)
        } else {
          root.style.removeProperty('--font-ui')
        }
        // 等宽字体始终同步，用于全局代码块（编辑器 / 预览 / 插件等）
        if (monoFont) {
          root.style.setProperty('--font-mono', monoFont)
        } else {
          root.style.removeProperty('--font-mono')
        }
      }
    } catch {}

    // 排版变量（未设置则移除，回退 CSS 默认）
    try {
      if (typeof prefs.lineHeight === 'number') {
        c.style.setProperty('--layout-line-height', String(prefs.lineHeight))
      } else {
        c.style.removeProperty('--layout-line-height')
      }
      if (typeof prefs.paragraphSpacing === 'number') {
        c.style.setProperty('--layout-paragraph-spacing', `${prefs.paragraphSpacing}em`)
      } else {
        c.style.removeProperty('--layout-paragraph-spacing')
      }
      if (typeof prefs.contentMaxWidth === 'number' && prefs.contentMaxWidth > 0) {
        c.style.setProperty('--layout-content-max-width', `${prefs.contentMaxWidth}px`)
        c.style.removeProperty('--layout-content-pad-x')
      } else if (prefs.contentMaxWidth === 0) {
        // 自适应：占满可见范围（用超大值让源码模式的 calc() 公式仍然有效），两侧各留 20px
        c.style.setProperty('--layout-content-max-width', '100000px')
        c.style.setProperty('--layout-content-pad-x', '20px')
      } else {
        c.style.removeProperty('--layout-content-max-width')
        c.style.removeProperty('--layout-content-pad-x')
      }
      if (typeof prefs.textIndent === 'number' && prefs.textIndent > 0) {
        c.style.setProperty('--layout-text-indent', `${prefs.textIndent}em`)
      } else {
        c.style.removeProperty('--layout-text-indent')
      }
    } catch {}

    // 羊皮风格：统一开关，同时作用于源码编辑区与阅读/所见正文
    // （两个类名分别命中 .editor 与 .md-content，CSS 无需改动）
    const parchmentOn = !!prefs.parchment
    c.classList.toggle('parchment-edit', parchmentOn)
    c.classList.toggle('parchment-read', parchmentOn)
    c.classList.toggle('parchment-wysiwyg', !!prefs.parchmentWysiwyg)

    // Markdown 风格类名
    c.classList.remove('md-standard', 'md-github', 'md-notion', 'md-journal', 'md-card', 'md-docs', 'md-typora', 'md-obsidian', 'md-bear', 'md-minimalist')
    const mdClass = `md-${prefs.mdStyle || 'standard'}`
    c.classList.add(mdClass)

    // 网格背景
    if (prefs.gridBackground) c.classList.add('edit-grid-bg')
    else c.classList.remove('edit-grid-bg')

    // 触发主题变更事件（扩展可监听）
    try {
      const ev = new CustomEvent('flymd:theme:changed', { detail: { prefs } })
      window.dispatchEvent(ev)
    } catch {}

    // 专注模式下更新侧栏背景色
    //
    // 这个定时器可能在当前环境销毁之后才触发：单测里测试文件已结束、
    // 应用里窗口已关闭。此时直接访问 window 会抛 ReferenceError，
    // 而它是**未捕获错误**——单测会因此以退出码 1 失败（尽管断言全过），
    // 应用侧也会在窗口关闭瞬间报一串噪音日志。故先确认 window 还在。
    setTimeout(() => {
      try {
        if (typeof window === 'undefined') return
        const updateFunc = (window as any).updateFocusSidebarBg
        if (typeof updateFunc === 'function') {
          updateFunc()
        }
      } catch {}
    }, 50)
  } catch {}
}

export function saveThemePrefs(prefs: ThemePrefs): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(prefs)) } catch {}
}

export function loadThemePrefs(): ThemePrefs {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return { ...DEFAULT_PREFS }
    const obj = JSON.parse(raw)
    let mdStyle: any = obj.mdStyle
    // 兼容：若历史保存为 terminal，则回退为 standard
    if (mdStyle === 'terminal') mdStyle = 'standard'

    const editBg = readColorField(obj.editBg, DEFAULT_PREFS.editBg)
    const rawReadBg = readColorField(obj.readBg, DEFAULT_PREFS.readBg)
    const editBgDark = readColorField(obj.editBgDark, DEFAULT_PREFS.editBgDark || NIGHT_BG_DEFAULT)
    const readBgDark = readColorField(obj.readBgDark, DEFAULT_PREFS.readBgDark || NIGHT_BG_DEFAULT)

    // 合并前的独立取值备份（仅在两域确实分歧且尚未备份过时写一次，幂等）。
    // 放在读取路径上而非某个写入口，保证面板 / 插件 API 等所有持久化路径都带上备份。
    //
    // **必须先于任何归一化**：否则备份里存的是被改写后的值，恢复语义就被破坏
    // （原始的 legacy 状态会永久丢失）。
    let preUnifyBg = (typeof obj.preUnifyBg === 'object' && obj.preUnifyBg) ? obj.preUnifyBg : undefined
    if (!preUnifyBg) {
      const diverged =
        editBg.trim().toLowerCase() !== rawReadBg.trim().toLowerCase() ||
        editBgDark.trim().toLowerCase() !== readBgDark.trim().toLowerCase() ||
        (!!obj.parchmentEdit !== !!obj.parchmentRead)
      if (diverged) {
        preUnifyBg = {
          editBg, readBg: rawReadBg, editBgDark, readBgDark,
          parchmentEdit: obj.parchmentEdit, parchmentRead: obj.parchmentRead,
        }
      }
    }

    // 旧版本用 getCssVar('--preview-bg') 取默认值：深色系统上会读到夜间值 #12100d，
    // 并在用户改动任意主题设置时被写进存储 → 浅色模式下纸面（现在是全窗口）近黑。
    // 特征：日间值与夜间默认相同。该值只可能来自这个误捕，按日间默认重置。
    let readBg = rawReadBg
    if (
      readBg.trim().toLowerCase() === LEGACY_DARK_CAPTURE &&
      readBgDark.trim().toLowerCase() === LEGACY_DARK_CAPTURE
    ) {
      readBg = DEFAULT_PREFS.readBg
    }

    // 羊皮风格统一开关：旧配置按**并集**归一 —— 任一模式原本开启过羊皮，
    // 统一后都不能凭空消失。
    const parchmentEdit = (typeof obj.parchmentEdit === 'boolean') ? obj.parchmentEdit : undefined
    const parchmentRead = (typeof obj.parchmentRead === 'boolean') ? obj.parchmentRead : undefined
    const parchment = (typeof obj.parchment === 'boolean')
      ? obj.parchment
      : (parchmentEdit === true || parchmentRead === true)

    return {
      editBg,
      readBg,
      /** @deprecated 仅原样回写旧配置，不再消费（见 ThemePrefs.wysiwygBg） */
      wysiwygBg: obj.wysiwygBg || DEFAULT_PREFS.wysiwygBg,
      editBgDark,
      readBgDark,
      parchment,
      parchmentEdit,
      parchmentRead,
      preUnifyBg,
      mdStyle: (['standard','github','notion','journal','card','docs','typora','obsidian','bear','minimalist'] as string[]).includes(mdStyle) ? mdStyle : 'standard',
      themeId: obj.themeId || undefined,
      /** @deprecated 所见羊皮纸已移除；仅保留读回以维持旧配置行为 */
      parchmentWysiwyg: (typeof obj.parchmentWysiwyg === 'boolean') ? obj.parchmentWysiwyg : undefined,
      bodyFont: (typeof obj.bodyFont === 'string') ? obj.bodyFont : undefined,
      bodyFontGlobal: (typeof obj.bodyFontGlobal === 'boolean') ? obj.bodyFontGlobal : false,
      monoFont: (typeof obj.monoFont === 'string') ? obj.monoFont : undefined,
      gridBackground: (typeof obj.gridBackground === 'boolean') ? obj.gridBackground : false,
      folderIcon: (typeof obj.folderIcon === 'string') ? obj.folderIcon : '🗂️',
      // 排版设置（带范围校验）
      lineHeight: (typeof obj.lineHeight === 'number' && obj.lineHeight >= 1.2 && obj.lineHeight <= 2.5) ? obj.lineHeight : undefined,
      paragraphSpacing: (typeof obj.paragraphSpacing === 'number' && obj.paragraphSpacing >= 0 && obj.paragraphSpacing <= 2) ? obj.paragraphSpacing : undefined,
      contentMaxWidth: (typeof obj.contentMaxWidth === 'number' && obj.contentMaxWidth >= 0 && obj.contentMaxWidth <= 1200) ? obj.contentMaxWidth : undefined,
      textIndent: (typeof obj.textIndent === 'number' && obj.textIndent >= 0 && obj.textIndent <= 4) ? obj.textIndent : undefined,
    }
  } catch { return { ...DEFAULT_PREFS } }
}

export function applySavedTheme(): void {
  // 检测系统深色模式并应用主题
  try {
    const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const savedDark = localStorage.getItem('flymd:darkmode')

    if (isSystemDark) {
      // 系统深色模式下，检查用户是否明确选择了浅色
      if (savedDark === 'false') {
        // 用户明确选择浅色：移除深色类，添加强制浅色类
        document.body.classList.remove('dark-mode')
        document.body.classList.add('light-mode')
      } else {
        // 默认跟随系统或用户选择深色
        document.body.classList.add('dark-mode')
        document.body.classList.remove('light-mode')
      }
    } else {
      // 系统浅色模式：无需强制浅色类
      document.body.classList.remove('light-mode')
      const isDark = savedDark === 'true'
      document.body.classList.toggle('dark-mode', isDark)
    }
  } catch {}

  // 库树彩虹色开关:启动时按存储值加 body class(默认开启)
  setLibColorDepthEnabled(getLibColorDepthEnabled())

  const prefs = loadThemePrefs()
  applyThemePrefs(prefs)
}

// ===== 扩展 API（对外暴露到 window.flymdTheme）=====
function registerTheme(def: ThemeDefinition): void {
  if (!def || !def.id) return
  _themes.set(def.id, def)
}
function registerPalette(label: string, color: string, id?: string): void {
  const _id = id || `ext-${Math.random().toString(36).slice(2, 8)}`
  _palettes.push({ id: _id, label, color })
}
function registerTypography(id: string, label: string, css?: string): void {
  // 允许的排版风格（遗留 API，保留兼容性）
  if (!['default', 'serif', 'modern', 'reading', 'academic', 'compact', 'elegant', 'minimal', 'tech', 'literary'].includes(id)) return
  if (css) {
    try {
      const style = document.createElement('style')
      style.dataset.themeTypo = id
      style.textContent = css
      document.head.appendChild(style)
    } catch {}
  }
}

function registerMdStyle(id: MdStyleId, label: string, css?: string): void {
  if (!['standard','github','notion','journal','card','docs','typora','obsidian','bear','minimalist'].includes(id)) return
  if (css) {
    try {
      const style = document.createElement('style')
      style.dataset.themeMd = id
      style.textContent = css
      document.head.appendChild(style)
    } catch {}
  }
}

export const themeAPI = { registerTheme, registerPalette, registerTypography, registerMdStyle, applyThemePrefs, loadThemePrefs, saveThemePrefs }
;(window as any).flymdTheme = themeAPI

// 监听模式切换事件（编辑 / 阅读 / 所见），在模式变化时也重新推导一遍外圈 UI 颜色
try {
  window.addEventListener('flymd:mode:changed', () => {
    const c = getContainer()
    if (!c) return
    updateChromeColorsFromContainer(c)
  })
} catch {}

// ===== 主题 UI =====

function buildColorList(): Array<{ id: string; label: string; color: string }> {
  const base = [
    { id: 'pure', label: '纯白', color: '#ffffff' },
    { id: 'parch', label: '羊皮纸', color: '#fbf5e6' },
    { id: 'beige', label: '米色', color: '#f5f5dc' },
    { id: 'soft-blue', label: '淡蓝', color: '#f7f9fc' },
    { id: 'lavender', label: '薰衣草', color: '#f5f3ff' },
    { id: 'ivory', label: '象牙', color: '#fffaf0' },
    { id: 'peach', label: '蜜桃', color: '#fff5ee' },
    { id: 'mint', label: '薄荷', color: '#eef8f1' },
    { id: 'cloud', label: '云白', color: '#f8fafc' },
    { id: 'sepia', label: '复古黄', color: '#fdf6e3' },
    { id: 'latte', label: '拿铁', color: '#f9f5f0' },
  ]
  return base.concat(_palettes)
}

// 夜间模式色板
function buildDarkColorList(): Array<{ id: string; label: string; color: string }> {
  const darkBase = [
    { id: 'dark-pure', label: '纯黑', color: '#000000' },
    { id: 'dark-charcoal', label: '木炭', color: '#0b0c0e' },
    { id: 'dark-midnight', label: '午夜', color: '#12100d' },
    { id: 'dark-coffee', label: '咖啡', color: '#1a1410' },
    { id: 'dark-sepia', label: '深褐', color: '#1a1612' },
    { id: 'dark-navy', label: '深蓝', color: '#0d1117' },
    { id: 'dark-ocean', label: '海洋', color: '#0e1419' },
    { id: 'dark-graphite', label: '石墨', color: '#14161a' },
    { id: 'dark-olive', label: '橄榄', color: '#15160f' },
    { id: 'dark-pewter', label: '暖锡', color: '#1a1816' },
  ]
  return darkBase.concat(_palettes)
}

function createPanel(): HTMLDivElement {
  const panel = document.createElement('div')
  panel.className = 'theme-panel hidden'
  panel.id = 'theme-panel'
  panel.innerHTML = `
    <div class="theme-panel-header">
      <span class="theme-panel-title">${t('theme.panel.title')}</span>
      <button class="theme-panel-close" title="${t('theme.panel.close')}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
    <div class="theme-panel-content">
    <div class="theme-section theme-focus-section">
      <div class="theme-focus-row">
        <label class="theme-toggle-label theme-toggle-third theme-toggle-boxed" for="focus-mode-toggle">
          <span class="theme-toggle-text">${t('theme.focusMode')}</span>
          <div class="theme-toggle-switch">
            <input type="checkbox" id="focus-mode-toggle" class="theme-toggle-input" />
            <span class="theme-toggle-slider"></span>
          </div>
        </label>
        <label class="theme-toggle-label theme-toggle-third theme-toggle-boxed" for="wysiwyg-default-toggle">
          <span class="theme-toggle-text">${t('theme.wysiwygMode')}</span>
          <div class="theme-toggle-switch">
            <input type="checkbox" id="wysiwyg-default-toggle" class="theme-toggle-input" />
            <span class="theme-toggle-slider"></span>
          </div>
        </label>
        <label class="theme-toggle-label theme-toggle-third theme-toggle-boxed" for="sourcemode-default-toggle">
          <span class="theme-toggle-text">${t('theme.sourceMode')}</span>
          <div class="theme-toggle-switch">
            <input type="checkbox" id="sourcemode-default-toggle" class="theme-toggle-input" />
            <span class="theme-toggle-slider"></span>
          </div>
        </label>
        <label class="theme-toggle-label theme-toggle-third theme-toggle-boxed" for="source-line-numbers-toggle" title="${t('theme.sourceLineNumbers.tip')}">
          <span class="theme-toggle-text">${t('theme.sourceLineNumbers')}</span>
          <div class="theme-toggle-switch">
            <input type="checkbox" id="source-line-numbers-toggle" class="theme-toggle-input" />
            <span class="theme-toggle-slider"></span>
          </div>
        </label>
        <label class="theme-toggle-label theme-toggle-third theme-toggle-boxed" for="code-wrap-toggle" title="${t('theme.codeWrap.tip')}">
          <span class="theme-toggle-text">${t('theme.codeWrap')}</span>
          <div class="theme-toggle-switch">
            <input type="checkbox" id="code-wrap-toggle" class="theme-toggle-input" />
            <span class="theme-toggle-slider"></span>
          </div>
        </label>
        <label class="theme-toggle-label theme-toggle-third theme-toggle-boxed" for="default-outline-tab-toggle" title="${t('theme.defaultOutlineTab.tip')}">
          <span class="theme-toggle-text">${t('theme.defaultOutlineTab')}</span>
          <div class="theme-toggle-switch">
            <input type="checkbox" id="default-outline-tab-toggle" class="theme-toggle-input" />
            <span class="theme-toggle-slider"></span>
          </div>
        </label>
        <label class="theme-toggle-label theme-toggle-third theme-toggle-boxed" for="symbol-auto-completion-toggle" title="${t('theme.symbolAutoCompletion.tip')}">
          <span class="theme-toggle-text">${t('theme.symbolAutoCompletion')}</span>
          <div class="theme-toggle-switch">
            <input type="checkbox" id="symbol-auto-completion-toggle" class="theme-toggle-input" />
            <span class="theme-toggle-slider"></span>
          </div>
        </label>
        <label class="theme-toggle-label theme-toggle-third theme-toggle-boxed" for="wysiwyg-html-table-toggle" title="${t('theme.wysiwygHtmlTable.tip')}">
          <span class="theme-toggle-text">${t('theme.wysiwygHtmlTable')}</span>
          <div class="theme-toggle-switch">
            <input type="checkbox" id="wysiwyg-html-table-toggle" class="theme-toggle-input" />
            <span class="theme-toggle-slider"></span>
          </div>
        </label>
        <label class="theme-toggle-label theme-toggle-third theme-toggle-boxed" for="wysiwyg-html-table-src-edit-toggle" title="${t('theme.wysiwygHtmlTableSrcEdit.tip')}">
          <span class="theme-toggle-text">${t('theme.wysiwygHtmlTableSrcEdit')}</span>
          <div class="theme-toggle-switch">
            <input type="checkbox" id="wysiwyg-html-table-src-edit-toggle" class="theme-toggle-input" />
            <span class="theme-toggle-slider"></span>
          </div>
        </label>
        <label class="theme-toggle-label theme-toggle-third theme-toggle-boxed" for="paste-url-title-toggle" title="${t('theme.pasteUrlTitleFetch.tip')}">
          <span class="theme-toggle-text">${t('theme.pasteUrlTitleFetch')}</span>
          <div class="theme-toggle-switch">
            <input type="checkbox" id="paste-url-title-toggle" class="theme-toggle-input" />
            <span class="theme-toggle-slider"></span>
          </div>
        </label>
        <label class="theme-toggle-label theme-toggle-third theme-toggle-boxed" for="paste-remote-images-toggle" title="${t('theme.pasteRemoteImages.tip')}">
          <span class="theme-toggle-text">${t('theme.pasteRemoteImages')}</span>
          <div class="theme-toggle-switch">
            <input type="checkbox" id="paste-remote-images-toggle" class="theme-toggle-input" />
            <span class="theme-toggle-slider"></span>
          </div>
        </label>
        <label class="theme-toggle-label theme-toggle-third theme-toggle-boxed" for="update-check-disabled-toggle" title="${t('theme.updateCheckDisabled.tip')}">
          <span class="theme-toggle-text">${t('theme.updateCheckDisabled')}</span>
          <div class="theme-toggle-switch">
            <input type="checkbox" id="update-check-disabled-toggle" class="theme-toggle-input" />
            <span class="theme-toggle-slider"></span>
          </div>
        </label>
        <label class="theme-toggle-label theme-toggle-third theme-toggle-boxed" for="dark-mode-toggle">
          <span class="theme-toggle-text">${t('theme.darkMode')}</span>
          <div class="theme-toggle-switch">
            <input type="checkbox" id="dark-mode-toggle" class="theme-toggle-input" />
            <span class="theme-toggle-slider"></span>
          </div>
        </label>
        <label class="theme-toggle-label theme-toggle-third theme-toggle-boxed" for="compact-titlebar-toggle">
          <span class="theme-toggle-text">${t('theme.compactTitlebar')}</span>
          <div class="theme-toggle-switch">
            <input type="checkbox" id="compact-titlebar-toggle" class="theme-toggle-input" />
            <span class="theme-toggle-slider"></span>
          </div>
        </label>
        <label class="theme-toggle-label theme-toggle-third theme-toggle-boxed" for="lib-color-depth-toggle">
          <span class="theme-toggle-text">${t('theme.libColorDepth')}</span>
          <div class="theme-toggle-switch">
            <input type="checkbox" id="lib-color-depth-toggle" class="theme-toggle-input" />
            <span class="theme-toggle-slider"></span>
          </div>
        </label>
      </div>
    </div>
    <div class="theme-section theme-bg-section">
      <div class="theme-title">${t('theme.bgSection')}</div>
      <div class="theme-hint theme-bg-hint">${t('theme.bg.tip')}</div>
      <div class="theme-swatches"></div>
      <div class="theme-options-row">
        <label class="theme-checkbox-label">
          <input type="checkbox" id="parchment-bg-toggle" class="theme-checkbox" />
          <span>${t('theme.parchment')}</span>
        </label>
        <div class="theme-custom-color-inline">
          <input type="text" id="custom-color-bg" class="theme-color-input theme-bg-color-input" placeholder="#FFFFFF" maxlength="7" />
          <button class="theme-apply-btn theme-bg-apply">${t('theme.apply')}</button>
        </div>
        <label class="theme-checkbox-label theme-grid-bg-option" title="${t('theme.gridBg.tip')}">
          <input type="checkbox" id="grid-bg-toggle" class="theme-checkbox" />
          <span>${t('theme.gridBg')}</span>
        </label>
      </div>
    </div>
    <div class="theme-section">
      <div class="theme-title">${t('theme.mdStyle')}</div>
      <div class="theme-md">
        <button class="md-btn" data-md="standard">标准</button>
        <button class="md-btn" data-md="github">GitHub</button>
        <button class="md-btn" data-md="notion">Notion</button>
        <button class="md-btn" data-md="journal">出版风</button>
        <button class="md-btn" data-md="card">卡片风</button>
        <button class="md-btn" data-md="docs">Docs</button>
        <button class="md-btn" data-md="typora">Typora</button>
        <button class="md-btn" data-md="obsidian">Obsidian</button>
        <button class="md-btn" data-md="bear">Bear</button>
        <button class="md-btn" data-md="minimalist">极简风</button>
      </div>
    </div>
    <div class="theme-section theme-fonts-section">
      <div class="theme-title">${t('theme.fontSection')}</div>
      <div class="theme-fonts">
        <label for="font-body-select">${t('theme.font.body')}</label>
        <select id="font-body-select"></select>
        <label for="font-mono-select">${t('theme.font.mono')}</label>
        <select id="font-mono-select"></select>
        <div class="theme-slider-row theme-font-size-row">
          <label for="font-size-range">${t('theme.font.size')}</label>
          <input type="range" id="font-size-range" min="12" max="24" step="1" value="16" />
          <span class="theme-slider-value" id="font-size-value">16px</span>
        </div>
      </div>
      <div class="theme-option">
        <label class="theme-checkbox-label">
          <input type="checkbox" id="font-body-global-toggle" class="theme-checkbox" />
          <span>${t('theme.font.bodyGlobal')}</span>
        </label>
      </div>
      <div class="font-list" id="font-list"></div>
    </div>
    <div class="theme-section theme-layout-section">
      <div class="theme-title">${t('theme.layoutSection')}</div>
      <div class="theme-layout-controls">
        <div class="theme-slider-row">
          <label for="layout-line-height">${t('theme.layout.lineHeight')}</label>
          <input type="range" id="layout-line-height" min="1.2" max="2.5" step="0.1" value="1.75" />
          <span class="theme-slider-value" id="layout-line-height-value">1.75</span>
        </div>
        <div class="theme-slider-row">
          <label for="layout-paragraph-spacing">${t('theme.layout.paragraphSpacing')}</label>
          <input type="range" id="layout-paragraph-spacing" min="0" max="2" step="0.1" value="1" />
          <span class="theme-slider-value" id="layout-paragraph-spacing-value">1em</span>
        </div>
        <div class="theme-slider-row">
          <label for="layout-content-width">${t('theme.layout.contentWidth')}</label>
          <input type="range" id="layout-content-width" min="0" max="1200" step="50" value="860" />
          <span class="theme-slider-value" id="layout-content-width-value">860px</span>
        </div>
        <div class="theme-slider-row">
          <label for="layout-text-indent">${t('theme.layout.textIndent')}</label>
          <input type="range" id="layout-text-indent" min="0" max="4" step="0.5" value="0" />
          <span class="theme-slider-value" id="layout-text-indent-value">0em</span>
        </div>
        <div class="theme-option">
          <label class="theme-checkbox-label">
            <input type="checkbox" id="layout-auto-width" class="theme-checkbox" />
            <span>${t('theme.layout.autoWidth')}</span>
          </label>
          <button class="theme-reset-layout-btn" id="reset-layout-btn">${t('theme.layout.reset')}</button>
        </div>
      </div>
    </div>
    <div class="theme-section theme-network-section">
      <div class="theme-title">${t('theme.networkSection')}</div>
      <div class="theme-option">
        <label class="theme-checkbox-label">
          <input type="checkbox" id="net-proxy-enabled" class="theme-checkbox" />
          <span>${t('theme.netProxy.enable')}</span>
        </label>
      </div>
      <div class="theme-field-row">
        <label for="net-proxy-url">${t('theme.netProxy.url')}</label>
        <input type="text" id="net-proxy-url" class="theme-text-input" placeholder="http://127.0.0.1:7890" />
      </div>
      <div class="theme-field-row">
        <label for="net-proxy-no-proxy">${t('theme.netProxy.noProxy')}</label>
        <input type="text" id="net-proxy-no-proxy" class="theme-text-input" placeholder="localhost,127.0.0.1,*.local" />
      </div>
      <div class="theme-field-actions">
        <button class="theme-apply-btn" id="net-proxy-apply">${t('theme.netProxy.apply')}</button>
      </div>
      <div class="theme-hint">${t('theme.netProxy.tip')}</div>
    </div>
  `
  return panel
}

/**
 * 把自定义色输入框同步为当前实际生效的背景色。
 * 背景合并为单一设置后只有一个输入框，它必须始终显示锚点值，
 * 否则会出现「色板显示 A 色、输入框残留 B 色」的自相矛盾。
 */
function syncBgColorInput(panel: HTMLElement, prefs: ThemePrefs): void {
  const input = panel.querySelector('.theme-bg-color-input') as HTMLInputElement | null
  if (!input) return
  const current = resolveUnifiedBg(prefs)
  // 只回填合法 hex：脏值回填进输入框没有意义（它是 text 框，不是 color 框）
  input.value = isValidHexColor(String(current || '')) ? String(current) : ''
  input.classList.remove('invalid')
}

function fillSwatches(panel: HTMLElement, prefs: ThemePrefs) {
  // 检测当前是否为夜间模式
  const isDarkMode = isDarkModeNow()
  // 根据模式选择色板
  const colors = isDarkMode ? buildDarkColorList() : buildColorList()
  // 统一背景只有一个生效值（锚点）
  const cur = resolveUnifiedBg(prefs)

  panel.querySelectorAll('.theme-swatches').forEach((wrap) => {
    const el = wrap as HTMLElement

    // 原地更新色板，**不重建 DOM**：
    // 重建（innerHTML）会把刚被点击的那个色板节点从文档树里摘掉，
    // 事件继续冒泡到 document 的「点击面板外关闭」处理器时，
    // ev.target.closest('#theme-panel') 在已脱离文档的节点上找不到祖先 →
    // 点一下颜色面板就被误判成「点击外部」而自己关闭。
    const cells = el.children
    if (cells.length !== colors.length) {
      // 数量不一致（首次渲染 / 明暗色板长度不同 / 扩展注册了新色板）才整体重建
      el.innerHTML = colors.map(({ label, color }) => {
        const active = (color.toLowerCase() === (cur || '').toLowerCase()) ? 'active' : ''
        const title = `${label} ${color}`
        return `<div class="theme-swatch ${active}" title="${title}" data-color="${color}" style="background:${color}"></div>`
      }).join('')
    } else {
      colors.forEach(({ label, color }, i) => {
        const cell = cells[i] as HTMLElement
        const active = (color.toLowerCase() === (cur || '').toLowerCase()) ? 'active' : ''
        cell.className = `theme-swatch ${active}`
        cell.title = `${label} ${color}`
        cell.dataset.color = color
        cell.style.background = color
      })
    }

    // 自定义色输入框同步为当前生效色（fillSwatches 是所有配色变更后的统一重绘点：
    // 色板点击、应用自定义色、切换夜间模式）
    syncBgColorInput(panel, prefs)
  })
  // MD 风格激活态
  panel.querySelectorAll('.md-btn').forEach((b) => {
    const el = b as HTMLButtonElement
    const v = el.dataset.md as MdStyleId
    if (v === prefs.mdStyle) el.classList.add('active'); else el.classList.remove('active')
  })
  // 网格背景复选框状态
  const gridToggle = panel.querySelector('#grid-bg-toggle') as HTMLInputElement | null
  if (gridToggle) gridToggle.checked = !!prefs.gridBackground
}

// 模块级引用：让 initThemeUI 的面板 toggle 也能调用 ensureThemePanelReady
// 内部定义的 revertAllPreviews。原代码是 ReferenceError 后被 try/catch 静默吞掉
// 的真实 bug。这里在 ensureThemePanelReady 中赋值，initThemeUI 通过可选链调用。
let _themeRevertAllPreviews: (() => void) | null = null

function ensureThemePanelReady(): HTMLDivElement | null {
  try {
    if (_themePanelReady) return document.getElementById('theme-panel') as HTMLDivElement | null
    _themePanelReady = true
    // 兼容新 ribbon 和旧 menubar 布局
    const menu = document.querySelector('.ribbon') || document.querySelector('.menubar')
    const container = getContainer()
    if (!menu || !container) { _themePanelReady = false; return null }

    let panel = document.getElementById('theme-panel') as HTMLDivElement | null
    if (!panel) {
      panel = createPanel()
      container.appendChild(panel)
    }

    // 遮罩层：面板打开时盖住整个窗口（含文件树），阻断下层交互与滚动条穿透；
    // 用 MutationObserver 跟随 panel 的 hidden 状态，覆盖所有打开/关闭路径。
    // 点击遮罩会命中下方已有的"点击外部关闭"document 监听，无需单独绑定。
    let mask = document.getElementById('theme-panel-mask') as HTMLDivElement | null
    if (!mask) {
      mask = document.createElement('div')
      mask.id = 'theme-panel-mask'
      mask.className = 'theme-panel-mask hidden'
      container.appendChild(mask)
    }
    const syncMask = () => {
      try {
        const hidden = panel!.classList.contains('hidden')
        mask!.classList.toggle('hidden', hidden)
        document.body.classList.toggle('theme-panel-open', !hidden)
      } catch {}
    }
    try { new MutationObserver(syncMask).observe(panel, { attributes: true, attributeFilter: ['class'] }) } catch {}
    syncMask()

    const prefs = loadThemePrefs()
    let lastSaved = { ...prefs }
    fillSwatches(panel, prefs)

    // 字体选项：内置常见字体栈，首项为空表示使用默认/随排版
    const bodyOptions: Array<{ label: string; stack: string }> = [
      { label: '跟随排版（默认）', stack: '' },
      { label: '系统无衬线（系统默认）', stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji'" },
      { label: '现代（Inter 优先）', stack: "Inter, Roboto, 'Noto Sans', system-ui, -apple-system, 'Segoe UI', Arial, sans-serif" },
      { label: '衬线（Georgia/思源宋体）', stack: "Georgia, 'Times New Roman', Times, 'Source Han Serif SC', serif" },
    ]
    // 扩展：追加常见系统/开源字体（仅引用名称，不随包分发）
    const moreBodyOptions: Array<{ label: string; stack: string }> = [
      { label: 'Windows 中文（微软雅黑）', stack: "'Microsoft YaHei', 'Segoe UI', 'Noto Sans', Arial, sans-serif" },
      { label: 'macOS 中文（苹方/Hiragino）', stack: "'PingFang SC', 'Hiragino Sans GB', 'Noto Sans CJK SC', 'Source Han Sans SC', -apple-system, 'Segoe UI', Arial, sans-serif" },
      { label: '开源中文（思源黑体）', stack: "'Source Han Sans SC', 'Noto Sans CJK SC', 'Noto Sans', -apple-system, 'Segoe UI', Arial, sans-serif" },
      { label: '开源中文（思源宋体）', stack: "'Source Han Serif SC', 'Noto Serif CJK SC', 'Noto Serif', Georgia, 'Times New Roman', serif" },
      { label: 'Android/通用（Roboto）', stack: "Roboto, 'Noto Sans', system-ui, -apple-system, 'Segoe UI', Arial, sans-serif" },
      { label: '经典无衬线（Tahoma/Verdana）', stack: "Tahoma, Verdana, Arial, Helvetica, sans-serif" },
      { label: '经典衬线（Times/宋体回退）', stack: "'Times New Roman', Times, 'SimSun', serif" },
    ]
    const moreMonoOptions: Array<{ label: string; stack: string }> = [
      { label: 'Cascadia Code', stack: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace" },
      { label: 'Menlo/Monaco（macOS）', stack: "Menlo, Monaco, ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', 'Courier New', monospace" },
      { label: 'Ubuntu Mono', stack: "'Ubuntu Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace" },
      { label: 'DejaVu Sans Mono', stack: "'DejaVu Sans Mono', 'Liberation Mono', 'Courier New', monospace" },
      { label: 'Source Code Pro', stack: "'Source Code Pro', 'Fira Code', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace" },
    ]
    const monoOptions: Array<{ label: string; stack: string }> = [
      { label: '系统等宽（默认）', stack: '' },
      { label: 'JetBrains Mono', stack: "'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace" },
      { label: 'Fira Code', stack: "'Fira Code', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace" },
      { label: 'Consolas 系', stack: "Consolas, 'Courier New', ui-monospace, SFMono-Regular, Menlo, Monaco, 'Liberation Mono', monospace" },
    ]

    const bodySel = panel.querySelector('#font-body-select') as HTMLSelectElement | null
    const monoSel = panel.querySelector('#font-mono-select') as HTMLSelectElement | null
    const resetBtn = panel.querySelector('#font-reset') as HTMLButtonElement | null
    const bodyGlobalToggle = panel.querySelector('#font-body-global-toggle') as HTMLInputElement | null
    const fontsWrap = panel.querySelector('.theme-fonts') as HTMLDivElement | null
    const fontSizeRange = panel.querySelector('#font-size-range') as HTMLInputElement | null
    const fontSizeValue = panel.querySelector('#font-size-value') as HTMLSpanElement | null
    const fontListEl = panel.querySelector('#font-list') as HTMLDivElement | null
    // 构造“安装字体”按钮并重组操作区（避免直接改 HTML 模板造成编码问题）
    let installBtn: HTMLButtonElement | null = null
    if (fontsWrap) {
      const actions = document.createElement('div')
      actions.className = 'font-actions'
      installBtn = document.createElement('button')
      installBtn.className = 'font-install'
      installBtn.id = 'font-install'
      installBtn.textContent = '安装字体'
      actions.appendChild(installBtn)
      if (resetBtn) actions.appendChild(resetBtn)
      fontsWrap.appendChild(actions)
    }

    // 字号滑块：控制内容（编辑/预览/所见）基准字号
    try {
      const syncFontSizeUI = () => {
        if (!fontSizeRange) return
        const px = getContentFontSize()
        fontSizeRange.value = String(px)
        if (fontSizeValue) fontSizeValue.textContent = `${px}px`
      }
      syncFontSizeUI()
      if (fontSizeRange) {
        fontSizeRange.addEventListener('input', () => {
          const n = Number.parseInt(fontSizeRange.value || '16', 10)
          setContentFontSize(Number.isFinite(n) ? n : 16)
          syncFontSizeUI()
        })
      }
    } catch {}

    // 自定义字体数据库（保存在 localStorage，仅记录元数据，文件存放于 AppLocalData/fonts）
    type CustomFont = CustomThemeFont
    function loadFontDb(): CustomFont[] { return loadThemeFontDb() }
    function saveFontDb(list: CustomFont[]) { try { localStorage.setItem(THEME_FONT_DB_KEY, JSON.stringify(list)) } catch {} }
    function sanitizeId(s: string): string { return s.replace(/[^a-zA-Z0-9_-]+/g, '-') }
    async function ensureFontsDir() { try { await mkdir(THEME_FONTS_DIR as any, { baseDir: BaseDirectory.AppLocalData, recursive: true } as any) } catch {} }
    async function injectFontFace(f: CustomFont): Promise<void> {
      await injectThemeFontFace(f)
    }
    // 启动时恢复已安装字体：将数据库中的字体全部注册为 @font-face，
    // 确保升级或重启应用后，"本地: XXX" 选项仍然真实指向对应字体文件
    try {
      const list = loadFontDb()
      for (const f of list) {
        void injectFontFace(f)
      }
    } catch {}
    function mergeCustomOptions(): { body: Array<{label:string; stack:string}>, mono: Array<{label:string;stack:string}> } {
      const outB: Array<{label:string; stack:string}> = []
      const outM: Array<{label:string; stack:string}> = []
      const list = loadFontDb()
      for (const f of list) {
        outB.push({ label: `本地: ${f.name}`, stack: `'${f.family}', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif` })
        outM.push({ label: `本地: ${f.name}`, stack: `'${f.family}', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace` })
      }
      return { body: outB, mono: outM }
    }

    function renderFontList(): void {
      try {
        if (!fontListEl) return
        const list = loadFontDb()
        if (!list.length) {
          fontListEl.innerHTML = '<div class="font-list-empty">暂无已安装字体</div>'
          return
        }
        fontListEl.innerHTML = list.map((f) =>
          `<div class="font-list-item" data-id="${f.id}">` +
          `<span class="font-list-item-name">${f.name}</span>` +
          `<button type="button" class="font-delete">删除</button>` +
          `</div>`
        ).join('')
      } catch {}
    }

    async function deleteCustomFont(id: string): Promise<void> {
      try {
        let db = loadFontDb()
        const idx = db.findIndex((x) => x.id === id)
        if (idx < 0) return
        const f = db[idx]
        db = db.slice(0, idx).concat(db.slice(idx + 1))
        saveFontDb(db)
        // 删除字体文件本体
        try {
          await remove(`${THEME_FONTS_DIR}/${f.rel}` as any, { baseDir: BaseDirectory.AppLocalData } as any)
        } catch {}
        // 移除已注入的 @font-face 样式
        try {
          document.querySelectorAll(`style[data-user-font="${f.id}"]`).forEach((el) => {
            try { el.parentElement?.removeChild(el) } catch {}
          })
        } catch {}
        // 若当前主题偏好中引用了该字体，则回退为默认
        let cur = loadThemePrefs()
        const token = `'${f.family}'`
        let changed = false
        if (cur.bodyFont && cur.bodyFont.includes(token)) { cur.bodyFont = undefined; changed = true }
        if (cur.monoFont && cur.monoFont.includes(token)) { cur.monoFont = undefined; changed = true }
        if (changed) {
          saveThemePrefs(cur)
          applyThemePrefs(cur)
          lastSaved = { ...cur }
        }
        // 刷新下拉框与列表
        rebuildFontSelects(loadThemePrefs())
        renderFontList()
      } catch {}
    }

    function rebuildFontSelects(cur: ThemePrefs) {
      try {
        const extras = mergeCustomOptions()
        if (bodySel) {
          const all = bodyOptions.concat(moreBodyOptions).concat(extras.body)
          bodySel.innerHTML = all
            .map(({ label, stack }) => `<option value="${stack.replace(/\"/g, '&quot;')}">${label}</option>`)
            .join('')
          bodySel.value = (cur.bodyFont || '')
        }
        if (monoSel) {
          const all = monoOptions.concat(moreMonoOptions).concat(extras.mono)
          monoSel.innerHTML = all
            .map(({ label, stack }) => `<option value="${stack.replace(/\"/g, '&quot;')}">${label}</option>`)
            .join('')
          monoSel.value = (cur.monoFont || '')
        }
      } catch {}
    }
    rebuildFontSelects(prefs)
    renderFontList()

    if (bodyGlobalToggle) bodyGlobalToggle.checked = !!prefs.bodyFontGlobal

    function applyBodyFont(v: string) {
      const cur = loadThemePrefs()
      cur.bodyFont = v || undefined
      saveThemePrefs(cur)
      applyThemePrefs(cur)
      lastSaved = { ...cur }
    }
    function applyMonoFont(v: string) {
      const cur = loadThemePrefs()
      cur.monoFont = v || undefined
      saveThemePrefs(cur)
      applyThemePrefs(cur)
      lastSaved = { ...cur }
    }

    if (bodySel) bodySel.addEventListener('change', () => applyBodyFont(bodySel!.value))
    if (monoSel) monoSel.addEventListener('change', () => applyMonoFont(monoSel!.value))
    if (bodyGlobalToggle) bodyGlobalToggle.addEventListener('change', () => {
      const cur = loadThemePrefs()
      cur.bodyFontGlobal = bodyGlobalToggle.checked
      saveThemePrefs(cur)
      applyThemePrefs(cur)
      lastSaved = { ...cur }
    })
    if (fontListEl) fontListEl.addEventListener('click', (ev) => {
      const t = ev.target as HTMLElement
      if (!t.classList.contains('font-delete')) return
      const row = t.closest('.font-list-item') as HTMLDivElement | null
      const id = row?.dataset.id || ''
      if (!id) return
      void deleteCustomFont(id)
    })

    if (resetBtn) resetBtn.addEventListener('click', () => {
      const cur = loadThemePrefs()
      cur.bodyFont = undefined
      cur.monoFont = undefined
      cur.bodyFontGlobal = false
      saveThemePrefs(cur)
      applyThemePrefs(cur)
      rebuildFontSelects(cur)
      if (bodyGlobalToggle) bodyGlobalToggle.checked = false
      lastSaved = { ...cur }
    })

    // 排版设置控件
    const lineHeightSlider = panel.querySelector('#layout-line-height') as HTMLInputElement | null
    const paragraphSpacingSlider = panel.querySelector('#layout-paragraph-spacing') as HTMLInputElement | null
    const contentWidthSlider = panel.querySelector('#layout-content-width') as HTMLInputElement | null
    const textIndentSlider = panel.querySelector('#layout-text-indent') as HTMLInputElement | null
    const autoWidthToggle = panel.querySelector('#layout-auto-width') as HTMLInputElement | null
    const resetLayoutBtn = panel.querySelector('#reset-layout-btn') as HTMLButtonElement | null
    const lineHeightValue = panel.querySelector('#layout-line-height-value') as HTMLSpanElement | null
    const paragraphSpacingValue = panel.querySelector('#layout-paragraph-spacing-value') as HTMLSpanElement | null
    const contentWidthValue = panel.querySelector('#layout-content-width-value') as HTMLSpanElement | null
    const textIndentValue = panel.querySelector('#layout-text-indent-value') as HTMLSpanElement | null

    // 初始化排版控件值
    function initLayoutControls(cur: ThemePrefs) {
      const lineHeight = cur.lineHeight ?? 1.75
      const paragraphSpacing = cur.paragraphSpacing ?? 1
      const contentMaxWidth = cur.contentMaxWidth ?? 860
      const textIndent = cur.textIndent ?? 0
      const isAutoWidth = contentMaxWidth === 0

      if (lineHeightSlider) lineHeightSlider.value = String(lineHeight)
      if (lineHeightValue) lineHeightValue.textContent = String(lineHeight)
      if (paragraphSpacingSlider) paragraphSpacingSlider.value = String(paragraphSpacing)
      if (paragraphSpacingValue) paragraphSpacingValue.textContent = `${paragraphSpacing}em`
      if (contentWidthSlider) {
        contentWidthSlider.value = isAutoWidth ? '860' : String(contentMaxWidth)
        contentWidthSlider.disabled = isAutoWidth
      }
      if (contentWidthValue) contentWidthValue.textContent = isAutoWidth ? '自适应' : `${contentMaxWidth}px`
      if (autoWidthToggle) autoWidthToggle.checked = isAutoWidth
      if (textIndentSlider) textIndentSlider.value = String(textIndent)
      if (textIndentValue) textIndentValue.textContent = `${textIndent}em`
    }
    initLayoutControls(prefs)

    // 排版变更处理
    function applyLayoutChange(key: keyof ThemePrefs, value: number | undefined) {
      const cur = loadThemePrefs()
      ;(cur as any)[key] = value
      saveThemePrefs(cur)
      applyThemePrefs(cur)
      lastSaved = { ...cur }
    }

    if (lineHeightSlider) {
      lineHeightSlider.addEventListener('input', () => {
        const v = Number(lineHeightSlider.value)
        if (lineHeightValue) lineHeightValue.textContent = String(v)
        applyLayoutChange('lineHeight', v)
      })
    }
    if (paragraphSpacingSlider) {
      paragraphSpacingSlider.addEventListener('input', () => {
        const v = Number(paragraphSpacingSlider.value)
        if (paragraphSpacingValue) paragraphSpacingValue.textContent = `${v}em`
        applyLayoutChange('paragraphSpacing', v)
      })
    }
    if (contentWidthSlider) {
      contentWidthSlider.addEventListener('input', () => {
        if (autoWidthToggle?.checked) return
        const v = Number(contentWidthSlider.value)
        if (contentWidthValue) contentWidthValue.textContent = `${v}px`
        applyLayoutChange('contentMaxWidth', v)
      })
    }
    if (textIndentSlider) {
      textIndentSlider.addEventListener('input', () => {
        const v = Number(textIndentSlider.value)
        if (textIndentValue) textIndentValue.textContent = `${v}em`
        applyLayoutChange('textIndent', v === 0 ? undefined : v)
      })
    }
    if (autoWidthToggle) {
      autoWidthToggle.addEventListener('change', () => {
        const isAuto = autoWidthToggle.checked
        if (contentWidthSlider) contentWidthSlider.disabled = isAuto
        if (contentWidthValue) contentWidthValue.textContent = isAuto ? '自适应' : `${contentWidthSlider?.value || 860}px`
        applyLayoutChange('contentMaxWidth', isAuto ? 0 : Number(contentWidthSlider?.value || 860))
      })
    }
    if (resetLayoutBtn) {
      resetLayoutBtn.addEventListener('click', () => {
        const cur = loadThemePrefs()
        cur.lineHeight = undefined
        cur.paragraphSpacing = undefined
        cur.contentMaxWidth = undefined
        cur.textIndent = undefined
        saveThemePrefs(cur)
        applyThemePrefs(cur)
        initLayoutControls(cur)
        lastSaved = { ...cur }
      })
    }

    // 简单的操作系统识别（仅用于选择系统字体目录）
    function detectOS(): 'windows' | 'mac' | 'linux' | 'other' {
      try {
        const ua = navigator.userAgent || ''
        if (/Windows/i.test(ua)) return 'windows'
        if (/Macintosh|Mac OS X/i.test(ua)) return 'mac'
        if (/Linux/i.test(ua)) return 'linux'
      } catch {}
      return 'other'
    }
    // 返回系统字体目录（优先用户目录，其次系统目录），尽量确保真实存在
    async function getSystemFontsDir(): Promise<string | undefined> {
      const os = detectOS()
      const candidates: string[] = []
      try {
        if (os === 'windows') {
          const h = await homeDir()
          // Windows 用户字体目录（按用户安装）
          candidates.push(await join(h, 'AppData', 'Local', 'Microsoft', 'Windows', 'Fonts'))
          // Windows 系统字体目录（可能不在 C 盘，但 C 盘是最常见，找不到则忽略）
          candidates.push('C\\Windows\\Fonts')
        } else if (os === 'mac') {
          const h = await homeDir()
          // macOS 用户字体目录
          candidates.push(await join(h, 'Library', 'Fonts'))
          // macOS 系统字体目录
          candidates.push('/Library/Fonts')
        } else if (os === 'linux') {
          const h = await homeDir()
          // Linux 常见字体目录（优先用户目录）
          candidates.push(await join(h, '.local', 'share', 'fonts'))
          candidates.push(await join(h, '.fonts'))
          candidates.push('/usr/share/fonts')
          candidates.push('/usr/local/share/fonts')
        }
      } catch {}
      // 依次尝试，找到第一个存在的目录
      for (const p of candidates) {
        try { if (await exists(p as any)) return p } catch {}
      }
      // 兜底：桌面目录（保证存在）
      try { return await desktopDir() } catch {}
      return undefined
    }

    // 安装字体：拷贝到 AppLocalData/fonts，并注册 @font-face
    if (installBtn) installBtn.addEventListener('click', async () => {
      try {
        const start = await getSystemFontsDir()
        const picked = await openDialog({
          multiple: true,
          // 默认打开系统字体目录，方便用户挑选已安装字体文件
          defaultPath: start,
          filters: [{ name: '字体', extensions: ['ttf','otf','woff','woff2'] }],
        } as any)
        const files: string[] = Array.isArray(picked) ? picked as any : (picked ? [picked as any] : [])
        if (!files.length) return
        await ensureFontsDir()
        let db = loadFontDb()
        for (const p of files) {
          try {
            const nameFull = (p.split(/[\\/]+/).pop() || '').trim()
            if (!nameFull) continue
            const m = nameFull.match(/^(.*?)(\.[^.]+)?$/) || [] as any
            const stem = (m?.[1] || 'font').trim()
            const ext = ((m?.[2] || '').replace('.', '') || 'ttf').toLowerCase()
            const id = sanitizeId(stem + '-' + Math.random().toString(36).slice(2,6))
            const family = 'UserFont-' + sanitizeId(stem)
            const rel = `${id}.${ext}`
            const bytes = await readFile(p as any)
            await writeFile(`${THEME_FONTS_DIR}/${rel}` as any, bytes as any, { baseDir: BaseDirectory.AppLocalData } as any)
            const rec: CustomFont = { id, name: stem, rel, ext, family }
            db.push(rec)
            await injectFontFace(rec)
          } catch {}
        }
        saveFontDb(db)
        rebuildFontSelects(loadThemePrefs())
      } catch {}
    })

    // 悬停预览：统一背景下，预览同时作用于界面/源码区与纸面
    const applyPreview = (color: string) => {
      try {
        const c = getContainer(); if (!c) return
        c.style.setProperty('--bg', color)
        c.style.setProperty('--preview-bg', color)
      } catch {}
    }
    const revertPreview = () => {
      try {
        const c = getContainer(); if (!c) return
        const unified = resolveUnifiedBg(lastSaved)
        c.style.setProperty('--bg', unified)
        c.style.setProperty('--preview-bg', unified)
      } catch {}
    }
    // 把还原函数暴露到模块级，让 initThemeUI 面板 toggle 时也能调用
    _themeRevertAllPreviews = revertPreview
    // 事件委托：在 swatch 上方时应用预览色
    panel.addEventListener('mouseover', (ev) => {
      const t = ev.target as HTMLElement
      const sw = t.closest('.theme-swatch') as HTMLElement | null
      if (!sw) return
      applyPreview(sw.dataset.color || '#ffffff')
    })
    // 离开色板区时还原，避免在区内移动造成闪烁
    panel.querySelectorAll('.theme-swatches').forEach((wrap) => {
      wrap.addEventListener('mouseleave', () => revertPreview())
    })

    // 点击颜色：更新、保存、应用
    panel.addEventListener('click', (ev) => {
      const t = ev.target as HTMLElement
      if (t.classList.contains('theme-swatch')) {
        const color = t.dataset.color || '#ffffff'
        const cur = loadThemePrefs()
        // 统一背景：写入锚点字段并同步镜像字段
        setUnifiedBg(cur, color)
        saveThemePrefs(cur)
        applyThemePrefs(cur)
        fillSwatches(panel!, cur)
        lastSaved = { ...cur }
      } else if (t.classList.contains('md-btn')) {
        const id = (t.dataset.md as MdStyleId) || 'standard'
        const cur = loadThemePrefs()
        cur.mdStyle = id
        saveThemePrefs(cur)
        applyThemePrefs(cur)
        fillSwatches(panel!, cur)
        lastSaved = { ...cur }
      }
    })

    // 网格背景切换
    const gridToggle = panel.querySelector('#grid-bg-toggle') as HTMLInputElement | null
    if (gridToggle) {
      gridToggle.addEventListener('change', () => {
        const cur = loadThemePrefs()
        cur.gridBackground = gridToggle.checked
        saveThemePrefs(cur)
        applyThemePrefs(cur)
        lastSaved = { ...cur }
      })
    }

    // 羊皮风格开关（统一开关）：同时作用于源码编辑区与阅读/所见正文。
    // 注：所见模式的羊皮纸已随「所见背景」设置移除——阅读羊皮纸通过 .md-content
    // 同时作用于所见模式（两者共用同一份正文排版层）。
    const parchmentBgToggle = panel.querySelector('#parchment-bg-toggle') as HTMLInputElement | null

    if (parchmentBgToggle) {
      const cur = loadThemePrefs()
      parchmentBgToggle.checked = !!cur.parchment
      parchmentBgToggle.addEventListener('change', () => {
        const cur = loadThemePrefs()
        const on = parchmentBgToggle.checked
        // 唯一事实源是 parchment；两个旧字段同步为镜像输出
        cur.parchment = on
        cur.parchmentEdit = on
        cur.parchmentRead = on
        saveThemePrefs(cur)
        applyThemePrefs(cur)
        lastSaved = { ...cur }
      })
    }

    // 自定义颜色输入框处理
    // 注意：只取背景区的控件（.theme-bg-*）——面板里还有网络代理的 .theme-apply-btn，
    // 用通用选择器会把「应用代理」的点击也绑到背景取色逻辑上。
    const customColorInputs = panel.querySelectorAll('.theme-bg-color-input') as NodeListOf<HTMLInputElement>
    const applyButtons = panel.querySelectorAll('.theme-bg-apply') as NodeListOf<HTMLButtonElement>

    // 实时验证输入
    customColorInputs.forEach((input) => {
      input.addEventListener('input', () => {
        const value = input.value.trim()
        if (value && !isValidHexColor(value)) {
          input.classList.add('invalid')
        } else {
          input.classList.remove('invalid')
        }
      })

      // 支持回车键应用
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const applyBtn = panel.querySelector('.theme-bg-apply') as HTMLButtonElement | null
          if (applyBtn) applyBtn.click()
        }
      })
    })

    // 应用按钮点击事件
    applyButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        // 统一背景只有一个自定义色输入框
        const input = panel.querySelector('.theme-bg-color-input') as HTMLInputElement | null
        if (!input) return

        const color = input.value.trim()

        // 验证颜色格式
        if (!color) {
          return  // 空值不处理
        }
        if (!isValidHexColor(color)) {
          alert('请输入有效的十六进制颜色（例如：#FFFFFF 或 #FFF）')
          input.focus()
          return
        }

        // 标准化颜色
        const normalized = normalizeHexColor(color)

        // 保存到配置
        const cur = loadThemePrefs()
        // 统一背景：写入锚点字段并同步镜像字段
        setUnifiedBg(cur, normalized)

        // 应用并保存
        saveThemePrefs(cur)
        applyThemePrefs(cur)
        fillSwatches(panel!, cur)
        lastSaved = { ...cur }
        // 输入框的值由 fillSwatches 统一同步为已生效的颜色
      })
    })

    // 专注模式开关
      const focusToggle = panel.querySelector('#focus-mode-toggle') as HTMLInputElement | null
      if (focusToggle) {
      // 初始化开关状态：同步当前 body 上的 focus-mode 类
      focusToggle.checked = document.body.classList.contains('focus-mode')
      // 监听开关变化
      focusToggle.addEventListener('change', async () => {
        const enabled = focusToggle.checked
        // 调用 main.ts 中的 toggleFocusMode 函数
        const toggleFunc = (window as any).flymdToggleFocusMode
        if (typeof toggleFunc === 'function') {
          await toggleFunc(enabled)
        } else {
          // 降级：如果函数不存在，至少切换 CSS 类
          document.body.classList.toggle('focus-mode', enabled)
          // 通过自定义事件通知 main.ts 保存状态
          const ev = new CustomEvent('flymd:focus:toggle', { detail: { enabled } })
          window.dispatchEvent(ev)
        }
      })
      // 监听外部专注模式变化（如快捷键触发），同步开关状态
      const syncFocusToggle = () => {
        focusToggle.checked = document.body.classList.contains('focus-mode')
      }
      // 使用 MutationObserver 监听 body 的 class 变化
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'attributes' && m.attributeName === 'class') {
            syncFocusToggle()
          }
        }
      })
        observer.observe(document.body, { attributes: true, attributeFilter: ['class'] })
      }

      // 紧凑标题栏开关
      const compactToggle = panel.querySelector('#compact-titlebar-toggle') as HTMLInputElement | null
      if (compactToggle) {
        // 紧凑标题栏：固定开启（样式依赖），不对用户暴露开关
        try {
          const label = compactToggle.closest('label') as HTMLElement | null
          if (label) label.style.display = 'none'
          compactToggle.checked = true
          compactToggle.disabled = true
        } catch {}
      }

    // 默认模式相关开关（所见 / 源码）
    const wysiwygDefaultToggle = panel.querySelector('#wysiwyg-default-toggle') as HTMLInputElement | null
    const sourcemodeDefaultToggle = panel.querySelector('#sourcemode-default-toggle') as HTMLInputElement | null
    const sourceLineNumbersToggle = panel.querySelector('#source-line-numbers-toggle') as HTMLInputElement | null
    const defaultOutlineTabToggle = panel.querySelector('#default-outline-tab-toggle') as HTMLInputElement | null
    const symbolAutoCompletionToggle = panel.querySelector('#symbol-auto-completion-toggle') as HTMLInputElement | null
    const wysiwygHtmlTableToggle = panel.querySelector('#wysiwyg-html-table-toggle') as HTMLInputElement | null
    const wysiwygHtmlTableSrcEditToggle = panel.querySelector('#wysiwyg-html-table-src-edit-toggle') as HTMLInputElement | null
    const pasteUrlTitleToggle = panel.querySelector('#paste-url-title-toggle') as HTMLInputElement | null
    const pasteRemoteImagesToggle = panel.querySelector('#paste-remote-images-toggle') as HTMLInputElement | null
    const libColorDepthToggle = panel.querySelector('#lib-color-depth-toggle') as HTMLInputElement | null
    const updateCheckDisabledToggle = panel.querySelector('#update-check-disabled-toggle') as HTMLInputElement | null

    const WYSIWYG_DEFAULT_KEY = 'flymd:wysiwyg:default'
    const SOURCEMODE_DEFAULT_KEY = 'flymd:sourcemode:default'
    const WYSIWYG_HTML_TABLE_TO_MD_KEY = 'flymd:wysiwyg:htmlTableToMd'

    const getWysiwygDefault = (): boolean => {
      try {
        const v = localStorage.getItem(WYSIWYG_DEFAULT_KEY)
        return v === 'true'
      } catch { return false }
    }

    const setWysiwygDefault = (enabled: boolean) => {
      try {
        localStorage.setItem(WYSIWYG_DEFAULT_KEY, enabled ? 'true' : 'false')
        const ev = new CustomEvent('flymd:wysiwyg:default', { detail: { enabled } })
        window.dispatchEvent(ev)
      } catch {}
    }

    const getSourcemodeDefault = (): boolean => {
      try {
        const v = localStorage.getItem(SOURCEMODE_DEFAULT_KEY)
        return v === 'true'
      } catch { return false }
    }

    const setSourcemodeDefault = (enabled: boolean) => {
      try {
        localStorage.setItem(SOURCEMODE_DEFAULT_KEY, enabled ? 'true' : 'false')
        const ev = new CustomEvent('flymd:sourcemode:default', { detail: { enabled } })
        window.dispatchEvent(ev)
      } catch {}
    }

    const getWysiwygHtmlTableToMd = (): boolean => {
      try {
        const v = localStorage.getItem(WYSIWYG_HTML_TABLE_TO_MD_KEY)
        return v === 'true'
      } catch { return false }
    }

    const setWysiwygHtmlTableToMd = (enabled: boolean) => {
      try {
        localStorage.setItem(WYSIWYG_HTML_TABLE_TO_MD_KEY, enabled ? 'true' : 'false')
        const ev = new CustomEvent('flymd:wysiwyg:htmlTableToMd', { detail: { enabled } })
        window.dispatchEvent(ev)
      } catch {}
    }

    // 所见模式 HTML 表格源码编辑入口（hover 铅笔按钮 / 双击）。默认开启。
    // 入口在交互发生时直接读 localStorage，无需事件广播即可即时生效。
    const WYSIWYG_HTML_TABLE_SRC_EDIT_KEY = 'flymd:wysiwyg:htmlTableSrcEdit'

    const getWysiwygHtmlTableSrcEdit = (): boolean => {
      try {
        const v = localStorage.getItem(WYSIWYG_HTML_TABLE_SRC_EDIT_KEY)
        if (v == null) return true
        return v !== 'false'
      } catch { return true }
    }

    const setWysiwygHtmlTableSrcEdit = (enabled: boolean) => {
      try {
        localStorage.setItem(WYSIWYG_HTML_TABLE_SRC_EDIT_KEY, enabled ? 'true' : 'false')
      } catch {}
    }

    // 默认使用所见模式开关
    if (wysiwygDefaultToggle) {
      // 初始化开关状态
      wysiwygDefaultToggle.checked = getWysiwygDefault()
      // 监听开关变化
      wysiwygDefaultToggle.addEventListener('change', () => {
        const enabled = wysiwygDefaultToggle.checked

        // 互斥：所见模式打开时，强制关闭源码模式
        if (enabled && sourcemodeDefaultToggle && sourcemodeDefaultToggle.checked) {
          sourcemodeDefaultToggle.checked = false
          try {
            localStorage.setItem(SOURCEMODE_DEFAULT_KEY, 'false')
            const ev = new CustomEvent('flymd:sourcemode:default', { detail: { enabled: false } })
            window.dispatchEvent(ev)
          } catch {}
        }

        setWysiwygDefault(enabled)
      })
    }

    // 默认使用源码模式开关
    if (sourcemodeDefaultToggle) {
      // 初始化开关状态
      sourcemodeDefaultToggle.checked = getSourcemodeDefault()

      // 监听开关变化
      sourcemodeDefaultToggle.addEventListener('change', () => {
        const enabled = sourcemodeDefaultToggle.checked

        // 互斥：源码模式打开时，强制关闭所见模式
        if (enabled && wysiwygDefaultToggle && wysiwygDefaultToggle.checked) {
          wysiwygDefaultToggle.checked = false
          try {
            localStorage.setItem(WYSIWYG_DEFAULT_KEY, 'false')
            const ev = new CustomEvent('flymd:wysiwyg:default', { detail: { enabled: false } })
            window.dispatchEvent(ev)
          } catch {}
        }

        setSourcemodeDefault(enabled)
      })
    }

    if (sourceLineNumbersToggle) {
      sourceLineNumbersToggle.checked = getSourceLineNumbersEnabled()
      sourceLineNumbersToggle.addEventListener('change', () => {
        setSourceLineNumbersEnabled(sourceLineNumbersToggle.checked)
        // 行号列是源码编辑器专属 DOM：textarea 源码模式是 .editor-gutter，
        // 大文件 CM6 源码视图是 .cm-gutters；Milkdown 所见 / 阅读模式两者都不渲染
        // → 那里切开关看不到任何变化，明确提示一次，避免被误判成"改了不生效、要重启"。
        // 分屏（源码+阅读）内部仍是 mode==='edit'，行号立即生效，同样不提示。
        let mode: string | null = null
        let wysiwyg: boolean | null = null
        try {
          const w = window as any
          const raw = w.flymdGetMode?.()
          // 只接受字符串返回值：钩子缺失或返回 null 时按"未知模式"处理
          mode = typeof raw === 'string' ? raw : null
          // 钩子不存在同样算未知（而不是"所见=false"），
          // 否则缺失一个钩子就会被当成源码模式，吞掉本该出现的提示。
          wysiwyg = typeof w.flymdGetWysiwygEnabled === 'function' ? !!w.flymdGetWysiwygEnabled() : null
        } catch (e) {
          // 任一钩子读取失败都按"未知模式"处理：必须把 mode 复位，
          // 否则"读到 edit 但 wysiwyg 读取抛错"会被误判成源码模式而吞掉提示。
          mode = null
          wysiwyg = null
          console.warn('[theme] 模式钩子不可用，源码行号提示按未知模式处理', e)
        }
        // 只有"明确处于源码模式"才不提示：任一钩子缺失/异常都按未知处理。
        // 提示是自消的，宁可多提示一次，也不给用户"点了没反应"的沉默。
        if (!hasSourceLineNumberColumn(mode, wysiwyg)) {
          NotificationManager.show('setting-hint', t('theme.sourceLineNumbers.hint'))
        }
      })
    }

    const codeWrapToggle = panel.querySelector('#code-wrap-toggle') as HTMLInputElement | null
    if (codeWrapToggle) {
      codeWrapToggle.checked = isCodeWrapEnabled()
      codeWrapToggle.addEventListener('change', () => {
        setCodeWrapEnabled(codeWrapToggle.checked)
      })
    }

    if (libColorDepthToggle) {
      libColorDepthToggle.checked = getLibColorDepthEnabled()
      libColorDepthToggle.addEventListener('change', () => {
        setLibColorDepthEnabled(libColorDepthToggle.checked)
      })
    }

    if (defaultOutlineTabToggle) {
      defaultOutlineTabToggle.checked = getDefaultOutlineTabEnabled()
      defaultOutlineTabToggle.addEventListener('change', () => {
        setDefaultOutlineTabEnabled(defaultOutlineTabToggle.checked)
      })
    }

    if (symbolAutoCompletionToggle) {
      symbolAutoCompletionToggle.checked = getSymbolAutoCompletionEnabled()
      symbolAutoCompletionToggle.addEventListener('change', () => {
        setSymbolAutoCompletionEnabled(symbolAutoCompletionToggle.checked)
      })
    }

    // 所见模式：HTML 表格转为可编辑的 Markdown 表格（进入所见/重载内容时生效）
    if (wysiwygHtmlTableToggle) {
      wysiwygHtmlTableToggle.checked = getWysiwygHtmlTableToMd()
      wysiwygHtmlTableToggle.addEventListener('change', () => {
        setWysiwygHtmlTableToMd(wysiwygHtmlTableToggle.checked)
      })
    }

    // 所见模式：HTML 表格源码编辑入口（hover 铅笔按钮 / 双击），即时生效
    if (wysiwygHtmlTableSrcEditToggle) {
      wysiwygHtmlTableSrcEditToggle.checked = getWysiwygHtmlTableSrcEdit()
      wysiwygHtmlTableSrcEditToggle.addEventListener('change', () => {
        setWysiwygHtmlTableSrcEdit(wysiwygHtmlTableSrcEditToggle.checked)
      })
    }

    // 粘贴 URL：自动抓取网页标题（Ctrl+V），Ctrl+Shift+V 可临时禁用抓取
    if (pasteUrlTitleToggle) {
      pasteUrlTitleToggle.checked = getPasteUrlTitleFetchEnabled()
      pasteUrlTitleToggle.addEventListener('change', () => {
        setPasteUrlTitleFetchEnabled(pasteUrlTitleToggle.checked)
      })
    }

    // 网页富文本粘贴：自动下载远程图片到当前文档 images/ 并使用相对路径
    if (pasteRemoteImagesToggle) {
      pasteRemoteImagesToggle.checked = getPasteRemoteImagesEnabled()
      pasteRemoteImagesToggle.addEventListener('change', () => {
        setPasteRemoteImagesEnabled(pasteRemoteImagesToggle.checked)
      })
    }

    // 更新检测：关闭后启动静默检测和手动检测入口都不再发起请求
    if (updateCheckDisabledToggle) {
      updateCheckDisabledToggle.checked = getUpdateCheckDisabled()
      updateCheckDisabledToggle.addEventListener('change', () => {
        setUpdateCheckDisabled(updateCheckDisabledToggle.checked)
      })
    }

    // 夜间模式开关
    const darkModeToggle = panel.querySelector('#dark-mode-toggle') as HTMLInputElement | null
    if (darkModeToggle) {
      const DARK_MODE_KEY = 'flymd:darkmode'
      // 检测系统是否为深色模式
      const isSystemDarkMode = (): boolean => {
        try {
          return window.matchMedia('(prefers-color-scheme: dark)').matches
        } catch { return false }
      }
      const getDarkMode = (): boolean => {
        // 读取用户保存的设置（系统深色模式下默认开启，但尊重用户选择）
        try {
          const v = localStorage.getItem(DARK_MODE_KEY)
          // 用户有明确选择时使用用户设置，否则跟随系统
          if (v !== null) return v === 'true'
          return isSystemDarkMode()
        } catch { return isSystemDarkMode() }
      }
      const setDarkMode = (enabled: boolean) => {
        try {
          localStorage.setItem(DARK_MODE_KEY, enabled ? 'true' : 'false')
          document.body.classList.toggle('dark-mode', enabled)
          // 系统深色模式下关闭夜间模式时，添加 light-mode 强制浅色
          const sysIsDark = isSystemDarkMode()
          document.body.classList.toggle('light-mode', sysIsDark && !enabled)
          // 重新应用主题设置（切换模式时使用对应的背景色）
          const cur = loadThemePrefs()
          applyThemePrefs(cur)
          // 刷新色板显示（切换到对应模式的色板）
          fillSwatches(panel!, cur)
          lastSaved = { ...cur }
          // 触发事件，通知其他组件
          const ev = new CustomEvent('flymd:darkmode:changed', { detail: { enabled } })
          window.dispatchEvent(ev)
        } catch {}
      }
      // 初始化开关状态
      const isDark = getDarkMode()
      darkModeToggle.checked = isDark
      document.body.classList.toggle('dark-mode', isDark)
      // 同步 light-mode 类（系统深色且用户选择浅色时）
      const sysIsDark = isSystemDarkMode()
      document.body.classList.toggle('light-mode', sysIsDark && !isDark)
      // 监听开关变化
      darkModeToggle.addEventListener('change', () => {
        setDarkMode(darkModeToggle.checked)
      })
    }

    // 网络代理（Tauri 后端 reqwest / plugin-http）
    type NetworkProxyPrefs = { enabled: boolean; proxyUrl: string; noProxy: string }
    const loadNetProxy = (): { prefs: NetworkProxyPrefs; hasSaved: boolean } => {
      try {
        const raw = localStorage.getItem(THEME_NET_PROXY_KEY)
        if (!raw) return { prefs: { enabled: false, proxyUrl: '', noProxy: NETWORK_PROXY_DEFAULT_NO_PROXY }, hasSaved: false }
        const v = JSON.parse(raw || '{}') as any
        return {
          prefs: {
            enabled: !!v.enabled,
            proxyUrl: typeof v.proxyUrl === 'string' ? v.proxyUrl : '',
            noProxy: normalizeNetworkNoProxy(typeof v.noProxy === 'string' ? v.noProxy : ''),
          },
          hasSaved: true,
        }
      } catch {
        return { prefs: { enabled: false, proxyUrl: '', noProxy: NETWORK_PROXY_DEFAULT_NO_PROXY }, hasSaved: false }
      }
    }
    const saveNetProxy = (prefs: NetworkProxyPrefs) => {
      try { localStorage.setItem(THEME_NET_PROXY_KEY, JSON.stringify({ ...prefs, noProxy: normalizeNetworkNoProxy(prefs.noProxy) })) } catch {}
    }
    const applyNetProxy = async (prefs: NetworkProxyPrefs) => {
      try {
        const enabled = !!prefs.enabled
        const proxyUrl = String(prefs.proxyUrl || '').trim()
        const noProxy = normalizeNetworkNoProxy(String(prefs.noProxy || ''))
        await invoke('set_network_proxy', { enabled, proxyUrl, noProxy })
      } catch (e) {
        try { console.warn('[Theme][Proxy] apply failed', e) } catch {}
        throw e
      }
    }

    const proxyEnabled = panel.querySelector('#net-proxy-enabled') as HTMLInputElement | null
    const proxyUrlInput = panel.querySelector('#net-proxy-url') as HTMLInputElement | null
    const noProxyInput = panel.querySelector('#net-proxy-no-proxy') as HTMLInputElement | null
    const proxyApplyBtn = panel.querySelector('#net-proxy-apply') as HTMLButtonElement | null

    const syncProxyUI = (prefs: NetworkProxyPrefs) => {
      try {
        if (proxyEnabled) proxyEnabled.checked = !!prefs.enabled
        if (proxyUrlInput) proxyUrlInput.value = prefs.proxyUrl || ''
        if (noProxyInput) noProxyInput.value = prefs.noProxy || ''
        const dis = !prefs.enabled
        if (proxyUrlInput) proxyUrlInput.disabled = dis
        if (noProxyInput) noProxyInput.disabled = dis
        if (proxyApplyBtn) proxyApplyBtn.disabled = dis
      } catch {}
    }

    const validateNetProxy = (prefs: NetworkProxyPrefs): string => {
      try {
        if (!prefs.enabled) return ''
        const u = String(prefs.proxyUrl || '').trim()
        if (!u) return t('theme.netProxy.errEmpty')
        if (!/^https?:\/\//i.test(u)) return t('theme.netProxy.errScheme')
        return ''
      } catch { return '' }
    }

    const applyFromUI = async () => {
      const prefs: NetworkProxyPrefs = {
        enabled: !!(proxyEnabled && proxyEnabled.checked),
        proxyUrl: String(proxyUrlInput?.value || ''),
        noProxy: normalizeNetworkNoProxy(String(noProxyInput?.value || '')),
      }
      const err = validateNetProxy(prefs)
      if (err) { alert(err); return }
      saveNetProxy(prefs)
      syncProxyUI(prefs)
      try { await applyNetProxy(prefs) } catch { alert(t('theme.netProxy.errApplyFailed')); return }
      try { window.dispatchEvent(new CustomEvent('flymd:netproxy:changed', { detail: { ...prefs } })) } catch {}
    }

    // 初始化：同步 UI + 尝试把已保存的代理设置下发到后端（即使面板未打开也能生效）
    try {
      const loaded = loadNetProxy()
      syncProxyUI(loaded.prefs)
      // 只在用户曾经保存过该配置时才触发下发，避免无端清空用户通过环境变量注入的代理
      if (loaded.hasSaved) {
        void applyNetProxy(loaded.prefs).catch(() => {})
      }
    } catch {}

    if (proxyEnabled) {
      proxyEnabled.addEventListener('change', async () => {
        const cur = loadNetProxy().prefs
        cur.enabled = !!proxyEnabled.checked
        saveNetProxy(cur)
        syncProxyUI(cur)
        const err = validateNetProxy(cur)
        if (err) { if (cur.enabled) alert(err); return }
        try { await applyNetProxy(cur) } catch { alert(t('theme.netProxy.errApplyFailed')); return }
        try { window.dispatchEvent(new CustomEvent('flymd:netproxy:changed', { detail: { ...cur } })) } catch {}
      })
    }
    if (proxyApplyBtn) proxyApplyBtn.addEventListener('click', () => { void applyFromUI() })
    if (proxyUrlInput) proxyUrlInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); void applyFromUI() } })
    if (noProxyInput) noProxyInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); void applyFromUI() } })

    // 关闭按钮
    const closeBtn = panel.querySelector('.theme-panel-close') as HTMLButtonElement | null
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        revertPreview()
        panel!.classList.add('hidden')
      })
    }

    // 点击外部关闭
    document.addEventListener('click', (ev) => {
      try {
        const t = ev.target as HTMLElement
        if (!panel || panel.classList.contains('hidden')) return
        if (t.closest('#theme-panel') || t.closest('#btn-theme')) return
        revertPreview()
        panel.classList.add('hidden')
      } catch {}
    })

    // ESC 键关闭
    document.addEventListener('keydown', (ev) => {
      try {
        if (ev.key === 'Escape' && panel && !panel.classList.contains('hidden')) {
          revertPreview()
          panel.classList.add('hidden')
          ev.preventDefault()
          ev.stopPropagation()
        }
      } catch {}
    })
    return panel
  } catch {
    _themePanelReady = false
    return null
  }
}

export function initThemeUI(): void {
  try {
    bootstrapThemeRuntime()
    if (_themeUiBound) return
    _themeUiBound = true
    const btn = document.getElementById('btn-theme') as HTMLDivElement | null
    if (!btn) return
    btn.addEventListener('click', () => {
      try {
        const panel = ensureThemePanelReady()
        if (!panel) return
        const wasHidden = panel.classList.contains('hidden')
        panel.classList.toggle('hidden')
        // 原代码此处直接调用 ensureThemePanelReady 内部定义的 revertAllPreviews，
        // 但作用域不重叠，是 ReferenceError，被 try/catch 静默吞掉。
        // 现在改为调用模块级 _themeRevertAllPreviews（ensureThemePanelReady 已暴露）
        if (!wasHidden && panel.classList.contains('hidden')) _themeRevertAllPreviews?.()
      } catch {}
    })
  } catch {}
}
