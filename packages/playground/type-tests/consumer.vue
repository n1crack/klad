<!--
  What someone who installs `@klad/vue` writes — checked against the `.d.ts`
  this repository publishes, rather than against its own source.

  Every other type check here resolves `@klad/vue` to `src/index.ts`, because
  that is what the workspace `exports` map points at; only
  `publishConfig.exports` swaps it for `dist/index.d.ts`, and only at publish
  time. So the rest of CI proves the source is consistent with itself and says
  nothing about the declarations a consumer receives. `tsconfig.consumer.json`
  redirects the import to `dist`, which is why this file sits outside `src/`
  and is checked on its own.

  It pins the component's PUBLIC surface — props, emits, slots, and the
  exposed `api` — so that changing how the component is authored cannot
  quietly change what a consumer gets. That is the whole point: `<script
  setup>` derives this surface automatically, and anything hand-written has to
  reproduce it exactly.
-->
<script setup lang="ts">
import { ref } from 'vue'
import { Klad } from '@klad/vue'
import type {
  KladApi,
  NodeContext,
  NodeData,
  NodeDropEvent,
  NodePlace,
  Options,
  Size,
  Warning,
} from '@klad/vue'

/** Fails to compile unless the argument's inferred type is assignable to `T`. */
function expectType<T>(value: T): void {
  void value
}

/**
 * The declarations that were impossible before this package re-exported
 * core's types: an inline literal in `data` infers, but naming the array's
 * element type, or the argument `nodeSize` returns, or the payload a warning
 * handler receives, all required importing `@klad/core` directly.
 */
const people: NodeData[] = [
  { id: 'root', name: 'Root' },
  { id: 'child', parentId: 'root' },
]

const nodeSize = (item: NodeData, at: NodePlace): Size =>
  at.depth === 0 ? { w: 200, h: 72 } : { w: 160, h: 56 }

function report(warning: Warning): void {
  void warning
}

const options = ref<Options>({ data: people, nodeSize })

/** A consumer's template ref, typed the way a consumer types it. */
const chart = ref<InstanceType<typeof Klad> | null>(null)

type KladProps = InstanceType<typeof Klad>['$props']

// --- props -----------------------------------------------------------------

expectType<Options>({} as NonNullable<KladProps['options']>)

// --- emits -----------------------------------------------------------------
// Declared as the `onX` listener props, which is the form `@x="..."` binds to.
// A missing event fails here as an unknown key, and a changed payload fails on
// the assertions inside.

const onNodeClick: NonNullable<KladProps['onNodeClick']> = (event) => {
  expectType<string>(event.id)
  expectType<string>(event.item.id)
}

const onNodeDblClick: NonNullable<KladProps['onNodeDblClick']> = (event) => {
  expectType<string>(event.id)
}

// The one event whose payload is a union: `id` and `item` are both null when
// the pointer leaves every node.
const onNodeHover: NonNullable<KladProps['onNodeHover']> = (event) => {
  expectType<string | null>(event.id)
}

const onNodeDrop: NonNullable<KladProps['onNodeDrop']> = (event) => {
  expectType<NodeDropEvent>(event)
  // The veto travels on the payload rather than as a return value.
  event.preventDefault()
}

const onChildrenLoaded: NonNullable<KladProps['onChildrenLoaded']> = (event) => {
  expectType<string>(event.id)
  expectType<string>(event.items[0]?.id ?? '')
}

const onToggle: NonNullable<KladProps['onToggle']> = (event) => {
  expectType<string>(event.id)
  expectType<boolean>(event.open)
}

const onWarning: NonNullable<KladProps['onWarning']> = (warning) => {
  report(warning)
}

/** Carries nothing — this fails to compile if it ever grows a parameter. */
const onReady: NonNullable<KladProps['onReady']> = () => {}

// --- exposed ---------------------------------------------------------------
// `defineExpose({ api })`, reached through the template ref above.

function readApi(): KladApi | null {
  return chart.value?.api.value ?? null
}

// --- slot ------------------------------------------------------------------

/** Forces the `#node` slot payload to be assignable to `NodeContext`. */
function cardClass(context: NodeContext): string {
  return context.open ? 'is-open' : 'is-closed'
}

void [readApi, onReady, onWarning]
</script>

<template>
  <Klad
    ref="chart"
    :options="options"
    @node-click="onNodeClick"
    @node-dbl-click="onNodeDblClick"
    @node-hover="onNodeHover"
    @node-drop="onNodeDrop"
    @children-loaded="onChildrenLoaded"
    @toggle="onToggle"
    @warning="onWarning"
    @ready="onReady"
  >
    <template #node="context">
      <article :class="cardClass(context)">{{ context.item.id }} / {{ context.descendants }}</article>
    </template>
  </Klad>
</template>
