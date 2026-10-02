<template>
  <section class="page" data-module="bone">
    <header class="page-head">
      <div>
        <h2>骨骼标本管理</h2>
        <p class="page-desc">
          鉴定结论按归属鉴权：没有归属权限的标本只读，鉴定人只能维护自己名下的标本，跨单位改动拦下并写明原因；换人退样冲突由标本室定优先级。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出骨骼标本清单</button>
        <button class="btn ghost" type="button" @click="resetDemo">恢复演示数据</button>
      </div>
    </header>

    <div class="identity-bar">
      <span>当前身份：<strong>{{ session.identityLabel }}</strong></span>
      <span class="identity-rule">{{ identityRule }}</span>
      <label v-if="session.identity.kind === 'room'" class="priority-item">
        换人/退样冲突优先级（标本室设定）：
        <select :value="priority" @change="changePriority(($event.target as HTMLSelectElement).value as Priority)">
          <option value="退样优先">退样优先</option>
          <option value="换人优先">换人优先</option>
        </select>
      </label>
    </div>

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
          <th>待办申请</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td>
            <RouterLink class="link" :to="`/bone/${row.id}`">{{ row['标本编号'] }}</RouterLink>
          </td>
          <td v-for="column in columns.slice(1)" :key="column">{{ displayValue(row, column) }}</td>
          <td>
            <div v-if="getBoneRequests(row).length" class="request-list">
              <span
                v-for="request in getBoneRequests(row)"
                :key="request.type + request.at"
                class="badge request"
                :title="requestLabel(request)"
              >
                {{ request.type }}待办
              </span>
            </div>
            <span v-else>—</span>
          </td>
          <td>
            <span class="badge" :class="statusClass(row.status)">{{ row.status }}</span>
          </td>
          <td>
            <BoneActions :row="row" @done="onDone" />
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无骨骼标本数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条骨骼标本记录（编号与详情页一致）</span>
      <span v-if="message" :class="messageOk ? 'success-text' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries, moduleMeta } from '@/api/local-service'
import {
  boneConflictPriority,
  getBoneRequests,
  listBone,
  requestLabel,
  resetBoneDemo,
  setBoneConflictPriority,
} from '@/api/bone-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'
import BoneActions from './components/BoneActions.vue'

type Priority = '换人优先' | '退样优先'

const meta = moduleMeta('bone')
const columns = ['标本编号', '出土单位', '种属', '骨骼部位', '归属单位', '归属鉴定人', '年龄估计', '鉴定结论']
const statuses = ['待鉴定', '鉴定中', '已鉴定', '已退样']

const session = useSessionStore()
const rows = ref<EntryRow[]>([])
const total = ref(0)
const message = ref('')
const messageOk = ref(false)
const filters = ref<Record<string, string>>({})
const filterFields = ['标本编号', '种属', '归属单位', '归属鉴定人']
const priority = ref<Priority>('退样优先')

const stats = computed(() => [
  { label: '待鉴定标本', value: rows.value.filter((row) => row.status === '待鉴定').length },
  { label: '鉴定中标本', value: rows.value.filter((row) => row.status === '鉴定中').length },
  { label: '已鉴定标本', value: rows.value.filter((row) => row.status === '已鉴定').length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const identityRule = computed(() =>
  session.identity.kind === 'room'
    ? '可提出换人申请并裁决换人/退样待办，鉴定结论由归属鉴定人维护'
    : `只能维护归属${session.identity.name}名下的标本，其他标本只读`,
)

function displayValue(row: EntryRow, column: string): string {
  const value = String(row[column] ?? '').trim()
  if (!value || value === '不详' || value === '不明') {
    return value ? `${value}（待补）` : '—'
  }
  return value
}

function statusClass(status: string | number | boolean | string[]): string {
  const text = String(status)
  if (text === '已鉴定') return 'status-done'
  if (text === '已退样') return 'status-returned'
  return 'status-active'
}

function resetFilters() {
  filters.value = {}
  reload()
}

function changePriority(next: Priority) {
  const result = setBoneConflictPriority(next)
  priority.value = next
  flash(result.message, result.ok)
}

function exportRows() {
  downloadEntries(meta.key)
}

function resetDemo() {
  resetBoneDemo()
  reload()
  flash('骨骼标本已恢复为演示数据，由结论联动生成的测年待送检项已清理', true)
}

function onDone(text: string, ok: boolean) {
  flash(text, ok)
  reload()
}

function flash(text: string, ok: boolean) {
  message.value = text
  messageOk.value = ok
}

function reload() {
  message.value = ''
  rows.value = listBone(filters.value)
  total.value = rows.value.length
  priority.value = boneConflictPriority()
}

onMounted(reload)
</script>
