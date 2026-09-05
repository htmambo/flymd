// mammoth 官方包未内置 TS 类型（且 convertToMarkdown 已弃用，仅声明浏览器入口用到的 API）
declare module 'mammoth' {
  export type MammothMessages = Array<{ type?: string; message?: string }>
  export type ConversionResult = { value: string; messages: MammothMessages }
  export function convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<ConversionResult>
  export function extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<ConversionResult>
  const mammoth: {
    convertToHtml: typeof convertToHtml
    extractRawText: typeof extractRawText
  }
  export default mammoth
}
