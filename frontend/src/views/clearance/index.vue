<template>
  <section class="page" data-module="clearance">
    <header class="page-head">
      <div>
        <h2>隐患核销管理</h2>
        <p class="page-desc">维护核销单，围绕核销编号、核销依据、复核人做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记核销单</button>
        <button class="btn" type="button" @click="exportRows">导出隐患核销清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar clearance-filter" @submit.prevent="queryFirstPage">
      <label class="filter-item">
        <span>核销编号</span>
        <input v-model="filters.核销编号" placeholder="按核销编号检索" />
      </label>
      <label class="filter-item">
        <span>核销依据</span>
        <input v-model="filters.核销依据" placeholder="按核销依据检索" />
      </label>
      <label class="filter-item">
        <span>复核人</span>
        <input v-model="filters.复核人" placeholder="按复核人检索" />
      </label>
      <fieldset class="filter-item filter-multi">
        <legend>核销结论（可多选）</legend>
        <label v-for="option in conclusionOptions" :key="option" class="check-item">
          <input
            type="checkbox"
            :value="option"
            :checked="filters.核销结论.includes(option)"
            @change="toggleConclusion(option)"
          />
          {{ option }}
        </label>
      </fieldset>
      <label class="filter-item">
        <span>复核日期起</span>
        <input v-model="filters.复核日期起" type="date" />
      </label>
      <label class="filter-item">
        <span>复核日期止</span>
        <input v-model="filters.复核日期止" type="date" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            {{ row.status }}
            <span v-if="row.abnormal" class="abnormal-tag">待核对</span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">
            {{ blockedMessage || '暂无隐患核销数据，可先登记核销单' }}
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot clearance-foot">
      <span>共 {{ total }} 条隐患核销记录</span>
      <div v-if="totalPages > 1" class="pager">
        <button class="btn" type="button" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
        <span>第 {{ page }} / {{ totalPages }} 页</span>
        <button
          class="btn"
          type="button"
          :disabled="page >= totalPages"
          @click="goPage(page + 1)"
        >
          下一页
        </button>
      </div>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import {
  CLEARANCE_CONCLUSIONS,
  CLEARANCE_PAGE_SIZE,
  advanceClearance,
  clearanceStatusSummary,
  emptyClearanceFilter,
  ledgerSize,
  listClearanceEntries,
} from '@/api/clearance-service'
import { downloadEntries, moduleMeta } from '@/api/local-service'
import type { ClearanceFilterState, EntryRow } from '@/data/types'

const meta = moduleMeta('clearance')
const columns = ["核销编号", "所属隐患点", "核销依据", "复核人", "复核日期", "核销结论", "归档日期", "核销状态"]
const actions = ["提交复核", "确认核销", "驳回申请"]
const statuses = ["待复核", "复核中", "已核销", "已驳回"]
const conclusionOptions = CLEARANCE_CONCLUSIONS

const rows = ref<EntryRow[]>([])
const total = ref(0)
const page = ref(1)
const totalPages = ref(1)
const blockedMessage = ref('')
const errorMessage = ref('')
const filters = ref<ClearanceFilterState>(emptyClearanceFilter())

const statusSummary = ref(clearanceStatusSummary(statuses))
const stats = ref([
  { label: '待复核核销单', value: countStatus('待复核') },
  { label: '已核销隐患点', value: countStatus('已核销') },
  { label: '已驳回申请', value: countStatus('已驳回') },
  { label: '核销流转记录', value: ledgerSize() },
])

function countStatus(status: string): number {
  return statusSummary.value.find((item) => item.status === status)?.count ?? 0
}

function refreshSummaries() {
  statusSummary.value = clearanceStatusSummary(statuses)
  stats.value = [
    { label: '待复核核销单', value: countStatus('待复核') },
    { label: '已核销隐患点', value: countStatus('已核销') },
    { label: '已驳回申请', value: countStatus('已驳回') },
    { label: '核销流转记录', value: ledgerSize() },
  ]
}

function toggleConclusion(option: string) {
  const picked = filters.value.核销结论
  filters.value.核销结论 = picked.includes(option)
    ? picked.filter((item) => item !== option)
    : [...picked, option]
}

function resetFilters() {
  filters.value = emptyClearanceFilter()
  page.value = 1
  reload()
}

function queryFirstPage() {
  page.value = 1
  reload()
}

function goPage(target: number) {
  page.value = target
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '核销单登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = advanceClearance(Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  const payload = listClearanceEntries(filters.value, page.value, CLEARANCE_PAGE_SIZE)
  rows.value = payload.items
  total.value = payload.total
  page.value = payload.page
  totalPages.value = payload.totalPages
  blockedMessage.value = payload.blocked
    ? `${payload.blocked.message}（判定优先级：复核人先于核销结论）`
    : ''
  refreshSummaries()
}

onMounted(reload)
</script>

<style scoped>
.clearance-filter {
  align-items: flex-start;
}
.filter-multi {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 8px;
}
.filter-multi legend {
  font-size: 12px;
  color: var(--muted);
  padding: 0 4px;
}
.check-item {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 13px;
  margin-right: 8px;
  white-space: nowrap;
}
.clearance-foot {
  align-items: center;
  gap: 12px;
}
.pager {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.pager .btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.abnormal-tag {
  margin-left: 4px;
  background: #fef3c7;
  color: #92400e;
  border-radius: 999px;
  padding: 0 8px;
  font-size: 12px;
}
</style>
