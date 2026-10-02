<template>
  <div class="app-shell">
    <aside class="app-side">
      <h1 class="app-title">考古发掘现场记录与出土物整理工作台</h1>
      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item">
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>
    <main class="app-main">
      <header class="app-head">
        <span class="head-desc">面向探方发掘进度、地层堆积编录、遗迹单位登记、出土物整理与检测送样的一体化田野考古记录工作台。</span>
        <label class="head-user">
          当前身份：
          <select class="operator-select" :value="store.operator" @change="switchOperator">
            <option v-for="item in staffs" :key="item.name" :value="item.name">
              {{ item.name }} · {{ item.unit }} · {{ item.role }}
            </option>
          </select>
        </label>
      </header>
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { useSessionStore } from '@/stores/session'
import { STAFFS } from '@/data/staff'

const store = useSessionStore()
const staffs = STAFFS

function switchOperator(event: Event) {
  store.setOperator((event.target as HTMLSelectElement).value)
}

const navItems = [{ label: "运营概览", path: "/" }, { label: "探方登记", path: "/trench" }, { label: "地层堆积", path: "/stratum" }, { label: "遗迹单位", path: "/feature" }, { label: "出土物登记", path: "/find" }, { label: "陶片拼对", path: "/sherd" }, { label: "骨骼标本", path: "/bone" }, { label: "浮选样品", path: "/flotation" }, { label: "测年送检", path: "/dating" }, { label: "测绘控制点", path: "/survey" }, { label: "影像资料", path: "/photo" }, { label: "发掘日记", path: "/diary" }, { label: "用工派工", path: "/labor" }, { label: "工具领用", path: "/tool" }, { label: "安全巡查", path: "/safety" }, { label: "样品封装", path: "/packing" }, { label: "标本修复", path: "/conserve" }, { label: "简报校核", path: "/briefing" }, { label: "探方验收", path: "/acceptance" }]
</script>
