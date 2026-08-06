import {
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  provide,
  render,
  shallowRef,
  watch,
  type PropType,
  type ShallowRef,
  type SlotsType,
  type VNode,
} from 'vue'
import {
  createKlad,
  type ChartState,
  type KladApi,
  type KladEvents,
  type NodeContext,
  type Options,
} from '@klad/core'
import { ORG_CHART_KEY } from './useKlad.js'

/**
 * A render function rather than a Single File Component, and that is not a
 * style preference.
 *
 * An SFC's declarations can only be emitted by `vue-tsc`, which is built on
 * TypeScript's JavaScript compiler API — the API that TypeScript 7 removed
 * when the compiler became a native binary. Staying an SFC meant staying on
 * TypeScript 5 for the one published package that is otherwise ordinary
 * TypeScript, and the template being replaced here was a single `<div>`:
 * nothing that made an SFC worth that tooling lived in it. The entire typed
 * surface was in the script block, which is what this file still is.
 *
 * It is also not what fixed the bug it was written for. These declarations
 * named `@vue/runtime-core` — private to `vue`, unresolvable for a consumer
 * who does not get a flattened `node_modules`, and `skipLibCheck` turned that
 * into silence rather than an error, so the whole component became `any`. The
 * rewrite did not stop it; the emitted references survived and briefly
 * multiplied. What stopped it was `tsconfig.build.json` turning out not to be
 * legal JSON: a `"//"` value ran across several lines, TypeScript's tolerant
 * parser took the file and quietly dropped what it could not read, and without
 * that config's `paths` the emitter named the package a symbol is DECLARED in
 * instead of the one this package depends on. Fixing the JSON emptied the
 * output of `@vue/runtime-core` entirely.
 *
 * Worth stating because the first explanation was wrong in a believable way:
 * it really is inference that prints those names, but inference was only
 * reaching for them because module resolution had been silently misconfigured.
 * A symptom two levels from its cause, and a fix that looked like it worked.
 *
 * See `type-tests/consumer.vue` in the playground and
 * `scripts/check-published-types.mjs`, which install this package the way a
 * stranger would. They are the only checks here that look at what a consumer
 * actually receives.
 */

/** The payload of one of the vanilla layer's events, as an emit declares it. */
type Payload<K extends keyof KladEvents> = Parameters<KladEvents[K]>[0]

const WRAPPER_STYLE = {
  display: 'block',
  boxSizing: 'border-box',
  width: '100%',
  height: '100%',
} as const

const Klad = defineComponent({
  name: 'Klad',

  props: {
    options: { type: Object as PropType<Options>, required: true },
  },

  /**
   * Declared as runtime validators that always pass, which is the only form
   * `defineComponent` infers payload types from. They are here to be read as
   * types: each one becomes both the `emit` signature and the `onNodeClick`
   * style listener prop a consumer binds `@node-click` to.
   *
   * Every parameter below is unused at runtime, and named anyway: the name is
   * what a consumer's editor shows in the tooltip for the handler they are
   * writing. Renaming them to `_event` would satisfy the linter by making
   * every consumer read `_event`.
   */
  /* oxlint-disable no-unused-vars */
  emits: {
    nodeClick: (event: Payload<'nodeClick'>) => true,
    nodeHover: (event: Payload<'nodeHover'>) => true,
    nodeDblClick: (event: Payload<'nodeDblClick'>) => true,
    /**
     * A node was dropped somewhere new, BEFORE anything moves. Call the
     * event's own `preventDefault()` to refuse it — Vue's emit has no return
     * channel, so the veto travels on the payload rather than as a return
     * value.
     */
    nodeDrop: (event: Payload<'nodeDrop'>) => true,
    childrenLoaded: (event: Payload<'childrenLoaded'>) => true,
    toggle: (event: Payload<'toggle'>) => true,
    warning: (warning: Payload<'warning'>) => true,
    ready: () => true,
  },
  /* oxlint-enable no-unused-vars */

  slots: Object as SlotsType<{ node?: (context: NodeContext) => VNode[] }>,

  setup(props, { emit, expose, slots }) {
    const hostRef = shallowRef<HTMLElement | null>(null)
    const api = shallowRef<KladApi | null>(null)
    const state = shallowRef<ChartState | null>(null)

    let chart: ReturnType<typeof createKlad> | null = null

    /**
     * Slot content is rendered into each pooled overlay element with Vue's
     * `render()`. The vanilla layer reuses the same `HTMLElement` per visible
     * slot across frames (see packages/core/src/overlay.ts) rather than
     * recreating DOM, so calling `render()` again on that same element lets
     * Vue patch the previous tree instead of remounting it — that reuse is
     * what keeps panning smooth at high node counts. This set only tracks
     * which elements currently hold a mounted Vue tree, so it can be
     * unmounted cleanly (`render(null, element)`) when the chart is destroyed
     * instead of being ripped out of the DOM with its component instances
     * still live.
     */
    const overlayElements = new Set<HTMLElement>()

    function renderNode(element: HTMLElement, context: NodeContext): void {
      const node = slots.node
      if (node === undefined) return
      // The wrapper fills the overlay slot it is rendered into. The slot element
      // already carries an inline width/height matching the declared nodeSize, but
      // this div sits between them, so without stretching it a percentage height on
      // the consumer's card has nothing to resolve against and the card collapses to
      // its content — leaving the canvas-drawn box visible underneath. Vanilla has no
      // such wrapper, so omitting this makes the two adapters disagree.
      render(h('div', { class: 'orgchart-node', style: WRAPPER_STYLE }, node(context)), element)
      overlayElements.add(element)
    }

    /** Options with `renderNode` attached only when there is slot content to render. */
    function withRenderNode(options: Options): Options {
      return slots.node === undefined ? { ...options } : { ...options, renderNode }
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
      // Emitted SYNCHRONOUSLY, which is what makes `preventDefault()` on the
      // payload work: the vanilla layer reads it back the instant this returns.
      chart.on('nodeDrop', (event) => emit('nodeDrop', event))
      chart.on('childrenLoaded', (event) => emit('childrenLoaded', event))
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
    expose({ api })

    return () => h('div', { ref: hostRef, class: 'orgchart' })
  },
})

/** What a template ref on `<Klad>` sees — the object `expose()` publishes. */
export interface KladHandle {
  api: ShallowRef<KladApi | null>
}

/**
 * `defineComponent` infers props, emits and slots from the options above, but
 * not `expose()` — nothing in the options object mentions it, so there is
 * nothing to infer from. Left alone, a consumer's `chartRef.value.api` is a
 * type error on a component that does publish `api` at runtime.
 *
 * Grafting a second construct signature is how Vue's own tooling states this;
 * `InstanceType` resolves to the LAST one, which is why this returns the
 * inferred instance INTERSECTED with the exposed surface rather than the
 * exposed surface alone. Returning only `KladHandle` would type `.api` and
 * silently drop `$props`, `$el` and the rest — trading one missing half of
 * the instance for the other.
 */
export default Klad as typeof Klad & {
  new (): InstanceType<typeof Klad> & KladHandle
}
