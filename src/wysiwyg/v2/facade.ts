// WYSIWYG V2 异步门面
// 将 milkdown/prosemirror 等重依赖延迟到首次进入所见模式时加载

import type * as WysiwygMod from './index'

let _modPromise: Promise<typeof WysiwygMod> | null = null
let _mod: typeof WysiwygMod | null = null

function loadMod(): Promise<typeof WysiwygMod> {
  if (!_modPromise) {
    _modPromise = import('./index').then((m) => {
      _mod = m as typeof WysiwygMod
      return _mod
    })
  }
  return _modPromise
}

// 异步 API：等待模块加载后转发
export async function enableWysiwygV2(root: HTMLElement, initialMd: string, onChange: (md: string) => void): Promise<void> {
  const mod = await loadMod()
  return mod.enableWysiwygV2(root, initialMd, onChange)
}

export async function disableWysiwygV2(): Promise<void> {
  const mod = await loadMod()
  return mod.disableWysiwygV2()
}

export async function wysiwygV2ToggleBold(): Promise<void> {
  const mod = await loadMod()
  return mod.wysiwygV2ToggleBold()
}

export async function wysiwygV2ToggleItalic(): Promise<void> {
  const mod = await loadMod()
  return mod.wysiwygV2ToggleItalic()
}

export async function wysiwygV2ApplyLink(href: string, labelOrTitle?: string, maybeTitle?: string): Promise<void> {
  const mod = await loadMod()
  return mod.wysiwygV2ApplyLink(href, labelOrTitle, maybeTitle)
}

export async function wysiwygV2ReplaceAll(markdown: string): Promise<void> {
  const mod = await loadMod()
  return mod.wysiwygV2ReplaceAll(markdown)
}

// 同步 API：模块加载完成后直接调用；未加载时返回安全默认值
export function wysiwygV2GetSelectedText(): string {
  return _mod?.wysiwygV2GetSelectedText() ?? ''
}

export function wysiwygV2FindNext(term: string, caseSensitive = false): boolean {
  return _mod?.wysiwygV2FindNext(term, caseSensitive) ?? false
}

export function wysiwygV2FindPrev(term: string, caseSensitive = false): boolean {
  return _mod?.wysiwygV2FindPrev(term, caseSensitive) ?? false
}

export function wysiwygV2ReplaceOne(term: string, replacement: string, caseSensitive = false): boolean {
  return _mod?.wysiwygV2ReplaceOne(term, replacement, caseSensitive) ?? false
}

export function wysiwygV2ReplaceAllInDoc(term: string, replacement: string, caseSensitive = false): number {
  return _mod?.wysiwygV2ReplaceAllInDoc(term, replacement, caseSensitive) ?? 0
}

export function wysiwygV2HandleListTab(outdent: boolean): boolean {
  return _mod?.wysiwygV2HandleListTab(outdent) ?? false
}

export function wysiwygV2DeleteTableRow(target: HTMLElement | null): boolean {
  return _mod?.wysiwygV2DeleteTableRow(target) ?? false
}

export function wysiwygV2DeleteTableColumn(target: HTMLElement | null): boolean {
  return _mod?.wysiwygV2DeleteTableColumn(target) ?? false
}

export function isWysiwygV2Enabled(): boolean {
  return _mod?.isWysiwygV2Enabled() ?? false
}
