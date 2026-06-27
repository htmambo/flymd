#!/usr/bin/env bash
set -euo pipefail

# 一键打包脚本：Debian / Deepin / Ubuntu
# 1. 自动从上游标签获取版本号
# 2. 调用 Tauri 构建生成基础 .deb
# 3. 用项目中更完整的 flymd.desktop 替换 Tauri 默认版本
# 4. 注入 AppStream 元数据和 postinst/postrm 脚本
# 5. 输出规范的 flymd_${VERSION}_amd64.deb

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

INSTALL=0
CLEAN_BUILD=0

usage() {
  cat <<'USAGE'
Usage: scripts/package-debian.sh [options]

Build a .deb package for Debian/Deepin/Ubuntu from the current working tree.

Options:
  -i, --install       Install the generated package with dpkg -i.
      --clean         Clean previous build artifacts before building.
  -h, --help          Show this help.

Examples:
  scripts/package-debian.sh
  scripts/package-debian.sh --install
  scripts/package-debian.sh --clean --install
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -i|--install)
      INSTALL=1
      ;;
    --clean)
      CLEAN_BUILD=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

# 系统环境检查
if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  if [[ "${ID:-}" != "deepin" && "${ID_LIKE:-}" != *debian* && "${ID:-}" != "debian" && "${ID:-}" != "ubuntu" ]]; then
    echo "Warning: this script is intended for Debian/Deepin/Ubuntu systems; detected: ${PRETTY_NAME:-unknown}" >&2
  fi
fi

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd node
require_cmd npm
require_cmd cargo
require_cmd dpkg-deb

# 获取版本号（上游标签 → package.json → fallback）
VERSION=$(bash "$ROOT_DIR/scripts/get-version.sh" "$ROOT_DIR/package.json")
echo "==> Packaging flymd $VERSION for Debian/Deepin"

# 清理历史构建产物
if [[ "$CLEAN_BUILD" -eq 1 ]]; then
  echo "==> Cleaning previous build artifacts"
  # 清前端 dist + 整个 bundle 目录(含历史 deb 残留,避免重打包时取错基础包)
  rm -rf src-tauri/target/release/bundle
  rm -rf dist
  # 清 Rust release 二进制 + 依赖构建产物,确保 CARGO_PKG_VERSION 与最新 Cargo.toml 同步
  # 保留 Cargo registry cache (target/release/deps) 加速重链,只删最终产物
  rm -f src-tauri/target/release/flymd
  rm -f src-tauri/target/release/flymd.d
  # 删 build fingerprint,让 cargo 重新运行 build.rs(build.rs 调 tauri_build::build
  # 会从 tauri.conf.json 读 version,如果 conf 改了必须重跑)
  rm -rf src-tauri/target/release/build
  rm -rf src-tauri/target/release/.fingerprint
  rm -rf src-tauri/target/release/deps/flymd-*
fi

# 安装前端依赖
if [[ ! -d node_modules ]] || [[ "$CLEAN_BUILD" -eq 1 ]]; then
  echo "==> Installing npm dependencies"
  npm ci
fi

# Tauri 构建（生成 .deb + AppImage）
echo "==> Building Tauri release bundle (.deb)"
npm run tauri:build

# 定位 Tauri 生成的 .deb
# 注意：deb 目录里可能残留历史 deb（旧版本），必须按版本号/文件名严格匹配当前 VERSION，
# 避免 find | head -1 拿到旧 deb → 重打包后控制文件版本号对了但二进制嵌入的 CARGO_PKG_VERSION 还是旧的。
DEB_DIR="src-tauri/target/release/bundle/deb"
EXPECTED_DEB="$DEB_DIR/flymd_${VERSION}_amd64.deb"
if [[ -f "$EXPECTED_DEB" ]]; then
  DEB_FILE="$EXPECTED_DEB"
else
  # 兜底：按 mtime 取最新的一个（避免完全没找到时报错）
  DEB_FILE=$(find "$DEB_DIR" -maxdepth 1 -name 'flymd_*_amd64.deb' -printf '%T@ %p\n' | sort -nr | head -1 | awk '{print $2}')
fi

if [[ -z "$DEB_FILE" ]] || [[ ! -f "$DEB_FILE" ]]; then
  echo "Error: Tauri did not produce a .deb package in $DEB_DIR (expected $EXPECTED_DEB)" >&2
  exit 1
fi

echo "==> Found base package: $(basename "$DEB_FILE")"

# 解压到临时目录进行修改
WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/flymd-deb.XXXXXX")
trap 'rm -rf "$WORK_DIR"' EXIT

dpkg-deb -R "$DEB_FILE" "$WORK_DIR"

# 0. 统一 control 文件版本号，避免文件名版本与 dpkg 显示版本不一致
echo "==> Setting package version to $VERSION"
sed -i "s/^Version: .*/Version: $VERSION/" "$WORK_DIR/DEBIAN/control"

# 1. 替换 .desktop（用项目中更完整的版本）
echo "==> Replacing desktop entry"
cp "$ROOT_DIR/flymd.desktop" "$WORK_DIR/usr/share/applications/flymd.desktop"

# 2. 注入 AppStream 元数据
echo "==> Adding AppStream metadata"
mkdir -p "$WORK_DIR/usr/share/metainfo"
cp "$ROOT_DIR/linux/com.flymd.metainfo.xml" "$WORK_DIR/usr/share/metainfo/"

# 3. 写入 postinst（安装后刷新桌面数据库和图标缓存）
cat > "$WORK_DIR/DEBIAN/postinst" << 'EOF'
#!/bin/sh
set -e
case "$1" in
  configure)
    if command -v update-desktop-database >/dev/null 2>&1; then
      update-desktop-database -q /usr/share/applications
    fi
    if command -v gtk-update-icon-cache >/dev/null 2>&1; then
      gtk-update-icon-cache -q /usr/share/icons/hicolor 2>/dev/null || true
    fi
    echo ""
    echo "飞速 MarkDown 已安装！"
    echo "  启动命令: flymd"
    echo "  或从应用菜单中找到「飞速MarkDown」"
    echo ""
    ;;
esac
EOF
chmod 755 "$WORK_DIR/DEBIAN/postinst"

# 4. 写入 postrm（卸载后清理）
cat > "$WORK_DIR/DEBIAN/postrm" << 'EOF'
#!/bin/sh
set -e
case "$1" in
  remove|purge)
    if command -v update-desktop-database >/dev/null 2>&1; then
      update-desktop-database -q /usr/share/applications
    fi
    if command -v gtk-update-icon-cache >/dev/null 2>&1; then
      gtk-update-icon-cache -q /usr/share/icons/hicolor 2>/dev/null || true
    fi
    ;;
esac
EOF
chmod 755 "$WORK_DIR/DEBIAN/postrm"

# 5. 重新打包
TARGET_DIR="$ROOT_DIR/target/debian"
mkdir -p "$TARGET_DIR"
OUTPUT="$TARGET_DIR/flymd_${VERSION}_amd64.deb"
echo "==> Rebuilding final package"
dpkg-deb --build "$WORK_DIR" "$OUTPUT"

echo ""
echo "==> Package built successfully"
echo "  $OUTPUT"

# 可选：直接安装
if [[ "$INSTALL" -eq 1 ]]; then
  echo "==> Installing package"
  if sudo dpkg -i "$OUTPUT"; then
    echo "==> Installed successfully"
  else
    echo "==> Fixing broken dependencies"
    sudo apt --fix-broken install -y
  fi
fi
