<script setup lang="ts">
import { Klad } from '@klad/vue'
import type { KladApi, NodeContext, Options, Theme } from '@klad/vue'
import { computed, ref } from 'vue'
import {
  DEPARTMENT_COLOR,
  EDGE_RADIUS_DEFAULT,
  initials,
  minimapDefaultOn,
  minimapDefaultPosition,
  minimapOptionFor,
  modeThemeFor,
  themeFor,
  type Department,
  type Example,
  type MinimapPosition,
} from './data.js'
import type { ThemeMode } from './theme.js'

const props = defineProps<{ example: Example; mode: ThemeMode }>()
const emit = defineEmits<{ ready: [KladApi] }>()

const chartRef = ref<{ api: KladApi | null } | null>(null)

const DEFAULT_NODE_SIZE = { w: 180, h: 64 }

type Item = NodeContext['item']

/**
 * Whether the minimap is on, and which corner it's in, for THIS mounted
 * chart. Deliberately PLAIN variables, not `ref`s: they still feed the
 * `options` computed below (so a REMOUNT — e.g. switching example/stack —
 * starts the fresh chart with the current values baked in), but reading a
 * plain variable inside `computed` does not register it as a reactive
 * dependency. If it did — if these were refs — then changing either one
 * would recompute `options` to a new object, which Klad.vue's own
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
/** The viewer's own silhouette colour, or `null` while the mode's default applies. */
let minimapSilhouette: string | null = null

function minimapOption(): NonNullable<Options['minimap']> {
  const base = minimapOptionFor(props.example, minimapOn, minimapPosition, currentMode)
  // `typeof base !== 'object'` rather than `=== false`: the option's type
  // allows a bare `true`, which has nowhere to carry a colour.
  if (typeof base !== 'object' || minimapSilhouette === null) return base
  return { ...base, silhouetteColour: minimapSilhouette }
}

/**
 * The light/dark mode this chart MOUNTED in, read once. Same reasoning as
 * `minimapOn` above: `props.mode` is set at `createApp` and never updated
 * (main.ts flips the mode through `setMode` below, not by re-rendering), but
 * reading it inside the `options` computed anyway would make a future prop
 * update recompute `options` and hand the adapter a `chart.update()` that
 * resets every node's open/closed state.
 */
const mountedMode: ThemeMode = props.mode

/** The mode the chart is in NOW — `mountedMode` moved on by `setMode` below. */
let currentMode: ThemeMode = mountedMode

const options = computed<Options>(() => ({
  data: props.example.data,
  nodeSize: DEFAULT_NODE_SIZE,
  label: (item) => String(item.name ?? ''),
  ...props.example.options,
  theme: themeFor(props.example, EDGE_RADIUS_DEFAULT, mountedMode),
  minimap: minimapOption(),
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
  chartRef.value?.api?.setMinimap(minimapOption())
}

function setMinimapPosition(position: MinimapPosition): void {
  minimapPosition = position
  chartRef.value?.api?.setMinimap(minimapOption())
}

/**
 * One door for every theme token the sidebar owns. `KladApi.setTheme`
 * (packages/vanilla/src/index.ts) merges a partial over whatever the chart is
 * already showing and repaints — paint-only, so unlike the `<Klad :key>`
 * remount this used to need, it keeps camera position and expand/collapse
 * state exactly where they were.
 */
function setTheme(partial: Partial<Theme>): void {
  chartRef.value?.api?.setTheme(partial)
}

/** The minimap's silhouette — an option rather than a theme token, and the one
 * part of the widget a host stylesheet cannot reach. */
function setMinimapSilhouette(colour: string): void {
  minimapSilhouette = colour
  chartRef.value?.api?.setMinimap(minimapOption())
}

/** `KladApi.setRing` — NOT a theme token, so it goes through its own
 * method rather than `setTheme`; see `Options.ring`'s docblock in
 * packages/vanilla/src/index.ts. */
function setRingEnabled(enabled: boolean): void {
  chartRef.value?.api?.setRing(enabled)
}

/**
 * Light/dark. Same paint-only `setTheme` path as every control above — the
 * canvas's node fill and stroke must move with the CSS the cards over them
 * use, or the canvas box shows around each card's edges (see theme.ts).
 */
function setMode(mode: ThemeMode): void {
  currentMode = mode
  chartRef.value?.api?.setTheme(modeThemeFor(props.example, mode))
  // The silhouette is the one piece of the minimap a host stylesheet cannot
  // reach (see `silhouetteColour` in theme.ts), so it is re-applied through
  // the option — only while the widget is actually showing.
  if (minimapOn) chartRef.value?.api?.setMinimap(minimapOption())
}

defineExpose({
  setMinimap,
  setMinimapPosition,
  setMinimapSilhouette,
  setTheme,
  setRingEnabled,
  setMode,
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
  <Klad ref="chartRef" :options="options" class="chart-host" @ready="handleReady">
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
  </Klad>
</template>
