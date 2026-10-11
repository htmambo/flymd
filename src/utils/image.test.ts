// transcodeToWebpIfNeeded 的动图保护行为。
//
// 背景：判断「是否动图」不能只依赖 Blob.type 与扩展名 —— 实际来源里
// 会出现 MIME 标错（如 .png 文件实为 GIF）或两者都缺失的情况。
// 一旦漏判，动图会被转成静态 WebP，动画就此丢失。

import { describe, it, expect } from 'vitest'
import { transcodeToWebpIfNeeded } from './image'

const latin1 = (s: string) => Array.from(new TextEncoder().encode(s))

// 动图：GIF89a 头 + NETSCAPE2.0 循环扩展 + 两个图像描述符
const ANIMATED_GIF: Uint8Array<ArrayBuffer> = new Uint8Array([
  ...latin1('GIF89a'),
  0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
  0x00, 0x00, 0x00, 0xff, 0xff, 0xff,
  0x21, 0xff, 0x0b, ...latin1('NETSCAPE2.0'), 0x03, 0x01, 0x00, 0x00, 0x00,
  0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
  0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
])

// 静态图：仅一个图像描述符
const STILL_GIF: Uint8Array<ArrayBuffer> = new Uint8Array([
  ...latin1('GIF89a'),
  0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
  0x00, 0x00, 0x00, 0xff, 0xff, 0xff,
  0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
])

// 最小 PNG（非动图）
const PNG: Uint8Array<ArrayBuffer> = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
])

function gifBlob(bytes: Uint8Array, mime: string): Blob {
  // 复制到独立 ArrayBuffer：TS 5.7+ 的 Uint8Array<ArrayBufferLike> 与
  // BlobPart 的 ArrayBufferView<ArrayBuffer> 方差不兼容，直接传会报错。
  const buf = new ArrayBuffer(bytes.length)
  new Uint8Array(buf).set(bytes)
  return new Blob([buf], { type: mime })
}

describe('transcodeToWebpIfNeeded — 动图保护', () => {
  it('MIME 标为 image/gif 时跳过（原有行为）', async () => {
    const blob = gifBlob(ANIMATED_GIF, 'image/gif')
    const r = await transcodeToWebpIfNeeded(blob, 'a.gif', 0.85, { skipAnimated: true })
    expect(r.changed).toBe(false)
    expect(r.type).toBe('image/gif')
  })

  it('扩展名为 .gif 但 MIME 缺失时跳过（原有行为）', async () => {
    const blob = gifBlob(ANIMATED_GIF, '')
    const r = await transcodeToWebpIfNeeded(blob, 'a.gif', 0.85, { skipAnimated: true })
    expect(r.changed).toBe(false)
    expect(r.type).toBe('image/gif')
  })

  it('扩展名与 MIME 都不可靠时，靠字节签名兜住动图（本次修复）', async () => {
    // 文件名像 PNG、MIME 是 image/png，但内容其实是动图 GIF：
    // 修复前会走进转码路径，动画被压成静态 WebP。
    const blob = gifBlob(ANIMATED_GIF, 'image/png')
    const r = await transcodeToWebpIfNeeded(blob, 'a.png', 0.85, { skipAnimated: true })
    expect(r.changed).toBe(false)
    expect(r.type).toBe('image/gif')
  })

  it('无扩展名 + octet-stream 的动图同样被兜住', async () => {
    const blob = gifBlob(ANIMATED_GIF, 'application/octet-stream')
    const r = await transcodeToWebpIfNeeded(blob, 'blob', 0.85, { skipAnimated: true })
    expect(r.changed).toBe(false)
    expect(r.type).toBe('image/gif')
  })

  it('静态 GIF 不被误判为动图（应照常进入转码路径）', async () => {
    const blob = gifBlob(STILL_GIF, 'application/octet-stream')
    const r = await transcodeToWebpIfNeeded(blob, 'blob', 0.85, { skipAnimated: true })
    // 转码在 jsdom 下通常拿不到 canvas，会回退为 changed:false + 原 MIME，
    // 关键是 type 不能被当成动图直接返回 image/gif。
    expect(r.type).not.toBe('image/gif')
  })

  it('普通 PNG 不受 GIF 检测影响', async () => {
    const blob = new Blob([PNG], { type: 'image/png' })
    const r = await transcodeToWebpIfNeeded(blob, 'a.png', 0.85, { skipAnimated: true })
    expect(r.type).not.toBe('image/gif')
  })

  it('skipAnimated 关闭时不启用字节级动图保护', async () => {
    const blob = gifBlob(ANIMATED_GIF, 'application/octet-stream')
    const r = await transcodeToWebpIfNeeded(blob, 'blob', 0.85, { skipAnimated: false })
    expect(r.type).not.toBe('image/gif')
  })

  // 头部读取必须真的只读前 N 字节。旧实现是「arrayBuffer 读整个文件再
  // subarray 截断」，limit 形同虚设，大图会白读整份进内存。
  it('只读取 Blob 的前若干字节，不整文件读入', async () => {
    const big = new Uint8Array(5 * 1024 * 1024)
    big.set(ANIMATED_GIF, 0)
    let slicedAt: number | null = null
    const blob = {
      size: big.length,
      // MIME 不可靠，否则会在前面的类型判断处就提前返回，走不到字节检测
      type: 'application/octet-stream',
      slice(start: number) {
        slicedAt = start
        const end = Math.min(start + 64 * 1024, big.length)
        return { arrayBuffer: async () => big.slice(start, end).buffer }
      },
      arrayBuffer: async () => { throw new Error('不应整文件 arrayBuffer') },
    } as unknown as Blob

    const r = await transcodeToWebpIfNeeded(blob, 'blob', 0.85, { skipAnimated: true })
    expect(slicedAt).toBe(0) // 走的是限量读取
    expect(r.changed).toBe(false)
    expect(r.type).toBe('image/gif')
  })
})