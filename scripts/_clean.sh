#!/usr/bin/env bash
# Shared build-cleanup helper — source by all package scripts
# (debian/manjaro/macos-universal/macos-x86).
#
# 用法:
#   source "$ROOT_DIR/scripts/_clean.sh"
#   clean_release_target "src-tauri/target/release"
#
# 设计目标:
#   1. 防止版本号错乱: CARGO_PKG_VERSION 是 Rust 编译期宏,来自 Cargo.toml;
#      build.rs 通过 tauri_build::build 嵌入 tauri.conf.json 的 version。
#      如果 Cargo.toml/tauri.conf.json 改了但 cargo 缓存未失效,二进制版本号可能错乱。
#   2. 防止重打包取错基础包: bundle/ 里可能残留多个历史 deb/app/dmg。
#
# 注意事项:
#   - 本脚本不设 set -euo pipefail,不 cd,不修改任何全局变量,
#     完全由调用者掌控自身 shell 行为(避免污染调用者环境)。
#   - 本脚本不主动调用任何清理函数(source 时无副作用)。
#   - rm glob 无匹配时由调用者的 shell 选项决定行为,建议调用者用
#     `shopt -s nullglob` 保护,或显式检查目录后再传参。

# 清理 Tauri release 产物(精确清理:删本项目产物,保留 deps 缓存加速增量重链)
# 参数: target/release 路径(如 src-tauri/target/release 或 src-tauri/target/aarch64-apple-darwin/release)
clean_release_target() {
  local target_dir="${1:?clean_release_target 需要传入 target_dir 参数}"

  if [[ ! -d "$target_dir" ]]; then
    echo "==> Skip cleaning: $target_dir does not exist"
    return 0
  fi

  echo "==> Cleaning $target_dir (保留 deps 缓存以加速增量重链)"
  # Tauri bundle(含 deb/app/dmg 残留)
  rm -rf "${target_dir}/bundle"
  # Rust 最终产物
  rm -f "${target_dir}/flymd" "${target_dir}/flymd.d"
  # 删 build script 产物(tauri-build 重新嵌入 tauri.conf.json version)
  rm -rf "${target_dir}/build" "${target_dir}/.fingerprint"
  # 本项目依赖编译产物(触发增量重链 flymd 本体,30-60s)
  # nullglob:无匹配时 glob 不展开为字面量
  shopt -s nullglob
  rm -rf "${target_dir}"/deps/flymd-* "${target_dir}"/deps/libflymd-*
  shopt -u nullglob
}
