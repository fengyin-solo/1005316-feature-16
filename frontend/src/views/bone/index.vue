<template>
  <section class="page" data-module="bone">
    <header class="page-head">
      <div>
        <h2>骨骼标本管理</h2>
        <p class="page-desc">鉴定结论按鉴定人归属：没有归属权限的标本只读，只能看不能改；鉴定人仅维护自己名下标本，跨单位改动一律拦下。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出骨骼标本清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item warn">待标本室办理：{{ pendingCount }}</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>归属 / 待办</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ readonly: access(row).readonly }">
          <td>
            <RouterLink class="link specimen-code" :to="`/bone/${row.id}`">{{ row['标本编号'] }}</RouterLink>
          </td>
          <td v-for="column in columns.slice(1)" :key="column">{{ row[column] || '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="owner-cell">
            <template v-if="row['归属鉴定人']">
              {{ row['归属鉴定人'] }}<span class="owner-unit">（{{ row['归属单位'] }}）</span>
            </template>
            <span v-else class="muted-text">未归属·只读</span>
            <div v-if="row['退样申请'] === true" class="badge warn">退样申请待办理</div>
            <div v-if="String(row['换人申请'] ?? '').trim()" class="badge info">
              换人申请：{{ row['换人申请'] }}
            </div>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">查看 / 鉴定</button>
            <button
              v-if="canProcess(row) || hasPending(row)"
              class="link"
              :class="{ disabled: !canProcess(row) }"
              type="button"
              @click="openDetail(row)"
            >
              {{ hasPending(row) ? '办理申请' : '' }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无符合条件的骨骼标本</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条骨骼标本记录；列表与详情页的标本编号取自同一条记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { downloadEntries, listEntries, moduleMeta } from '@/api/local-service'
import { pendingRequestCount } from '@/api/bone-service'
import { STAFF_BY_NAME } from '@/data/staff'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('bone')
// 列表不直接展示结论文本，结论在详情页维护；编号列与详情页同源。
const columns = ["标本编号", "出土单位", "种属", "骨骼部位", "年龄估计", "鉴定状态"]
const statuses = ["待鉴定", "鉴定中", "已鉴定"]

const router = useRouter()
const store = useSessionStore()

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ["标本编号", "出土单位", "种属"]

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const stats = computed(() => [
  { label: '待鉴定标本', value: rows.value.filter((row) => row.status === '待鉴定').length },
  { label: '鉴定中标本', value: rows.value.filter((row) => row.status === '鉴定中').length },
  { label: '已鉴定标本', value: rows.value.filter((row) => row.status === '已鉴定').length },
])
const pendingCount = computed(() => pendingRequestCount(rows.value))

function currentStaff() {
  return STAFF_BY_NAME.get(store.operator)!
}

// 只读口径与详情页一致：非标本室且非名下鉴定人，一律只读。
function access(row: EntryRow): { readonly: boolean; reason: string } {
  const staff = currentStaff()
  if (staff.role === '标本室') return { readonly: false, reason: '' }
  const owner = String(row['归属鉴定人'] ?? '').trim()
  if (owner === '') {
    return { readonly: true, reason: '该标本尚未归属鉴定人，当前只读，可以查看但不能改' }
  }
  if (owner !== staff.name) {
    const ownerUnit = String(row['归属单位'] ?? '').trim()
    const reason =
      ownerUnit && ownerUnit !== staff.unit
        ? `跨单位改动被拒：标本归属${ownerUnit}·${owner}，${staff.unit}·${staff.name} 无权改动`
        : `该标本归属 ${owner}，鉴定人只能维护自己名下标本`
    return { readonly: true, reason }
  }
  return { readonly: false, reason: '' }
}

function hasPending(row: EntryRow): boolean {
  return row['退样申请'] === true || String(row['换人申请'] ?? '').trim() !== ''
}

function canProcess(row: EntryRow): boolean {
  return store.isLab && hasPending(row)
}

function openDetail(row: EntryRow) {
  if (canProcess(row) || !hasPending(row)) {
    router.push(`/bone/${row.id}`)
    return
  }
  if (hasPending(row) && !store.isLab) {
    errorMessage.value = `标本 ${row['标本编号']} 的换人/退样申请由标本室办理，当前身份「${store.operator}」无权裁决。`
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '骨骼标本列表读取失败'
  }
}

onMounted(reload)
</script>
