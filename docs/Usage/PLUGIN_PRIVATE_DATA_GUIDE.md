# 插件库作用域存储指南（v2.0+）

> 适用版本：flymd 2.0+（库私有化 v2 落地后）

## 1. 概述

flymd 2.0 给插件新增 `context.storage.scoped` API，用于把数据存进 **当前库** 的 `.flymd/local.json`（通道 C），库目录搬走时数据跟随。

与 `context.storage`（旧的全局存储）的关键差异：

| API | 存储位置 | 跨库共享 | 跟库走 | 适合场景 |
|---|---|---|---|---|
| `context.storage.{get,set}` | 系统层 Store `plugin:<id>` | ✅ 是 | ❌ 否 | API key、全局开关 |
| `context.storage.scoped.{get,set,remove}` | `<库根>/.flymd/local.json` 的 `prefs.<pluginId>` 段 | ❌ 否 | ✅ 是 | 实例数据、画板状态、每个库独立的笔记元数据 |

## 2. 何时用哪个？

**用 `context.storage`（旧）**：
- 用户级偏好（语言、UI 模式）
- API key / 凭据
- 跨多个库共享的设置

**用 `context.storage.scoped`（新）**：
- 插件给某个库创建的实例数据（如：本库的画板内容、本库的笔记元数据）
- 想跟随库搬走的数据
- 含敏感信息但不想被 WebDAV 同步（默认排除）

**两者都用**：
- 全局默认在 `storage`，但用户可以给单库配置 → 库级 override 在 `storage.scoped`

## 3. API 用法

```javascript
// 读
const v = await context.storage.scoped.get('myKey')
//   无库根 / 临时库 / 键不存在 → 返回 null
//   成功 → 返回存储的值

// 写
const ok = await context.storage.scoped.set('myKey', { lastRead: Date.now() })
//   无库根 / 临时库 → 返回 false
//   成功 → 返回 true
//   底层走 libraryPrivate.ts（500ms 防抖 + 原子写 + 跨进程锁）

// 删
const ok = await context.storage.scoped.remove('myKey')
//   无库根 / 临时库 → 返回 false
//   成功（无论键是否存在） → 返回 true
```

**优雅降级**：无库根或临时库时，**不抛错**，返回 `null` / `false`。插件可继续运行（只是数据不持久化）。

## 4. 完整示例

```javascript
// 激活时
async function onActivate() {
  const state = await context.storage.scoped.get('pluginState')
  if (state) {
    // 恢复上次的状态
  } else {
    // 首次使用,创建默认状态
    await context.storage.scoped.set('pluginState', {
      createdAt: Date.now(),
      lastOpened: null,
    })
  }
}

// 用户操作时
async function onUserAction() {
  const state = await context.storage.scoped.get('pluginState') || {}
  state.lastOpened = Date.now()
  await context.storage.scoped.set('pluginState', state)
}

// 用户清除数据时
async function onClearRequest() {
  await context.storage.scoped.remove('pluginState')
}
```

## 5. 数据隔离

- **不同插件互不干扰**：`<pluginId>` 段隔离，即使两个插件都用 `'canvasState'` 作 key
- **不同库互不干扰**：每个库独立 `local.json`，切库后看到的是该库的数据
- **WebDAV 不同步**：`local.json` 被默认排除（PR-1），凭据安全

## 6. v1.x 兼容性

**v1.x 插件**：`context.storage` 仍正常工作（向后兼容），不需要改动。

**v2.0 新插件**：可选择用 `scoped` 给单库数据持久化。

**迁移**：旧的 `context.storage` 数据**不**自动迁移到 `scoped`。用户切库时旧的全局数据仍存在；建议：
- 读取时 fallback：`scoped.get('k') ?? (await context.storage.get('k'))`
- 写入时双写：先 `scoped.set`，再 `storage.set` 作为兜底

## 7. 调试

**查看数据**：直接打开 `<库根>/.flymd/local.json`，找 `prefs.<你的插件 id>` 段。

**常见问题**：
- 写入返回 `false`？检查是否有持久化库激活（无库 / 临时库 → false）
- 读出来是 `null`？首次使用 / 库切换到从未写过的库 / 凭据文件损坏

## 8. 相关文档

- [库私有配置指南（用户角度）](./LIBRARY_PRIVATE_CONFIG_GUIDE.md)
- [插件开发主文档](../plugin.md#contextstoragescoped库作用域存储-v20)
