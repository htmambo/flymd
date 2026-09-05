# 库私有配置：后续增强记录（完全私有化）

## 当前实现（v1，sync/main-v1.4.4）

库私有配置分两个通道（框架：`src/core/libraryConfig.ts`）：

- **通道A（库内共享）** `<库根>/.flymd/config.json`：
  最近文件 `recent`、库树排序 `librarySort`、文件夹排序 `folderOrder`、
  粘贴默认目录 `defaultPasteDir`、扩展启用覆盖 `pluginEnable`。
- **通道B（系统层按库命名空间）** Store/localStorage key 追加 `:<libId>`：
  标签会话 `tabSession`、光标位置 `docPos`、图床配置 `uploader`（含凭据）。
  WebDAV 维持原有 `sync.profiles[libId]`（系统层按库，不动）。

全局应用级设置（主题/字号/布局/行为开关/代理/更新检查等）保持全局，不入库。

切库行为：切换持久化库时保存旧库标签会话 → 恢复新库会话（无会话则重置为
空白标签）；扩展激活集按新库覆盖 reconcile；docPos/folderOrder 等缓存随
`flymd:library:changed` 事件失效重载。临时库/无库一律回落全局行为。

## 后续增强（用户已确认方向，待排期）

**完全私有化处理**：把通道B 的内容也迁入库目录（如 `.flymd/local.json`），
实现"库目录整体搬走即带走全部私有信息"。要点：

1. **同步排除**：`.flymd/local.json`（设备私有：标签会话/光标位置/图床凭据）
   必须加入 WebDAV 同步排除列表，避免多设备互相覆盖、凭据外泄。
   需检查 `src/extensions/webdavSync.ts` 的排除机制并扩展。
2. **多窗口并发写**：库内文件需保持原子写（临时文件 + rename，框架已具备），
   必要时加文件锁或合并策略。
3. **迁移**：首次打开库时把通道B 存量数据搬入库目录并清理系统层 key。
4. **配置备份/便携模式**：`src/core/configBackup.ts`、`src/core/portable.ts`
   目前只打包 AppData/AppLocalData，完全私有化后库私有部分不再被覆盖到，
   需明确语义（可能提供"导出库配置"入口）。
