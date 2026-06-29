#!/bin/bash
#
# flymd-macos-x86-build.sh
# macOS 一键打包脚本（x86_64 单架构二进制，输出 .app + .dmg + .zip）
#
# 注意：本脚本仅构建 x86_64-apple-darwin 单架构产物。
#       与 scripts/flymd-macos-build.sh（Universal 二进制）并列存在，
#       输出目录共享 target/macos/，文件名以 _x86_64-apple-darwin 后缀区分。
#
#       若本机为 Apple Silicon (arm64) 且未安装 x86_64 Rust 工具链，
#       脚本会通过 rustup target add x86_64-apple-darwin 自动安装。
#
# 用法: ./flymd-macos-x86-build.sh [--dmg-only]
#
#   --dmg-only   仅构建 DMG，跳过 .app + .zip（已有 .app 时可加速）
#
# 依赖 (脚本会自动检测并提示):
#   - Node.js >= 20
#   - Rust + cargo
#   - Xcode Command Line Tools (SetFile)
#   - create-dmg (brew install create-dmg)
#
# 输出目录: src-tauri/target/x86_64-apple-darwin/release/bundle/
#   ├── macos/flymd.app
#   └── dmg/flymd_<version>_x86_64-apple-darwin.dmg
#
# 最终产物（与 Universal 脚本共享 target/macos/）:
#   target/macos/flymd_x86_64-apple-darwin.zip
#   target/macos/flymd_<version>_x86_64-apple-darwin.dmg
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
    -h|--help)
      grep -E '^# ' "$0" | sed 's/^# //; s/^#//'
      exit 0
      ;;
    *)          err "未知参数: $1（使用 --help 查看用法）"; ;;
  esac
done

# ── 项目路径 ────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

# ── 版本 / 路径常量 ─────────────────────────────────────────────────────────
APP_NAME="flymd"
VERSION=$(node -p "require('./package.json').version")
ARCH="x86_64-apple-darwin"
RUST_TARGET="x86_64-apple-darwin"
TAURI_TARGET="src-tauri/target/${ARCH}/release"
APP_DIR="${TAURI_TARGET}/bundle/macos/${APP_NAME}.app"

# 与 Universal 脚本共享输出目录，文件名以架构后缀区分
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

# 确保 x86_64 Rust target 已安装（Apple Silicon 机器必需）
# Homebrew 装的 rust 不带 rustup，提前探测避免 set -e 触发意外退出
if command -v rustup &>/dev/null; then
  if ! rustup target list --installed 2>/dev/null | grep -q "^${RUST_TARGET}$"; then
    warn "Rust target ${RUST_TARGET} 未安装，正在通过 rustup 安装…"
    rustup target add "${RUST_TARGET}" || err "安装 Rust target ${RUST_TARGET} 失败；请手动执行: rustup target add ${RUST_TARGET}"
  fi
  ok "Rust target ${RUST_TARGET} 已就绪"
else
  warn "未检测到 rustup（Homebrew 安装的 rust 通常无 rustup）"
  # 探针：用 rustc 自己看支不支持目标——支持就继续，不支持立即报错而非
  # 留到 npm run tauri:build 才挂，错误定位更清晰。
  if rustc --print target-list 2>/dev/null | grep -q "^${RUST_TARGET}$"; then
    ok "rustc 已支持目标 ${RUST_TARGET}（无 rustup 但 cargo 可直接构建）"
  else
    err "当前 Rust 环境不支持目标 ${RUST_TARGET}，且未检测到 rustup\n  建议:\n    1) 安装 rustup: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh\n    2) 或手动安装 ${RUST_TARGET} 工具链"
  fi
fi

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
  # 先确保 Homebrew 可用，避免直接 brew install 给出含糊错误
  if ! command -v brew &>/dev/null; then
    err "缺少 create-dmg，且未检测到 Homebrew。请手动安装:\n  1) 安装 Homebrew: https://brew.sh\n  2) brew install create-dmg"
  fi
  warn "create-dmg 未安装，将通过 Homebrew 安装…"
  brew install create-dmg || err "Homebrew 安装 create-dmg 失败；请手动执行: brew install create-dmg"
fi
ok "create-dmg $(create-dmg --version 2>/dev/null | head -1 || echo 'OK')"

# 加载共享清理助手(精确清理:保留 deps/ 缓存,避免每次冷跑都重编 ring/aws-sdk 等)
# shellcheck disable=SC1091
source "$SCRIPT_DIR/_clean.sh" 2>/dev/null || true

# sccache —— 强烈建议安装;可把 ring/aws-sdk 这类大 crate 的编译结果缓存到磁盘,
# 首次冷跑仍然慢,但后续改完代码再 build 会显著加速(典型 5-10x)。
# 文档:https://github.com/mozilla/sccache
if command -v sccache &>/dev/null; then
  export RUSTC_WRAPPER=sccache
  : "${SCCACHE_DIR:=$HOME/.cache/sccache}"
  export SCCACHE_DIR
  ok "sccache $(sccache --version 2>/dev/null | head -1) 已启用 (RUSTC_WRAPPER=sccache, SCCACHE_DIR=$SCCACHE_DIR)"
else
  warn "未检测到 sccache —— ring/aws-sdk 等大 crate 将每次重编。"
  warn "    建议安装: brew install sccache  (之后本脚本会自动启用)"
fi

# FAST_BUILD —— 调试/迭代时用。release 配置下 lto=true (fat) 会让最终链接
# 阶段把全部 crate 重新 codegen 一次,Intel Mac 上常拖 5-10 分钟。设置 FAST_BUILD=1
# 可临时把 lto 降为 thin、关掉 strip,二进制稍大但总构建时间显著缩短。
#   用法: FAST_BUILD=1 ./scripts/flymd-macos-x86-build.sh
if [[ "${FAST_BUILD:-0}" == "1" ]]; then
  export CARGO_PROFILE_RELEASE_LTO=thin
  export CARGO_PROFILE_RELEASE_STRIP=false
  export CARGO_PROFILE_RELEASE_CODEGEN_UNITS=256
  ok "FAST_BUILD=1 → lto=thin, strip=false, codegen-units=256 (牺牲一些体积换速度)"
else
  info "当前使用 [profile.release] 默认值 (lto=true / strip=true / codegen-units=1) —— 体积最优但链接慢"
  info "  → 若仅做联调可设置 FAST_BUILD=1 走瘦 LTO,省 5-10 分钟"
fi

# reqwest TLS 后端提示 —— 防止有人不小心把 rustls-tls 改回默认(native-tls 会拉 ring)。
if grep -Eq 'reqwest\s*=\s*\{[^}]*default-features\s*=\s*true' src-tauri/Cargo.toml; then
  warn "检测到 reqwest 使用 default-features=true —— 这会拉入 ring 和 native-tls,"
  warn "    编译时间显著增加。建议保留 'default-features = false, features = [\"rustls-tls\", ...]'。"
else
  ok "reqwest TLS 后端:rustls (无 ring 依赖)"
fi

# ── 1. 安装依赖 ─────────────────────────────────────────────────────────────
info "安装前端依赖…"
if [ ! -d "node_modules" ]; then
  npm ci
else
  info "node_modules 已存在，跳过 npm ci"
fi

# 依赖 npm ci 已锁定的 @tauri-apps/cli（devDependencies），不再执行 npm install -D 以避免污染 package-lock.json
# 如需升级 CLI 版本，请开发者手动在本地调整 package.json 后重新提交

# ── 2. 生成图标 ─────────────────────────────────────────────────────────────
info "确保图标齐全…"
node scripts/ensure-icons.cjs

# ── 3. 构建 .app ───────────────────────────────────────────────────────────
if [ "$DMG_ONLY" = true ] && [ -d "$APP_DIR" ]; then
  info "检测到已有 .app (--dmg-only 模式)，跳过构建"
else
  info "构建 .app (x86_64)…"
  # 精确清理本项目产物(保留 deps/ 缓存,避免把 ring/aws-sdk 的编译结果一起删掉)
  # 如未加载到 _clean.sh(脚本缺失),回退到原整目录删除以保证正确性
  if declare -F clean_release_target >/dev/null 2>&1; then
    clean_release_target "src-tauri/target/${ARCH}/release"
  else
    warn "未找到 _clean.sh,回退到 rm -rf 整目录清理(会丢掉 deps 缓存)"
    rm -rf "src-tauri/target/${ARCH}"
  fi

  export RUST_LOG=trace
  export TAURI_BUNDLE_TARGET="${ARCH}"

  npm run tauri:build -- --bundles app --target "${ARCH}"
fi

if [ ! -d "$APP_DIR" ]; then
  err ".app 构建失败，找不到产物: $APP_DIR"
fi
ok ".app 构建完成: $APP_DIR"

# ── 4. 打包 .app.zip ───────────────────────────────────────────────────────
if [ "$DMG_ONLY" = true ]; then
  info "--dmg-only 模式，跳过 .app.zip 打包"
else
  info "打包 .app.zip…"
  mkdir -p "$TARGET_DIR"
  # 删除旧 zip 避免 zip -r 增量更新导致 .app 内容变化时残留旧文件
  rm -f "${ZIP_OUT}"
  (cd "$(dirname "$APP_DIR")" && zip -qry "${ZIP_OUT}" "${APP_NAME}.app")
  ok ".app.zip: ${ZIP_OUT} ($(du -sh "${ZIP_OUT}" | cut -f1))"
fi

# ── 5. 构建 DMG ─────────────────────────────────────────────────────────────
info "构建 DMG…"
mkdir -p "$TARGET_DIR"

# 优先用 tauri bundler（仅在非 --dmg-only 模式；--dmg-only 跳过 tauri 链路直接用现有 .app 打包以加速）
DMG_BUILT=false
if [ "$DMG_ONLY" = true ]; then
  info "--dmg-only 模式，跳过 tauri bundler，直接用 create-dmg 打包现有 .app…"
else
  info "尝试 tauri bundler (dmg)…"
  if npm run tauri:build -- --bundles dmg --target "${ARCH}" 2>/dev/null; then
    # 用 sort | tail -1 取最新构建产物，避免 head -1 拿到旧残留 DMG
    # （DMG 名包含版本号，sort 字典序 = 最新版本最大；同版本时 find -print 顺序未定但 sort 稳定）
    TAURI_DMG=$(find "${TAURI_TARGET}/bundle/dmg" -type f -name "*.dmg" -print 2>/dev/null | sort | tail -1 || true)
    if [[ -n "${TAURI_DMG}" && -f "${TAURI_DMG}" ]]; then
      cp "${TAURI_DMG}" "${DMG_OUT}"
      ok "DMG (tauri bundler): ${DMG_OUT} ($(du -sh "${DMG_OUT}" | cut -f1))"
      DMG_BUILT=true
    else
      warn "tauri bundler 返回成功但未找到 .dmg 产物，fallback 到 create-dmg…"
    fi
  else
    warn "tauri bundler DMG 失败，fallback 到 create-dmg…"
  fi
fi

# Fallback: create-dmg
if [ "${DMG_BUILT}" = false ]; then
  # 删除旧 DMG 避免 create-dmg 内部 hdiutil convert 拒绝覆盖
  rm -f "${DMG_OUT}"
  # create-dmg 会把源目录的"内容"打包进 DMG，所以传 .app 的父目录
  create-dmg \
    --volname "${APP_NAME}" \
    --icon-size 128 \
    --app-drop-link 480 180 \
    --icon "${APP_NAME}.app" 160 180 \
    "${DMG_OUT}" "$(dirname "${APP_DIR}")" || err "create-dmg 失败"

  ok "DMG (create-dmg): ${DMG_OUT} ($(du -sh "${DMG_OUT}" | cut -f1))"
fi

# ── 完成 ────────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ok   "构建完成！产物（x86_64 单架构）："
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  target/macos/"
echo "  ├── ${APP_NAME}_${ARCH}.zip"
echo "  └── ${APP_NAME}_${VERSION}_${ARCH}.dmg"
echo ""
echo "下一步："
echo "  1. open target/macos/                 # 打开产物目录"
echo "  2. lipo -archs '${APP_DIR}/Contents/MacOS/${APP_NAME}'  # 校验 x86_64 架构"
echo "  3. 上传到 GitHub Release 或内部分发"
echo ""
