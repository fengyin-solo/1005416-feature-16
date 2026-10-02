import { listRows, saveRows } from '@/data/local-store'
import type {
  ClearanceBlockedCondition,
  ClearanceFilterState,
  ClearanceLedgerEntry,
  ClearancePageResult,
  EntryRow,
} from '@/data/types'

// 核销结论候选项：筛选用多选，登记结论也只能从这几个里落。
export const CLEARANCE_CONCLUSIONS = ['通过', '限期整改', '不予核销', '补充材料']

// 四个环节依次流转，每一步只允许来自指定的上一环节，越级一律挡下。
export const CLEARANCE_FLOW: { action: string; from: string; to: string }[] = [
  { action: '提交复核', from: '待复核', to: '复核中' },
  { action: '确认核销', from: '复核中', to: '已核销' },
  { action: '驳回申请', from: '复核中', to: '已驳回' },
]

// 筛选条件的判定优先级：复核人先于核销结论判定；其余按此顺序依次收窄。
// 多条命中且互相「撞在一起」时，靠前的条件先解释未命中。
export const CLEARANCE_CONDITION_PRIORITY = [
  '核销编号',
  '核销依据',
  '复核人',
  '核销结论',
  '复核日期起',
  '复核日期止',
] as const

export const CLEARANCE_PAGE_SIZE = 5
const LEDGER_KEY = 'clearance-ledger'

export function emptyClearanceFilter(): ClearanceFilterState {
  return { 核销编号: '', 核销依据: '', 复核人: '', 核销结论: [], 复核日期起: '', 复核日期止: '' }
}

// 两条路径读同一份核销依据：筛选匹配与「确认核销」落到边坡重新建档项，
// 都必须经过这个唯一读法，不允许两边各取一个字段、各判一套。
export function readClearanceBasis(row: EntryRow): string {
  return String(row['核销依据'] ?? '').trim()
}

export function listClearanceLedger(): ClearanceLedgerEntry[] {
  const rows = listRows(LEDGER_KEY)
  return rows.filter((row) => 'action' in row).map((row) => ({
    id: Number(row['核销单id'] ?? row.id),
    核销编号: String(row['核销编号'] ?? ''),
    action: String(row['action'] ?? ''),
    from: String(row['from'] ?? ''),
    to: String(row['to'] ?? ''),
    at: String(row['at'] ?? ''),
  }))
}

function appendClearanceLedger(entry: Omit<ClearanceLedgerEntry, 'id'> & { id: number }): void {
  const rows = listRows(LEDGER_KEY)
  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const ledgerRow: EntryRow = {
    ...entry,
    id: nextId,
    status: '已留痕',
    pending: false,
    abnormal: false,
    核销单id: entry.id,
  }
  saveRows(LEDGER_KEY, [...rows, ledgerRow])
}

function hasLedgerRecord(id: number, action: string): boolean {
  return listClearanceLedger().some(
    (entry) => entry.id === id && entry.action === action,
  )
}

type Stage =
  | { kind: 'match'; rows: EntryRow[] }
  | { kind: 'blocked'; blocked: ClearanceBlockedCondition }

function sampleValues(rows: EntryRow[], field: string, limit = 3): string {
  const values: string[] = []
  for (const row of rows) {
    const value = String(row[field] ?? '').trim()
    if (value && !values.includes(value)) {
      values.push(value)
    }
    if (values.length >= limit) {
      break
    }
  }
  return values.length ? values.join('、') : '（均为空）'
}

// 按优先级逐条件收窄候选集；某一步把候选清空，就由它解释未命中。
function narrowClearance(rows: EntryRow[], filter: ClearanceFilterState): Stage {
  let candidates = rows
  for (const condition of CLEARANCE_CONDITION_PRIORITY) {
    if (condition === '核销结论') {
      const picked = filter.核销结论.map((item) => item.trim()).filter(Boolean)
      if (picked.length === 0) {
        continue
      }
      const matched = candidates.filter((row) =>
        picked.includes(String(row['核销结论'] ?? '').trim()),
      )
      if (matched.length === 0) {
        return {
          kind: 'blocked',
          blocked: {
            condition,
            expected: `包含在「${picked.join('、')}」`,
            candidates: sampleValues(candidates, '核销结论'),
            message: `没有命中：条件「核销结论」未通过（要求包含在「${picked.join('、')}」，当前候选记录的核销结论为：${sampleValues(candidates, '核销结论')}）`,
          },
        }
      }
      candidates = matched
      continue
    }

    if (condition === '复核日期起') {
      const start = filter.复核日期起
      if (!start) {
        continue
      }
      const matched = candidates.filter(
        (row) => String(row['复核日期'] ?? '') >= start,
      )
      if (matched.length === 0) {
        return {
          kind: 'blocked',
          blocked: {
            condition,
            expected: `不早于 ${start}`,
            candidates: sampleValues(candidates, '复核日期'),
            message: `没有命中：条件「复核日期起」未通过（要求不早于 ${start}，当前候选记录的复核日期为：${sampleValues(candidates, '复核日期')}）`,
          },
        }
      }
      candidates = matched
      continue
    }

    if (condition === '复核日期止') {
      const end = filter.复核日期止
      if (!end) {
        continue
      }
      const matched = candidates.filter(
        (row) => String(row['复核日期'] ?? '') !== '' && String(row['复核日期'] ?? '') <= end,
      )
      if (matched.length === 0) {
        return {
          kind: 'blocked',
          blocked: {
            condition,
            expected: `不晚于 ${end}`,
            candidates: sampleValues(candidates, '复核日期'),
            message: `没有命中：条件「复核日期止」未通过（要求不晚于 ${end}，当前候选记录的复核日期为：${sampleValues(candidates, '复核日期')}）`,
          },
        }
      }
      candidates = matched
      continue
    }

    const keyword = filter[condition].trim()
    if (!keyword) {
      continue
    }
    // 核销编号/核销依据/复核人三个文本条件各自只在自己的字段里匹配，
    // 不复用全字段 includes，避免复核人与核销结论撞字段时互相放行。
    const matched = candidates.filter((row) =>
      condition === '核销依据'
        ? readClearanceBasis(row).includes(keyword)
        : String(row[condition] ?? '').includes(keyword),
    )
    if (matched.length === 0) {
      return {
        kind: 'blocked',
        blocked: {
          condition,
          expected: `包含「${keyword}」`,
          candidates: sampleValues(candidates, condition),
          message: `没有命中：条件「${condition}」未通过（要求包含「${keyword}」，当前候选记录的${condition}为：${sampleValues(candidates, condition)}）`,
        },
      }
    }
    candidates = matched
  }
  return { kind: 'match', rows: candidates }
}

export function listClearanceEntries(
  filter: ClearanceFilterState,
  page = 1,
  size = CLEARANCE_PAGE_SIZE,
): ClearancePageResult {
  const all = listRows('clearance')
  const stage = narrowClearance(all, filter)

  if (stage.kind === 'blocked') {
    return {
      items: [],
      total: 0,
      page: 1,
      size,
      totalPages: 0,
      blocked: stage.blocked,
    }
  }

  const matched = stage.rows
  const totalPages = Math.max(1, Math.ceil(matched.length / size))
  const currentPage = Math.min(Math.max(1, Math.floor(page)), totalPages)
  const start = (currentPage - 1) * size
  return {
    items: matched.slice(start, start + size),
    total: matched.length,
    page: currentPage,
    size,
    totalPages,
    blocked: null,
  }
}

// 复核人取到极值（全部核销单中字典序最小或最大，含空值）的记录一律退回核对：
// 本次流转不放行，并把单据退回「待复核」、标为异常，等人工核对后再走流程。
function reviewerExtremum(all: EntryRow[], reviewer: string): { extreme: true; which: string } | null {
  const names = all.map((row) => String(row['复核人'] ?? '').trim())
  const filled = names.filter(Boolean)
  if (reviewer === '' || filled.length === 0) {
    return { extreme: true, which: '复核人为空' }
  }
  const min = filled.reduce((a, b) => (a.localeCompare(b, 'zh-Hans-CN') <= 0 ? a : b))
  const max = filled.reduce((a, b) => (a.localeCompare(b, 'zh-Hans-CN') >= 0 ? a : b))
  if (reviewer === min) {
    return { extreme: true, which: `复核人「${reviewer}」取到全部核销单中的最小值` }
  }
  if (reviewer === max) {
    return { extreme: true, which: `复核人「${reviewer}」取到全部核销单中的最大值` }
  }
  return null
}

// 确认核销后，结论落到边坡形变清单：追加一条「重新建档」测点。
// 核销依据与筛选侧共用 readClearanceBasis，保证两条路径读到的同一份依据不两样。
function appendSlopeRebuild(row: EntryRow): void {
  const slopeRows = listRows('slope')
  const nextId = slopeRows.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
  const rebuildCount =
    slopeRows.filter((item) => String(item['形变状态']) === '重新建档').length + 1
  const rebuild: EntryRow = {
    id: nextId,
    status: '待观测',
    pending: true,
    abnormal: false,
    测点编号: `REBK-${String(rebuildCount).padStart(4, '0')}`,
    所属隐患点: String(row['所属隐患点'] ?? ''),
    监测方式: '核销后重新建档',
    本期位移: '0',
    累计位移: '0',
    观测日期: String(row['复核日期'] ?? ''),
    观测人: String(row['复核人'] ?? ''),
    形变状态: '重新建档',
    核销依据: readClearanceBasis(row),
    核销编号: String(row['核销编号'] ?? ''),
  }
  saveRows('slope', [...slopeRows, rebuild])
}

type AdvanceOutcome =
  | { ok: true; message: string; deduplicated: boolean }
  | { ok: false; message: string }

export function advanceClearance(id: number, action: string): AdvanceOutcome {
  const step = CLEARANCE_FLOW.find((item) => item.action === action)
  if (!step) {
    return { ok: false, message: `核销单没有登记「${action}」这个动作` }
  }

  const all = listRows('clearance')
  const index = all.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的核销单` }
  }
  const row = all[index]
  const current = String(row.status)

  // 幂等：同一单据同一动作连续点两次，只记一次，不重复落边坡、不重复留痕。
  if (hasLedgerRecord(id, action)) {
    return {
      ok: true,
      deduplicated: true,
      message: `「${action}」已记录过，连续操作只记一次，当前状态「${current}」`,
    }
  }

  const reviewer = String(row['复核人'] ?? '').trim()
  const extreme = reviewerExtremum(all, reviewer)
  if (extreme) {
    const bounced: EntryRow = { ...row, status: '待复核', pending: true, abnormal: true }
    const next = [...all]
    next[index] = bounced
    saveRows('clearance', next)
    return {
      ok: false,
      message: `${extreme.which}，该记录一律退回核对：已退回「待复核」并标记异常，核对后再提交`,
    }
  }

  // 顺序流转：只接受指定的上一环节；已到目标态或从其它环节越级都挡下。
  if (current === step.to) {
    return { ok: false, message: `核销单已经是「${step.to}」，不用重复操作` }
  }
  if (current !== step.from) {
    return {
      ok: false,
      message: `流转被挡下：「${action}」只能在「${step.from}」环节办理，当前为「${current}」，不能越级`,
    }
  }

  const updated: EntryRow = {
    ...row,
    status: step.to,
    pending: step.to !== '已核销',
    abnormal: step.to === '已驳回',
  }
  const next = [...all]
  next[index] = updated
  saveRows('clearance', next)

  appendClearanceLedger({
    id,
    核销编号: String(row['核销编号'] ?? ''),
    action,
    from: step.from,
    to: step.to,
    at: new Date().toISOString(),
  })

  if (action === '确认核销') {
    appendSlopeRebuild(updated)
    return {
      ok: true,
      deduplicated: false,
      message: `核销单已确认核销，结论已落到边坡形变清单并新增一条「重新建档」项`,
    }
  }
  return { ok: true, deduplicated: false, message: `核销单已${action}，当前状态「${step.to}」` }
}

// 看板状态分布：统计全部核销单（不是当前页）。
export function clearanceStatusSummary(statuses: string[]) {
  const all = listRows('clearance')
  return statuses.map((status) => ({
    status,
    count: all.filter((row) => String(row.status) === status).length,
  }))
}

// 留痕条目数：供看板展示流转记录量。
export function ledgerSize(): number {
  return listClearanceLedger().length
}
