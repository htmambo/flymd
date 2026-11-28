# 更新链路签名评估（2026-11-28）

## 现状

更新链路已经具备以下防护（`src-tauri/src/main.rs`）：

- `check_update` 只访问固定 GitHub 仓库的 Releases API；
- 下载 URL 必须在 `DOWNLOAD_ALLOWED_HOSTS` 白名单内，仅允许 HTTPS；
- SHA-256 必须来自 Rust 侧登记的 `check_update` 结果（前端传入的 `expected_sha256` 不被信任）；
- 下载到临时文件 → 校验摘要 → 原子替换；大小上限 512MB；重定向后再次校验域名；
- `run_installer` 只允许运行 Downloads/temp 下、且登记过摘要的 `.exe/.msi`，spawn 前重新哈希。

## 风险

当前信任锚是“GitHub Releases API + 传输层 TLS”。这能防中间人和随机镜像投毒，但**不能防**：

1. GitHub 账号 / Release 被攻破：攻击者可以同时替换安装包与 `digest` 字段；
2. 仓库维护者误操作上传错误产物；
3. 供应链上游（构建机、依赖）被污染。

`download_file` 的摘要校验只保证“下载到的字节与 GitHub 声称的一致”，不保证“GitHub 声称的是发布者签过名的”。

## 建议方案（minisign / Tauri updater 签名）

1. 生成发布密钥对；私钥只存在于发布 CI 的 secret 中，公钥内置进二进制（Rust 常量）。
2. 发布流程对每个安装包生成 detached signature（`.sig`），随 Release 一起上传；
   推荐同时把签名写入 `update-extra.json`，避免依赖 GitHub asset 命名。
3. `check_update` 返回 `signature` 与 `pubkey_id`；`download_file` 在 SHA-256 校验之后追加签名校验：
   - 下载 `.sig`（或在同一响应中返回）；
   - 用内置公钥验证 `signature(file_bytes)`；
   - 校验失败删除临时文件并返回明确错误。
4. `run_installer` 的 `verified_installs` 只在“摘要 + 签名”都通过后登记。
5. 密钥轮换：内置多个 `pubkey_id`，按 `check_update` 返回值选择；旧密钥保留一个版本周期。

## 迁移步骤

1. 先生成密钥并在 CI 中对现有产物签名，但不强制校验（观察期）。
2. 客户端增加“有签名则校验、无签名记录告警”的宽松模式，发布 1~2 个版本。
3. 切换为强制校验；缺失签名直接拒绝自动安装，仍保留“手动打开下载页”的降级路径。
4. 更新本文档与 `docs/security/` 下的威胁模型。

## 本轮不做

- 不引入密钥、不修改发布工作流、不改 `download_file` / `run_installer` 行为。
- 原因：当前环境没有发布私钥，改动无法端到端验证；本轮只产出评估与迁移路径。

## 验收建议（未来实施时）

- 单元测试覆盖：签名正确、签名错误、公钥不匹配、签名缺失。
- 手工验证：篡改安装包后 `download_file` 拒绝，`run_installer` 不登记。
