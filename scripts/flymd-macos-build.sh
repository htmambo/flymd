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

# ── 项目路径 ────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

# 加载共享清理助手(精确清理:保留 deps/ 缓存,避免每次冷跑都重编 ring/aws-sdk 等)
# shellcheck disable=SC1091
source "$SCRIPT_DIR/_clean.sh" 2>/dev/null || true

# ── 解析参数 ────────────────────────────────────────────────────────────────
DMG_ONLY=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dmg-only) DMG_ONLY=true; shift ;;
    *)          err "未知参数: $1"; ;;
  esac
done

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

# sccache —— 强烈建议安装；可把 ring/aws-sdk 这类大 crate 的编译结果缓存到磁盘，
# 首次冷跑仍然慢，但后续改完代码再 build 会显著加速（典型 5–10x）。
# 文档：https://github.com/mozilla/sccache
if command -v sccache &>/dev/null; then
  export RUSTC_WRAPPER=sccache
  # 默认缓存目录：用户级 .cache；如需自定义请在调用脚本前 export SCCACHE_DIR
  : "${SCCACHE_DIR:=$HOME/.cache/sccache}"
  export SCCACHE_DIR
  ok "sccache $(sccache --version 2>/dev/null | head -1) 已启用 (RUSTC_WRAPPER=sccache, SCCACHE_DIR=$SCCACHE_DIR)"
else
  warn "未检测到 sccache —— ring/aws-sdk 等大 crate 将每次重编。"
  warn "    建议安装: brew install sccache  （之后本脚本会自动启用）"
fi

# Pillow —— ensure-icons 生成安全区图标源图（make_icon_safearea.py）依赖它。
# Xcode CLT 自带的系统 Python 默认未安装；缺失时自动装到用户目录（不影响系统 Python）。
# 仍失败只警告不中断：ensure-icons 会回退到原始源图，但 macOS Dock 图标会偏大。
if python3 -c "import PIL" &>/dev/null 2>&1; then
  ok "Pillow $(python3 -c "from PIL import __version__ as v; print(v)" 2>/dev/null || echo 'OK') 已可用"
else
  warn "未检测到 Pillow，尝试自动安装到用户目录…"
  if python3 -m pip install --user Pillow &>/dev/null && python3 -c "import PIL" &>/dev/null 2>&1; then
    ok "Pillow 安装成功（python3 -m pip install --user Pillow）"
  else
    warn "Pillow 自动安装失败 —— 图标安全区生成将回退，macOS Dock 图标可能偏大。"
    warn "    可手动安装: python3 -m pip install --user Pillow"
  fi
fi

# FAST_BUILD —— 调试/迭代时用。release 配置下 lto=true (fat) 会让最终链接
# 阶段把全部 crate 重新 codegen 一次，Intel Mac 上常拖 5–10 分钟。设置 FAST_BUILD=1
# 可临时把 lto 降为 thin、关掉 strip，二进制稍大但总构建时间显著缩短。
#   用法: FAST_BUILD=1 ./scripts/flymd-macos-build.sh
if [[ "${FAST_BUILD:-0}" == "1" ]]; then
  export CARGO_PROFILE_RELEASE_LTO=thin
  export CARGO_PROFILE_RELEASE_STRIP=false
  export CARGO_PROFILE_RELEASE_CODEGEN_UNITS=256
  ok "FAST_BUILD=1 → lto=thin, strip=false, codegen-units=256 (牺牲一些体积换速度)"
else
  info "当前使用 [profile.release] 默认值 (lto=true / strip=true / codegen-units=1) —— 体积最优但链接慢"
  info "  → 若仅做联调可设置 FAST_BUILD=1 走瘦 LTO，省 5–10 分钟"
fi

# reqwest TLS 后端提示 —— 防止有人不小心把 rustls-tls 改回默认(native-tls 会拉 ring)。
if grep -Eq 'reqwest\s*=\s*\{[^}]*default-features\s*=\s*true' src-tauri/Cargo.toml; then
  warn "检测到 reqwest 使用 default-features=true —— 这会拉入 ring 和 native-tls，"
  warn "    编译时间显著增加。建议保留 'default-features = false, features = [\"rustls-tls\", ...]'。"
else
  ok "reqwest TLS 后端：rustls (无 ring 依赖)"
fi

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
  # 精确清理本项目产物(保留 deps/ 缓存,避免把 ring/aws-sdk 的编译结果一起删掉)
  # 如未加载到 _clean.sh(脚本缺失),回退到原整目录删除以保证正确性
  if declare -F clean_release_target >/dev/null 2>&1; then
    clean_release_target "src-tauri/target/${ARCH}/release"
  else
    warn "未找到 _clean.sh，回退到 rm -rf 整目录清理(会丢掉 deps 缓存)"
    rm -rf "src-tauri/target/${ARCH}"
  fi

  export RUST_LOG=trace
  export TAURI_BUNDLE_TARGET="universal-apple-darwin"

  npm run tauri:build -- --bundles app --target universal-apple-darwin
fi

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
