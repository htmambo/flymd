// 跨平台启动器：避免在 package.json 里写 POSIX-only 的 `NODE_ENV=x node ...`
// （Windows cmd/PowerShell 下会直接失败）。
//   node --import tsx/esm scripts/run.mjs dev    → NODE_ENV=development + src/main.ts
//   node scripts/run.mjs start                  → NODE_ENV=production + dist/main.js
const mode = process.argv[2] === "dev" ? "dev" : "start"
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = mode === "dev" ? "development" : "production"
}
const target = mode === "dev" ? "../src/main.ts" : "../dist/main.js"
await import(target)
