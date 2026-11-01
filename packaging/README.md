# 第三方分发渠道清单

flymd 的发布主线在 `htmambo/flymd`。但**包管理器渠道的清单托管在别人的仓库里**，
本目录存放这些清单的**可提交副本**与生成脚本，方便每次发版后快速提交 PR。

> ⚠️ 本目录里的文件**不参与构建**，不会被打进安装包。它们是「提交给第三方仓库的素材」。

---

## winget（microsoft/winget-pkgs）

包名：`flyhunterl.FlyMD` —— **沿用原包名，不改名**。

理由：winget 的包名是升级通道的标识。改包名等于在商店里另开一个应用，
原包名下已有的用户**收不到 v2.0.0+ 的升级提示**，等于把 900+ 存量用户丢掉。
包名里带 `flyhunterl` 与实际维护者不一致，是历史遗留，接受这个代价。

生成清单：

```bash
node packaging/winget/generate.mjs --version 2.0.1
```

脚本会从 GitHub Release 拉取 `flymd_<版本>_x64-setup.exe`、算 SHA256，
然后在 `packaging/winget/manifests/f/flyhunterl/FlyMD/<版本>/` 下生成四个文件：

```
flyhunterl.FlyMD.yaml
flyhunterl.FlyMD.installer.yaml
flyhunterl.FlyMD.locale.en-US.yaml
flyhunterl.FlyMD.locale.zh-CN.yaml
```

提交方式：在 [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs) 上开分支，
把四个文件放到 `manifests/f/flyhunterl/FlyMD/<版本>/`，提 PR。

**相对 1.4.4 的改动**：

| 字段 | 1.4.4 | 2.0.1 |
|---|---|---|
| `InstallerUrl` | `github.com/flyhunterl/flymd/...` | `github.com/htmambo/flymd/...` |
| `InstallerSha256` | `907276C8…98B9E` | `02048195…F5E7A6` |
| `License` | `Proprietary` | `GPL-3.0-only` |
| `ReleaseDate` | 2026-07-22 | 2026-11-01 |
| 描述 | 无 MCP 相关 | 补一条 MCP 服务器说明 |

2.0.1 的清单已生成在 `packaging/winget/manifests/f/flyhunterl/FlyMD/2.0.1/`，
可直接拿去提 PR。

> `License: Proprietary` 是历史遗留的错值 —— flymd 早已是 GPL-3.0，
> 仓库里的 `LICENSE` 文件与 `package.json` 的 `license` 字段都已对齐。
> winget 清单没跟上，这次一并修正。

---

## AUR（aur.archlinux.org）

包名：`flymd` —— **沿用原包名，不改名**（同上理由）。

当前状态：**aur.archlinux.org 上的 `flymd` 由第三方维护**（Maintainer: `Integral`），
不是本项目维护者。因此本仓库无法直接推送，有两条路：

| 方案 | 做法 | 代价 |
|---|---|---|
| A. 孤儿化 + 收养 | 在 AUR 网页申请孤儿化该包 → 克隆 `https://aur.archlinux.org/flymd.git` → 提交 | 需要在 AUR 账户上走一遍申请流程 |
| B. 联系当前维护者 | 由 `Integral` 提交同样的 `PKGBUILD` 改动 | 依赖对方响应，不可控 |

`packaging/aur/PKGBUILD` 是**可直接提交**的版本，与当前线上的差异：

| 字段 | 线上（1.4.3） | 本目录（2.0.1） |
|---|---|---|
| `pkgver` | 1.4.3 | 2.0.1 |
| `url` | `github.com/flyhunterl/flymd` | `github.com/htmambo/flymd` |
| `source` | 从旧仓库取 tarball | 从新仓库取 tarball |
| `sha256sums` | 旧值 | `bdab052a…520c3` |

源码包来自 GitHub 自动生成的 tag 归档，顶层目录名是 `flymd-<版本>/`
（按**仓库名**而非 tag 推导，所以换仓库不影响路径匹配）。

---

## 为什么不在 CI 里自动提交

winget 与 AUR 都是**第三方仓库**，自动提交意味着：

- 需要在本仓库存 `GITHUB_TOKEN` 之外的凭据（AUR 用 SSH key，winget 用 PAT）
- 自动 PR 容易在版本号算错时把坏清单推上去，而 winget 的清单校验很严（PR 会被自动测试打回）

当前选择：**生成素材 + 人工确认后提交**。一次发版的额外工作量约 10 分钟。
