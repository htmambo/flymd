# flymd macOS x86 单架构打包脚本

**状态**: ✅ 已完成 (完成时间: 2026-06-16)
**创建人**: Claude (with Codex 协作)
**关联脚本**: `scripts/flymd-macos-build.sh` (Universal 版本)

## 1. 目标与背景

### 1.1 背景
项目已存在 `scripts/flymd-macos-build.sh`，构建 **Universal** 二进制（`universal-apple-darwin`），输出 `.app + .dmg + .zip` 到 `target/macos/`。

但部分场景下需要单独的 x86_64 架构包：
- 旧版 Intel Mac 用户（仍占有一定比例）
- 团队内部分发 / 兼容性验证
- CI 产物对比

### 1.2 目标
新增 `scripts/flymd-macos-x86-build.sh`，构建 **x86_64-apple-darwin** 单架构包，输出到**复用**的 `target/macos/` 目录（与 Universal 共存），文件名带 `x86_64-apple-darwin` 标识。

## 2. 用户已确认的关键决策

| 决策项 | 选定方案 |
|---|---|
| 产物输出目录 | 复用 `target/macos/` 目录（与 Universal 共存） |
| 文件名后缀 | `x86_64-apple-darwin`（如 `flymd_x86_64-apple-darwin.zip`） |
| 参数支持 | 支持 `--dmg-only`（与 Universal 版本保持一致） |
| 文件权限 | 创建后 +x 可执行权限（与 Universal 版本一致） |

### 复用目录后的最终产物
```
target/macos/
├── flymd_universal-apple-darwin.zip
├── flymd_x86_64-apple-darwin.zip
├── flymd_1.0.0_universal-apple-darwin.dmg
└── flymd_1.0.0_x86_64-apple-darwin.dmg
```

## 3. 详细任务分解

### 3.1 子任务清单

| # | 子任务 | 状态 | 说明 |
|---|---|---|---|
| 3.1.1 | 向 Codex 索要代码原型 | ✅ | codex MCP/CLI 均不可用，subagent 按 CLAUDE.md 第三优先级独立完成 diff |
| 3.1.2 | 创建 Active 计划文档 | ✅ | `docs/Task/Active/FLYMD_MACOS_X86_BUILD_PLAN.md` |
| 3.1.3 | 重写为生产级脚本 | ✅ | 基于 diff 原型，参考 Universal 脚本风格重写 |
| 3.1.4 | Codex review（4 轮迭代）| ✅ | 见 §10 修复清单 |
| 3.1.5 | 赋可执行权限 chmod +x | ✅ | -rwxr-xr-x |
| 3.1.6 | 语法校验 (bash -n) | ✅ | 通过 |
| 3.1.7 | 归档 + Git 提交 | 🔄 | 当前步骤 |

## 4. 与 Universal 脚本的差异点（核心改动）

| 项 | Universal | x86 单架构 |
|---|---|---|
| ARCH 变量 | `universal-apple-darwin` | `x86_64-apple-darwin` |
| TAURI_TARGET | `target/universal-apple-darwin/release` | `target/x86_64-apple-darwin/release` |
| ZIP 文件名 | `flymd_universal-apple-darwin.zip` | `flymd_x86_64-apple-darwin.zip` |
| DMG 文件名 | `flymd_${VERSION}_universal-apple-darwin.dmg` | `flymd_${VERSION}_x86_64-apple-darwin.dmg` |
| 脚本头注释 | "Universal 二进制" | "x86_64 单架构二进制" |

**保持不变的部分**：
- 颜色输出函数 (info/ok/warn/err)
- `--dmg-only` 参数解析
- 前置检查（Node/Rust/Xcode CLT/create-dmg）
- 依赖安装（npm ci + tauri CLI）
- 图标生成 (ensure-icons.cjs)
- .app.zip 打包逻辑
- DMG 构建（tauri bundler + create-dmg fallback）
- TARGET_DIR 复用 `target/macos/`
- 完成提示信息

## 5. 验收标准

- [ ] 脚本能通过 `bash -n` 语法检查
- [ ] 脚本具备可执行权限 (-rwxr-xr-x)
- [ ] 产物文件名带 `x86_64-apple-darwin` 标识
- [ ] 输出目录复用 `target/macos/`，不与 Universal 冲突
- [ ] 支持 `--dmg-only` 参数
- [ ] 在 README/脚本头注释中明确说明 "x86_64 单架构" 字样
- [ ] Codex review 无关键问题
- [ ] Git 提交信息符合 COMMIT_TEMPLATE.md 格式

## 6. 风险评估

| 风险 | 缓解措施 |
|---|---|
| 误覆盖 Universal 产物 | 文件名后缀严格区分，路径不重叠 |
| x86 架构本地无交叉编译环境 | 脚本内不强制 arch 检查，依赖 tauri 自身处理 |
| Xcode CLT SetFile 不可用 | 沿用 Universal 脚本的探测 + 警告策略 |
| create-dmg 缺失 | 沿用 Universal 脚本的 brew install 自动安装策略 |

## 7. 不在本任务范围

- 不修改现有 `flymd-macos-build.sh`（Universal 脚本保持原样）
- 不实际执行构建（仅做语法校验）
- 不修改 `package.json` / `src-tauri/tauri.conf.json`
- 不新增 CI 配置

## 8. 实施顺序

1. Codex 索要 diff 原型 → 2. 创建本计划文档 → 3. 重写脚本 → 4. 赋权限 + bash -n → 5. Codex review → 6. 归档 + commit

## 9. 备注

### 9.1 经验总结

- **diff 改写时的"镜像陷阱"**：第一次 Codex MCP 不可用、CLI 也因上游 503 失败，subagent 按 CLAUDE.md 第三优先级独立生成 diff。该 diff 过于"机械镜像"Universal 脚本，**继承了 Universal 脚本的多个隐藏 bug**。
- **Codex review 4 轮迭代修复 10 个 P2 问题**（详见 §10），这些是 Universal 脚本共有的"祖传 bug"，本任务**只修复 x86 脚本**，未触动 Universal 脚本。
- **重要的反置疑**：问题 5（`--dmg-only` 触发 tauri build）我原本想保留 tauri 链路以与 Universal 一致，codex 指出"会 rebuild app"——最终采纳 codex 建议（`--dmg-only` 跳过 tauri bundler），更符合"加速"语义。

### 9.2 不在任务范围的副作用

Universal 脚本 (`flymd-macos-build.sh`) 仍然存在以下已知 bug，本次任务**不修复**：
- `--dmg-only` 仍生成 ZIP
- ZIP 输出位置错误
- create-dmg fallback 源路径错误
- ZIP/DMG 不清空重建
- `npm install -D` 污染 lockfile
- rustup 探测缺失
- create-dmg 不支持的 `--dmg-title` 参数

后续可单独立任务统一治理 Universal 脚本的健壮性。

## 10. Codex Review 修复清单（4 轮迭代）

| # | 严重度 | 问题 | 修复 |
|---|---|---|---|
| 1 | P2 | ZIP 写到 `src-tauri/...bundle/macos/` 而非 `target/macos/` | `zip` 改用绝对路径 `${ZIP_OUT}` |
| 2 | P2 | `--dmg-only` 仍生成 ZIP | 加 `if [ "$DMG_ONLY" = true ]` 跳过 |
| 3 | P2 | create-dmg 源传了 `.app` 本体 | 改为 `$(dirname "$APP_DIR")` |
| 4 | P2 | `zip -r` 增量更新导致旧文件残留 | 打包前 `rm -f "${ZIP_OUT}"` |
| 5 | P2 | `--dmg-only` 仍触发 tauri build | 跳过 tauri bundler，直接 create-dmg |
| 6 | P2 | DMG fallback 不会清旧文件 | 打包前 `rm -f "${DMG_OUT}"` |
| 7 | P2 | Homebrew rust 无 rustup 崩溃 | 加 `command -v rustup` 探测 |
| 8 | P2 | `npm install -D` 污染 lockfile | 移除该步骤，依赖 `npm ci` 的 devDeps |
| 9 | P3 | lipo 校验路径错误 | 改用绝对路径 `${APP_DIR}/...` |
| 10 | P2 | create-dmg 不支持 `--dmg-title` | 移除该参数，只保留 `--volname` |

**最终 Codex 评价**：
> No discrete correctness issues were found in the current staged, unstaged, or untracked changes. The lockfile is consistent with package.json, and the new x86 macOS build script is syntactically valid.
