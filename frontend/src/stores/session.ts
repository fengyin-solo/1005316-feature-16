import { defineStore } from 'pinia'

import { STAFF_BY_NAME } from '@/data/staff'

// 换人申请与退样申请撞在一起时，由标本室定优先级；此处只登记标本室的裁决口径。
export type ConflictPolicy = '退样优先' | '换人优先'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '张明',
    shiftLabel: '白班 08:00-20:00',
    scope: '考古发掘现场记录与出土物整理工作台',
    conflictPolicy: '退样优先' as ConflictPolicy,
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    unit(): string {
      return STAFF_BY_NAME.get(this.operator)?.unit ?? ''
    },
    role(): string {
      return STAFF_BY_NAME.get(this.operator)?.role ?? ''
    },
    isLab(): boolean {
      return this.role === '标本室'
    },
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setOperator(name: string) {
      this.operator = name
    },
    setConflictPolicy(policy: ConflictPolicy) {
      this.conflictPolicy = policy
    },
  },
})
