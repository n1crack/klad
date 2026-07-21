<script setup lang="ts">
import { OrgChart } from '@n1crack/orgchart-vue'
import type { Options, OrgChartApi } from '@n1crack/orgchart-vue'
import { computed, ref } from 'vue'
import type { Example } from './data.js'

const props = defineProps<{ example: Example }>()
const emit = defineEmits<{ ready: [OrgChartApi] }>()

const chartRef = ref<{ api: OrgChartApi | null } | null>(null)

const DEFAULT_NODE_SIZE = { w: 180, h: 64 }

const options = computed<Options>(() => ({
  data: props.example.data,
  nodeSize: DEFAULT_NODE_SIZE,
  label: (item) => String(item.name ?? ''),
  ...props.example.options,
}))

function handleReady(): void {
  if (chartRef.value?.api) emit('ready', chartRef.value.api)
}
</script>

<template>
  <OrgChart ref="chartRef" :options="options" class="chart-host" @ready="handleReady">
    <template #node="{ item, hasChildren, open, toggle }">
      <div class="card">
        <strong>{{ String(item.name ?? '') }}</strong>
        <small>{{ String(item.title ?? '') }}</small>
        <button v-if="hasChildren" type="button" class="toggle-btn" @click="toggle">
          {{ open ? '−' : '+' }}
        </button>
      </div>
    </template>
  </OrgChart>
</template>
