import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'
import { IDENTIFIERS, STAFF_BY_NAME, type Staff } from '@/data/staff'

// 骨骼标本鉴定的专属业务：归属与权限、出具结论校验、换人/退样冲突裁决、结论落到送检清单。
// 通用 runAction 不承载这些规则，避免别的模块被牵连；页面只能从这里改骨骼标本。

const KEY = 'bone'
const DATING_KEY = 'dating'

const EDITABLE_FIELDS = ['出土单位', '种属', '骨骼部位', '可鉴定性别', '年龄估计', '病理现象']
const FIELD_LABEL: Record<string, string> = {
  种属: '种属',
  骨骼部位: '骨骼部位',
}

type SaveDraftInput = {
  operator: Staff
  fields: Partial<Record<(typeof EDITABLE_FIELDS)[number], string>>
}

function isBlank(value: unknown): boolean {
  return String(value ?? '').trim() === ''
}

function findBone(id: number): { rows: EntryRow[]; index: number; row: EntryRow } | ActionResult {
  const rows = listRows(KEY)
  const index = rows.findIndex((item) => Number(item.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的骨骼标本` }
  }
  return { rows, index, row: rows[index] }
}

// 维护类改动（补登记、保存年龄估计、改结论）的统一权限闸口。
// 没有归属的标本只读；鉴定人只能维护自己名下标本；跨单位改动拦下并写明原因。
function assertCanMaintain(row: EntryRow, operator: Staff, action: string): ActionResult | null {
  const owner = String(row['归属鉴定人'] ?? '').trim()
  const ownerUnit = String(row['归属单位'] ?? '').trim()
  if (operator.role === '标本室') {
    return null
  }
  if (owner === '') {
    return {
      ok: false,
      message: `标本 ${row['标本编号']} 尚未归属鉴定人，当前为只读，只能查看，不能${action}；请由归属鉴定人或标本室维护。`,
    }
  }
  if (owner !== operator.name) {
    if (ownerUnit && ownerUnit !== operator.unit) {
      return {
        ok: false,
        message: `跨单位改动被拒：标本 ${row['标本编号']} 归属${ownerUnit}·${owner}，${operator.unit}·${operator.name} 无权${action}。`,
      }
    }
    return {
      ok: false,
      message: `标本 ${row['标本编号']} 归属鉴定人 ${owner}，鉴定人只能维护自己名下的标本，${operator.name} 不能${action}。`,
    }
  }
  return null
}

// 认领：未归属标本在提交鉴定时归属到当前鉴定人名下，提交后进入鉴定中。
export function claimBone(id: number, operator: Staff): ActionResult {
  if (operator.role === '标本室') {
    return { ok: false, message: '标本室不承担具体鉴定，请切换到鉴定人身份后再提交鉴定。' }
  }
  const found = findBone(id)
  if ('ok' in found) return found
  const { rows, index, row } = found
  if (String(row.status) !== '待鉴定') {
    return { ok: false, message: `标本 ${row['标本编号']} 当前为「${row.status}」，无需重复提交鉴定。` }
  }
  const updated: EntryRow = {
    ...row,
    status: '鉴定中',
    pending: true,
    '归属鉴定人': operator.name,
    '归属单位': operator.unit,
    // 若挂起的换人申请正好指向认领人，认领即视为该申请已兑现。
    '换人申请': String(row['换人申请'] ?? '').trim() === operator.name ? '' : row['换人申请'],
  }
  const next = [...rows]
  next[index] = updated
  saveRows(KEY, next)
  return { ok: true, message: `标本 ${updated['标本编号']} 已归属 ${operator.name}（${operator.unit}），进入鉴定中。` }
}

export function saveDraft(id: number, input: SaveDraftInput): ActionResult {
  const found = findBone(id)
  if ('ok' in found) return found
  const { rows, index, row } = found
  const denied = assertCanMaintain(row, input.operator, '维护鉴定信息')
  if (denied) return denied

  const patch: EntryRow = { ...row }
  for (const field of EDITABLE_FIELDS) {
    const value = input.fields[field]
    if (value !== undefined) {
      patch[field] = value.trim()
    }
  }
  const next = [...rows]
  next[index] = patch
  saveRows(KEY, next)
  return { ok: true, message: `标本 ${patch['标本编号']} 的鉴定信息已保存，年龄估计保留为「${patch['年龄估计'] || '未填'}」。` }
}

// 出具结论：种属缺失或骨骼部位不全不许出结论；结论落库后在送检清单生成一条待送检项。
export function concludeBone(id: number, conclusion: string, operator: Staff): ActionResult {
  const found = findBone(id)
  if ('ok' in found) return found
  const { rows, index, row } = found
  const denied = assertCanMaintain(row, operator, '出具鉴定结论')
  if (denied) return denied

  const missing: string[] = []
  if (isBlank(row['种属'])) missing.push(FIELD_LABEL['种属'])
  if (isBlank(row['骨骼部位'])) missing.push(FIELD_LABEL['骨骼部位'])
  if (missing.length > 0) {
    return {
      ok: false,
      message: `标本 ${row['标本编号']} ${missing.join('、')}不全，不许出具鉴定结论；补齐后再送检。`,
    }
  }
  if (isBlank(conclusion)) {
    return { ok: false, message: `标本 ${row['标本编号']} 的鉴定结论为空，请先填写结论内容。` }
  }

  const today = new Date().toISOString().slice(0, 10)
  const updated: EntryRow = {
    ...row,
    status: '已鉴定',
    pending: false,
    abnormal: false,
    '鉴定结论': conclusion.trim(),
    '结论日期': today,
    '鉴定状态': '已鉴定',
  }
  const next = [...rows]
  next[index] = updated
  saveRows(KEY, next)
  pushDatingItem(updated)
  return {
    ok: true,
    message: `标本 ${updated['标本编号']} 已出具鉴定结论，并在测年送检清单生成一条待送检项（${updated['种属']}·${updated['骨骼部位']}）。`,
  }
}

// 结论落到送检那边的清单：同源编号不重复生成，状态恒为待送检。
function pushDatingItem(bone: EntryRow): void {
  const datingRows = listRows(DATING_KEY)
  const code = `DATI-${bone['标本编号']}`
  const exists = datingRows.some((item) => String(item['送检编号']) === code)
  if (exists) {
    return
  }
  const nextId = datingRows.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
  const item: EntryRow = {
    id: nextId,
    status: '待送检',
    pending: true,
    abnormal: false,
    '送检编号': code,
    '样品来源': `骨骼标本 ${bone['标本编号']}（${bone['种属']}·${bone['骨骼部位']}）`,
    '承接实验室': '',
    '测年方法': '碳十四测年',
    '送检日期': String(bone['结论日期'] ?? ''),
    '校正年代': '',
    '报告收到日': '',
    '送检状态': '待送检',
    '来源标本编号': String(bone['标本编号']),
  }
  saveRows(DATING_KEY, [...datingRows, item])
}

// 换人 / 退样都先挂申请，由标本室办理；撞车时按标本室定的优先级只办一项。
export function requestReturn(id: number, operator: Staff): ActionResult {
  return markRequest(id, operator, '退样申请', '退样')
}

export function requestReassign(id: number, targetName: string, operator: Staff): ActionResult {
  const name = targetName.trim()
  if (!STAFF_BY_NAME.get(name) || STAFF_BY_NAME.get(name)?.role !== '鉴定人') {
    return { ok: false, message: `「${targetName}」不在鉴定人名录中，换人目标必须是在册鉴定人。` }
  }
  const found = findBone(id)
  if ('ok' in found) return found
  if (String(found.row['归属鉴定人'] ?? '') === name) {
    return { ok: false, message: `标本 ${found.row['标本编号']} 本就归属 ${name}，无需换人。` }
  }
  return markRequest(id, operator, '换人申请', '换人', name)
}

// 办理入口供页面生成"换人给哪位鉴定人"的候选项。
export function reassignCandidates(currentOwner: string): Staff[] {
  return IDENTIFIERS.filter((item) => item.name !== currentOwner)
}

function markRequest(
  id: number,
  operator: Staff,
  flag: '退样申请' | '换人申请',
  label: string,
  targetName = '',
): ActionResult {
  const found = findBone(id)
  if ('ok' in found) return found
  const { rows, index, row } = found
  const denied = assertCanMaintain(row, operator, `申请${label}`)
  if (denied) return denied
  if (String(row.status) !== '鉴定中') {
    return { ok: false, message: `标本 ${row['标本编号']} 当前为「${row.status}」，仅鉴定中的标本可以申请${label}。` }
  }
  const samePending = flag === '退样申请' ? row['退样申请'] === true : String(row['换人申请'] ?? '').trim() !== ''
  if (samePending) {
    return {
      ok: false,
      message: `标本 ${row['标本编号']} 已有待办理的${label}，标本室尚未裁决，不能重复申请。`,
    }
  }
  const updated: EntryRow = { ...row, [flag]: flag === '退样申请' ? true : targetName }
  const next = [...rows]
  next[index] = updated
  saveRows(KEY, next)
  return { ok: true, message: `标本 ${updated['标本编号']} 的${label}申请已提交，等待标本室办理。` }
}

export type ConflictPolicy = '退样优先' | '换人优先'

export function pendingRequestCount(rows: EntryRow[] = listRows(KEY)): number {
  return rows.filter((row) => row['退样申请'] === true || String(row['换人申请'] ?? '').trim() !== '').length
}

export function processRequest(id: number, policy: ConflictPolicy): ActionResult {
  const found = findBone(id)
  if ('ok' in found) return found
  const { rows, index, row } = found

  const wantsReturn = row['退样申请'] === true
  const reassignTo = String(row['换人申请'] ?? '').trim()
  const wantsReassign = reassignTo !== ''
  if (!wantsReturn && !wantsReassign) {
    return { ok: false, message: `标本 ${row['标本编号']} 没有待办理的换人或退样申请。` }
  }

  // 换人与退样撞在一起：优先级由标本室定，只执行胜出的一项，另一项原样挂起。
  const doReturn = wantsReturn && (!wantsReassign || policy === '退样优先')

  let updated: EntryRow
  let message: string
  if (doReturn) {
    // 退回待鉴定：已填好的年龄估计原样保留，归属清空重新进入认领。
    updated = {
      ...row,
      status: '待鉴定',
      pending: true,
      abnormal: false,
      '归属鉴定人': '',
      '归属单位': '',
      '鉴定结论': '',
      '结论日期': '',
      '鉴定状态': '待鉴定',
      '退样申请': false,
      '换人申请': wantsReassign ? row['换人申请'] : '',
    }
    message =
      `标本 ${updated['标本编号']} 已退回待鉴定，年龄估计「${updated['年龄估计'] || '未填'}」原样保留。` +
      (wantsReassign ? '换人申请与退样撞车，按标本室「退样优先」裁决，换人申请继续挂起。' : '')
  } else {
    updated = {
      ...row,
      status: '鉴定中',
      pending: true,
      '归属鉴定人': reassignTo,
      '归属单位': STAFF_BY_NAME.get(reassignTo)?.unit ?? '',
      '换人申请': '',
      '退样申请': wantsReturn ? true : false,
    }
    message =
      `标本 ${updated['标本编号']} 已换人给 ${reassignTo}（${updated['归属单位']}），年龄估计原样保留。` +
      (wantsReturn ? '退样申请与换人撞车，按标本室「换人优先」裁决，退样申请继续挂起。' : '')
  }

  const next = [...rows]
  next[index] = updated
  saveRows(KEY, next)
  return { ok: true, message }
}
