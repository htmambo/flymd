#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

INSTALL=0
NPM_CI_MODE="auto"
SYNCDEPS=1

usage() {
  cat <<'USAGE'
Usage: scripts/package-manjaro.sh [options]

Build a Manjaro/Arch pacman package from the current working tree.

Options:
  -i, --install       Install the generated package with makepkg -i.
      --npm-ci        Always run pnpm install --frozen-lockfile before building.
      --skip-npm-ci   Never run pnpm install before building.
      --no-syncdeps   Do not let makepkg install missing pacman dependencies.
  -h, --help          Show this help.

Examples:
  scripts/package-manjaro.sh
  scripts/package-manjaro.sh --install
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -i|--install)
      INSTALL=1
      ;;
    --npm-ci)
      NPM_CI_MODE="always"
      ;;
    --skip-npm-ci)
      NPM_CI_MODE="never"
      ;;
    --no-syncdeps)
      SYNCDEPS=0
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

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd node
require_cmd npm
require_cmd makepkg

if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  os_tags="${ID:-} ${ID_LIKE:-}"
  if [[ "$os_tags" != *manjaro* && "$os_tags" != *arch* ]]; then
    echo "Warning: this script is intended for Manjaro/Arch-like systems; detected: ${PRETTY_NAME:-unknown}" >&2
  fi
fi

if [[ ! -f PKGBUILD ]]; then
  echo "Missing PKGBUILD in $ROOT_DIR" >&2
  exit 1
fi

if [[ ! -f flymd.desktop ]]; then
  echo "Missing flymd.desktop in $ROOT_DIR" >&2
  exit 1
fi

package_version="$(bash "$ROOT_DIR/scripts/get-version.sh" "$ROOT_DIR/package.json")"
# 交叉校验:打包版本(get-version.sh 优先取上游最新标签)与本地 package.json 版本。
# 两者不一致说明 package.json 的版本号没跟上上游发布。
# 不再解析 PKGBUILD —— 它的 pkgver 本来就是 get-version.sh 的输出,拿两者比较
# 恒等,既无意义,又会多跑一次 git ls-remote;直接 source PKGBUILD 还会让这个
# 校验耦合到"pkgver 必须是顶层变量赋值"这一写法上。
pkgjson_version="$(PKG_FILE="$ROOT_DIR/package.json" node -p 'require(process.env.PKG_FILE).version' 2>/dev/null || true)"
if [[ -n "$pkgjson_version" && "$package_version" != "$pkgjson_version" ]]; then
  echo "Warning: packaged version ($package_version) differs from package.json version ($pkgjson_version)" >&2
fi

# 前端依赖就位检查与安装(共用 helper)
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/_deps.sh"
ensure_frontend_deps "$NPM_CI_MODE" "$ROOT_DIR"

echo "==> Building Tauri release binary"
npm run tauri:build -- --no-bundle

if [[ ! -x src-tauri/target/release/flymd ]]; then
  echo "Expected release binary was not created: src-tauri/target/release/flymd" >&2
  exit 1
fi

makepkg_args=(--force --clean)
if [[ "$SYNCDEPS" -eq 1 ]]; then
  makepkg_args+=(--syncdeps)
fi
if [[ "$INSTALL" -eq 1 ]]; then
  makepkg_args+=(--install)
fi
# makepkg 默认 PACMAN_OPTS=()，只有自己收到 --noconfirm 才会转发给 pacman。
# 两条会调 pacman 的路径都需要它：
#   --syncdeps → handle_deps() 里的 pacman -S --asdeps
#   --install  → pacman -U
# 不加的话 pacman 会弹出 ":: 进行安装吗？ [Y/n]"；脚本在无 TTY 环境
# （CI、后台任务、管道调用）下读到 EOF 直接放弃，报
# "警告： 安装创建的软件包失败" 并以 exit 14 退出。
# 无条件添加：不会出现询问时它是空操作，不会掩盖真实的冲突或签名错误。
makepkg_args+=(--noconfirm)

# 隔离 makepkg 的构建目录。
# 默认 $srcdir=$startdir/src、$pkgdir=$startdir/pkg，会与本项目自身的 src/ 目录撞名；
# 叠加下面的 --clean，会在打包后删除 $srcdir → 把前端源码 src/ 整个清空（已踩过坑）。
# 用独立的 BUILDDIR 让 $srcdir/$pkgdir 落到临时目录；$startdir 仍是仓库根，
# PKGBUILD 里的 $startdir/...（二进制、图标、LICENSE）与 $srcdir/flymd.desktop 都照常可用。
# 产物 .pkg.tar.* 输出到 target/archlinux/ 目录
build_tmp="$(mktemp -d "${TMPDIR:-/tmp}/flymd-makepkg.XXXXXX")"
trap 'rm -rf "$build_tmp"' EXIT
export BUILDDIR="$build_tmp"

# 设置产物输出目录
TARGET_DIR="$ROOT_DIR/target/archlinux"
mkdir -p "$TARGET_DIR"
export PKGDEST="$TARGET_DIR"

echo "==> Building pacman package with makepkg"
makepkg "${makepkg_args[@]}"

echo "==> Package output"
find "$TARGET_DIR" -maxdepth 1 -type f -name 'flymd-*.pkg.tar.*' -printf '  %f\n' | sort
