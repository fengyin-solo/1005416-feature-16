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

export type ActionResult = {
  ok: boolean
  message: string
}

/** 隐患核销的查询条件：编号/依据/复核人按文本卡，核销结论多选，复核日期按起止区间卡。 */
export type ClearanceQuery = {
  核销编号?: string
  核销依据?: string
  复核人?: string
  核销结论?: string[]
  复核日期起?: string
  复核日期止?: string
  page?: number
  size?: number
}

export type ClearancePage = PageResult & {
  /** 没有命中时是哪一个条件没过；空串表示不是被条件卡掉的 */
  failedCondition: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
