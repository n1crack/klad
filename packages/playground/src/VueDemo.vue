<script setup lang="ts">
import { OrgChart } from '@n1crack/orgchart-vue'
import type { NodeContext, Options, OrgChartApi } from '@n1crack/orgchart-vue'
import { computed, ref } from 'vue'
import { DEPARTMENT_COLOR, initials, type Department, type Example } from './data.js'

const props = defineProps<{ example: Example }>()
const emit = defineEmits<{ ready: [OrgChartApi] }>()

const chartRef = ref<{ api: OrgChartApi | null } | null>(null)

const DEFAULT_NODE_SIZE = { w: 180, h: 64 }

type Item = NodeContext['item']

const options = computed<Options>(() => ({
  data: props.example.data,
  nodeSize: DEFAULT_NODE_SIZE,
  label: (item) => String(item.name ?? ''),
  ...props.example.options,
}))

function handleReady(): void {
  if (chartRef.value?.api) emit('ready', chartRef.value.api)
}

// Shared by the avatar/status/photo templates below, mirroring the vanilla
// demo's renderAvatar/renderStatus/renderPhoto so both stacks land on the
// same colours for the same department.
function departmentOf(item: Item): Department {
  return (item.department as Department | undefined) ?? 'Executive'
}
function departmentColor(item: Item): string {
  return DEPARTMENT_COLOR[departmentOf(item)]
}
function photoGradient(item: Item): string {
  const colour = departmentColor(item)
  return `linear-gradient(155deg, ${colour}, color-mix(in srgb, ${colour} 55%, black))`
}
function headcountOf(item: Item): number {
  return Number(item.headcount ?? 0)
}
</script>

<template>
  <OrgChart ref="chartRef" :options="options" class="chart-host" @ready="handleReady">
    <!--
      One `#node` slot, branching on `example.content` — the same tag the
      vanilla demo switches on to pick a render function. `v-if` directly on
      the `<template #node>` tag is what lets the "canvas only" example omit
      the slot entirely: when the condition is false, the child component
      sees no `node` slot at all, not an empty one, so no overlay element is
      created — matching the vanilla path, which never sets `renderNode`.
    -->
    <template v-if="example.content !== 'none'" #node="{ item, hasChildren, open, toggle }">
      <div v-if="example.content === 'avatar'" class="avatar-card">
        <div class="avatar-circle" :style="{ background: departmentColor(item) }">
          {{ initials(String(item.name ?? '')) }}
        </div>
        <div class="avatar-text">
          <strong>{{ String(item.name ?? '') }}</strong>
          <small>{{ String(item.title ?? '') }}</small>
        </div>
        <button v-if="hasChildren" type="button" class="toggle-btn" @click="toggle">
          {{ open ? '−' : '+' }}
        </button>
      </div>

      <div
        v-else-if="example.content === 'monogram'"
        class="monogram-card"
        :style="{ '--accent': departmentColor(item) }"
      >
        <div class="monogram-circle">{{ initials(String(item.name ?? '')) }}</div>
        <span class="monogram-name">{{ String(item.name ?? '') }}</span>
      </div>

      <div
        v-else-if="example.content === 'status'"
        class="status-card"
        :style="{ '--accent': departmentColor(item) }"
      >
        <strong>{{ String(item.name ?? '') }}</strong>
        <small>{{ String(item.title ?? '') }}</small>
        <div class="status-badges">
          <span class="badge badge-dept">{{ departmentOf(item) }}</span>
          <span v-if="headcountOf(item) > 0" class="badge badge-count">
            {{ headcountOf(item) }} report{{ headcountOf(item) === 1 ? '' : 's' }}
          </span>
        </div>
      </div>

      <div v-else-if="example.content === 'photo'" class="photo-tile">
        <div class="photo-image" :style="{ background: photoGradient(item) }">
          <span>{{ initials(String(item.name ?? '')) }}</span>
        </div>
        <div class="photo-caption">
          <strong>{{ String(item.name ?? '') }}</strong>
          <small>{{ String(item.title ?? '') }}</small>
        </div>
        <button v-if="hasChildren" type="button" class="toggle-btn" @click="toggle">
          {{ open ? '−' : '+' }}
        </button>
      </div>

      <div v-else class="card">
        <strong>{{ String(item.name ?? '') }}</strong>
        <small>{{ String(item.title ?? '') }}</small>
        <button v-if="hasChildren" type="button" class="toggle-btn" @click="toggle">
          {{ open ? '−' : '+' }}
        </button>
      </div>
    </template>
  </OrgChart>
</template>
