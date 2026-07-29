<script setup lang="ts">
import { Klad } from '@klad/vue'
import type { KladApi, LayoutSettings, NodeContext, Options, Theme } from '@klad/vue'
import { computed, onBeforeUnmount, ref } from 'vue'
import { createAccordionSlide, createDrill, goTo } from './demo-behaviour.js'
import { openPickerFor, overflowLabel } from './overflow-card.js'
import {
  DEPARTMENT_COLOR,
  accordionProgress,
  EDGE_RADIUS_DEFAULT,
  initials,
  minimapDefaultOn,
  minimapDefaultPosition,
  minimapOptionFor,
  modeThemeFor,
  dropDetail,
  rowFields,
  isBranchRow,
  optionsForLayout,
  contentForLayout,
  themeFor,
  type Department,
  type Example,
  type LayoutName,
  type MinimapPosition,
} from './data.js'
import type { ThemeMode } from './theme.js'

const props = defineProps<{ example: Example; layout: LayoutName; mode: ThemeMode }>()
const emit = defineEmits<{
  ready: [KladApi]
  drop: [{ ids: string[]; parentId: string | null; mode: string }]
  centreChange: [string | null]
}>()

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

/**
 * The node-content treatment for this example under this LAYOUT — see
 * `LAYOUT_PRESETS` in data.ts. Read once, like `mountedMode`: changing the
 * layout remounts the demo (main.ts's `show`), so this never needs to be
 * reactive, and making it so would feed `options` a change the adapter
 * answers with a full `update()`.
 */
const content = contentForLayout(props.example, props.layout)

/** The mode the chart is in NOW — `mountedMode` moved on by `setMode` below. */
let currentMode: ThemeMode = mountedMode

const options = computed<Options>(() => ({
  data: props.example.data,
  nodeSize: DEFAULT_NODE_SIZE,
  label: (item) => String(item.name ?? ''),
  ...optionsForLayout(props.example, props.layout),
  theme: themeFor(props.example, props.layout, EDGE_RADIUS_DEFAULT, mountedMode),
  minimap: minimapOption(),
}))

function handleReady(): void {
  if (chartRef.value?.api) emit('ready', chartRef.value.api)
}

/**
 * The drop log, reported the same way the vanilla demo does — see
 * `dropDetail`. Not `preventDefault()`-ed: the point of the example is that
 * the chart applies the move, and a demo that vetoed every drop would be
 * demonstrating the veto.
 */
function handleNodeDrop(event: { ids: string[]; parentId: string | null; mode: string }): void {
  emit('drop', dropDetail(props.example.data, event.ids, event.parentId, event.mode))
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

/** Live layout tuning — see `KladApi.setLayoutOptions`. Straight through the
 * API like every other control here, so a slider drag never resets the tree. */
function setLayoutOptions(settings: LayoutSettings, fit: boolean): void {
  chartRef.value?.api?.setLayoutOptions(settings, { fit })
}

/**
 * Light/dark. Same paint-only `setTheme` path as every control above — the
 * canvas's node fill and stroke must move with the CSS the cards over them
 * use, or the canvas box shows around each card's edges (see theme.ts).
 */
function setMode(mode: ThemeMode): void {
  currentMode = mode
  chartRef.value?.api?.setTheme(modeThemeFor(props.example, props.layout, mode))
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
  setLayoutOptions,
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

const ROLE_OPTIONS = ['Owner', 'Reviewer', 'Observer'] as const

/**
 * The accordion's own slide. Shared with the other two stacks — see
 * `createAccordionSlide`: the node's HEIGHT follows the disclosure, and sizes
 * are declared rather than measured (layout runs in a worker with no DOM), so
 * the chart has to be told to re-read them on each frame of the ease.
 */
const slide = createAccordionSlide(() => chartRef.value?.api, props.example)
onBeforeUnmount(() => slide.stop())

function toggleDetail(item: Item): void {
  item.detail = item.detail !== true
  slide.start()
}

/**
 * A card changed something about ITSELF — a star toggled — so nothing in the
 * chart's own state moved and it has no reason to draw a frame. A paint-only
 * `setTheme({})` (a merge of nothing over the current theme, documented as
 * never touching tree, layout or camera) is how a demo card gets itself
 * redrawn without the library needing a "repaint" verb.
 */
function toggleStar(item: Item): void {
  item.starred = item.starred !== true
  chartRef.value?.api?.setTheme({})
}

function goToNode(id: string): void {
  const api = chartRef.value?.api
  if (api) goTo(api, id)
}

/**
 * The sunburst's drill-down, delivered through the adapter's own `nodeClick`
 * emit. The decision is shared with the other two stacks (`createDrill`); only
 * the delivery differs.
 */
const drill = createDrill(props.example, props.layout)

function handleNodeClick({ id }: { id: string }): void {
  const api = chartRef.value?.api
  if (!api) return
  const next = drill(id, api.getCentre())
  if (next === undefined) return
  api.setCentre(next)
  emit('centreChange', api.getCentre())
}
</script>

<template>
  <Klad
    ref="chartRef"
    :options="options"
    class="chart-host"
    @ready="handleReady"
    @node-drop="handleNodeDrop"
    @node-click="handleNodeClick"
  >
    <!--
      One `#node` slot, branching on the LAYOUT's content treatment — the same
      tag the vanilla demo switches on to pick a render function. `v-if` directly on
      the `<template #node>` tag is what lets the "canvas only" example omit
      the slot entirely: when the condition is false, the child component
      sees no `node` slot at all, not an empty one, so no overlay element is
      created — matching the vanilla path, which never sets `renderNode`.
    -->
    <template
      v-if="content !== 'none'"
      #node="{ id, item, hasChildren, open, toggle, overflow, loading, directChildren, descendants, depth, height, lft, rgt }"
    >
      <div v-if="content === 'avatar'" class="avatar-card">
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
        v-else-if="content === 'monogram'"
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
        v-else-if="content === 'status'"
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

      <div v-else-if="content === 'photo'" class="photo-tile">
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

      <!--
        One file-explorer row. See `renderFileRow` in vanilla-demo.ts for what
        each part does; the chevron keeps its width on a leaf so every name in
        a run of siblings starts at the same x.
      -->
      <div
        v-else-if="content === 'row'"
        class="file-row"
        :class="{ 'is-folder': isBranchRow(item, hasChildren) }"
      >
        <button
          type="button"
          class="file-chevron"
          :class="{ 'is-open': open }"
          :disabled="!hasChildren"
          :aria-hidden="!hasChildren"
          @click.stop="toggle"
        >
          {{ hasChildren ? '▸' : '' }}
        </button>
        <span
          class="file-icon"
          :class="{ 'is-chip': rowFields(item, open).iconColour !== '' }"
          :style="{ background: rowFields(item, open).iconColour || undefined }"
        >{{ rowFields(item, open).icon }}</span>
        <span class="file-name">{{ rowFields(item, open).primary }}</span>
        <span class="file-size">{{ rowFields(item, open).secondary }}</span>
      </div>

      <!-- Subtree counts. Every number is an array lookup the chart
           precomputed — see `NodeStats` — not a walk. -->
      <!-- Nested-set bounds on the borders they describe — see `renderBounds`
           in vanilla-demo.ts. The placement is the explanation. -->
      <div v-else-if="content === 'bounds'" class="bounds-card">
        <span class="bounds-lft">{{ lft }}</span>
        <div class="bounds-body">
          <strong>{{ String(item.name ?? '') }}</strong>
          <small>{{ descendants === 0 ? 'leaf' : `${descendants} below` }}</small>
        </div>
        <span class="bounds-rgt">{{ rgt }}</span>
        <button v-if="hasChildren" type="button" class="toggle-btn" @click="toggle">
          {{ open ? '−' : '+' }}
        </button>
      </div>

      <div
        v-else-if="content === 'counts'"
        class="counts-card"
        :style="{ '--accent': departmentColor(item) }"
      >
        <strong>{{ String(item.name ?? '') }}</strong>
        <small>{{ String(item.title ?? '') }}</small>
        <div class="counts-row">
          <span class="count count-direct" title="Direct reports">{{ directChildren }}</span>
          <span class="count count-total" title="Everyone below, at any depth">{{ descendants }}</span>
          <span class="count count-depth" title="Levels below the root">L{{ depth }}</span>
          <span class="count count-height" title="How deep this subtree runs">↓{{ height }}</span>
        </div>
        <button v-if="hasChildren" type="button" class="toggle-btn" @click="toggle">
          {{ open ? '−' : '+' }}
        </button>
      </div>

      <!--
        A card carrying a real `<select>`. The overlay is a DOM layer over a
        canvas, so a form control in it has to keep behaving normally: opening
        the menu must not pan the chart, which `@pointerdown.stop` handles.
        The value is written back onto the node's own data, so it survives the
        pooled element being recycled onto another node and back.
      -->
      <div v-else-if="content === 'dropdown'" class="dropdown-card">
        <div class="dropdown-text">
          <strong>{{ String(item.name ?? '') }}</strong>
          <small>{{ String(item.title ?? '') }}</small>
        </div>
        <select
          class="dropdown-select"
          :value="String(item.access ?? ROLE_OPTIONS[0])"
          @pointerdown.stop
          @change="item.access = ($event.target as HTMLSelectElement).value"
        >
          <option v-for="role in ROLE_OPTIONS" :key="role" :value="role">{{ role }}</option>
        </select>
      </div>

      <!--
        A card with its own detail pane — a SECOND, independent kind of "open"
        inside a node. The chart's expand/collapse is about children; this is
        about the card's own content, so the state lives on `item.detail` and
        is never inferred from `open`.
      -->
      <div v-else-if="content === 'accordion'" class="accordion-card">
        <div class="accordion-head">
          <div class="accordion-text">
            <strong>{{ String(item.name ?? '') }}</strong>
            <small>{{ String(item.title ?? '') }}</small>
          </div>
          <button
            type="button"
            class="accordion-btn"
            :aria-expanded="item.detail === true"
            @click.stop="toggleDetail(item)"
          >
            {{ item.detail === true ? 'Hide details' : 'Details' }}
          </button>
        </div>
        <div
          class="accordion-body"
          :class="{ 'is-open': accordionProgress(item) > 0 }"
          :style="{ opacity: accordionProgress(item) }"
        >
          {{ String(item.department ?? '—') }} · {{ directChildren }} direct · {{ descendants }} total
        </div>
      </div>

      <!-- The node as a small toolbar: arbitrary controls on a card, each
           keeping its own click, with the chart's own toggle as one of them. -->
      <div v-else-if="content === 'actions'" class="actions-card">
        <div class="actions-text">
          <strong>{{ String(item.name ?? '') }}</strong>
          <small>{{ String(item.title ?? '') }}</small>
        </div>
        <div class="actions-bar">
          <button
            type="button"
            class="action-btn"
            :class="{ 'is-on': item.starred === true }"
            :title="item.starred === true ? 'Starred' : 'Star'"
            @click.stop="toggleStar(item)"
          >★</button>
          <button
            type="button"
            class="action-btn"
            title="Go to this node, marking the way"
            @click.stop="goToNode(id)"
          >⇢</button>
          <button
            v-if="hasChildren"
            type="button"
            class="action-btn"
            title="Expand or collapse"
            @click.stop="toggle"
          >{{ open ? '−' : '+' }}</button>
        </div>
      </div>

      <!-- The node a capped level rolled its remainder into. The picker it
           opens is plain DOM shared by all three stacks — see
           `overflow-card.ts`. -->
      <div
        v-else-if="overflow !== null"
        class="card is-overflow"
        @click="(event) => openPickerFor(event.currentTarget as HTMLElement, overflow!, id)"
      >
        <strong>{{ overflowLabel(overflow) }}</strong>
        <small>Click to search and pick</small>
      </div>

      <div v-else class="card" :class="{ 'is-loading': loading }">
        <strong>{{ String(item.name ?? '') }}</strong>
        <small>{{ String(item.title ?? '') }}</small>
        <button v-if="hasChildren" type="button" class="toggle-btn" @click="toggle">
          {{ open ? '−' : '+' }}
        </button>
      </div>
    </template>
  </Klad>
</template>
