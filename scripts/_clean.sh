#!/usr/bin/env bash
# 共享构建清理函数 — 所有打包脚本(debian/manjaro/macos)统一调用
#
# 设计目标：
#   1. 防止版本号错乱:CARGO_PKG_VERSION 是 Rust 编译期宏,来自 Cargo.toml;
#      build.rs 通过 tauri_build::build 嵌入 tauri.conf.json 的 version。
#      如果 Cargo.toml/tauri.conf.json 改了但 cargo 缓存未失效,二进制版本号可能错乱。
#   2. 防止重打包取错基础包:src-tauri/target/release/bundle/deb/ 里可能残留
#      多个历史版本的 deb,find | head -1 取错会导致 control 改了但内部二进制版本不变。
#   3. 防止前端 bundle 缓存:dist/ 里可能含旧的 CSS/JS。
#
# 清理策略:
#   - 删除本项目最终产物(flymd 二进制、deb/app/dmg bundle)
#   - 删除 build.rs 产物 + fingerprint,触发重新嵌入 tauri.conf.json
#   - 删除 deps/flymd-*,触发增量重链(只重编 flymd 本体,30-60s)
#   - 保留 deps/ 下其他依赖 crate 编译产物(registry 加速,不全量 cargo clean)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# 清理 Tauri 默认的 target/release 路径(linux/debian)
# macOS 脚本 target 是 target/${ARCH}/release(如 aarch64-apple-darwin/release)
clean_release_target() {
  local target_dir="${1:-src-tauri/target/release}"

  if [[ ! -d "$target_dir" ]]; then
    return 0
  fi

  echo "==> Cleaning $target_dir (保留 deps 缓存以加速增量重链)"
  # 前端 dist
  rm -rf dist
  # Tauri bundle(含 deb/app/dmg 残留)
  rm -rf "${target_dir}/bundle"
  # Rust 最终产物 + build script 缓存
  rm -f "${target_dir}/flymd"
  rm -f "${target_dir}/flymd.d"
  rm -rf "${target_dir}/build"
  rm -rf "${target_dir}/.fingerprint"
  # 本项目依赖编译产物(增量重链 flymd 本体)
  rm -rf "${target_dir}/deps/flymd-"*
}

# 默认调用:清理 linux 默认 target/release 路径
clean_release_target "src-tauri/target/release"
