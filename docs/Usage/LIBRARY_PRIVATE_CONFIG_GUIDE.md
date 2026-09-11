# 库私有配置指南（v2.0+）

> 适用版本：flymd 2.0+（库私有化 v2 落地后）

## 1. 概述

flymd v2.0 把"库内配置"拆成两个通道：

| 通道 | 存储位置 | 内容 | 同步 |
|---|---|---|---|
| **A 共享** | `<库根>/.flymd/config.json` | recent / currentFile / librarySort / folderOrder / defaultPasteDir / pluginEnable | **随 WebDAV 同步** |
| **C 私有** | `<库根>/.flymd/local.json` | docPos（光标位置）/ uploader 凭据 / 插件 per-library 数据 | **不同步**（PR-1 默认排除） |

**关键设计**：
- 库目录整体搬走 → 带走全部 A + C 私有
- WebDAV 同步 → 只带 A 共享；C 私有（含凭据）始终留在本机
- 多设备多用户场景：每台设备各自的 C 私有，跨设备共享的 A 共享

## 2. 文件结构

```
<库根>/
├── .flymd/
│   ├── config.json       # 通道 A (共享,可被 WebDAV 同步)
│   ├── local.json        # 通道 C (私有,含凭据,不同步)
│   ├── local.json.bak1   # 备份 1 (损坏可回退)
│   ├── local.json.bak2   # 备份 2
│   ├── local.json.bak3   # 备份 3
│   ├── local.json.tmp    # 临时文件(原子写中,正常情况下不应存在)
│   └── library-id.json   # 库标识(WebDAV 同步时需匹配)
├── 笔记1.md
├── 笔记2.md
└── ...
```

## 3. 库搬走指南

### 3.1 把库搬到新机器

**方法 A：整库复制**
1. 在旧机器关闭 flymd（避免复制中写到一半）
2. 复制整个库目录到新机器
3. 新机器打开 flymd → "添加库" → 选新路径
4. 完成！所有配置（含凭据、插件数据）跟随

**方法 B：剪贴板/网盘**
- 直接复制库目录（包含 `.flymd/` 隐藏文件夹）
- 任何方式都行，关键是 **`.flymd/` 子目录完整**

### 3.2 跨设备同步（WebDAV）

| 数据 | 同步 | 备注 |
|---|---|---|
| 笔记文件 | ✅ | 你的库内容 |
| `.flymd/config.json` | ✅ | 共享配置跨设备一致 |
| `.flymd/local.json` | ❌ | 含凭据，留本机 |
| 插件/扩展 | ❌ | 系统层，跨设备需分别安装 |

## 4. 凭据保护

`local.json` **可能含**：
- **图床凭据**：S3 accessKeyId/secretAccessKey、兰空图床 token
- **加密密钥**：WebDAV 内容加密密钥/盐
- **插件 per-library 状态**（如 AI 助手偏好等）

**保护措施**：
- **WebDAV 同步默认排除** `**/.flymd/local.json`（PR-1）—— 凭据不随同步上传
- **不可手动移除排除项**（PR-7 计划加 UI 锁死）—— 防止误操作

**最佳实践**：
- 不要把库目录整个分享给他人（除非明确不要凭据）
- 备份库目录到加密磁盘/U 盘
- 删除库时**手动**清理 `local.json` 残留（自动备份机制保留 3 个 .bak）

## 5. 故障排查

### 5.1 local.json 损坏

**症状**：库设置异常 / 插件异常 / 启动报错

**恢复步骤**：
1. 关闭 flymd
2. 进入 `<库根>/.flymd/`
3. 检查 `local.json` 是否有乱码/截断
4. 若损坏，从 `local.json.bak1` 恢复（最近一次成功写入的备份）：
   ```bash
   cp local.json.bak1 local.json
   ```
5. 启动 flymd 验证
6. 若所有 .bak 都损坏，库私有数据丢失（通道 A 共享配置不受影响）

**自动备份机制**（每 3 次写滚动 1 次）：
- 每次写入 local.json 成功后
- `local.json` → `local.json.bak1`
- 旧的 `bak1` → `bak2`
- 旧的 `bak2` → `bak3`
- 旧的 `bak3` 删除

**启动期清理**：
- `.tmp` 文件（写入未完成）会在启动时被 Rust 端 `cleanup_stale_tmp_files` 自动清理

### 5.2 迁移未触发（升级 v2.0 后数据没出现在 local.json）

**原因**：v1.x → v2.0 升级期，存量数据在系统层 Store。需满足以下条件才触发迁移：
1. 打开的是**持久化库**（不是临时库/无库）
2. Store 中存在旧 key：`docPos:<libId>` 或 `uploader:<libId>`
3. 库根存在

**手动触发**（如自动迁移失败）：
- 检查通知中心是否出现"已迁移 N 项库私有数据"
- 看 `flymd:lib-local-migrated:<libId>` 是否在 Store
- 删除该标记后重启可强制重试

### 5.3 多窗口写冲突

**预防**（PR-2 基础设施）：
- Rust 端跨进程文件锁（POSIX `flock` / Windows `LockFileEx`）
- 500ms 防抖（高频 docPos 写合并）
- 原子写（tmp + fsync + rename）

**症状**：极少见。表现：偶发写丢。

**恢复**：
- 关掉所有窗口再开
- 检查 `local.json` 是否最新
- 若损坏 → 5.1 恢复

## 6. 不入库的内容（全局）

下列仍是全局配置，**不**跟库走：

- **主题/字号/快捷键** — 全局应用偏好
- **AI 助手模型选择** — 全局（v2.0）
- **搜索历史 / 命令面板历史** — 全局
- **插件市场安装 / 启用** — 全局
- **AI 助手核心扩展状态** — 全局
- **库侧栏 / 大纲布局** — 全局
- **便携模式开关** — 全局
- **窗口位置** — Tauri 窗口状态插件管理

**v2.1+ 计划**：可能提供 per-library 化全局偏好的显式 opt-in（当前 v2.0 不做以避免切库丢配置）。

## 7. 旧版本（v1.x）数据迁移

升级 v2.0 后，首次打开库时会自动迁移：

| 字段 | 旧位置 | 新位置 | 备份 |
|---|---|---|---|
| docPos | Store `docPos:<libId>` | local.json.docPos | `flymd:lib-local-migrated:backup:<libId>:docPos` |
| uploader | Store `uploader:<libId>` | local.json.uploader | `flymd:lib-local-migrated:backup:<libId>:uploader` |

**v2.0 不迁移**（设计修正，避免切库丢配置）：
- ASR 配置 — 全局
- 手动转写偏好 — 全局
- Word 预览 enabled — 全局
- WebDAV 同步配置 — 库搬走后失效合理

**幂等保证**：
- 标记 `flymd:lib-local-migrated:<libId>` 写入 Store
- 第二次打开库直接跳过（避免重复迁移）
- 旧 key 保留 v2.0 兜底，v2.1 稳定后清理

## 8. 备份与恢复

### 8.1 库配置导出

库设置面板 → "导出此库配置"：
- **不含凭据**：打包 config.json（共享段），适合跨设备同步
- **含凭据**：再附加 local.json（含图床 key / 加密密钥），**二次确认**

输出 `.flymdconfig` 文件，可被未来的 restore 工具还原到对应库。

### 8.2 便携模式

便携模式备份 = **仅全局**（主题/快捷键/全局扩展）。

**不**包含任何库。要搬库请用 §3 的方法。

## 9. 常见问题

**Q: 库配置备份会包含凭据吗？**
A: 便携模式 ❌。库配置导出可选项（默认 ❌，需显式勾选 + 二次确认）。

**Q: 我能在 Git 里同步库目录吗？**
A: 可以同步**笔记 + config.json**。但要确保 `.gitignore` 含 `**/.flymd/local.json`（凭据）。WebDAV 用户更简单（已默认排除）。

**Q: 删除库时数据会一起删吗？**
A: 删除库列表项 ≠ 删除磁盘文件。库目录仍在原位。
   - A 共享（config.json）随库目录走
   - C 私有（local.json）随库目录走
   - 备份 .bak 随库目录走
   - 通知中心有"是否删除"提示确认

**Q: 旧版本 v1.4.4 的数据能继续读吗？**
A: 能。v2.0 仍读旧 Store key（fallback），但新写入会同时写到 local.json。升级 v2.1 之前别手动删旧 key。

## 10. 相关文档

- [WebDAV 排除项指南](./EXTERNAL_FILE_WATCH_GUIDE.md)
- [插件开发指南 - 库作用域存储](../plugin.md#contextstoragescoped库作用域存储-v20)
