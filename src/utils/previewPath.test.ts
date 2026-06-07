import { describe, it, expect } from 'vitest'
import {
  decodePreviewHrefPath,
  stripPreviewHrefSuffix,
  normalizePreviewFsPath,
  fileUrlToPreviewPath,
  resolvePreviewLocalDocPath,
} from './previewPath'

describe('decodePreviewHrefPath', () => {
  it('decodes utf-8 percent escapes', () => {
    expect(decodePreviewHrefPath('hello%20world')).toBe('hello world')
  })
  it('falls back to decodeURI on utf-8 failure', () => {
    // %C0 invalid utf-8 → decodeURIComponent throws → falls back to decodeURI
    expect(decodePreviewHrefPath('%C0bad')).toBe('%C0bad')
  })
  it('returns input when both decodes fail', () => {
    expect(decodePreviewHrefPath('%')).toBe('%')
  })
})

describe('stripPreviewHrefSuffix', () => {
  it('strips query string', () => {
    expect(stripPreviewHrefSuffix('file.md?x=1')).toBe('file.md')
  })
  it('strips hash', () => {
    expect(stripPreviewHrefSuffix('file.md#section')).toBe('file.md')
  })
  it('strips both, keeping the earlier end', () => {
    expect(stripPreviewHrefSuffix('file.md?x=1#section')).toBe('file.md')
    expect(stripPreviewHrefSuffix('file.md#section?x=1')).toBe('file.md')
  })
  it('returns input when no suffix', () => {
    expect(stripPreviewHrefSuffix('file.md')).toBe('file.md')
  })
})

describe('normalizePreviewFsPath', () => {
  it('returns empty string for empty input', () => {
    expect(normalizePreviewFsPath('')).toBe('')
    expect(normalizePreviewFsPath('   ')).toBe('')
  })
  it('converts Windows drive to canonical form', () => {
    expect(normalizePreviewFsPath('C:/foo/bar')).toBe('C:/foo/bar')
  })
  it('flattens . and .. without prefix', () => {
    expect(normalizePreviewFsPath('./a/./b/../c')).toBe('a/c')
  })
  it('handles leading /', () => {
    expect(normalizePreviewFsPath('/foo/bar')).toBe('/foo/bar')
  })
  it('preserves UNC double-slash prefix', () => {
    expect(normalizePreviewFsPath('//server/share/dir')).toBe('//server/share/dir')
  })
  it('flips to backslash when currentFilePath is Windows-y', () => {
    expect(normalizePreviewFsPath('C:/foo/bar', 'C:\\doc.md')).toBe('C:\\foo\\bar')
  })
  it('keeps forward slash for non-Windows currentFilePath', () => {
    expect(normalizePreviewFsPath('C:/foo/bar', '/home/u/doc.md')).toBe('C:/foo/bar')
  })
})

describe('fileUrlToPreviewPath', () => {
  it('returns null for non-file URLs', () => {
    expect(fileUrlToPreviewPath('https://example.com/x.md')).toBeNull()
  })
  it('converts file:// URL to local path', () => {
    expect(fileUrlToPreviewPath('file:///C:/foo/bar.md')).toBe('C:/foo/bar.md')
  })
  it('strips leading slash for Windows drive in URL', () => {
    expect(fileUrlToPreviewPath('file:///C:/foo/bar.md')).toBe('C:/foo/bar.md')
  })
  it('rebuilds UNC for file:// with host', () => {
    expect(fileUrlToPreviewPath('file://server/share/dir/file.md')).toBe('//server/share/dir/file.md')
  })
  it('returns null on invalid URL', () => {
    expect(fileUrlToPreviewPath('not a url')).toBeNull()
  })
})

describe('resolvePreviewLocalDocPath', () => {
  it('returns null for empty href', () => {
    expect(resolvePreviewLocalDocPath('')).toBeNull()
  })
  it('returns null for hash-only href', () => {
    expect(resolvePreviewLocalDocPath('#section')).toBeNull()
  })
  it('returns null for non-document extension', () => {
    expect(resolvePreviewLocalDocPath('image.png')).toBeNull()
  })
  it('returns null for unknown protocol', () => {
    expect(resolvePreviewLocalDocPath('https://example.com/doc.md')).toBeNull()
  })
  it('handles file:// URL', () => {
    expect(resolvePreviewLocalDocPath('file:///C:/foo/bar.md')).toBe('C:/foo/bar.md')
  })
  it('handles Windows absolute path', () => {
    // 无 currentFilePath → preferBackslash=false,保持正斜杠
    expect(resolvePreviewLocalDocPath('C:\\foo\\bar.md')).toBe('C:/foo/bar.md')
  })
  it('handles Windows absolute path with Windows currentFilePath', () => {
    expect(resolvePreviewLocalDocPath('C:\\foo\\bar.md', 'C:\\doc.md')).toBe('C:\\foo\\bar.md')
  })
  it('handles UNC path', () => {
    // UNC `\\server\share\dir.md` → `\\server\share\dir.md` 经 normalize 得 `\\server\share\dir.md`(正反斜杠翻转);
    // 无 currentFilePath → 不翻转,保持 `//server/share/dir.md`
    expect(resolvePreviewLocalDocPath('\\\\server\\share\\dir.md')).toBe('//server/share/dir.md')
  })
  it('handles absolute POSIX path on Linux/macOS', () => {
    expect(resolvePreviewLocalDocPath('/foo/bar.md', '/home/u/cur.md')).toBe('/foo/bar.md')
  })
  it('returns null for absolute POSIX path when currentFilePath is Windows-y', () => {
    expect(resolvePreviewLocalDocPath('/foo/bar.md', 'C:\\Users\\me\\cur.md')).toBeNull()
  })
  it('resolves relative path against currentFilePath', () => {
    expect(resolvePreviewLocalDocPath('sub/note.md', '/home/u/cur.md')).toBe('/home/u/sub/note.md')
  })
  it('returns null for relative path without currentFilePath', () => {
    expect(resolvePreviewLocalDocPath('sub/note.md')).toBeNull()
  })
  it('strips query string before checking extension', () => {
    expect(resolvePreviewLocalDocPath('note.md?download=1', '/home/u/cur.md')).toBe('/home/u/note.md')
  })
})
