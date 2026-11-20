# 修复 Linux 打包脚本 `package-manjaro.sh --install` 失败

**Status**: ✅ Completed (completion time: 2026-11-20)
**Created**: 2026-11-20
**责任人**: 果农（Claude 协作实现）
**范围**: `scripts/get-version.sh`、`scripts/package-manjaro.sh`、`scripts/package-debian.sh`、新增 `scripts/_deps.sh`

## 目标（Goals）

1. 定位 `scripts/package-manjaro.sh --install` 运行失败的**根因**（而非停留在报错表象）。
2. 修复该根因，使 `scripts/package-manjaro.sh --install` 能在 Manjaro/Arch 上从当前工作树**端到端成功**并完成安装。
3. 顺带修掉同源缺陷，避免 Debian 打包路径踩同一个坑。
4. 全部结论**可复现、可验证**，不接受"看起来对了"。

## 现状分析（Context）

### 用户报障

`scripts/package-manjaro.sh --install` 运行失败。实跑日志（`/tmp/manjaro-install.log`）的失败点：

```
✗ Build failed in 3.94s
error during build:
Error: [vite]: Rolldown failed to resolve import "@codemirror/state"
    from "/home/hoping/htdocs/flymd/src/modes/cm6LivePreview.ts".
beforeBuildCommand `vite build` failed with exit code 1
EXIT=1
```

注意：报错点在 **前端构建**，与 pacman 打包毫无关系。

### 根因一：node_modules 陈旧 + 脚本不检测陈旧性（主因）

| 事实 | 证据 |
|---|---|
| `node_modules/` 安装于 2026-10-09 15:21 | `stat node_modules` |
| `@codemirror/state` 等 6 个直接依赖于 2026-10-30 才加入 package.json | `git log -S'"@codemirror/state"' -- package.json` → `3eb6b34 perf: 大文件视口渲染与 CM6 流畅编辑` |
| 旧脚本只在 `node_modules` **目录不存在**时才装依赖 | 原 `scripts/package-manjaro.sh:93` 的 `! -d node_modules` 判定 |
| 结果 | 目录存在 → 走 "Reusing existing node_modules" → 构建时才炸 |

缺失的 6 个直接依赖（`package.json` 声明但 `node_modules/` 顶层解析不到）：

```
@codemirror/commands  @codemirror/lang-markdown  @codemirror/language
@codemirror/state     @codemirror/view           @types/mdast
```

（`.pnpm/` 目录里其实有 `@codemirror/state@6.7.4`——它是 `@milkdown` 的**传递依赖**；
缺的只是顶层**直接依赖**的软链。）

### 根因二：本机没有全局 pnpm，恢复路径也是死的

- `pnpm` 不在 PATH（只有 `corepack@0.36.0` 与 `npm@12.2.0`）
- 即使用 `--npm-ci`，旧脚本的分支是 `command -v pnpm >/dev/null 2>&1` → 不满足 → 直接 `exit 1`（"需要 pnpm"）
- 仓库实际以 pnpm 为准：`pnpm-lock.yaml` 存在、无 `package-lock.json`、`package.json` 声明 `"packageManager": "pnpm@10.28.0"`
- `corepack pnpm --version` → `10.28.0`（本地已缓存），与 CI 的 `pnpm/action-setup@v4`（读 `packageManager`）等价

### 根因三：版本号被 `^{}` 污染（影响两个打包路径）

`scripts/get-version.sh` 的 `get_upstream_version()`：

```bash
git ls-remote --tags ... | awk '/refs\/tags\/v[0-9]/ {sub(/.*\/v/, ""); print}' | sort -V | tail -1
```

**附注标签**在 `git ls-remote --tags` 里返回**两行**：

```
7edf5520...	refs/tags/v2.2.1        ← 标签对象本身
c102c8c2...	refs/tags/v2.2.1^{}     ← 剥离后的提交引用
```

`awk` 把第二行也处理成 `2.2.1^{}`，`sort -V` 把它排在 `2.2.1` 之后，`tail -1` 于是取到**带 `^{}` 的非法版本号**。

后果：
- **Arch**：`pkgver` = `2.2.1^{}` → 包名 `flymd-2.2.1^{}-1-x86_64.pkg.tar.zst`。pacman 能装，但版本号非法、升级比较失真。
- **Debian**：`dpkg-deb --build` **硬失败** —— `软件包 'flymd' 时：'Version' 字段值 '2.2.1^{}': 版本号含无效字符`（实测 exit 2）。Debian 打包路径当时是**完全不可用**的。

### 根因四：`makepkg --install` 在非交互环境被 pacman 询问卡死

`makepkg` 默认 `PACMAN_OPTS=()`（`/usr/bin/makepkg:85`），只有 makepkg **自己**收到 `--noconfirm` 时才会转发给 pacman（`/usr/bin/makepkg:1103`）。
不加 → `pacman -U` 弹 `:: 进行安装吗？ [Y/n]` → 无 TTY 下读到 EOF 直接放弃 → `警告： 安装创建的软件包失败` → **exit 14**。

同样的问题存在于 `--syncdeps` 路径：makepkg 的 `handle_deps()` 会跑 `run_pacman -S --asdeps`（`/usr/bin/makepkg:291`），同样会询问。

### 附带缺陷：版本一致性检查恒定误报

```bash
pkgbuild_version="$(sed -n 's/^pkgver=//p' PKGBUILD | sed -n '1p')"
```

PKGBUILD 里的 `pkgver=` 是**命令替换**（`$(bash .../get-version.sh ...)`），sed 取出来的是那段字面 shell 表达式，与实际版本**永远不相等** → 这条 Warning 每次都误报，且**从不**能发现真实的不一致。

## 子任务清单（Subtasks）

- [x] **T1** 复现失败并定位到前端构建阶段的 rolldown 解析错误 ✅
- [x] **T2** 确认根因一：node_modules 陈旧（6 个直接依赖缺失）+ 脚本不检测陈旧性 ✅
- [x] **T3** 确认根因二：本机无全局 pnpm，`--npm-ci` 恢复路径也是死的 ✅
- [x] **T4** 确认根因三：附注标签 `^{}` 污染版本号（Arch 非法版本 + Debian 硬失败） ✅
- [x] **T5** 确认根因四：`makepkg --install` 缺 `--noconfirm` → 非 TTY 下 exit 14 ✅
- [x] **T6** 修 `get-version.sh`：awk 过滤剥离引用（`!/[{]/`），去掉 `git ls-remote --refs` 的 git 版本依赖 ✅
- [x] **T7** 新增 `scripts/_deps.sh` 共享 helper：缺失依赖检测 + 锁文件漂移检测 + corepack 回退 + 安装 ✅
- [x] **T8** `package-manjaro.sh` / `package-debian.sh` 接入共享 helper ✅
- [x] **T9** `makepkg_args+=(--noconfirm)` 提升为无条件（同时覆盖 `--syncdeps` 与 `--install`） ✅
- [x] **T10** 版本一致性检查改为「打包版本 vs package.json 版本」，不再解析 PKGBUILD ✅
- [x] **T11** 端到端验证：`scripts/package-manjaro.sh --install` exit 0 + 安装成功 ✅
- [x] **T12** External Review MCP 审查（需求轮/代码轮，2 轮）并逐条处置 ✅

## 改动内容

### `scripts/get-version.sh`

- `git ls-remote --tags` 的结果在 awk 里过滤掉含 `{` 的行（附注标签的剥离引用）。
- 用字符类 `[{]` 匹配字面花括号：**POSIX 对 `\{` 的转义未定义**，各 awk 实现行为不一致；字符类是跨实现安全的写法。
- **不用** `git ls-remote --refs`：它要求 git ≥ 2.13，本脚本要在各种发行版的老 git 上也能跑。

### `scripts/_deps.sh`（新增）

沿用仓库既有的共享 helper 约定（参照 `scripts/_clean.sh`：不设 `set -e`、不 cd、不改全局变量、source 时无副作用）：

| 函数 | 职责 | 返回码 |
|---|---|---|
| `deps_missing_list` | 列出 package.json 声明但 node_modules 解析不到的依赖 | 恒 0 |
| `deps_lockfile_drift` | 比对仓库 `pnpm-lock.yaml` 与 `node_modules/.pnpm/lock.yaml` | 0=有漂移 / 1=无漂移 |
| `ensure_frontend_deps` | 统一入口，mode = `auto` / `always` / `never` | 0=成功 / 1=失败 |

- `auto`：node_modules 不存在 **或** 声明依赖有缺失 **或** 锁文件漂移 → 安装
- pnpm 解析顺序：PATH 上的 `pnpm` → `corepack pnpm`（读 `packageManager`，与 CI 等价）→ 都没有则报错退出

### `scripts/package-manjaro.sh` / `scripts/package-debian.sh`

- 改为 `source scripts/_deps.sh` + `ensure_frontend_deps`（两个脚本不再重复同一段逻辑）
- `--npm-ci` / `--skip-npm-ci` 语义保持不变（`always` / `never`）；Debian 脚本的 `--clean` 映射到 `always`
- `makepkg_args+=(--noconfirm)` 提升为无条件
- 帮助文本里的 "npm ci" 更正为实际行为（脚本一直用的是 pnpm）

## 验收标准（Acceptance）与验收结果

| 验收项 | 结果 |
|---|---|
| `bash -n` 四个脚本 | ✅ 全过 |
| helper 单测：auto+依赖齐全→跳过安装 | ✅ |
| helper 单测：never→跳过安装 | ✅ |
| helper 单测：锁文件漂移可检出 / 恢复后清除 | ✅ |
| helper 单测：缺失依赖可检出 / 恢复后清除 | ✅ |
| 自动修复路径：移走 `@codemirror/state` → 检出并重装 | ✅ 1.077s |
| `scripts/package-manjaro.sh --install` 端到端 | ✅ **EXIT=0** |
| 产物版本号 | ✅ `flymd-2.2.1-1-x86_64.pkg.tar.zst`（修前为 `2.2.1^{}-1`） |
| `pacman -Q flymd` | ✅ `flymd 2.2.1-1`（自 1.4.4-1 升级） |
| post-install 钩子 | ✅ 3 个全部执行 |
| 版本一致性告警 | ✅ 不再误报 |
| Debian 路径：`dpkg-deb --build` 接受版本号 | ✅（修前 `2.2.1^{}` 硬失败 exit 2） |

## 风险与回滚（Risks & Rollback）

- **pnpm 内部布局依赖**：`node_modules/.pnpm/lock.yaml` 是 pnpm 内部路径。若未来版本挪位置，`deps_lockfile_drift` 会恒判"有漂移" → 每次构建多跑一次**幂等**的 `pnpm install`（约 1–3s），**不会出错**。`packageManager` 字段锁定 pnpm 版本，风险有限。
- **`CI=true` 的作用域**：会传给依赖的 lifecycle 脚本。实测确认这是 pnpm 唯一有效的非交互杠杆（见下），且是 pnpm 报错信息自身给出的建议。
- **回滚**：`git checkout -- scripts/get-version.sh scripts/package-manjaro.sh scripts/package-debian.sh && rm scripts/_deps.sh` 即可完全回到修改前状态。三个文件均为独立、无数据迁移的构建脚本改动。

### `CI=true` vs 定向参数的实测结论（Round 2 审查争议项）

审查方建议改用 `--config.confirmModulesPurge=false` 以缩小 `CI` 作用域。**实测证明该建议无效**（pnpm 10.28.0，隔离工程 + 非 TTY + 破坏 `virtualStoreDirMaxLength` 触发 purge）：

| 变体 | 结果 |
|---|---|
| 无参数 | ❌ `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` |
| `CI=true` | ✅ 通过 |
| `--config.confirmModulesPurge=false` | ❌ 仍然中止 |
| `--config.confirmModulesPurge=true` | ❌ 仍然中止 |
| `npm_config_confirm_modules_purge=false` | ❌ 仍然中止 |
| `--force` | ✅ 通过（但强制全量重装，副作用更大） |

机制：`opts.confirmModulesPurge` 默认取 `!opts.force`（即 true），最终经 `opts.confirmModulesPurge && !opts.ci` 决定是否询问 —— **只有 `CI=true` 能关掉它**；`--config` 命名空间根本到不了该选项。故保留 `CI=true`，并在代码注释里写明证据，避免后人"优化"成无效变体。

## External Review Opinion

- **Round 1/10（code 轮）**：**NEEDS_CHANGES**，列 7 条 risk。
  - 处置：risk 1（`--noconfirm` 未覆盖 `--syncdeps`）**属实**，已提升为无条件；risk 2（`--refs` 可移植性）已改用 awk 字符类过滤，彻底去掉 git 版本依赖；risk 3（版本漂移漏检）已新增锁文件比对；risk 4（PKGBUILD 耦合 + 重复网络调用）已改为对比 package.json 版本；risk 5 已加 `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`；risk 6 已抽 `_deps.sh`；risk 7 经实测**驳回**其替代方案（见上表）。
  - 附带修正：审查方指出 Debian 11 / Ubuntu 22.04 的 git 过旧（`--refs` 需 2.13）这一**事实有误**（二者分别为 2.30.2 / 2.34.1），但仍采纳其可移植性诉求。
- **Round 2/10（code 轮）**：**APPROVED**，无阻断缺陷，4 条非阻断建议**全部采纳**：
  - `node -p "require('$ROOT_DIR/package.json')"` 路径含单引号会崩 → 改为 `PKG_FILE=... node -p 'require(process.env.PKG_FILE).version'`（已实测：旧写法 SyntaxError，新写法正常）
  - `CI=true` 作用域偏大 → 经实测 `confirmModulesPurge=false` 无效，保留 `CI=true` 并补证据注释
  - `deps_lockfile_drift` 依赖 pnpm 内部路径 → 已加注释说明降级行为
  - `deps_lockfile_drift` "无漂移"返回 1 → 已在 helper 头部与函数注释标注"必须放在 if/elif 条件里调用"

## 经验教训（Remarks）

1. **报错点离病因很远**是这类构建失败最难缠的地方。rolldown 报的是"找不到 @codemirror/state"，但病因在 3 周前的一次依赖新增 + 一个只判断"目录是否存在"的脚本。定位此类问题的第一步应该是**比对 package.json 声明与 node_modules 实际状态**，而不是追 rolldown 的解析错误。
2. **同一个病根在两个脚本里各写了一份**。`package-manjaro.sh` 与 `package-debian.sh` 的依赖安装逻辑是复制关系，Debian 路径当时已完全不可用却没人发现。抽 `_deps.sh` 不只是去重，更是让两条路径共享同一份修复。
3. **bash 会按字节偏移惰性读取脚本**——在脚本执行期间修改它，会让 bash 从错位处续读，把注释内容当命令执行（本次实测报出 `行 155: un: 未找到命令`）。调试期间改脚本前务必确认没有实例在跑。
4. **审查建议不等于事实**。Round 2 建议的 `--config.confirmModulesPurge=false` 从源码推导看合理，但实测证明它根本到不了那个选项。**用隔离复现工程做 A/B 实测，比读源码更能定论**——这也是 Round 2 能给出 APPROVED 的前提。

## 工时估算（Estimate）

已完成（S：诊断与根因定位 ~1h；M：三处修复 + 共享 helper 抽取 + 两轮外审处置 ~2h；验证：端到端跑通 4 次，其中 2 次因上述经验教训 #3 需重跑）
