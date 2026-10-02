import { filterRows } from '@/api/local-service'
import {
  listRows,
  loadBoneSettings,
  resetRows,
  saveBoneSettings,
  saveRows,
} from '@/data/local-store'
import type { ActionResult, EntryRow, PendingRequest } from '@/data/types'
import type { Identity } from '@/stores/session'

// 骨骼标本的全部业务规则都在这一层：页面只渲染、不做判断。
// 归属：每条标本挂「归属单位 + 归属鉴定人」。标本室可管归属与裁决，
// 鉴定人只能维护自己名下的标本；没有归属的标本对所有人只读。

const BONE_KEY = 'bone'
const DATING_KEY = 'dating'

export type BoneTarget = { name: string; unit: string }
export type BoneActionParams = {
  conclusion?: string
  target?: BoneTarget
}

function ok(message: string): ActionResult {
  return { ok: true, message }
}

function fail(message: string): ActionResult {
  return { ok: false, message }
}

function findBone(id: number): { rows: EntryRow[]; index: number; row: EntryRow } | null {
  const rows = listRows(BONE_KEY)
  const index = rows.findIndex((item) => Number(item.id) === id)
  if (index < 0) {
    return null
  }
  return { rows, index, row: rows[index] }
}

function codeOf(row: EntryRow): string {
  return String(row['标本编号'] ?? `#${row.id}`)
}

// 这些写法等于没填：种属或骨骼部位落成这些值时，不许出具结论。
const EMPTY_WORDS = ['', '不详', '不明', '未知', '未定', '待补', '待鉴定', '—', '-']

function isFilled(value: unknown): boolean {
  return !EMPTY_WORDS.includes(String(value ?? '').trim())
}

function getRequests(row: EntryRow): PendingRequest[] {
  const raw = row._requests
  return Array.isArray(raw) ? (raw as PendingRequest[]) : []
}

function setRequests(row: EntryRow, requests: PendingRequest[]): void {
  if (requests.length) {
    row._requests = requests
  } else {
    delete row._requests
  }
}

function pushDecision(row: EntryRow, line: string): void {
  const log = Array.isArray(row._decisionLog) ? (row._decisionLog as string[]) : []
  const stamp = new Date().toLocaleString('zh-CN', { hour12: false })
  row._decisionLog = [`[${stamp}] ${line}`, ...log].slice(0, 20)
}

function persist(rows: EntryRow[], index: number, row: EntryRow): void {
  const pendingStatuses = ['待鉴定', '鉴定中']
  const next: EntryRow = {
    ...row,
    '鉴定状态': row.status,
    pending: pendingStatuses.includes(String(row.status)) || getRequests(row).length > 0,
  }
  const clone = [...rows]
  clone[index] = next
  saveRows(BONE_KEY, clone)
}

export type BoneAccess = {
  editable: boolean
  reason: string
}

// 归属鉴权：返回可不可改、被拒的具体原因。只读标本可以看，不能动。
export function boneAccess(row: EntryRow, identity: Identity): BoneAccess {
  if (identity.kind === 'room') {
    return { editable: true, reason: '' }
  }
  const owner = String(row['归属鉴定人'] ?? '').trim()
  const unit = String(row['归属单位'] ?? '').trim()
  if (!owner || !unit) {
    return {
      editable: false,
      reason: `标本 ${codeOf(row)} 尚未归属鉴定人，当前只读：可以查看，不能改动；请联系标本室先办理归属`,
    }
  }
  if (unit !== identity.unit) {
    return {
      editable: false,
      reason: `跨单位改动已拦下：标本 ${codeOf(row)} 归属「${unit}」的${owner}，你所在「${identity.unit}」无权改动其鉴定结论`,
    }
  }
  if (owner !== identity.name) {
    return {
      editable: false,
      reason: `改动已拦下：标本 ${codeOf(row)} 归属本单位鉴定人「${owner}」，鉴定人只能维护自己名下的标本`,
    }
  }
  return { editable: true, reason: '' }
}

// 鉴定类动作（提交鉴定、出具结论、退回、退样）只能由归属鉴定人本人办理，标本室只管归属与裁决。
function ensureIdentifierWritable(row: EntryRow, identity: Identity): ActionResult | null {
  if (identity.kind === 'room') {
    return fail(
      `鉴定操作已拦下：标本室负责归属与换人退样裁决，不能代为鉴定；标本 ${codeOf(row)} 须由其归属鉴定人维护`,
    )
  }
  return ensureWritable(row, identity)
}

// 写操作前的统一归属校验。
function ensureWritable(row: EntryRow, identity: Identity): ActionResult | null {
  const access = boneAccess(row, identity)
  return access.editable ? null : fail(access.reason)
}

function nowText(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

// 出具结论后落到测年送检清单：那边生出一条待送检项。同一标本不重复生单。
function createDatingItem(bone: EntryRow): string {
  const dating = listRows(DATING_KEY)
  const boneId = String(bone.id)
  const existing = dating.find((row) => String(row._sourceBoneId ?? '') === boneId)
  if (existing) {
    return String(existing['送检编号'])
  }
  const nextId = dating.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const datingCode = `DATI-${String(nextId).padStart(4, '0')}`
  const row: EntryRow = {
    id: nextId,
    status: '待送检',
    pending: true,
    abnormal: false,
    '送检编号': datingCode,
    '样品来源': `骨骼标本 ${bone['标本编号']}（鉴定结论联动）`,
    '承接实验室': '待安排',
    '测年方法': '待安排',
    '送检日期': '',
    '校正年代': '',
    '报告收到日': '',
    '送检状态': '待送检',
    '种属': String(bone['种属'] ?? ''),
    _sourceBoneId: boneId,
  }
  saveRows(DATING_KEY, [...dating, row])
  return datingCode
}

function submitIdentify(
  ctx: { rows: EntryRow[]; index: number; row: EntryRow },
  identity: Identity,
): ActionResult {
  const denied = ensureIdentifierWritable(ctx.row, identity)
  if (denied) return denied
  if (String(ctx.row.status) === '鉴定中') {
    return fail('标本已在鉴定中，不用重复提交')
  }
  if (String(ctx.row.status) !== '待鉴定') {
    return fail(`标本当前是「${ctx.row.status}」，不能再提交鉴定`)
  }
  ctx.row.status = '鉴定中'
  pushDecision(ctx.row, `${identityLabel(identity)} 提交鉴定，状态由待鉴定转鉴定中`)
  persist(ctx.rows, ctx.index, ctx.row)
  return ok(`标本 ${codeOf(ctx.row)} 已提交鉴定，归属${ctx.row['归属单位']}的${ctx.row['归属鉴定人']}`)
}

function issueConclusion(
  ctx: { rows: EntryRow[]; index: number; row: EntryRow },
  identity: Identity,
  params: BoneActionParams,
): ActionResult {
  const denied = ensureIdentifierWritable(ctx.row, identity)
  if (denied) return denied
  // 种属缺失、骨骼部位不全的，一律不许出具结论，补齐后再送检。
  const missing: string[] = []
  if (!isFilled(ctx.row['种属'])) missing.push('种属')
  if (!isFilled(ctx.row['骨骼部位'])) missing.push('骨骼部位')
  if (missing.length) {
    return fail(
      `无法出具鉴定结论：标本 ${codeOf(ctx.row)} 的${missing.join('、')}缺失或填写不全，补齐后才能出具结论并送检`,
    )
  }
  const conclusion = String(params.conclusion ?? '').trim()
  if (!conclusion) {
    return fail('鉴定结论内容为空，请先填写结论再出具')
  }
  if (String(ctx.row.status) !== '鉴定中') {
    return fail(`标本当前是「${ctx.row.status}」，只有鉴定中的标本才能出具结论`)
  }
  ctx.row['鉴定结论'] = conclusion
  ctx.row.status = '已鉴定'
  pushDecision(ctx.row, `${identityLabel(identity)} 出具鉴定结论：${conclusion}`)
  persist(ctx.rows, ctx.index, ctx.row)
  const datingCode = createDatingItem(ctx.row)
  return ok(
    `鉴定结论已出具并归属${identityLabel(identity)}；测年送检清单已生成待送检项 ${datingCode}，信息补齐后再办理送检`,
  )
}

// 退回待鉴定：只回退状态，已经填好的年龄估计原样保留，不许抹掉。
function returnToIdentify(
  ctx: { rows: EntryRow[]; index: number; row: EntryRow },
  identity: Identity,
): ActionResult {
  const denied = ensureIdentifierWritable(ctx.row, identity)
  if (denied) return denied
  if (String(ctx.row.status) !== '鉴定中') {
    return fail(`标本当前是「${ctx.row.status}」，只有鉴定中的标本能退回待鉴定`)
  }
  const keptAge = String(ctx.row['年龄估计'] ?? '')
  ctx.row.status = '待鉴定'
  // 显式不动「年龄估计」：原样写回，退回不抹数据。
  ctx.row['年龄估计'] = keptAge
  pushDecision(
    ctx.row,
    `${identityLabel(identity)} 退回待鉴定；年龄估计「${keptAge || '空'}」原样保留`,
  )
  persist(ctx.rows, ctx.index, ctx.row)
  return ok(`标本 ${codeOf(ctx.row)} 已退回待鉴定，年龄估计「${keptAge || '空'}」原样保留`)
}

// 鉴定人提出退样申请。与换人申请撞车时，按标本室定的优先级当场给说法。
function requestReturn(
  ctx: { rows: EntryRow[]; index: number; row: EntryRow },
  identity: Identity,
): ActionResult {
  if (identity.kind !== 'identifier') {
    return fail('退样由归属鉴定人提出申请，标本室负责裁决，不直接申请')
  }
  const denied = ensureWritable(ctx.row, identity)
  if (denied) return denied
  const status = String(ctx.row.status)
  if (status === '已退样') {
    return fail('标本已退样，不能重复申请')
  }
  if (status === '已鉴定') {
    return fail('标本已出具鉴定结论，不能再退样')
  }
  const requests = getRequests(ctx.row)
  if (requests.some((item) => item.type === '退样')) {
    return fail('退样申请已提交，正在等待标本室办理，不用重复申请')
  }
  const reassign = requests.find((item): item is Extract<PendingRequest, { type: '换人' }> => item.type === '换人')
  if (reassign) {
    const settings = loadBoneSettings()
    if (settings.conflictPriority === '换人优先') {
      pushDecision(
        ctx.row,
        `${identityLabel(identity)} 申请退样被拒绝：标本室设定「换人优先」，换人至${reassign.targetUnit}的${reassign.targetName}先行，退样不予受理`,
      )
      persist(ctx.rows, ctx.index, ctx.row)
      return fail(
        `退样申请被拦下：标本 ${codeOf(ctx.row)} 已有换人至「${reassign.targetUnit}·${reassign.targetName}」的申请，标本室设定「换人优先」，换人先行、本次退样不予受理`,
      )
    }
  }
  requests.push({
    type: '退样',
    applicantName: identity.name,
    applicantUnit: identity.unit,
    at: nowText(),
  })
  setRequests(ctx.row, requests)
  pushDecision(ctx.row, `${identityLabel(identity)} 提出退样申请，等待标本室办理`)
  persist(ctx.rows, ctx.index, ctx.row)
  if (reassign) {
    return ok('退样申请已登记；该标本同时有换人申请，标本室将按「退样优先」规则裁决')
  }
  return ok('退样申请已登记，等待标本室办理')
}

// 标本室提出换人申请。与退样申请撞车时，按标本室定的优先级当场给说法。
function requestReassign(
  ctx: { rows: EntryRow[]; index: number; row: EntryRow },
  identity: Identity,
  params: BoneActionParams,
): ActionResult {
  if (identity.kind !== 'room') {
    return fail('换人由标本室办理，鉴定人不能自行转交标本')
  }
  const target = params.target
  if (!target || !target.name.trim() || !target.unit.trim()) {
    return fail('换人申请需要指定接手的鉴定人及其单位')
  }
  const status = String(ctx.row.status)
  if (status === '已退样') {
    return fail('标本已退样，不能再换人')
  }
  const owner = String(ctx.row['归属鉴定人'] ?? '').trim()
  const unit = String(ctx.row['归属单位'] ?? '').trim()
  if (owner === target.name && unit === target.unit) {
    return fail(`标本本就归属${target.unit}的${target.name}，无需换人`)
  }
  const requests = getRequests(ctx.row)
  if (requests.some((item) => item.type === '换人')) {
    return fail('换人申请已提交，等待办理，不用重复申请')
  }
  const back = requests.find((item): item is Extract<PendingRequest, { type: '退样' }> => item.type === '退样')
  if (back) {
    const settings = loadBoneSettings()
    if (settings.conflictPriority === '退样优先') {
      pushDecision(
        ctx.row,
        `${identity.name} 申请换人至${target.unit}的${target.name}被拒绝：标本室设定「退样优先」，${back.applicantName}的退样申请在先，退样先行、换人不予受理`,
      )
      persist(ctx.rows, ctx.index, ctx.row)
      return fail(
        `换人申请被拦下：标本 ${codeOf(ctx.row)} 已有${back.applicantUnit}的${back.applicantName}提出退样申请，标本室设定「退样优先」，退样先行、本次换人不予受理`,
      )
    }
  }
  requests.push({
    type: '换人',
    targetName: target.name,
    targetUnit: target.unit,
    applicantName: identity.name,
    applicantUnit: '标本室',
    at: nowText(),
  })
  setRequests(ctx.row, requests)
  pushDecision(
    ctx.row,
    `${identity.name} 提出换人申请：${unit ? unit + '·' : ''}${owner || '未归属'} → ${target.unit}·${target.name}`,
  )
  persist(ctx.rows, ctx.index, ctx.row)
  if (back) {
    return ok('换人申请已登记；该标本同时有退样申请，将按「换人优先」规则裁决')
  }
  return ok(`换人申请已登记：拟转至${target.unit}的${target.name}，等待办理`)
}

function applyReturn(row: EntryRow, request: PendingRequest): void {
  row.status = '已退样'
  pushDecision(
    row,
    `标本室办理：${request.applicantUnit}的${request.applicantName}提出的退样申请通过，标本已退样`,
  )
}

function applyReassign(row: EntryRow, request: Extract<PendingRequest, { type: '换人' }>): void {
  row['归属单位'] = request.targetUnit
  row['归属鉴定人'] = request.targetName
  pushDecision(
    row,
    `标本室办理：换人申请通过，归属由原鉴定人转为${request.targetUnit}的${request.targetName}`,
  )
}

// 办理待办：换人、退样撞在一起时，按标本室定的优先级裁决，被拒一方写明原因。
function processRequests(
  ctx: { rows: EntryRow[]; index: number; row: EntryRow },
  identity: Identity,
): ActionResult {
  if (identity.kind !== 'room') {
    return fail('换人、退样待办由标本室裁决办理，鉴定人无权办理')
  }
  const requests = getRequests(ctx.row)
  if (!requests.length) {
    return fail(`标本 ${codeOf(ctx.row)} 没有待办理的换人或退样申请`)
  }
  const returnReq = requests.find((item): item is Extract<PendingRequest, { type: '退样' }> => item.type === '退样')
  const reassignReq = requests.find((item): item is Extract<PendingRequest, { type: '换人' }> => item.type === '换人')
  const settings = loadBoneSettings()

  if (returnReq && reassignReq) {
    if (settings.conflictPriority === '退样优先') {
      applyReturn(ctx.row, returnReq)
      pushDecision(
        ctx.row,
        `换人至${reassignReq.targetUnit}的${reassignReq.targetName}的申请被拒绝：按标本室「退样优先」规定，${returnReq.applicantName}的退样先行办理，换人不再执行`,
      )
    } else {
      applyReassign(ctx.row, reassignReq)
      pushDecision(
        ctx.row,
        `${returnReq.applicantUnit}的${returnReq.applicantName}的退样申请被拒绝：按标本室「换人优先」规定，标本已换至${reassignReq.targetUnit}的${reassignReq.targetName}，退样不再执行，如需退样请由新归属鉴定人重新提出`,
      )
    }
  } else if (returnReq) {
    applyReturn(ctx.row, returnReq)
  } else if (reassignReq) {
    applyReassign(ctx.row, reassignReq)
  }
  setRequests(ctx.row, [])
  persist(ctx.rows, ctx.index, ctx.row)
  return ok(`标本 ${codeOf(ctx.row)} 的待办已按「${settings.conflictPriority}」裁决办理，当前状态「${ctx.row.status}」`)
}

export function runBoneAction(
  id: number,
  action: string,
  identity: Identity,
  params: BoneActionParams = {},
): ActionResult {
  const ctx = findBone(id)
  if (!ctx) {
    return fail(`没有找到编号为 ${id} 的骨骼标本`)
  }
  switch (action) {
    case '提交鉴定':
      return submitIdentify(ctx, identity)
    case '出具结论':
      return issueConclusion(ctx, identity, params)
    case '退回待鉴定':
      return returnToIdentify(ctx, identity)
    case '退样申请':
      return requestReturn(ctx, identity)
    case '换人申请':
      return requestReassign(ctx, identity, params)
    case '办理待办':
      return processRequests(ctx, identity)
    default:
      return fail(`骨骼标本没有登记「${action}」这个动作`)
  }
}

export type BoneActionState = {
  action: string
  enabled: boolean
  reason: string
}

// 供页面渲染按钮：哪些动作可点、不可点的原因是什么，全部由业务层算好。
export function boneActions(row: EntryRow, identity: Identity): BoneActionState[] {
  const status = String(row.status)
  const requests = getRequests(row)
  const hasReturn = requests.some((item) => item.type === '退样')
  const hasReassign = requests.some((item) => item.type === '换人')

  if (identity.kind === 'room') {
    return [
      { action: '提交鉴定', enabled: false, reason: '鉴定维护由归属鉴定人办理，标本室只做归属与裁决' },
      { action: '出具结论', enabled: false, reason: '鉴定结论由归属鉴定人出具，标本室只做归属与裁决' },
      { action: '退回待鉴定', enabled: false, reason: '退回鉴定由归属鉴定人办理' },
      { action: '退样申请', enabled: false, reason: '退样由归属鉴定人提出申请，标本室负责裁决' },
      {
        action: '换人申请',
        enabled: status !== '已退样' && !hasReassign,
        reason: status === '已退样' ? '标本已退样，不能再换人' : hasReassign ? '换人申请已在待办中' : '',
      },
      {
        action: '办理待办',
        enabled: requests.length > 0,
        reason: requests.length > 0 ? '' : '当前没有换人/退样待办',
      },
    ]
  }

  const access = boneAccess(row, identity)
  if (!access.editable) {
    return [
      '提交鉴定',
      '出具结论',
      '退回待鉴定',
      '退样申请',
      '换人申请',
      '办理待办',
    ].map((action) => {
      const roomOnly = action === '换人申请' || action === '办理待办'
      return {
        action,
        enabled: false,
        reason: roomOnly ? '换人、退样待办仅标本室可办理' : access.reason,
      }
    })
  }

  return [
    {
      action: '提交鉴定',
      enabled: status === '待鉴定',
      reason: status === '待鉴定' ? '' : `当前状态「${status}」不能提交鉴定`,
    },
    {
      action: '出具结论',
      enabled: status === '鉴定中',
      reason: status === '鉴定中' ? '' : `当前状态「${status}」不能出具结论`,
    },
    {
      action: '退回待鉴定',
      enabled: status === '鉴定中',
      reason: status === '鉴定中' ? '' : `当前状态「${status}」不能退回`,
    },
    {
      action: '退样申请',
      enabled: status !== '已退样' && status !== '已鉴定' && !hasReturn,
      reason:
        status === '已退样'
          ? '标本已退样'
          : status === '已鉴定'
            ? '已出具结论的标本不能退样'
            : hasReturn
              ? '退样申请已提交，等待标本室办理'
              : '',
    },
    { action: '换人申请', enabled: false, reason: '换人由标本室办理' },
    { action: '办理待办', enabled: false, reason: '换人、退样待办仅标本室可办理' },
  ]
}

export function requestLabel(request: PendingRequest): string {
  if (request.type === '退样') {
    return `退样申请：${request.applicantUnit}·${request.applicantName}（${request.at}）`
  }
  return `换人申请：转至${request.targetUnit}·${request.targetName}（${request.at}）`
}

export function getBoneRequests(row: EntryRow): PendingRequest[] {
  return getRequests(row)
}

export function getBoneDecisionLog(row: EntryRow): string[] {
  const log = row._decisionLog
  return Array.isArray(log) ? (log as string[]) : []
}

export function listBone(filters: Record<string, string> = {}): EntryRow[] {
  return filterRows(listRows(BONE_KEY), filters)
}

export function getBone(id: number): EntryRow | undefined {
  return listRows(BONE_KEY).find((row) => Number(row.id) === id)
}

export function boneConflictPriority(): '换人优先' | '退样优先' {
  return loadBoneSettings().conflictPriority
}

export function setBoneConflictPriority(priority: '换人优先' | '退样优先'): ActionResult {
  saveBoneSettings({ conflictPriority: priority })
  return ok(`换人与退样冲突优先级已设为「${priority}」`)
}

// 演示用：把骨骼标本恢复成示例，并清掉由结论联动生成的测年待送检项。
export function resetBoneDemo(): void {
  resetRows(BONE_KEY)
  const dating = listRows(DATING_KEY).filter((row) => row._sourceBoneId === undefined)
  saveRows(DATING_KEY, dating)
}

// 仅供本文件拼裁决日志时用。
function identityLabel(identity: Identity): string {
  return identity.kind === 'room'
    ? identity.name
    : `${identity.unit}·${identity.name}`
}
