<template>
  <section class="page bone-detail" v-if="row">
    <header class="page-head">
      <div>
        <h2>骨骼标本 {{ row['标本编号'] }}</h2>
        <p class="page-desc">
          编号与列表页同源一致；
          <template v-if="access.readonly">
            <span class="error-text">{{ access.reason }}。</span>
          </template>
          <template v-else>当前由 {{ store.operator }}（{{ store.unit }}）维护。</template>
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn ghost" to="/bone">返回列表</RouterLink>
      </div>
    </header>

    <div class="detail-grid">
      <article class="detail-card readonly-card">
        <h3>归属与流转</h3>
        <dl class="kv">
          <div><dt>标本编号</dt><dd class="specimen-code">{{ row['标本编号'] }}</dd></div>
          <div><dt>当前状态</dt><dd>{{ row.status }}</dd></div>
          <div><dt>归属鉴定人</dt><dd>{{ row['归属鉴定人'] || '未归属（只读）' }}</dd></div>
          <div><dt>归属单位</dt><dd>{{ row['归属单位'] || '—' }}</dd></div>
          <div><dt>结论日期</dt><dd>{{ row['结论日期'] || '—' }}</dd></div>
          <div><dt>待办申请</dt><dd>
            <span v-if="row['退样申请'] === true" class="badge warn">退样申请待办理</span>
            <span v-if="String(row['换人申请'] ?? '').trim()" class="badge info">换人申请：{{ row['换人申请'] }}</span>
            <span v-if="!hasPending" class="muted-text">无</span>
          </dd></div>
        </dl>
        <div v-if="store.isLab" class="policy-box">
          <span>标本室冲突裁决口径（换人、退样撞车时按此只办一项）：</span>
          <label class="radio-line">
            <input type="radio" value="退样优先" v-model="policy" @change="savePolicy" /> 退样优先
          </label>
          <label class="radio-line">
            <input type="radio" value="换人优先" v-model="policy" @change="savePolicy" /> 换人优先
          </label>
        </div>
      </article>

      <article class="detail-card">
        <h3>鉴定信息</h3>
        <form class="bone-form" @submit.prevent>
          <label v-for="field in editableFields" :key="field" class="form-item">
            <span>{{ field }}</span>
            <input
              v-model="form[field]"
              :disabled="access.readonly || !canEdit"
              :placeholder="field === '年龄估计' ? '退回待鉴定时该值原样保留' : `填写${field}`"
            />
          </label>
          <label class="form-item full">
            <span>鉴定结论</span>
            <textarea
              v-model="form['鉴定结论']"
              rows="3"
              :disabled="access.readonly || !canEdit"
              placeholder="种属或骨骼部位不全时不许出具结论"
            ></textarea>
          </label>
          <p class="form-hint">
            校验规则：缺种属、骨骼部位不全或结论为空，都不允许出具鉴定结论；补齐种属后才能送检。
          </p>
          <div class="form-actions">
            <button class="btn" type="button" :disabled="access.readonly || !canEdit" @click="saveDraftForm">
              保存鉴定信息
            </button>
            <button
              v-if="row.status === '待鉴定' && !access.readonly && store.role === '鉴定人'"
              class="btn" type="button" @click="claim"
            >
              提交鉴定（认领到我名下）
            </button>
            <button class="btn primary" type="button" :disabled="access.readonly || !canEdit" @click="conclude">
              出具结论并生成待送检项
            </button>
          </div>
        </form>
      </article>

      <article class="detail-card">
        <h3>换人与退样</h3>
        <p class="form-hint">换人、退样均先提交申请，由标本室办理；两项撞车时按左侧口径裁决，未胜出的申请继续挂起。</p>
        <div class="form-actions wrap">
          <label class="inline-select">
            <span>换人给</span>
            <select v-model="reassignTarget" :disabled="access.readonly || !canEdit || row.status !== '鉴定中'">
              <option value="">请选择鉴定人</option>
              <option v-for="item in candidates" :key="item.name" :value="item.name">
                {{ item.name }}（{{ item.unit }}）
              </option>
            </select>
          </label>
          <button
            class="btn" type="button"
            :disabled="access.readonly || !canEdit || row.status !== '鉴定中' || !reassignTarget || hasPending"
            @click="requestReassign"
          >
            申请换人
          </button>
          <button
            class="btn" type="button"
            :disabled="access.readonly || !canEdit || row.status !== '鉴定中' || hasPending"
            @click="requestReturn"
          >
            申请退样
          </button>
        </div>

        <div v-if="store.isLab && hasPending" class="process-box">
          <h4>标本室办理</h4>
          <p v-if="bothPending" class="warn-text">
            换人（{{ row['换人申请'] }}）与退样申请撞在一起，将按「{{ policy }}」办理，另一项继续挂起。
          </p>
          <button class="btn primary" type="button" @click="process">按{{ policy }}办理此标本</button>
        </div>
        <p v-else-if="hasPending" class="form-hint">当前身份为鉴定人，申请需等待标本室办理。</p>
      </article>
    </div>

    <footer class="page-foot">
      <span v-if="lastOk" class="ok-text">{{ lastOk }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import {
  claimBone,
  concludeBone,
  processRequest,
  reassignCandidates,
  requestReassign as applyReassign,
  requestReturn as applyReturn,
  saveDraft,
  type ConflictPolicy,
} from '@/api/bone-service'
import { listEntries } from '@/api/local-service'
import { STAFF_BY_NAME } from '@/data/staff'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const EDITABLE = ["出土单位", "种属", "骨骼部位", "可鉴定性别", "年龄估计", "病理现象", "鉴定结论"] as const
type EditableField = (typeof EDITABLE)[number]

const route = useRoute()
const store = useSessionStore()

const row = ref<EntryRow | null>(null)
const errorMessage = ref('')
const lastOk = ref('')
const reassignTarget = ref('')
const policy = ref<ConflictPolicy>(store.conflictPolicy)

const form = reactive<Record<EditableField, string>>({
  出土单位: '',
  种属: '',
  骨骼部位: '',
  可鉴定性别: '',
  年龄估计: '',
  病理现象: '',
  鉴定结论: '',
})

const editableFields = EDITABLE.slice(0, 6)

const candidates = computed(() =>
  reassignCandidates(String(row.value?.['归属鉴定人'] ?? '')),
)
const canEdit = computed(() => String(row.value?.status ?? '') !== '已鉴定')
const hasPending = computed(() =>
  row.value ? row.value['退样申请'] === true || String(row.value['换人申请'] ?? '').trim() !== '' : false,
)
const bothPending = computed(
  () => row.value?.['退样申请'] === true && String(row.value?.['换人申请'] ?? '').trim() !== '',
)

const access = computed(() => {
  if (!row.value) return { readonly: true, reason: '标本不存在' }
  const staff = STAFF_BY_NAME.get(store.operator)!
  if (staff.role === '标本室') return { readonly: false, reason: '' }
  const owner = String(row.value['归属鉴定人'] ?? '').trim()
  if (owner === '') {
    return { readonly: true, reason: '该标本尚未归属鉴定人，只能查看不能改' }
  }
  if (owner !== staff.name) {
    const ownerUnit = String(row.value['归属单位'] ?? '').trim()
    if (ownerUnit && ownerUnit !== staff.unit) {
      return { readonly: true, reason: `跨单位改动将被拒（归属${ownerUnit}·${owner}）` }
    }
    return { readonly: true, reason: `该标本归属 ${owner}，你只能维护自己名下标本` }
  }
  return { readonly: false, reason: '' }
})

watch(row, (value) => {
  if (!value) return
  for (const field of EDITABLE) {
    form[field] = String(value[field] ?? '')
  }
}, { immediate: true })

function staff() {
  return STAFF_BY_NAME.get(store.operator)!
}

function reload() {
  errorMessage.value = ''
  lastOk.value = ''
  const id = Number(route.params.id)
  const found = listEntries('bone').items.find((item) => Number(item.id) === id)
  if (!found) {
    row.value = null
    errorMessage.value = `没有找到编号为 ${id} 的骨骼标本`
    return
  }
  row.value = found
}

function handle(result: { ok: boolean; message: string }) {
  if (result.ok) {
    lastOk.value = result.message
    errorMessage.value = ''
  } else {
    errorMessage.value = result.message
    lastOk.value = ''
  }
  reload()
}

function savePolicy() {
  store.setConflictPolicy(policy.value)
}

function claim() {
  handle(claimBone(Number(row.value!.id), staff()))
}

function saveDraftForm() {
  handle(saveDraft(Number(row.value!.id), { operator: staff(), fields: { ...form } }))
}

function conclude() {
  handle(concludeBone(Number(row.value!.id), form['鉴定结论'], staff()))
}

function requestReturn() {
  handle(applyReturn(Number(row.value!.id), staff()))
}

function requestReassign() {
  handle(applyReassign(Number(row.value!.id), reassignTarget.value, staff()))
}

function process() {
  handle(processRequest(Number(row.value!.id), policy.value))
}

onMounted(reload)
</script>
