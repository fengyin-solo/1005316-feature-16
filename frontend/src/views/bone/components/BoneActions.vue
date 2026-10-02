<template>
  <span class="row-actions">
    <button
      v-for="item in actionStates"
      :key="item.action"
      class="link"
      :disabled="!item.enabled"
      :title="item.enabled ? '' : item.reason"
      type="button"
      @click="trigger(item)"
    >
      {{ item.action }}
    </button>

    <!-- 出具结论：种属/部位经服务层校验通过后才会落库，这里只负责录入结论文本 -->
    <div v-if="conclusionOpen" class="modal-mask" @click.self="conclusionOpen = false">
      <div class="modal-card">
        <h3>为 {{ current?.['标本编号'] }} 出具鉴定结论</h3>
        <p class="modal-hint">
          种属「{{ current?.['种属'] }}」· 骨骼部位「{{ current?.['骨骼部位'] }}」。结论出具后将在测年送检清单生成待送检项。
        </p>
        <textarea
          v-model="conclusionText"
          class="modal-textarea"
          rows="4"
          placeholder="请填写鉴定结论，例如：成年个体，性别倾向雄性，骨表无明显病理现象"
        ></textarea>
        <footer class="modal-foot">
          <button class="btn ghost" type="button" @click="conclusionOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitConclusion">出具结论</button>
        </footer>
      </div>
    </div>

    <!-- 换人：标本室指定接手的鉴定人，跨单位/同单位都可选，最终归属由裁决定 -->
    <div v-if="reassignOpen" class="modal-mask" @click.self="reassignOpen = false">
      <div class="modal-card">
        <h3>为 {{ current?.['标本编号'] }} 办理换人</h3>
        <p class="modal-hint">当前归属：{{ current?.['归属单位'] || '未归属' }} · {{ current?.['归属鉴定人'] || '未归属' }}</p>
        <label class="modal-field">
          <span>接手鉴定人</span>
          <select v-model="targetKey">
            <option value="" disabled>请选择接手鉴定人</option>
            <option v-for="person in identifierChoices" :key="person.key" :value="person.key">
              {{ person.unit }} · {{ person.name }}
            </option>
          </select>
        </label>
        <footer class="modal-foot">
          <button class="btn ghost" type="button" @click="reassignOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitReassign">提交换人申请</button>
        </footer>
      </div>
    </div>
  </span>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { boneActions, runBoneAction } from '@/api/bone-service'
import type { EntryRow } from '@/data/types'
import { IDENTITIES, useSessionStore } from '@/stores/session'

const props = defineProps<{ row: EntryRow }>()
const emit = defineEmits<{ (e: 'done', message: string, ok: boolean): void }>()

const session = useSessionStore()

const actionStates = computed(() => boneActions(props.row, session.identity))

const conclusionOpen = ref(false)
const conclusionText = ref('')
const reassignOpen = ref(false)
const targetKey = ref('')
const current = ref<EntryRow>(props.row)

const identifierChoices = IDENTITIES.filter((item) => item.kind === 'identifier').map((item) => ({
  key: `${item.kind === 'identifier' ? item.unit : ''}::${item.kind === 'identifier' ? item.name : ''}`,
  unit: item.kind === 'identifier' ? item.unit : '',
  name: item.kind === 'identifier' ? item.name : '',
}))

function trigger(item: { action: string; enabled: boolean; reason: string }) {
  if (!item.enabled) {
    emit('done', item.reason, false)
    return
  }
  if (item.action === '出具结论') {
    current.value = props.row
    conclusionText.value = String(props.row['鉴定结论'] ?? '')
    conclusionOpen.value = true
    return
  }
  if (item.action === '换人申请') {
    current.value = props.row
    targetKey.value = ''
    reassignOpen.value = true
    return
  }
  const result = runBoneAction(Number(props.row.id), item.action, session.identity)
  emit('done', result.message, result.ok)
}

function submitConclusion() {
  const result = runBoneAction(Number(props.row.id), '出具结论', session.identity, {
    conclusion: conclusionText.value,
  })
  conclusionOpen.value = false
  emit('done', result.message, result.ok)
}

function submitReassign() {
  const [unit, name] = targetKey.value.split('::')
  const result = runBoneAction(Number(props.row.id), '换人申请', session.identity, {
    target: { unit, name },
  })
  reassignOpen.value = false
  emit('done', result.message, result.ok)
}
</script>
