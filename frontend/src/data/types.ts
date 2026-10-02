/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
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

// 隐患核销的筛选条件：三个文本条件 + 核销结论多选 + 复核日期起止区间。
export type ClearanceFilterState = {
  核销编号: string
  核销依据: string
  复核人: string
  核销结论: string[]
  复核日期起: string
  复核日期止: string
}

// 未命中时逐条件收窄后，拦下全部候选记录的那个条件（含判定明细）。
export type ClearanceBlockedCondition = {
  condition: string
  expected: string
  candidates: string
  message: string
}

export type ClearancePageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
  totalPages: number
  blocked: ClearanceBlockedCondition | null
}

// 核销流转留痕：一次成功流转只记一条，连续重复点击不追加。
export type ClearanceLedgerEntry = {
  id: number
  核销编号: string
  action: string
  from: string
  to: string
  at: string
}

export type ActionResult = {
  ok: boolean
  message: string
  // 命中幂等去重（连续重复操作只记一次）时为 true，不产生新流转。
  deduplicated?: boolean
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
