<template>
  <section class="page" data-module="bone-detail">
    <header class="page-head">
      <div>
        <h2>骨骼标本详情</h2>
        <p class="page-desc">
          编号取自骨骼标本清单同一条记录，与列表页完全一致。没有归属权限时本页只读：可以看，不能改。
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/bone">返回列表</RouterLink>
      </div>
    </header>

    <div v-if="!row" class="empty-state detail-empty">
      没有找到编号为 {{ route.params.id }} 的骨骼标本，请从列表页选择标本进入。
    </div>

    <template v-else>
      <div class="identity-bar">
        <span>当前身份：<strong>{{ session.identityLabel }}</strong></span>
        <span class="identity-rule">{{ access.editable ? '你可以维护这条标本' : access.reason }}</span>
      </div>

      <article class="detail-card">
        <h3 class="detail-code">{{ row['标本编号'] }}</h3>
        <dl class="detail-grid">
          <template v-for="field in detailFields" :key="field">
            <dt>{{ field }}</dt>
            <dd :class="{ 'field-missing': isMissing(row[field]) }">{{ valueText(row[field]) }}</dd>
          </template>
          <dt>当前状态</dt>
          <dd><span class="badge" :class="statusClass(row.status)">{{ row.status }}</span></dd>
        </dl>
      </article>

      <article class="detail-card">
        <h3>待办与裁决</h3>
        <p v-if="!requests.length" class="page-desc">暂无换人或退样待办。</p>
        <ul v-else class="request-log">
          <li v-for="request in requests" :key="request.type + request.at">
            <span class="badge request">{{ request.type }}</span>
            <span>{{ requestLabel(request) }}</span>
          </li>
        </ul>
        <p class="page-desc">
          换人、退样撞在一起时，标本室当前优先级：<strong>{{ priority }}</strong>。
        </p>
        <div class="detail-actions">
          <BoneActions :row="row" @done="onDone" />
        </div>
      </article>

      <article class="detail-card">
        <h3>处理记录</h3>
        <ul v-if="decisionLog.length" class="request-log">
          <li v-for="(line, index) in decisionLog" :key="index">{{ line }}</li>
        </ul>
        <p v-else class="page-desc">暂无处理记录。</p>
      </article>

      <footer class="page-foot">
        <span>本页编号与列表页同源：{{ row['标本编号'] }}</span>
        <span v-if="message" :class="messageOk ? 'success-text' : 'error-text'">{{ message }}</span>
      </footer>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

import {
  boneAccess,
  boneConflictPriority,
  getBone,
  getBoneDecisionLog,
  getBoneRequests,
  requestLabel,
} from '@/api/bone-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'
import BoneActions from './components/BoneActions.vue'

const route = useRoute()
const session = useSessionStore()

const detailFields = [
  '出土单位',
  '种属',
  '骨骼部位',
  '归属单位',
  '归属鉴定人',
  '年龄估计',
  '鉴定结论',
  '鉴定状态',
]
const MISSING = ['', '不详', '不明', '未知', '未定', '待补']

const version = ref(0)
const message = ref('')
const messageOk = ref(false)

const id = computed(() => Number(route.params.id))
// 详情与列表走同一条数据记录；version 变化时重新读取，保证动作后页面刷新。
const row = computed<EntryRow | undefined>(() => {
  void version.value
  return getBone(id.value)
})

const access = computed(() =>
  row.value
    ? boneAccess(row.value, session.identity)
    : { editable: false, reason: '标本不存在' },
)
const requests = computed(() => (row.value ? getBoneRequests(row.value) : []))
const decisionLog = computed(() => (row.value ? getBoneDecisionLog(row.value) : []))
const priority = computed(() => boneConflictPriority())

function isMissing(value: unknown): boolean {
  return MISSING.includes(String(value ?? '').trim())
}

function valueText(value: unknown): string {
  const text = String(value ?? '').trim()
  return text || '—'
}

function statusClass(status: unknown): string {
  const text = String(status)
  if (text === '已鉴定') return 'status-done'
  if (text === '已退样') return 'status-returned'
  return 'status-active'
}

function onDone(text: string, ok: boolean) {
  message.value = text
  messageOk.value = ok
  version.value += 1
}
</script>
