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
      --npm-ci        Always run npm ci before building.
      --skip-npm-ci   Never run npm ci before building.
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
pkgbuild_version="$(sed -n 's/^pkgver=//p' PKGBUILD | sed -n '1p')"
if [[ -n "$pkgbuild_version" && "$package_version" != "$pkgbuild_version" ]]; then
  echo "Warning: detected version ($package_version) differs from PKGBUILD pkgver ($pkgbuild_version)" >&2
fi

if [[ "$NPM_CI_MODE" == "always" || ( "$NPM_CI_MODE" == "auto" && ! -d node_modules ) ]]; then
  echo "==> Installing npm dependencies"
  npm ci
elif [[ "$NPM_CI_MODE" == "auto" ]]; then
  echo "==> Reusing existing node_modules (pass --npm-ci for a clean install)"
fi

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

# 隔离 makepkg 的构建目录。
# 默认 $srcdir=$startdir/src、$pkgdir=$startdir/pkg，会与本项目自身的 src/ 目录撞名；
# 叠加下面的 --clean，会在打包后删除 $srcdir → 把前端源码 src/ 整个清空（已踩过坑）。
# 用独立的 BUILDDIR 让 $srcdir/$pkgdir 落到临时目录；$startdir 仍是仓库根，
# PKGBUILD 里的 $startdir/...（二进制、图标、LICENSE）与 $srcdir/flymd.desktop 都照常可用。
# 产物 .pkg.tar.* 仍写到 PKGDEST（默认 = $startdir = 仓库根），与原行为一致。
build_tmp="$(mktemp -d "${TMPDIR:-/tmp}/flymd-makepkg.XXXXXX")"
trap 'rm -rf "$build_tmp"' EXIT
export BUILDDIR="$build_tmp"

echo "==> Building pacman package with makepkg"
makepkg "${makepkg_args[@]}"

echo "==> Package output"
find "$ROOT_DIR" -maxdepth 1 -type f -name 'flymd-*.pkg.tar.*' -printf '  %f\n' | sort
