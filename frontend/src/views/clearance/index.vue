<template>
  <section class="page" data-module="clearance">
    <header class="page-head">
      <div>
        <h2>隐患核销管理</h2>
        <p class="page-desc">维护核销单，围绕核销编号、所属隐患点、核销依据、复核人做登记、筛选与状态流转。</p>
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

    <form class="filter-bar" @submit.prevent="search">
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
      <div class="filter-item">
        <span>核销结论（可多选）</span>
        <div class="check-group">
          <label v-for="option in conclusionOptions" :key="option" class="check-item">
            <input v-model="filters.核销结论" type="checkbox" :value="option" />
            {{ option }}
          </label>
        </div>
      </div>
      <label class="filter-item">
        <span>复核日期</span>
        <span class="date-range">
          <input v-model="filters.复核日期起" type="date" />
          <span>至</span>
          <input v-model="filters.复核日期止" type="date" />
        </span>
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
          <td>{{ row.status }}</td>
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
            {{ missMessage || '暂无隐患核销数据，可先登记核销单' }}
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条隐患核销记录</span>
      <div class="pager">
        <button class="btn" type="button" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
        <button
          v-for="item in pageCount"
          :key="item"
          class="btn"
          :class="{ current: item === page }"
          type="button"
          @click="goPage(item)"
        >
          {{ item }}
        </button>
        <button class="btn" type="button" :disabled="page >= pageCount" @click="goPage(page + 1)">下一页</button>
        <select v-model.number="size" @change="search">
          <option v-for="option in sizeOptions" :key="option" :value="option">每页 {{ option }} 条</option>
        </select>
      </div>
      <span class="foot-messages">
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
        <span v-else-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      </span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listClearanceEntries,
  listEntries,
  moduleMeta,
  runClearanceAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('clearance')
const columns = ["核销编号", "所属隐患点", "核销依据", "复核人", "复核日期", "核销结论", "归档日期", "核销状态"]
const actions = ["提交复核", "确认核销", "驳回申请"]
const statuses = ["待复核", "复核中", "已核销", "已驳回"]
const sizeOptions = [5, 10, 20]

const rows = ref<EntryRow[]>([])
const legendRows = ref<EntryRow[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(5)
const failedCondition = ref('')
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref({
  核销编号: '',
  核销依据: '',
  复核人: '',
  核销结论: [] as string[],
  复核日期起: '',
  复核日期止: '',
})

const stats = computed(() => [
  { label: '待复核核销单', value: countStatus('待复核') },
  { label: '已核销隐患点', value: countStatus('已核销') },
  { label: '已驳回申请', value: countStatus('已驳回') },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({ status, count: countStatus(status) })),
)
const conclusionOptions = computed(() => [
  ...new Set(legendRows.value.map((row) => String(row['核销结论'] ?? '')).filter((item) => item !== '')),
])
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / size.value)))
const missMessage = computed(() =>
  failedCondition.value === '' ? '' : `没有命中：条件「${failedCondition.value}」没过，请调整该条件后重新查询`,
)

function countStatus(status: string): number {
  return legendRows.value.filter((row) => String(row.status) === status).length
}

function resetFilters() {
  filters.value = { 核销编号: '', 核销依据: '', 复核人: '', 核销结论: [], 复核日期起: '', 复核日期止: '' }
  search()
}

function search() {
  page.value = 1
  errorMessage.value = ''
  noticeMessage.value = ''
  reload()
}

function goPage(target: number) {
  if (target < 1 || target > pageCount.value || target === page.value) {
    return
  }
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
  noticeMessage.value = ''
  const result = runClearanceAction(Number(row.id), action)
  if (result.ok) {
    noticeMessage.value = result.message
  } else {
    errorMessage.value = result.message
  }
  // 越级拦截、极值退回也会改数据，无论成败都刷新一遍
  reload()
}

function reload() {
  try {
    const payload = listClearanceEntries({ ...filters.value, page: page.value, size: size.value })
    rows.value = payload.items
    total.value = payload.total
    page.value = payload.page
    failedCondition.value = payload.failedCondition
    legendRows.value = listEntries(meta.key).items
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '隐患核销列表读取失败'
  }
}

onMounted(reload)
</script>
