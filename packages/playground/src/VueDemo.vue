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
 * `options` computed below (so a REMOUNT — e.g. switching example/stack —
 * starts the fresh chart with the current values baked in), but reading a
 * plain variable inside `computed` does not register it as a reactive
 * dependency. If it did — if these were refs — then changing either one
 * would recompute `options` to a new object, which OrgChart.vue's own
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

const options = computed<Options>(() => ({
  data: props.example.data,
  nodeSize: DEFAULT_NODE_SIZE,
  label: (item) => String(item.name ?? ''),
  ...props.example.options,
  theme: themeFor(props.example, EDGE_RADIUS_DEFAULT),
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

/**
 * `edgeCornerRadius` lives under `theme`, and used to require a full
 * `<OrgChart :key="...">` remount to change post-construction (theme was
 * resolved exactly once, at `createOrgChart`, and `chart.update()` never
 * re-resolved it). `OrgChartApi.setTheme` (packages/vanilla/src/index.ts)
 * fixes that: it merges a partial theme over whatever the chart is already
 * showing, re-resolves it, and repaints — paint-only, so this no longer
 * resets camera position or expand/collapse state the way the remount used
 * to on every drag tick.
 */
function setEdgeRadius(radius: number): void {
  chartRef.value?.api?.setTheme({ edgeCornerRadius: radius })
}

/** Same `setTheme` path as `setEdgeRadius` — see its comment. */
function setNodeFill(nodeFill: string): void {
  chartRef.value?.api?.setTheme({ nodeFill })
}

/** Same `setTheme` path — the `block`-tier shape-fill colour. */
function setBlockFill(blockFill: string): void {
  chartRef.value?.api?.setTheme({ blockFill })
}

/** Same `setTheme` path — the confirmation ring's colour. */
function setRingStroke(ringStroke: string): void {
  chartRef.value?.api?.setTheme({ ringStroke })
}

/** `OrgChartApi.setRing` — NOT a theme token, so it goes through its own
 * method rather than `setTheme`; see `Options.ring`'s docblock in
 * packages/vanilla/src/index.ts. */
function setRingEnabled(enabled: boolean): void {
  chartRef.value?.api?.setRing(enabled)
}

defineExpose({
  setMinimap,
  setMinimapPosition,
  setEdgeRadius,
  setNodeFill,
  setBlockFill,
  setRingStroke,
  setRingEnabled,
})

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
