import { defineStore } from 'pinia'

// 身份只有两类：标本室（管归属、换人退样裁决），或某个单位的鉴定人（只能动自己名下标本）。
export type Identity =
  | { kind: 'room'; name: string }
  | { kind: 'identifier'; name: string; unit: string }

const IDENTITY_KEY = 'archaeology-field:identity'

const PRESET_IDENTITIES: Identity[] = [
  { kind: 'room', name: '标本室值班员' },
  { kind: 'identifier', name: '周鉴定', unit: '第一考古队' },
  { kind: 'identifier', name: '吴鉴定', unit: '第一考古队' },
  { kind: 'identifier', name: '郑鉴定', unit: '第二考古队' },
  { kind: 'identifier', name: '王鉴定', unit: '动物考古实验室' },
]

function restoreIdentity(): Identity {
  if (typeof window !== 'undefined' && window.localStorage) {
    const raw = window.localStorage.getItem(IDENTITY_KEY)
    if (raw) {
      try {
        return JSON.parse(raw) as Identity
      } catch {
        // 落回默认身份
      }
    }
  }
  return PRESET_IDENTITIES[0]
}

export const IDENTITIES = PRESET_IDENTITIES

export function identityLabel(identity: Identity): string {
  return identity.kind === 'room'
    ? identity.name
    : `${identity.name}（${identity.unit}）`
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '考古发掘现场记录与出土物整理工作台',
    identity: restoreIdentity() as Identity,
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    identityLabel: (state) => identityLabel(state.identity),
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setIdentity(identity: Identity) {
      this.identity = identity
      this.operator = identity.kind === 'room' ? identity.name : identity.name
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity))
      }
    },
  },
})
