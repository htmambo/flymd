#!/bin/bash
#
# flymd-macos-build.sh
# macOS 一键打包脚本（Universal 二进制，输出 .app + .dmg + .zip）
#
# 用法: ./flymd-macos-build.sh [--dmg-only]
#
#   --dmg-only   仅构建 DMG，跳过 .app + .zip（已有 .app 时可加速）
#
# 依赖 (脚本会自动检测并提示):
#   - Node.js >= 20
#   - Rust + cargo
#   - Xcode Command Line Tools (xcran / SetFile)
#   - create-dmg (brew install create-dmg)
#
# 输出目录: src-tauri/target/universal-apple-darwin/release/bundle/
#   ├── macos/flymd.app.zip
#   └── dmg/flymd_universal.dmg
#

set -euo pipefail

# ── 颜色输出 ────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[ OK ]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ── 解析参数 ────────────────────────────────────────────────────────────────
DMG_ONLY=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dmg-only) DMG_ONLY=true; shift ;;
    *)          err "未知参数: $1"; ;;
  esac
done

# ── 项目路径 ────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

# ── 版本 / 路径常量 ─────────────────────────────────────────────────────────
APP_NAME="flymd"
VERSION=$(node -p "require('./package.json').version")
ARCH="universal-apple-darwin"
TAURI_TARGET="src-tauri/target/${ARCH}/release"
APP_DIR="${TAURI_TARGET}/bundle/macos/${APP_NAME}.app"

# 所有产物统一放到 target/macos/ 目录
TARGET_DIR="${PROJECT_ROOT}/target/macos"
ZIP_OUT="${TARGET_DIR}/${APP_NAME}_${ARCH}.zip"
DMG_OUT="${TARGET_DIR}/${APP_NAME}_${VERSION}_${ARCH}.dmg"

# ── 0. 前置检查 ─────────────────────────────────────────────────────────────
info "检查环境依赖…"

check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    err "缺少命令: $1\n  提示: $2"
  fi
}

# Node
NODE_VERSION=$(node -v 2>/dev/null | tr -d 'v' || echo "0")
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
if (( NODE_MAJOR < 20 )); then
  err "需要 Node.js >= 20，当前版本: $(node -v)\n  提示: 使用 nvm install 20 或从 https://nodejs.org 安装"
fi
ok "Node.js $(node -v)"

# Rust
check_cmd rustc "安装: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
ok "Rust $(rustc --version | awk '{print $2}')"

# Xcode CLT (SetFile)
if ! xcrun --find SetFile &>/dev/null; then
  warn "Xcode Command Line Tools 未完全配置，尝试修复…"
  sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer 2>/dev/null || true
fi
if ! xcrun --find SetFile &>/dev/null; then
  warn "SetFile 不可用，请手动运行: xcode-select --install"
fi
ok "Xcode CLT OK"

# create-dmg
if ! command -v create-dmg &>/dev/null; then
  warn "create-dmg 未安装，将通过 Homebrew 安装…"
  brew install create-dmg
fi
ok "create-dmg $(create-dmg --version 2>/dev/null | head -1 || echo 'OK')"

# ── 1. 安装依赖 ─────────────────────────────────────────────────────────────
info "安装前端依赖…"
if [ ! -d "node_modules" ]; then
  npm ci
else
  info "node_modules 已存在，跳过 npm ci"
fi

info "安装 Tauri CLI…"
npm install -D @tauri-apps/cli@^2

# ── 2. 生成图标 ─────────────────────────────────────────────────────────────
info "确保图标齐全…"
node scripts/ensure-icons.cjs

# ── 3. 构建 .app ───────────────────────────────────────────────────────────
if [ "$DMG_ONLY" = true ] && [ -d "$APP_DIR" ]; then
  info "检测到已有 .app (--dmg-only 模式)，跳过构建"
else
  info "构建 .app (Universal)…"
  # 清理旧产物（避免残留）
  rm -rf "src-tauri/target/${ARCH}"

  export RUST_LOG=trace
  export TAURI_BUNDLE_TARGET="universal-apple-darwin"

  npm run tauri:build -- --bundles app --target universal-apple-darwin
fi

if [ ! -d "$APP_DIR" ]; then
  err ".app 构建失败，找不到产物: $APP_DIR"
fi
ok ".app 构建完成: $APP_DIR"

if [ ! -d "$APP_DIR" ]; then
  err ".app 构建失败，找不到产物: $APP_DIR"
fi
ok ".app 构建完成: $APP_DIR"

# ── 4. 打包 .app.zip ───────────────────────────────────────────────────────
info "打包 .app.zip…"
mkdir -p "$TARGET_DIR"
(cd "$(dirname "$APP_DIR")" && zip -qry "$(basename "$ZIP_OUT")" "${APP_NAME}.app")
ok ".app.zip: $ZIP_OUT ($(du -sh "$ZIP_OUT" | cut -f1))"

# ── 5. 构建 DMG ─────────────────────────────────────────────────────────────
info "构建 DMG…"
mkdir -p "$TARGET_DIR"

# 优先用 tauri bundler
info "尝试 tauri bundler (dmg)…"
if npm run tauri:build -- --bundles dmg --target universal-apple-darwin 2>/dev/null; then
  TAURI_DMG=$(find "${TAURI_TARGET}/bundle/dmg" -name "*.dmg" 2>/dev/null | head -1)
  if [ -n "$TAURI_DMG" ] && [ -f "$TAURI_DMG" ]; then
    cp "$TAURI_DMG" "$DMG_OUT"
    ok "DMG (tauri bundler): $DMG_OUT ($(du -sh "$DMG_OUT" | cut -f1))"
  fi
else
  warn "tauri bundler DMG 失败，fallback 到 create-dmg…"
  create-dmg \
    --dmg-title "${APP_NAME}" \
    --volname "${APP_NAME}" \
    --icon-size 128 \
    --app-drop-link 480 180 \
    --icon "${APP_NAME}.app" 160 180 \
    "$DMG_OUT" "$APP_DIR" || err "create-dmg 失败"

  ok "DMG (create-dmg): $DMG_OUT ($(du -sh "$DMG_OUT" | cut -f1))"
fi

# ── 完成 ────────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ok   "构建完成！产物："
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  target/macos/"
echo "  ├── ${APP_NAME}_${ARCH}.zip"
echo "  └── ${APP_NAME}_${VERSION}_${ARCH}.dmg"
echo ""
echo "下一步："
echo "  1. open target/macos/   # 打开产物目录"
echo "  2. 上传到 GitHub Release 或内部分发"
echo ""
