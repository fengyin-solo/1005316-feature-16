/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

// 换人/退样申请：挂在标本记录上，等标本室裁决。
export type PendingRequest = (
  | {
      type: '退样'
    }
  | {
      type: '换人'
      targetName: string
      targetUnit: string
    }
) & {
  applicantName: string
  applicantUnit: string
  at: string
}

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  // 下划线开头的是模块内部字段（如待办申请、裁决记录），不出现在清单列与导出里。
  [field: string]: string | number | boolean | string[] | PendingRequest[]
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
