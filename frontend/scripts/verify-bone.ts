import { listRows } from '@/data/local-store'
import {
  claimBone,
  concludeBone,
  processRequest,
  requestReassign,
  requestReturn,
  saveDraft,
} from '@/api/bone-service'
import { STAFF_BY_NAME } from '@/data/staff'

const zm = STAFF_BY_NAME.get('张明')!
const wf = STAFF_BY_NAME.get('王芳')!
const lh = STAFF_BY_NAME.get('李华')!

function bone(id: number) {
  return listRows('bone').find((r) => Number(r.id) === id)!
}

const log = (label: string, r: { ok: boolean; message: string }) =>
  console.log(`${r.ok ? 'PASS' : 'FAIL'} ${label}: ${r.message}`)

// 1 跨单位改动要拦下并写清原因：张明(一队)改李华(二队)的 BONE-0004
log('跨单位拦截', saveDraft(4, { operator: zm, fields: { 年龄估计: 'x' } }).ok === false
  ? { ok: true, message: '已拦截: ' + saveDraft(4, { operator: zm, fields: {} }).message }
  : { ok: false, message: '不该放行' })

// 2 同单位非名下也只读：王芳(一队)改张明(一队)的 BONE-0002
const r2 = saveDraft(2, { operator: wf, fields: { 年龄估计: '3岁' } })
log('同单位他人名下只读', !r2.ok ? { ok: true, message: '已拦截: ' + r2.message } : r2)

// 3 未归属标本只读（除提交鉴定认领）
const r3 = saveDraft(1, { operator: zm, fields: { 年龄估计: '1岁' } })
log('未归属只读', !r3.ok ? { ok: true, message: '已拦截: ' + r3.message } : r3)

// 4 种属缺失不许出具结论：BONE-0001 先认领到张明名下，再出结论
claimBone(1, zm)
const r4 = concludeBone(1, '某结论', zm)
log('缺种属拒出结论', !r4.ok && r4.message.includes('种属')
  ? { ok: true, message: r4.message } : r4)

// 5 骨骼部位不全不许出具结论：BONE-0005（李华，种属=猪，部位空）
const r5 = concludeBone(5, '某结论', lh)
log('部位不全拒出结论', !r5.ok && r5.message.includes('骨骼部位')
  ? { ok: true, message: r5.message } : r5)

// 6 结论为空拒绝
const r6 = concludeBone(2, '  ', zm)
log('空结论拒绝', !r6.ok ? { ok: true, message: r6.message } : r6)

// 7 正常出结论，生成待送检项（BONE-0002 年龄估计=2岁左右，需保留）
const beforeAge = bone(2)['年龄估计']
const r7 = concludeBone(2, '家猪下颌骨，雌性2岁左右。', zm)
const dating = listRows('dating').find((d) => d['送检编号'] === 'DATI-BONE-0002')
log('出结论+送检联动', r7.ok && dating && dating.status === '待送检'
  ? { ok: true, message: r7.message + `；送检项状态=${dating.status}` }
  : { ok: false, message: '送检项未生成' })

// 8 退样保留年龄估计，清空归属、回到待鉴定（用鉴定中的 BONE-0004，李华，年龄=老年）
requestReturn(4, lh)
const r8 = processRequest(4, '退样优先')
const b3 = bone(4)
log('退样保留年龄估计', r8.ok && b3.status === '待鉴定' && b3['归属鉴定人'] === '' && b3['年龄估计'] === '老年'
  ? { ok: true, message: r8.message + `；年龄估计=${b3['年龄估计']}` }
  : { ok: false, message: '状态/归属/年龄异常' })

// 9 换人与退样撞车：退样优先后换人申请继续挂起（BONE-0006 王芳名下）
requestReturn(6, wf)
requestReassign(6, '张明', wf)
const r9 = processRequest(6, '退样优先')
const b6 = bone(6)
log('撞车退样优先', r9.ok && b6.status === '待鉴定' && b6['退样申请'] === false && b6['换人申请'] === '张明' && b6['年龄估计'] === '3-4岁'
  ? { ok: true, message: r9.message } : { ok: false, message: '裁决结果异常' })

// 10 换人优先（重新认领 BONE-0006 给张明，再撞车：退样 vs 换人给王芳）
claimBone(6, zm)
requestReturn(6, zm)
requestReassign(6, '王芳', zm)
const r10 = processRequest(6, '换人优先')
const b6b = bone(6)
log('撞车换人优先', r10.ok && b6b.status === '鉴定中' && b6b['归属鉴定人'] === '王芳' && b6b['退样申请'] === true
  ? { ok: true, message: r10.message } : { ok: false, message: '裁决结果异常' })

// 11 退样后重新认领，年龄估计原样还在（BONE-0006 年龄 3-4岁 历经退样+换人）
log('退样年龄不抹掉', b6b['年龄估计'] === '3-4岁'
  ? { ok: true, message: `年龄估计仍为 ${b6b['年龄估计']}` }
  : { ok: false, message: `年龄估计变成 ${b6b['年龄估计']}` })

void beforeAge
