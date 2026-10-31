// 「源码行号」即时生效不变量测试
//
// 背景
//   用户反馈「源码行号开关只能重启后才能看到效果」。实际是三个独立原因：
//     1. 行号列（.editor-gutter）是源码编辑器专属 DOM，所见/阅读模式根本不渲染它；
//        在那些模式里切开关看不到任何变化 → 容易被误判成"要重启"。
//     2. 安装时机：编辑器 DOM 尚未挂上时，旧实现直接 return 且永不重试，
//        等于本会话永远没有行号列 → 这条是真正的"必须重启"失败路径。
//     3. 开关切换后是否立刻重排，取决于偏好变更事件有没有被行号模块监听。
//
// 本文件把这三条固化成可自动校验的不变量，避免后续重构把"重启才生效"放回去。

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')

function read(relative: string): string {
  return readFileSync(join(repoRoot, relative), 'utf8')
}

describe('源码行号：安装不放弃', () => {
  it('调度器在编辑器 DOM 未就绪时有界重试，而不是直接放弃', () => {
    const src = read('src/modes/sourceLineNumbers.ts')
    // 有界重试：attempt 递增并递归回调度器
    expect(src).toMatch(/scheduleInstall\(attempt\s*\+\s*1\)/)
    // 次数上限存在（避免无限轮询）
    expect(src).toMatch(/INSTALL_MAX_ATTEMPTS\s*=\s*\d+/)
    // 重试间隔存在
    expect(src).toMatch(/INSTALL_RETRY_INTERVAL_MS\s*=\s*\d+/)
    // 关键回归点：安装入口不得再出现"直接放弃"的裸返回形态
    // （旧实现是 setTimeout(installLineNumbers, 800) 后 if (!editor) return，永不重试）
    expect(src).not.toMatch(/setTimeout\(\s*installLineNumbers\s*,/)
  })

  it('重试窗口足够覆盖编辑器挂载延迟', () => {
    const src = read('src/modes/sourceLineNumbers.ts')
    const interval = Number(src.match(/INSTALL_RETRY_INTERVAL_MS\s*=\s*(\d+)/)?.[1] ?? '0')
    const attempts = Number(src.match(/INSTALL_MAX_ATTEMPTS\s*=\s*(\d+)/)?.[1] ?? '0')
    expect(interval).toBeGreaterThan(0)
    expect(attempts).toBeGreaterThan(1)
    // 至少覆盖 ~5s 的挂载延迟
    expect(interval * attempts).toBeGreaterThanOrEqual(5000)
  })

  it('快速重试窗口用尽后转入 DOM 观察兜底，不做静默永久放弃', () => {
    const src = read('src/modes/sourceLineNumbers.ts')
    expect(src).toMatch(/MutationObserver/)
    expect(src).toMatch(/watchForEditor/)
    // 兜底失败必须留痕，不能静默
    expect(src).toMatch(/console\.warn/)
  })

  it('幂等标志在 DOM 组装完成之后才置位', () => {
    const src = read('src/modes/sourceLineNumbers.ts')
    // 主路径的置位点必须晚于 DOM 插入点，否则"编辑器未挂载"会永久消耗掉安装机会。
    // 注意：防御分支（编辑器已在 .editor-shell 内）有一处更早的置位，用 lastIndexOf 取主路径那处。
    const flagIdx = src.lastIndexOf('flymd.__flymdSourceLineNumbersInit = true')
    expect(flagIdx).toBeGreaterThan(-1)
    const insertIdx = src.indexOf('parent.insertBefore(shell, editor)')
    expect(insertIdx).toBeGreaterThan(-1)
    expect(flagIdx).toBeGreaterThan(insertIdx)
    // 子树必须先在游离状态组装好再插入，避免中途抛错留下半成品外壳
    expect(src.indexOf('shell.appendChild(gutter)')).toBeLessThan(insertIdx)
    expect(src.indexOf('surface.appendChild(measure)')).toBeLessThan(insertIdx)
  })

  it('安装中途被打断时不会二次插入把安装卡死', () => {
    const src = read('src/modes/sourceLineNumbers.ts')
    // 编辑器已被移进 .editor-shell（上次安装中断）时只补标志，不再插入第二个外壳
    expect(src).toMatch(/existingShell[\s\S]{0,400}editor-shell/)
    expect(src).toMatch(/existingShell[\s\S]{0,400}__flymdSourceLineNumbersInit\s*=\s*true/)
  })
})

describe('源码行号：切换后立即生效', () => {
  it('偏好变更通过事件广播，行号模块监听后立刻重排', () => {
    const src = read('src/modes/sourceLineNumbers.ts')
    // 事件名统一走共享常量，避免多处手写字面量漂移
    expect(src).toMatch(/window\.addEventListener\(\s*SOURCE_LINE_NUMBERS_CHANGED_EVENT/)
  })

  it('写入偏好时派发变更事件（写在唯一事实源里）', () => {
    const src = read('src/core/sourceLineNumbersPref.ts')
    expect(src).toMatch(/new CustomEvent<[^>]*>\(\s*SOURCE_LINE_NUMBERS_CHANGED_EVENT/)
    expect(src).toMatch(/window\.dispatchEvent/)
  })

  it('偏好读写只有一处实现：三个消费方都从共享模块导入', () => {
    const prefSrc = read('src/core/sourceLineNumbersPref.ts')
    expect(prefSrc).toMatch(/export function getSourceLineNumbersEnabled/)
    expect(prefSrc).toMatch(/export function setSourceLineNumbersEnabled/)

    // theme.ts / sourceLineNumbers.ts / CM6 链路不得再自带一份实现或键名字面量
    for (const file of ['src/theme.ts', 'src/modes/sourceLineNumbers.ts', 'src/modes/cm6Editor.ts', 'src/modes/cm6ModeHost.ts']) {
      const src = read(file)
      expect(src, file).not.toMatch(/['"]flymd:sourceLineNumbers:enabled['"]/)
      expect(src, file).not.toMatch(/['"]flymd:sourceLineNumbers:changed['"]/)
      expect(src, file).toMatch(/from ['"][^'"]*sourceLineNumbersPref['"]/)
    }
  })
})

describe('源码行号：非源码模式给出即时反馈', () => {
  it('主题面板在非源码模式切开关时弹出提示', () => {
    const src = read('src/theme.ts')
    expect(src).toMatch(/NotificationManager\.show\(\s*['"]setting-hint['"]/)
    // 提示必须由「是否源码模式」决定
    expect(src).toMatch(/flymdGetMode/)
    expect(src).toMatch(/flymdGetWysiwygEnabled/)
    // 模式判定只认字符串返回值：钩子缺失/返回 null 时按未知模式处理，不得静默吞掉
    expect(src).toMatch(/typeof raw\s*===\s*['"]string['"]/)
    // 所见钩子缺失同样按未知处理，不能被当成"所见=false"而误判成源码模式
    expect(src).toMatch(/typeof w\.flymdGetWysiwygEnabled\s*===\s*['"]function['"]/)
    expect(src).toMatch(/console\.warn/)
  })

  it('提示时长只有一处事实源（配置表），调用点不重复写字面量', () => {
    const themeSrc = read('src/theme.ts')
    // show('setting-hint', ...) 不再带第三个时长参数
    expect(themeSrc).not.toMatch(/NotificationManager\.show\(\s*['"]setting-hint['"]\s*,[^)]*,/)
    const cfgSrc = read('src/core/uiNotifications.ts')
    expect(cfgSrc).toMatch(/['"]setting-hint['"]\s*:\s*\{[\s\S]{0,200}duration:\s*\d+/)
  })

  it('setting-hint 类型在联合类型与配置表里都存在', () => {
    const src = read('src/core/uiNotifications.ts')
    // configs 缺项会让 config.clickable 抛错，被 catch 静默吞掉 → 通知永远不显示
    expect(src).toMatch(/\|\s*['"]setting-hint['"]/)
    expect(src).toMatch(/['"]setting-hint['"]\s*:\s*\{/)
  })

  it('开关带 tooltip 说明作用范围', () => {
    const src = read('src/theme.ts')
    expect(src).toMatch(/theme\.sourceLineNumbers\.tip/)
  })

  it('中英文案都齐备', () => {
    const src = read('src/i18n.ts')
    expect(src).toMatch(/'theme\.sourceLineNumbers\.tip'\s*:/)
    expect(src).toMatch(/'theme\.sourceLineNumbers\.hint'\s*:/)
    // 中英各一份：键名在本文件出现两次
    const tipCount = (src.match(/'theme\.sourceLineNumbers\.tip'\s*:/g) ?? []).length
    const hintCount = (src.match(/'theme\.sourceLineNumbers\.hint'\s*:/g) ?? []).length
    expect(tipCount).toBe(2)
    expect(hintCount).toBe(2)
  })
})

describe('源码行号：大文件 CM6 视图同样受同一个开关控制', () => {
  it('CM6 行号扩展装在 Compartment 里，可运行时重配置', () => {
    const src = read('src/modes/cm6Editor.ts')
    expect(src).toMatch(/new Compartment\(\)/)
    // 构造时按偏好装载，而不是无条件 lineNumbers()
    expect(src).toMatch(/lineNumbersCompartment\.of\(/)
    expect(src).not.toMatch(/^\s*lineNumbers\(\),\s*$/m)
    // 提供运行时显隐入口
    expect(src).toMatch(/setLineNumbersEnabled\(enabled:\s*boolean\)/)
    expect(src).toMatch(/lineNumbersCompartment\.reconfigure\(/)
  })

  it('CM6 宿主订阅偏好变更并在销毁时解绑', () => {
    const src = read('src/modes/cm6ModeHost.ts')
    expect(src).toMatch(/window\.addEventListener\(SOURCE_LINE_NUMBERS_CHANGED_EVENT, this\.onLineNumbersPrefChanged\)/)
    expect(src).toMatch(/window\.removeEventListener\(SOURCE_LINE_NUMBERS_CHANGED_EVENT, this\.onLineNumbersPrefChanged\)/)
    // 初始化按当前偏好
    expect(src).toMatch(/lineNumbers:\s*getSourceLineNumbersEnabled\(\)/)
  })

  it('提示只在「当前视图没有源码行号列」时出现', () => {
    const src = read('src/theme.ts')
    expect(src).toMatch(/function hasSourceLineNumberColumn\(/)
    // textarea 源码模式：有行号列 → 不提示
    expect(src).toMatch(/mode\s*===\s*['"]edit['"]\s*&&\s*wysiwyg\s*===\s*false/)
    // 大文件 CM6 视图：行号栏就在眼前 → 不提示
    expect(src).toMatch(/CM6_VIEW_CLASS/)
    expect(src).toMatch(/if \(!hasSourceLineNumberColumn\(mode, wysiwyg\)\)/)
  })

  it('CM6 视图标记类只有一处定义（共享常量），读写方不各自手写字符串', () => {
    const engineSrc = read('src/modes/editorEngine.ts')
    expect(engineSrc).toMatch(/export const CM6_VIEW_CLASS\s*=\s*['"]wysiwyg-cm6['"]/)

    // 挂载/卸载/读取三处都用常量
    const mainSrc = read('src/main.ts')
    expect(mainSrc).toMatch(/classList\.add\(\s*['"]wysiwyg-v2['"],\s*CM6_VIEW_CLASS\s*\)/)
    expect(mainSrc).toMatch(/classList\.remove\(CM6_VIEW_CLASS\)/)
    const themeSrc = read('src/theme.ts')
    expect(themeSrc).toMatch(/CM6_VIEW_CLASS/)

    // 除常量定义处外，不应再出现字面量 'wysiwyg-cm6'
    for (const file of ['src/main.ts', 'src/theme.ts']) {
      expect(read(file), file).not.toMatch(/['"]wysiwyg-cm6['"]/)
    }
  })
})
