#!/usr/bin/env bash
# Shared frontend-dependency helper — source by package scripts (debian/manjaro).
#
# 用法:
#   source "$ROOT_DIR/scripts/_deps.sh"
#   ensure_frontend_deps "auto" "$ROOT_DIR"   # auto | always | never
#
# 设计目标:
#   1. node_modules 目录存在 ≠ 依赖齐全。新增依赖后旧目录仍在,若不复核
#      package.json,失败会推迟到 vite/rolldown 阶段才炸成
#      "failed to resolve import '@codemirror/state'",报错点离病因很远。
#   2. 依赖版本漂移:package.json 的依赖都在,但装的仍是旧版本(锁文件更新后
#      没重装),同样要能被发现。
#   3. pnpm 版本由 package.json 的 packageManager 字段锁定(pnpm@10.28.0)。
#      本机可能没有全局 pnpm,但 corepack 能按 packageManager 拉起对应版本,
#      与 CI 的 pnpm/action-setup@v4 等价。
#
# 注意事项:
#   - 本脚本不设 set -euo pipefail,不 cd,不修改任何全局变量,
#     完全由调用者掌控自身 shell 行为(避免污染调用者环境)。
#   - 本脚本不主动安装依赖(source 时无副作用),需显式调用 ensure_frontend_deps。
#   - deps_lockfile_drift 的"无漂移"返回码是 1(非 0),必须放在 if/elif
#     条件里调用,否则会触发调用方 set -e 的退出。

# 列出 package.json 中声明但无法在 node_modules 解析到的依赖。
# 参数: root_dir
# 输出: 缺失包名(空格分隔);全部就位则输出为空。
deps_missing_list() {
  local root_dir="${1:?deps_missing_list 需要传入 root_dir 参数}"
  [[ -d "$root_dir/node_modules" ]] || return 0
  (
    cd "$root_dir" || exit 0
    # node -e 默认按 CommonJS 解析,不受 package.json 的 "type": "module" 影响。
    # || true:node 失败(比如 package.json 损坏)不应中断调用者,退化为"不缺失"。
    node -e '
      const p = require("./package.json");
      const fs = require("fs");
      const all = { ...p.dependencies, ...p.devDependencies };
      const missing = Object.keys(all).filter((d) => !fs.existsSync("node_modules/" + d));
      process.stdout.write(missing.join(" "));
    ' 2>/dev/null || true
  )
}

# 检测已安装的依赖树是否与仓库锁文件同步。
# pnpm install 会把实际使用的锁文件写到 node_modules/.pnpm/lock.yaml;
# 锁文件更新后没重装时,该文件仍是旧的 → 依赖都在但版本是旧的。
# 注意: node_modules/.pnpm/lock.yaml 是 pnpm 的内部布局,未来版本若挪位置,
# 本函数会恒判"有漂移" → 每次构建多跑一次幂等的 pnpm install(约 1-3s),
# 不会出错,只是变慢。packageManager 字段锁定了 pnpm 版本,风险有限。
# 参数: root_dir
# 返回: 0 = 有漂移(需要重装); 1 = 无漂移。
# 注意: "无漂移"返回的是 1。调用方必须放在 if/elif 条件里,
# 直接裸调用会被调用方的 set -e 终止。
deps_lockfile_drift() {
  local root_dir="${1:?deps_lockfile_drift 需要传入 root_dir 参数}"
  local repo_lock="$root_dir/pnpm-lock.yaml"
  local installed_lock="$root_dir/node_modules/.pnpm/lock.yaml"
  [[ -f "$repo_lock" ]] || return 1
  [[ -f "$installed_lock" ]] || return 0
  cmp -s "$repo_lock" "$installed_lock" && return 1
  return 0
}

# 确保前端依赖就位。
# 参数: mode(root_dir)
#   auto   — node_modules 不存在、声明依赖有缺失、或锁文件漂移时安装
#   always — 总是安装
#   never  — 从不安装
ensure_frontend_deps() {
  local mode="${1:-auto}"
  local root_dir="${2:?ensure_frontend_deps 需要传入 root_dir 参数}"

  local need=0
  case "$mode" in
    never)
      return 0
      ;;
    always)
      need=1
      ;;
    auto)
      if [[ ! -d "$root_dir/node_modules" ]]; then
        need=1
      else
        local missing
        missing="$(deps_missing_list "$root_dir")"
        if [[ -n "$missing" ]]; then
          echo "==> node_modules 已过期，缺少依赖: $missing" >&2
          need=1
        elif deps_lockfile_drift "$root_dir"; then
          echo "==> node_modules 与 pnpm-lock.yaml 不同步（依赖版本漂移）" >&2
          need=1
        fi
      fi
      ;;
    *)
      echo "    error: 未知的依赖安装模式: $mode" >&2
      return 1
      ;;
  esac

  [[ "$need" -eq 1 ]] || return 0

  if [[ ! -f "$root_dir/pnpm-lock.yaml" ]]; then
    echo "    error: 需要 pnpm（仓库以 pnpm-lock.yaml 为准，已不再维护 package-lock.json）" >&2
    return 1
  fi

  local pnpm_cmd=()
  if command -v pnpm >/dev/null 2>&1; then
    pnpm_cmd=(pnpm)
  elif command -v corepack >/dev/null 2>&1; then
    pnpm_cmd=(corepack pnpm)
  else
    echo "    error: 需要 pnpm 或 corepack（仓库以 pnpm-lock.yaml 为准，已不再维护 package-lock.json）" >&2
    return 1
  fi

  echo "==> Installing frontend dependencies"
  echo "    detected pnpm-lock.yaml, using pnpm"
  # CI=true:pnpm 在无 TTY 环境下需要重建 node_modules 时会中止
  #   (ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY)。
  #   中止闸门在 pnpm 内部是 `if (opts.confirmModulesPurge ?? true)`,而
  #   opts.confirmModulesPurge 默认取 `!opts.force`(即 true),最终经
  #   `opts.confirmModulesPurge && !opts.ci` 决定是否询问 —— 只有 CI=true
  #   才能把它关掉。
  #   实测(pnpm 10.28.0,隔离工程 + 非 TTY):
  #     无参数                      → 中止
  #     CI=true                     → 通过
  #     --config.confirmModulesPurge=false  → 仍然中止(--config 到不了该选项)
  #     npm_config_confirm_modules_purge=false → 仍然中止
  #     --force                     → 通过,但会强制全量重装,副作用更大
  #   这也是 pnpm 报错信息自己给出的建议("set the CI environment variable to true"),
  #   故保留 CI=true,不要改成上面那两个定向参数。
  # COREPACK_ENABLE_DOWNLOAD_PROMPT=0:corepack 首次下载 pnpm 时不弹确认
  #   (非 TTY 环境下会直接失败)。
  (
    cd "$root_dir" || exit 1
    CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0 "${pnpm_cmd[@]}" install --frozen-lockfile
  )
}
