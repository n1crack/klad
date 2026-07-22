<script setup lang="ts">
import { OrgChart } from '@n1crack/orgchart-vue'
import type { NodeContext, Options, OrgChartApi } from '@n1crack/orgchart-vue'
import { computed, ref } from 'vue'
import {
  DEPARTMENT_COLOR,
  EDGE_RADIUS_DEFAULT,
  initials,
  minimapDefaultOn,
  minimapDefaultPosition,
  minimapOptionFor,
  themeFor,
  type Department,
  type Example,
  type MinimapPosition,
} from './data.js'

const props = defineProps<{ example: Example }>()
const emit = defineEmits<{ ready: [OrgChartApi] }>()

const chartRef = ref<{ api: OrgChartApi | null } | null>(null)

const DEFAULT_NODE_SIZE = { w: 180, h: 64 }

type Item = NodeContext['item']

/**
 * Whether the minimap is on, and which corner it's in, for THIS mounted
 * chart. Deliberately PLAIN variables, not `ref`s: they still feed the
 * `options` computed below (so a later remount — see `edgeRadius` — starts
 * the fresh chart with the current values baked in), but reading a plain
 * variable inside `computed` does not register it as a reactive dependency.
 * If it did — if these were refs — then changing either one would recompute
 * `options` to a new object, which OrgChart.vue's own
 * `watch(() => props.options, ..., { deep: true })` would see as a prop
 * change and respond to with `chart.update()`, which calls `initOpen()` and
 * resets every node's open/closed state. That is exactly the reset
 * `setMinimap`/`setMinimapPosition` below are trying to AVOID by calling the
 * API directly — so the state that decides what to bake into the next
 * remount has to stay out of Vue's reactivity entirely. (A version of this
 * file that used `ref` here shipped briefly and was caught by hand: toggling
 * the minimap silently re-expanded a manually collapsed subtree. Confirmed
 * with Playwright — collapse a node, click the toggle, watch it come back.)
 */
let minimapOn = minimapDefaultOn(props.example)
let minimapPosition: MinimapPosition = minimapDefaultPosition(props.example)

/**
 * `edgeCornerRadius` lives under `theme`, and theme is resolved exactly once
 * at chart construction (`resolveTheme(options.theme)` in
 * `packages/vanilla/src/index.ts`) — `chart.update()`, which is all
 * OrgChart.vue's own `watch(() => props.options, ...)` ever calls, merges
 * its `partial` into `currentOptions` but never re-resolves or re-applies
 * theme. Routing a theme change through the normal reactive-options path
 * would therefore be a silent no-op: `update()` would run and nothing would
 * be redrawn differently. This one IS a real `ref` (unlike `minimapOn`/
 * `minimapPosition` above) because changing it is meant to force exactly the
 * reactive response those two have to avoid: the `:key="edgeRadius"` on
 * `<OrgChart>` below turns a change to this ref into a full remount — Vue
 * tears down the whole `<OrgChart>` instance and mounts a fresh one,
 * `onMounted` runs again, and `createOrgChart` gets called with the new
 * theme baked in from scratch (picking up the current `minimapOn`/
 * `minimapPosition` values too, since `options` below reads them at that
 * moment). A real `setTheme` API (mirroring `setMinimap`) would let this go
 * through the cheap, state-preserving path instead; see the playground's
 * polish report. This remount does lose camera position and expand/collapse
 * state on every drag tick, unlike `setMinimap`/`setMinimapPosition`.
 */
const edgeRadius = ref(EDGE_RADIUS_DEFAULT)

const options = computed<Options>(() => ({
  data: props.example.data,
  nodeSize: DEFAULT_NODE_SIZE,
  label: (item) => String(item.name ?? ''),
  ...props.example.options,
  theme: themeFor(props.example, edgeRadius.value),
  minimap: minimapOptionFor(props.example, minimapOn, minimapPosition),
}))

function handleReady(): void {
  if (chartRef.value?.api) emit('ready', chartRef.value.api)
}

function setMinimap(on: boolean): void {
  minimapOn = on
  // Apply it straight through the API, not by letting a reactive `options`
  // change flow into the adapter's `update()` — that would reset the tree's
  // expand/collapse state as an unrelated side effect. See the comment on
  // `minimapOn` above for why it is a plain variable, not a `ref`, which is
  // what makes this safe rather than merely apparently safe.
  chartRef.value?.api?.setMinimap(minimapOptionFor(props.example, on, minimapPosition))
}

function setMinimapPosition(position: MinimapPosition): void {
  minimapPosition = position
  chartRef.value?.api?.setMinimap(minimapOptionFor(props.example, minimapOn, position))
}

function setEdgeRadius(radius: number): void {
  // Updating the ref is enough: the `:key="edgeRadius"` on `<OrgChart>` below
  // does the rest by forcing a remount — see the comment on the ref above
  // for why a plain reactive `options` update (`chart.update()`) would not.
  edgeRadius.value = radius
}

defineExpose({ setMinimap, setMinimapPosition, setEdgeRadius })

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
  <OrgChart :key="edgeRadius" ref="chartRef" :options="options" class="chart-host" @ready="handleReady">
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
        <button v-if="hasChildren" type="button" class="toggle-btn" @click="toggle">
          {{ open ? '−' : '+' }}
        </button>
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
