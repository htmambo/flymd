#!/usr/bin/env bash
set -euo pipefail

# 从上游 GitHub 仓库标签获取最新版本号。
# 回退顺序：上游 git 标签 → package.json → 默认兜底版本。
# 所有打包脚本（PKGBUILD、Debian、RPM 等）统一调用此脚本获取版本。

UPSTREAM_REPO="${UPSTREAM_REPO:-flyhunterl/flymd}"
PKG_JSON="${1:-./package.json}"
FALLBACK_VER="1.3.9"

get_upstream_version() {
  if ! command -v git >/dev/null 2>&1; then
    return 1
  fi
  git ls-remote --tags "https://github.com/$UPSTREAM_REPO" 2>/dev/null | \
    awk '/refs\/tags\/v[0-9]/ {sub(/.*\/v/, ""); print}' | \
    sort -V | \
    tail -1
}

get_local_version() {
  if [[ ! -r "$PKG_JSON" ]]; then
    return 1
  fi
  node -p "require('$PKG_JSON').version" 2>/dev/null
}

ver=$(get_upstream_version || true)
if [[ -n "${ver:-}" ]]; then
  echo "$ver"
  exit 0
fi

ver=$(get_local_version || true)
if [[ -n "${ver:-}" ]]; then
  echo "$ver"
  exit 0
fi

echo "$FALLBACK_VER"
