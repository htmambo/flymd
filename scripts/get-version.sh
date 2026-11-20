#!/usr/bin/env bash
set -euo pipefail

# 从上游 GitHub 仓库标签获取最新版本号。
# 回退顺序：上游 git 标签 → package.json → 默认兜底版本。
# 所有打包脚本（PKGBUILD、Debian、RPM 等）统一调用此脚本获取版本。

UPSTREAM_REPO="${UPSTREAM_REPO:-htmambo/flymd}"
PKG_JSON="${1:-./package.json}"
FALLBACK_VER="1.3.9"

get_upstream_version() {
  if ! command -v git >/dev/null 2>&1; then
    return 1
  fi
  # 附注标签(annotated tag)在 ls-remote 里会返回两行——
  #   refs/tags/v2.2.1        标签对象本身
  #   refs/tags/v2.2.1^{}     剥离后的提交引用
  # 若不过滤，awk 的 sub 会把第二行也处理成 "2.2.1^{}"，而 sort -V 会把它排在
  # "2.2.1" 之后，tail -1 于是取到带 ^{} 的非法版本号：
  #   Arch  → 包名变成 flymd-2.2.1^{}-1-...（pacman 能装，但版本号非法、升级比较失真）
  #   Debian→ dpkg-deb 直接报错 "版本号含无效字符"，打包中断
  # 过滤用字符类 [{] 匹配字面花括号：POSIX 字符类不依赖 \{ 转义（POSIX 对 \
  # 的转义未定义），各 awk 实现行为一致。
  # 不改用 git ls-remote --refs（同样能滤掉）：它要求 git >= 2.13，
  # 而本脚本要在各种发行版的老 git 上也能跑。
  git ls-remote --tags "https://github.com/$UPSTREAM_REPO" 2>/dev/null | \
    awk '/refs\/tags\/v[0-9]/ && !/[{]/ {sub(/.*\/v/, ""); print}' | \
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
