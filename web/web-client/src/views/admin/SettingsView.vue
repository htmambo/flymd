<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useAuthStore } from "@/stores/auth";
import { api, ApiError } from "@/services/api";
import type { PublicUser, Setting, SettingCategory } from "@/types/api";

const auth = useAuthStore();
const token = computed(() => auth.token || "");

const loading = ref(false);
const errorMsg = ref<string | null>(null);

const overview = ref<{ totalUsers: number; activeUsers: number; disabledUsers: number; totalSettings: number } | null>(null);
const users = ref<PublicUser[]>([]);
const settings = ref<Setting[]>([]);
const activeCategory = ref<SettingCategory>("ai");
const editingKey = ref<string | null>(null);
const editValue = ref<unknown>(null);
const editDescription = ref<string>("");
const editVisibility = ref<"admin" | "user" | "public">("admin");
const editDirty = ref(false);
const saving = ref(false);
const savingKey = ref<string | null>(null);

const categoryLabels: Record<SettingCategory, { title: string; icon: string; desc: string }> = {
  ai:     { title: "AI 配置",     icon: "🤖", desc: "LLM 服务商、模型、temperature 等" },
  apikey: { title: "API_KEY",     icon: "🔑", desc: "第三方服务的密钥管理" },
  system: { title: "系统设置",   icon: "⚙", desc: "服务器级配置" },
  user:   { title: "用户偏好",   icon: "👤", desc: "面向普通用户的设置" },
};

const filtered = computed(() => settings.value.filter((s) => s.category === activeCategory.value));
const isAdmin = computed(() => auth.isAdmin);

async function loadAll() {
  if (!token.value) return;
  loading.value = true;
  errorMsg.value = null;
  try {
    const [ov, us, st] = await Promise.all([
      api.adminOverview(token.value).catch(() => null),
      api.adminUsers(token.value).catch(() => []),
      api.adminSettings(token.value, { unmask: false }).catch((e) => {
        if (e instanceof ApiError && e.status === 403) return []
        throw e
      }),
    ]);
    overview.value = ov;
    users.value = us || [];
    settings.value = st || [];
  } catch (e) {
    errorMsg.value = e instanceof ApiError ? e.message : (e as Error)?.message || "加载失败";
  } finally {
    loading.value = false;
  }
}

function startEdit(s: Setting) {
  editingKey.value = s.key
  editValue.value = JSON.parse(JSON.stringify(s.value))
  editDescription.value = s.description || ""
  editVisibility.value = s.visibility
  editDirty.value = false
}

function startNew() {
  const cat = activeCategory.value
  const newKey = `${cat}.new.${Date.now().toString(36).slice(-4)}`
  editingKey.value = newKey
  editValue.value = cat === "ai" || cat === "apikey" ? { provider: "openai", apiKey: "" } : { enabled: true }
  editDescription.value = ""
  editVisibility.value = "admin"
  editDirty.value = true  // 新建直接进保存分支
}

function markDirty() { editDirty.value = true }

async function save() {
  if (!editingKey.value) return
  saving.value = true
  savingKey.value = editingKey.value
  try {
    const isNew = !settings.value.find((s) => s.key === editingKey.value)
    await api.adminUpsertSetting(token.value, {
      key: editingKey.value,
      value: editValue.value,
      category: activeCategory.value,
      visibility: editVisibility.value,
      description: editDescription.value || undefined,
    })
    await loadAll()
    if (isNew) {
      // 新建保留编辑,允许继续添加同类
    } else {
      cancelEdit()
    }
  } catch (e) {
    errorMsg.value = e instanceof ApiError ? e.message : (e as Error)?.message || "保存失败"
  } finally {
    saving.value = false
    savingKey.value = null
  }
}

function cancelEdit() {
  editingKey.value = null
  editValue.value = null
  editDirty.value = false
}

async function remove(s: Setting) {
  if (!confirm(`确认删除 "${s.key}" ?`)) return
  try {
    await api.adminDeleteSetting(token.value, s.key)
    await loadAll()
  } catch (e) {
    errorMsg.value = e instanceof ApiError ? e.message : (e as Error)?.message || "删除失败"
  }
}

function valueAsString(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "string") return v
  return JSON.stringify(v, null, 2)
}

function setEditValueFromString(s: string) {
  try {
    editValue.value = JSON.parse(s)
  } catch {
    editValue.value = s
  }
}

async function updateUserRole(u: PublicUser, role: "admin" | "user") {
  try {
    await api.adminUpdateUser(token.value, u.id, { role })
    await loadAll()
  } catch (e) {
    errorMsg.value = e instanceof ApiError ? e.message : "更新失败"
  }
}
async function toggleUserStatus(u: PublicUser) {
  const status = u.status === "active" ? "disabled" : "active"
  if (!confirm(`确认将 ${u.email} 设为 ${status === "active" ? "启用" : "禁用"} ?`)) return
  try {
    await api.adminUpdateUser(token.value, u.id, { status })
    await loadAll()
  } catch (e) {
    errorMsg.value = e instanceof ApiError ? e.message : "更新失败"
  }
}

onMounted(loadAll)
</script>

<template>
  <div class="settings-page">
    <header class="page-header">
      <div>
        <h1>系统设置</h1>
        <p class="muted">管理 AI 服务商、API_KEY、用户与系统级配置</p>
      </div>
      <button v-if="isAdmin" class="btn btn-primary" @click="loadAll" :disabled="loading">
        {{ loading ? "加载中…" : "刷新" }}
      </button>
    </header>

    <div v-if="errorMsg" class="error-banner">{{ errorMsg }}</div>

    <section v-if="overview" class="stats">
      <div class="stat-card hover-card"><div class="stat-num">{{ overview.totalUsers }}</div><div class="muted">总用户</div></div>
      <div class="stat-card hover-card"><div class="stat-num">{{ overview.activeUsers }}</div><div class="muted">活跃</div></div>
      <div class="stat-card hover-card"><div class="stat-num">{{ overview.disabledUsers }}</div><div class="muted">已禁用</div></div>
      <div class="stat-card hover-card"><div class="stat-num">{{ overview.totalSettings }}</div><div class="muted">设置项</div></div>
    </section>

    <div class="tabs">
      <button
        v-for="(label, key) in categoryLabels"
        :key="key"
        :class="['tab', { active: activeCategory === key }]"
        @click="activeCategory = key as SettingCategory"
      >
        <span class="tab-icon">{{ label.icon }}</span>
        <span>{{ label.title }}</span>
        <span class="tab-count">{{ settings.filter((s) => s.category === key).length }}</span>
      </button>
    </div>

    <section class="content-section hover-card">
      <div class="section-header">
        <h2>{{ categoryLabels[activeCategory].title }}</h2>
        <p class="muted">{{ categoryLabels[activeCategory].desc }}</p>
        <button v-if="isAdmin && !editingKey" class="btn btn-primary" @click="startNew">+ 新增</button>
      </div>

      <!-- 编辑器 -->
      <div v-if="editingKey" class="editor card hover-card hover-card-glow">
        <div class="editor-header">
          <div>
            <div class="muted small">key</div>
            <div class="mono">{{ editingKey }}</div>
          </div>
          <div class="editor-actions">
            <button class="btn-ghost" @click="cancelEdit">取消</button>
            <button class="btn btn-primary" :disabled="!editDirty || saving" @click="save">
              {{ saving && savingKey === editingKey ? "保存中…" : "保存" }}
            </button>
          </div>
        </div>
        <div class="editor-grid">
          <div>
            <label>value (JSON)</label>
            <textarea
              rows="10"
              :value="valueAsString(editValue)"
              @input="(e) => { setEditValueFromString((e.target as HTMLTextAreaElement).value); markDirty() }"
              spellcheck="false"
            ></textarea>
          </div>
          <div>
            <label>描述</label>
            <input v-model="editDescription" @input="markDirty" placeholder="可选" />
            <label style="margin-top:12px;">可见性</label>
            <select v-model="editVisibility" @change="markDirty">
              <option value="admin">仅管理员</option>
              <option value="user">所有登录用户</option>
              <option value="public">公开</option>
            </select>
          </div>
        </div>
      </div>

      <!-- 列表 -->
      <div v-if="filtered.length === 0 && !editingKey" class="empty muted">
        当前分类下还没有设置项,点击「+ 新增」添加
      </div>
      <table v-else-if="!editingKey" class="settings-table">
        <thead>
          <tr>
            <th>Key</th>
            <th>Value</th>
            <th>可见性</th>
            <th>更新时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in filtered" :key="s.key" class="hover-row">
            <td class="mono">{{ s.key }}</td>
            <td class="value-cell">
              <code>{{ valueAsString(s.value).slice(0, 120) }}</code>
            </td>
            <td><span :class="['pill', s.visibility]">{{ s.visibility }}</span></td>
            <td class="muted small">{{ new Date(s.updatedAt * 1000).toLocaleString() }}</td>
            <td class="actions">
              <button v-if="isAdmin" class="btn-ghost" @click="startEdit(s)">编辑</button>
              <button v-if="isAdmin" class="btn-ghost danger" @click="remove(s)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="isAdmin" class="content-section hover-card">
      <div class="section-header">
        <h2>用户管理</h2>
        <p class="muted">管理注册用户角色与状态</p>
      </div>
      <table class="settings-table">
        <thead>
          <tr>
            <th>邮箱</th>
            <th>昵称</th>
            <th>角色</th>
            <th>状态</th>
            <th>注册时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id" class="hover-row">
            <td class="mono">{{ u.email }}</td>
            <td>{{ u.nickname }}</td>
            <td>
              <select :value="u.role" @change="(e) => updateUserRole(u, (e.target as HTMLSelectElement).value as 'admin' | 'user')">
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </td>
            <td>
              <span :class="['pill', u.status]">{{ u.status }}</span>
            </td>
            <td class="muted small">{{ new Date(u.createdAt * 1000).toLocaleString() }}</td>
            <td class="actions">
              <button v-if="u.id !== auth.user?.id" class="btn-ghost" @click="toggleUserStatus(u)">
                {{ u.status === "active" ? "禁用" : "启用" }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.settings-page { max-width: 1100px; margin: 0 auto; }
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}
.page-header h1 { margin: 0 0 4px; font-size: 22px; }
.muted { color: var(--muted); }
.small { font-size: 12px; }
.error-banner {
  padding: 10px 14px;
  background: rgba(220, 38, 38, 0.1);
  border: 1px solid var(--danger);
  border-radius: 6px;
  margin-bottom: 16px;
  color: var(--danger);
}
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-bottom: 24px; }
.stat-card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 14px 18px; }
.stat-num { font-size: 22px; font-weight: 700; }
.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin-bottom: 20px; flex-wrap: wrap; }
.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  color: var(--muted);
  font-size: 14px;
  cursor: pointer;
}
.tab:hover { color: var(--fg); }
.tab.active { color: var(--accent); border-bottom-color: var(--accent); font-weight: 600; }
.tab-icon { font-size: 16px; }
.tab-count { background: var(--bg); padding: 1px 6px; border-radius: 8px; font-size: 11px; }
.content-section { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 20px; margin-bottom: 20px; }
.section-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.section-header h2 { margin: 0; font-size: 18px; }
.section-header p { margin: 4px 0 0; font-size: 13px; flex: 1; }
.editor { margin-bottom: 16px; }
.editor-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.editor-actions { display: flex; gap: 8px; }
.editor-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; }
.editor-grid label { margin-top: 0; }
.editor-grid textarea { font-family: ui-monospace, "Cascadia Code", monospace; font-size: 12px; }
.mono { font-family: ui-monospace, "Cascadia Code", monospace; font-size: 13px; }
.empty { padding: 40px; text-align: center; }
.settings-table { width: 100%; border-collapse: collapse; }
.settings-table th, .settings-table td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); font-size: 13px; }
.settings-table th { font-weight: 600; color: var(--muted); font-size: 12px; text-transform: uppercase; }
.settings-table code { background: var(--bg); padding: 2px 6px; border-radius: 4px; font-size: 12px; }
.value-cell { max-width: 480px; overflow: hidden; text-overflow: ellipsis; }
.actions { display: flex; gap: 4px; }
.btn-ghost { background: transparent; border: 0; color: var(--accent); padding: 4px 8px; font-size: 13px; }
.btn-ghost:hover { background: var(--border); }
.btn-ghost.danger { color: var(--danger); }
.pill { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 11px; background: var(--bg); border: 1px solid var(--border); }
.pill.admin { background: rgba(124, 58, 237, 0.1); color: #7c3aed; border-color: #7c3aed; }
.pill.public { background: rgba(34, 197, 94, 0.1); color: var(--success); border-color: var(--success); }
.pill.active { background: rgba(34, 197, 94, 0.1); color: var(--success); border-color: var(--success); }
.pill.disabled { background: rgba(220, 38, 38, 0.1); color: var(--danger); border-color: var(--danger); }
</style>
