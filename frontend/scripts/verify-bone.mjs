// 骨骼标本业务规则的端到端验证：shim 掉浏览器 localStorage，直接跑业务层。
// 用法：node scripts/verify-bone.mjs
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const storage = new Map()
globalThis.window = {
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  },
}

const dir = mkdtempSync(join(tmpdir(), 'bone-verify-'))
const entry = join(dir, 'entry.ts')
writeFileSync(entry, `
export * from '@/api/bone-service'
export { listRows, saveRows, resetRows } from '@/data/local-store'
export { useSessionStore } from '@/stores/session'
`)

await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: join(dir, 'bundle.mjs'),
  alias: { '@': join(process.cwd(), 'src') },
})

const service = await import(pathToFileURL(join(dir, 'bundle.mjs')).href)
const {
  runBoneAction,
  listBone,
  getBone,
  boneAccess,
  resetBoneDemo,
  setBoneConflictPriority,
  listRows,
  saveRows,
} = service

let passed = 0
let failed = 0
function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name} ${detail}`)
  }
}

const zhou = { kind: 'identifier', name: '周鉴定', unit: '第一考古队' }
const wu = { kind: 'identifier', name: '吴鉴定', unit: '第一考古队' }
const zheng = { kind: 'identifier', name: '郑鉴定', unit: '第二考古队' }
const wang = { kind: 'identifier', name: '王鉴定', unit: '动物考古实验室' }
const room = { kind: 'room', name: '标本室值班员' }

const find = (id) => getBone(id)
const datingCount = () => listRows('dating').length
const datingFor = (id) => listRows('dating').find((r) => String(r._sourceBoneId) === String(id))

console.log('1. 只读归属：无归属标本 / 同单位他人 / 跨单位')
resetBoneDemo()
const orphan = {
  id: 100,
  status: '待鉴定',
  pending: true,
  abnormal: false,
  '标本编号': 'BONE-TEST-ORPHAN',
  '出土单位': 'X1',
  '种属': '猪',
  '骨骼部位': '下颌',
  '归属单位': '',
  '归属鉴定人': '',
  '年龄估计': '',
  '鉴定结论': '',
  '鉴定状态': '待鉴定',
}
saveRows('bone', [...listRows('bone'), orphan])
check('无归属标本对鉴定人只读', boneAccess(find(100), zhou).editable === false)
check('只读原因写明联系标本室', boneAccess(find(100), zhou).reason.includes('尚未归属鉴定人'))
check('BONE-0001（周鉴定名下）本人可改', boneAccess(find(1), zhou).editable === true)
check('同单位吴鉴定不能改周鉴定名下标本', boneAccess(find(1), wu).editable === false)
check('同单位拒绝原因说明只能维护自己名下', boneAccess(find(1), wu).reason.includes('只能维护自己名下'))
check('跨单位郑鉴定不能改第一考古队标本', boneAccess(find(1), zheng).editable === false)
const crossMsg = boneAccess(find(1), zheng).reason
check('跨单位拒绝并写明双方单位', crossMsg.includes('跨单位') && crossMsg.includes('第二考古队'))

console.log('2. 种属缺失 / 骨骼部位不全不许出具结论')
check('部位不详的 BONE-0004 出具结论被拦', runBoneAction(4, '出具结论', zheng, { conclusion: '试一下' }).ok === false)
check('拒绝信息写明缺骨骼部位', runBoneAction(4, '出具结论', zheng, { conclusion: '试一下' }).message.includes('骨骼部位'))
// 补全部位后允许出具
{
  const rows = listRows('bone')
  const idx = rows.findIndex((r) => Number(r.id) === 4)
  rows[idx] = { ...rows[idx], '骨骼部位': '胫骨' }
  saveRows('bone', rows)
}
const beforeCount = datingCount()
const issue = runBoneAction(4, '出具结论', zheng, { conclusion: '绵羊左侧胫骨，成年个体' })
check('补齐部位后可出具结论', issue.ok === true, issue.message)
check('出具结论后测年清单新增一条待送检项', datingCount() === beforeCount + 1)
const d4 = datingFor(4)
check('联动送检项为待送检状态', d4 && d4.status === '待送检')
check('联动送检项带来源与种属', d4 && String(d4['样品来源']).includes('BONE-0004') && d4['种属'] === '绵羊')
check('重复出具不会重复生单', runBoneAction(4, '出具结论', zheng, { conclusion: '再来一次' }).ok === false)
check('送检单仍是一条', datingCount() === beforeCount + 1)

console.log('3. 退回待鉴定保留年龄估计')
resetBoneDemo()
check('退回前先提交鉴定', runBoneAction(2, '提交鉴定', zhou).ok === true || find(2).status === '鉴定中')
// BONE-0002 原本鉴定中，年龄估计为成年
const ageBefore = find(2)['年龄估计']
const ret = runBoneAction(2, '退回待鉴定', zhou)
check('退回动作成功', ret.ok === true, ret.message)
check('状态回到待鉴定', find(2).status === '待鉴定')
check('年龄估计原样保留', find(2)['年龄估计'] === ageBefore && find(2)['年龄估计'] === '成年')
check('成功消息明示年龄保留', ret.message.includes('年龄估计'))

console.log('4. 换人退样撞车：标本室定优先级，被拒原因写记录')
resetBoneDemo()
setBoneConflictPriority('退样优先')
// BONE-0006 已有吴鉴定的退样申请
check('退样优先时标本室换人申请当场被拦', runBoneAction(6, '换人申请', room, { target: { name: '王鉴定', unit: '动物考古实验室' } }).ok === false)
check('被拦原因写明退样优先', runBoneAction(6, '换人申请', room, { target: { name: '王鉴定', unit: '动物考古实验室' } }).message.includes('退样优先'))
check('待办理：标本室裁决退样通过', runBoneAction(6, '办理待办', room).ok === true)
check('标本状态为已退样', find(6).status === '已退样')
check('裁决日志记录换人被拒原因', (find(6)._decisionLog ?? []).some((l) => l.includes('换人') && l.includes('拒绝')))

resetBoneDemo()
setBoneConflictPriority('换人优先')
// 退样申请已在（种子数据），换人申请可登记；裁决时换人通过、退样被拒并写明原因
const reassign = runBoneAction(6, '换人申请', room, { target: { name: '周鉴定', unit: '第一考古队' } })
check('换人优先时换人申请可登记', reassign.ok === true, reassign.message)
const verdict = runBoneAction(6, '办理待办', room)
check('裁决办理成功', verdict.ok === true, verdict.message)
check('归属已换成周鉴定', find(6)['归属鉴定人'] === '周鉴定')
check('退样被拒原因写入处理记录', (find(6)._decisionLog ?? []).some((l) => l.includes('退样') && l.includes('拒绝')))
check('待办已清空', (find(6)._requests ?? []).length === 0)
check('换人后吴鉴定不再有权维护', boneAccess(find(6), wu).editable === false)
check('新人周鉴定有权维护', boneAccess(find(6), zhou).editable === true)

console.log('5. 只有归属人能操作本人名下标本的鉴定流转')
resetBoneDemo()
check('跨单位不能替别人提交鉴定', runBoneAction(1, '提交鉴定', wang).ok === false)
check('本人提交鉴定成功', runBoneAction(1, '提交鉴定', zhou).ok === true)
check('标本室不能代替出具结论', runBoneAction(1, '出具结论', room, { conclusion: 'x' }).ok === false)
check('鉴定人不能办理待办', runBoneAction(6, '办理待办', wu).ok === false)
check('鉴定人不能自行换人', runBoneAction(1, '换人申请', zhou, { target: { name: '王鉴定', unit: '动物考古实验室' } }).ok === false)

console.log('6. 列表页与详情页编号同源')
{
  const list = listBone()
  for (const row of list.slice(0, 6)) {
    const detail = getBone(Number(row.id))
    check(`id=${row.id} 两处编号一致`, detail && detail['标本编号'] === row['标本编号'])
  }
}

console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
