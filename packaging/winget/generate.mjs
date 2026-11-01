#!/usr/bin/env node
/**
 * 生成 winget-pkgs 的清单文件。
 *
 * winget 的清单托管在第三方仓库 microsoft/winget-pkgs，PR 需要在那边提。
 * 本脚本负责把「一次 Release」翻译成「四个 winget 清单文件」，省掉手写 YAML
 * 与算 SHA256 的活。
 *
 * 用法：
 *   node packaging/winget/generate.mjs --version 2.0.1
 *   node packaging/winget/generate.mjs --version 2.0.1 --out /tmp/winget
 *
 * 产物目录结构与 winget-pkgs 仓库一致：
 *   manifests/f/flyhunterl/FlyMD/<version>/
 *     flyhunterl.FlyMD.yaml
 *     flyhunterl.FlyMD.installer.yaml
 *     flyhunterl.FlyMD.locale.en-US.yaml
 *     flyhunterl.FlyMD.locale.zh-CN.yaml
 *
 * 提交方式：在 microsoft/winget-pkgs 上开 PR，把上面四个文件放到对应路径。
 * 包名沿用 flyhunterl.FlyMD（不改名）——换包名会让原包名下的用户失去升级通道。
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REPO = 'htmambo/flymd'
const PACKAGE_ID = 'flyhunterl.FlyMD'
const MANIFEST_VERSION = '1.12.0'

function parseArgs(argv) {
  const out = { version: null, out: null, repo: REPO }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--version' || a === '-v') out.version = argv[++i]
    else if (a === '--out' || a === '-o') out.out = argv[++i]
    else if (a === '--repo') out.repo = argv[++i]
    else if (a === '--help' || a === '-h') {
      console.log('用法: node packaging/winget/generate.mjs --version <版本> [--out <目录>] [--repo <owner/name>]')
      process.exit(0)
    } else {
      console.error(`未知参数: ${a}`)
      process.exit(2)
    }
  }
  if (!out.version) {
    console.error('缺少 --version')
    process.exit(2)
  }
  return out
}

async function fetchReleaseAssets(repo, version) {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/tags/v${version}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'flymd-winget-generator',
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  })
  if (!res.ok) {
    throw new Error(`拉取 Release 失败: HTTP ${res.status} ${res.statusText}`)
  }
  const json = await res.json()
  if (!json.assets || json.assets.length === 0) {
    throw new Error(`Release v${version} 没有任何资产`)
  }
  return json
}

function pickSetupExe(assets) {
  const hit = assets.find((a) => /x64-setup\.exe$/i.test(a.name))
  if (!hit) {
    throw new Error(`Release 里找不到 x64-setup.exe，现有资产: ${assets.map((a) => a.name).join(', ')}`)
  }
  return hit
}

async function sha256Of(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'flymd-winget-generator',
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  })
  if (!res.ok) throw new Error(`下载安装包失败: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  return createHash('sha256').update(buf).digest('hex').toUpperCase()
}

/** 取 Release 的发布日期（ISO 日期），winget 的 ReleaseDate 要用这个。 */
function releaseDateOf(release) {
  const raw = release.published_at || release.created_at
  return raw ? raw.slice(0, 10) : new Date().toISOString().slice(0, 10)
}

function renderFiles({ version, installerUrl, installerSha256, releaseDate }) {
  const versionYaml = `# Created with YamlCreate.ps1 Dumplings Mod
# yaml-language-server: $schema=https://aka.ms/winget-manifest.version.${MANIFEST_VERSION}.schema.json

PackageIdentifier: ${PACKAGE_ID}
PackageVersion: ${version}
DefaultLocale: zh-CN
ManifestType: version
ManifestVersion: ${MANIFEST_VERSION}
`

  const installerYaml = `# Created with YamlCreate.ps1 Dumplings Mod
# yaml-language-server: $schema=https://aka.ms/winget-manifest.installer.${MANIFEST_VERSION}.schema.json

PackageIdentifier: ${PACKAGE_ID}
PackageVersion: ${version}
InstallerType: nullsoft
Scope: user
UpgradeBehavior: install
FileExtensions:
- markdown
- md
ProductCode: flymd
ReleaseDate: ${releaseDate}
Installers:
- Architecture: x64
  InstallerUrl: ${installerUrl}
  InstallerSha256: ${installerSha256}
ManifestType: installer
ManifestVersion: ${MANIFEST_VERSION}
`

  const enUs = `# Created with YamlCreate.ps1 Dumplings Mod
# yaml-language-server: $schema=https://aka.ms/winget-manifest.locale.${MANIFEST_VERSION}.schema.json

PackageIdentifier: ${PACKAGE_ID}
PackageVersion: ${version}
PackageLocale: en-US
License: GPL-3.0-only
ShortDescription: A highly responsive and extremely low-resource Markdown editor and PDF reader tool that supports WYSIWYG, WebDAV synchronization, automatic image uploads, AI-assisted writing, and plugins.
Description: |-
  A cross-platform WYSIWYG Markdown editor and PDF reader with image hosting, WebDAV sync, plugins, fast response, and minimal resource usage.
  ✨ Highlights
  - Ready to Use: Only 7MB installer, no bloat. Millisecond-level cold start, one-click code copy
  - Clean Interface: Minimalist design with just menabar + editor, focused on content creation. Excellent startup and response speed
  - Library Feature: Support for designated folders, tree-view display of subfolders and documents, with document management; supports multiple libraries
  - Secure & Reliable: Local execution, no network connection, automatic HTML sanitization in preview
  - Image Hosting: S3/R2 binding support, direct paste image upload with automatic link syntax generation
  - Full-Featured: Complete support for Markdown, LaTeX, Mermaid, and HTML
  - Real-time Rendering: WYSIWYG mode, instant render on input! Global real-time rendering for Mermaid and LaTeX, double-click to edit code
  - Ultimate Performance: Millisecond-level response, farewell to common pain points of similar software
  - Position Memory: Automatic memory of reading and editing positions, returning to remembered positions on next open (v0.0.6 official)
  - Auto Sync: WebDAV sync functionality
  - Plugin Extensions: Support for plugin extensions, develop your own or install with one click
  - AI Assistant: Install from the Extensions market to polish, correct and summarize content
  - MCP Server: Ships a standalone MCP server that exposes the note library to Claude Code, Cursor and Codex (read-only)
  - Export formats: Export to PDF, DOCX, WPS
Tags:
- editor
- markdown
ManifestType: locale
ManifestVersion: ${MANIFEST_VERSION}
`

  const zhCn = `# Created with YamlCreate.ps1 Dumplings Mod
# yaml-language-server: $schema=https://aka.ms/winget-manifest.locale.${MANIFEST_VERSION}.schema.json

PackageIdentifier: ${PACKAGE_ID}
PackageVersion: ${version}
PackageLocale: zh-CN
License: GPL-3.0-only
ShortDescription: 极速的 Markdown 编辑器与 PDF 阅读器，支持所见即所得、WebDAV 同步、图片自动上传、AI 辅助写作与插件扩展。
Description: |-
  跨平台的所见即所得 Markdown 编辑器与 PDF 阅读器，支持图床托管、WebDAV 同步、插件扩展，响应极快、资源占用极低。
  ✨ 亮点
  - 开箱即用：仅 7MB 安装包，毫秒级冷启动，一键复制代码
  - 界面清爽：仅保留菜单栏与编辑器，专注内容创作，启动与响应速度优秀
  - 文库特性：支持指定文件夹、树状展示子目录与文档、便于管理；支持多文库
  - 安全可靠：本地运行，不联网，预览自动净化 HTML
  - 图床托管：支持 S3/R2 绑定，粘贴图片直传并自动生成链接语法
  - 功能完整：完整支持 Markdown、LaTeX、Mermaid 与 HTML
  - 实时渲染：所见即所得模式，输入即渲染！Mermaid 与 LaTeX 全局实时渲染，双击即可编辑代码
  - 极致性能：毫秒级响应，告别同类软件的常见痛点
  - 位置记忆：自动记忆阅读与编辑位置，下次打开直接回到原位（v0.0.6 起）
  - 自动同步：WebDAV 同步功能
  - 插件扩展：支持插件扩展，可自行开发或一键安装
  - AI 助手：从扩展市场安装后可润色、纠错、总结内容
  - MCP 服务器：随包提供独立 MCP 服务器，把笔记库交给 Claude Code、Cursor、Codex 读取（只读）
  - 导出格式：可导出 PDF、DOCX、WPS
Tags:
- editor
- markdown
ManifestType: locale
ManifestVersion: ${MANIFEST_VERSION}
`

  return {
    [`${PACKAGE_ID}.yaml`]: versionYaml,
    [`${PACKAGE_ID}.installer.yaml`]: installerYaml,
    [`${PACKAGE_ID}.locale.en-US.yaml`]: enUs,
    [`${PACKAGE_ID}.locale.zh-CN.yaml`]: zhCn,
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const release = await fetchReleaseAssets(opts.repo, opts.version)
  const setup = pickSetupExe(release.assets)
  const installerUrl = setup.browser_download_url
  console.log(`安装包: ${setup.name} (${(setup.size / 1048576).toFixed(1)} MB)`)
  console.log('计算 SHA256 …')
  const installerSha256 = await sha256Of(installerUrl)
  console.log(`SHA256: ${installerSha256}`)

  const files = renderFiles({
    version: opts.version,
    installerUrl,
    installerSha256,
    releaseDate: releaseDateOf(release),
  })

  const base = opts.out
    ? path.resolve(opts.out)
    : path.resolve(process.cwd(), 'packaging', 'winget', 'manifests', 'f', 'flyhunterl', 'FlyMD', opts.version)
  fs.mkdirSync(base, { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(base, name), content)
    console.log(`写入 ${path.join(base, name)}`)
  }

  console.log('\n下一步：把上面目录下的四个文件复制到 microsoft/winget-pkgs 的')
  console.log(`  manifests/f/flyhunterl/FlyMD/${opts.version}/`)
  console.log('然后提 PR。可用 GitHub CLI 一键开分支：')
  console.log(`  gh api -X PUT repos/microsoft/winget-pkgs/contents/manifests/f/flyhunterl/FlyMD/${opts.version} \\`)
  console.log('    --field message="Add FlyMD 2.0.1" --field branch=<你的分支> --field content=<base64>')
}

main().catch((e) => {
  console.error(`错误: ${e.message}`)
  process.exit(1)
})
