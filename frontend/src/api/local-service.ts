import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  ClearancePage,
  ClearanceQuery,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

// —— 隐患核销专用：组合筛选、依次流转、核销联动边坡形变 ——

const CLEARANCE_KEY = 'clearance'
const SLOPE_KEY = 'slope'

// 环节只能依次流转：待复核 → 复核中 → 已核销 / 已驳回，越级的一律挡下。
const CLEARANCE_FLOW: Record<string, string[]> = {
  提交复核: ['待复核'],
  确认核销: ['复核中'],
  驳回申请: ['复核中'],
}
const CLEARANCE_TERMINAL = ['已核销', '已驳回']

type ClearanceCondition = {
  label: string
  pass: (row: EntryRow) => boolean
}

// 条件按固定优先级排：核销编号 → 核销依据 → 复核人 → 核销结论 → 复核日期。
// 复核人与核销结论撞在一起时，先判复核人，后判核销结论，顺序不写死在人脑里。
function clearanceConditions(query: ClearanceQuery): ClearanceCondition[] {
  const conditions: ClearanceCondition[] = []
  const no = (query.核销编号 ?? '').trim()
  if (no !== '') {
    conditions.push({ label: '核销编号', pass: (row) => String(row['核销编号'] ?? '').includes(no) })
  }
  const basis = (query.核销依据 ?? '').trim()
  if (basis !== '') {
    conditions.push({ label: '核销依据', pass: (row) => String(row['核销依据'] ?? '').includes(basis) })
  }
  const reviewer = (query.复核人 ?? '').trim()
  if (reviewer !== '') {
    conditions.push({ label: '复核人', pass: (row) => String(row['复核人'] ?? '').includes(reviewer) })
  }
  const conclusions = (query.核销结论 ?? []).map((item) => item.trim()).filter((item) => item !== '')
  if (conclusions.length > 0) {
    conditions.push({
      label: '核销结论',
      pass: (row) => conclusions.includes(String(row['核销结论'] ?? '')),
    })
  }
  const start = (query.复核日期起 ?? '').trim()
  const end = (query.复核日期止 ?? '').trim()
  if (start !== '' || end !== '') {
    conditions.push({
      label: '复核日期',
      pass: (row) => {
        const day = String(row['复核日期'] ?? '')
        if (start !== '' && day < start) return false
        if (end !== '' && day > end) return false
        return true
      },
    })
  }
  return conditions
}

export function listClearanceEntries(query: ClearanceQuery = {}): ClearancePage {
  const size = Math.max(1, Math.floor(query.size ?? 5))
  // 按优先级逐个条件收窄，第一个把结果卡空的条件就是「没过」的那个。
  let matched = listRows(CLEARANCE_KEY)
  let failedCondition = ''
  for (const condition of clearanceConditions(query)) {
    matched = matched.filter(condition.pass)
    if (matched.length === 0) {
      failedCondition = condition.label
      break
    }
  }
  const total = matched.length
  const maxPage = Math.max(1, Math.ceil(total / size))
  const page = Math.min(Math.max(1, Math.floor(query.page ?? 1)), maxPage)
  const items = matched.slice((page - 1) * size, page * size)
  return { items, total, page, size, failedCondition }
}

// 复核人取到极值（字典序最小或最大）的记录一律退回核对。
function extremeReviewers(rows: EntryRow[]): string[] {
  const names = [
    ...new Set(rows.map((row) => String(row['复核人'] ?? '').trim()).filter((name) => name !== '')),
  ].sort()
  if (names.length === 0) {
    return []
  }
  return [names[0], names[names.length - 1]]
}

// 核销结论落到边坡形变清单：追加一条「重新建档」观测点。
// 核销依据从同一张核销单上原样带出，两条路径读的是同一份，不另起副本；
// 测点编号由核销编号推导，同一单重复核销也只记一次。
function appendSlopeRefile(row: EntryRow): void {
  const pointNo = `SLOP-RE-${String(row['核销编号'] ?? '')}`
  const slopes = listRows(SLOPE_KEY)
  if (slopes.some((item) => String(item['测点编号']) === pointNo)) {
    return
  }
  const nextId = slopes.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
  const refile: EntryRow = {
    id: nextId,
    status: '待观测',
    pending: true,
    abnormal: false,
    测点编号: pointNo,
    所属隐患点: String(row['所属隐患点'] ?? ''),
    监测方式: '重新建档',
    本期位移: 0,
    累计位移: 0,
    观测日期: String(row['复核日期'] ?? ''),
    观测人: String(row['复核人'] ?? ''),
    形变状态: String(row['核销结论'] ?? ''),
    核销依据: String(row['核销依据'] ?? ''),
  }
  saveRows(SLOPE_KEY, [...slopes, refile])
}

export function runClearanceAction(id: number, action: string): ActionResult {
  const meta = moduleMeta(CLEARANCE_KEY)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(CLEARANCE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  // 连续点两次只记一次：已在目标状态就直接说明，不重复记账。
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，同一动作只记一次，不用重复操作` }
  }
  const allowedFrom = CLEARANCE_FLOW[action] ?? []
  if (!allowedFrom.includes(current)) {
    return {
      ok: false,
      message: `越级操作已挡下：「${current}」不能执行「${action}」，核销单只能按 待复核→复核中→已核销/已驳回 依次流转`,
    }
  }
  if (action === '确认核销') {
    const reviewer = String(rows[index]['复核人'] ?? '').trim()
    if (reviewer !== '' && extremeReviewers(rows).includes(reviewer)) {
      const bounced: EntryRow = { ...rows[index], status: '待复核', pending: true, abnormal: true }
      const next = [...rows]
      next[index] = bounced
      saveRows(CLEARANCE_KEY, next)
      return { ok: false, message: `复核人「${reviewer}」取到极值，记录已退回核对，当前状态「待复核」` }
    }
  }
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: !CLEARANCE_TERMINAL.includes(target),
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(CLEARANCE_KEY, next)
  if (action === '确认核销') {
    appendSlopeRefile(updated)
    return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」，边坡形变清单已追加一条重新建档项` }
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
