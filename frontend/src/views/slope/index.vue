<template>
  <section class="page" data-module="slope">
    <header class="page-head">
      <div>
        <h2>边坡形变管理</h2>
        <p class="page-desc">维护边坡观测点，围绕测点编号、所属隐患点、监测方式、本期位移做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记边坡观测点</button>
        <button class="btn" type="button" @click="exportRows">导出边坡形变清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-if="rebuildCount" class="legend-item rebuild-legend">
        核销后重新建档：{{ rebuildCount }} 条（核销依据与隐患核销同源）
      </span>
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in displayColumns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'rebuild-row': row['形变状态'] === '重新建档' }">
          <td v-for="column in displayColumns" :key="column">{{ row[column] ?? '—' }}</td>
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
          <td :colspan="displayColumns.length + 2" class="empty-state">暂无边坡形变数据，可先登记边坡观测点</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条边坡形变记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('slope')
const columns = ["测点编号", "所属隐患点", "监测方式", "本期位移", "累计位移", "观测日期", "观测人", "形变状态"]
// 确认核销落过来的「重新建档」项带核销编号与核销依据（与隐患核销同源），出现时多展两列。
const rebuildColumns = ["核销编号", "核销依据"]
const actions = ["提交观测", "标记加剧", "办理停测"]
const statuses = ["待观测", "正常", "变形加剧", "已停测"]
const stats = [{"label": "待观测测点", "value": 0}, {"label": "变形加剧测点", "value": 0}, {"label": "本期最大位移", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const hasRebuild = computed(() => rows.value.some((row) => String(row['形变状态']) === '重新建档'))
const displayColumns = computed(() =>
  hasRebuild.value ? [...columns, ...rebuildColumns] : columns,
)
const rebuildCount = computed(
  () => rows.value.filter((row) => String(row['形变状态']) === '重新建档').length,
)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '边坡观测点登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '边坡形变列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.rebuild-row {
  background: #ecfdf3;
}
.rebuild-legend {
  background: #d1fadf;
  color: #027a48;
}
</style>
