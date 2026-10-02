// 标本室与鉴定人名录：鉴定归属、跨单位权限判定、换人目标都从这里取。
export type StaffRole = '鉴定人' | '标本室'

export type Staff = {
  name: string
  unit: string
  role: StaffRole
}

export const STAFFS: Staff[] = [
  { name: '张明', unit: '第一发掘队', role: '鉴定人' },
  { name: '王芳', unit: '第一发掘队', role: '鉴定人' },
  { name: '李华', unit: '第二发掘队', role: '鉴定人' },
  { name: '周明', unit: '标本室', role: '标本室' },
]

export const STAFF_BY_NAME: Map<string, Staff> = new Map(STAFFS.map((item) => [item.name, item]))

export const IDENTIFIERS = STAFFS.filter((item) => item.role === '鉴定人')
