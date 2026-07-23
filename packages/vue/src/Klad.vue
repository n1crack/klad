<script setup lang="ts">
import {
  createKlad,
  type ChartState,
  type NodeContext,
  type Options,
  type KladApi,
  type KladEvents,
} from 'klad'
import { h, onBeforeUnmount, onMounted, provide, render, shallowRef, watch, type VNode } from 'vue'
import { ORG_CHART_KEY } from './useKlad.js'

const props = defineProps<{ options: Options }>()
const emit = defineEmits<{
  nodeClick: Parameters<KladEvents['nodeClick']>
  nodeHover: Parameters<KladEvents['nodeHover']>
  nodeDblClick: Parameters<KladEvents['nodeDblClick']>
  toggle: Parameters<KladEvents['toggle']>
  warning: Parameters<KladEvents['warning']>
  ready: Parameters<KladEvents['ready']>
}>()

const slots = defineSlots<{ node?: (context: NodeContext) => VNode[] }>()

const hostRef = shallowRef<HTMLElement | null>(null)
const api = shallowRef<KladApi | null>(null)
const state = shallowRef<ChartState | null>(null)

let chart: ReturnType<typeof createKlad> | null = null

/**
 * Slot content is rendered into each pooled overlay element with Vue's
 * `render()`. The vanilla layer reuses the same `HTMLElement` per visible
 * slot across frames (see packages/vanilla/src/overlay.ts) rather than
 * recreating DOM, so calling `render()` again on that same element lets Vue
 * patch the previous tree instead of remounting it — that reuse is what
 * keeps panning smooth at high node counts. This set only tracks which
 * elements currently hold a mounted Vue tree, so it can be unmounted
 * cleanly (`render(null, element)`) when the chart is destroyed instead of
 * being ripped out of the DOM with its component instances still live.
 */
const overlayElements = new Set<HTMLElement>()

const WRAPPER_STYLE = { display: 'block', boxSizing: 'border-box', width: '100%', height: '100%' } as const

/** Options with `renderNode` attached only when there is slot content to render. */
function withRenderNode(options: Options): Options {
  return slots.node === undefined ? { ...options } : { ...options, renderNode }
}

function renderNode(element: HTMLElement, context: NodeContext): void {
  const node = slots.node
  if (node === undefined) return
  // The wrapper fills the overlay slot it is rendered into. The slot element
  // already carries an inline width/height matching the declared nodeSize, but
  // this div sits between them, so without stretching it a percentage height on
  // the consumer's card has nothing to resolve against and the card collapses to
  // its content — leaving the canvas-drawn box visible underneath. Vanilla has no
  // such wrapper, so omitting this makes the two adapters disagree.
  render(
    h('div', { class: 'orgchart-node', style: WRAPPER_STYLE }, node(context)),
    element,
  )
  overlayElements.add(element)
}

onMounted(() => {
  if (hostRef.value === null) return
  // Only claim the overlay when a #node slot actually exists. Passing
  // `renderNode` unconditionally makes the vanilla layer allocate and position
  // an element per visible node to hand to a callback that returns immediately —
  // so a Vue consumer who wants the plain canvas chart would still pay for DOM
  // that a frameworkless consumer does not. Same tier, either way.
  chart = createKlad(hostRef.value, withRenderNode(props.options))
  api.value = chart.api
  chart.subscribe((next) => (state.value = next))
  chart.on('nodeClick', (event) => emit('nodeClick', event))
  chart.on('nodeHover', (event) => emit('nodeHover', event))
  chart.on('nodeDblClick', (event) => emit('nodeDblClick', event))
  chart.on('toggle', (event) => emit('toggle', event))
  chart.on('warning', (warning) => emit('warning', warning))
  chart.on('ready', () => emit('ready'))
})

watch(
  () => props.options,
  (next) => chart?.update(next.data, withRenderNode(next)),
  { deep: true },
)

onBeforeUnmount(() => {
  chart?.destroy()
  chart = null
  api.value = null
  for (const element of overlayElements) render(null, element)
  overlayElements.clear()
})

provide(ORG_CHART_KEY, { api, state })
defineExpose({ api })
</script>

<template>
  <div ref="hostRef" class="orgchart" />
</template>
