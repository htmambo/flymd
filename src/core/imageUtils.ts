// 图片工具:扩展名识别 + File → DataURL。
// 抽离自 main.ts:extIsImage / fileToDataUrl。
// 0 deps,纯函数。

export function extIsImage(name: string): boolean {
  return /\.(png|jpe?g|gif|svg|webp|bmp|avif)$/i.test(name)
}

export async function fileToDataUrl(file: File): Promise<string> {
  // 使用 FileReader 生成 data URL,避免手动拼接带来的内存与性能问题
  return await new Promise<string>((resolve, reject) => {
    try {
      const fr = new FileReader()
      fr.onerror = () => reject(fr.error || new Error('读取文件失败'))
      fr.onload = () => resolve(String(fr.result || ''))
      fr.readAsDataURL(file)
    } catch (e) {
      reject(e as any)
    }
  })
}
