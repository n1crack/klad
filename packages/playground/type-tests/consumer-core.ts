/**
 * What someone who installs `@klad/core` writes — the frameworkless entry, and
 * the one the two adapters are thin wrappers over. Checked against the `.d.ts`
 * this repository publishes rather than against its own source; see
 * `consumer.vue` for why that distinction matters.
 *
 * This is the surface that cannot be reached through either adapter's props,
 * so nothing else here pins it: the instance `createKlad` returns, the events
 * it emits, and the payloads it hands a plain callback.
 */
import { createKlad } from '@klad/core'
import type { ChartState, KladApi, KladInstance, NodeContext, NodeDropEvent, Options } from '@klad/core'

/** Fails to compile unless the argument's inferred type is assignable to `T`. */
function expectType<T>(value: T): void {
  void value
}

declare const host: HTMLElement

const options: Options = {
  data: [{ id: 'root' }, { id: 'child', parentId: 'root' }],
  nodeSize: { w: 120, h: 48 },
  // The callback a frameworkless consumer draws their own card with — the
  // thing both adapters reroute through a slot or a render prop.
  renderNode: (element: HTMLElement, context: NodeContext) => {
    element.textContent = context.item.id
    expectType<boolean>(context.open)
    expectType<number>(context.descendants)
  },
}

const chart: KladInstance = createKlad(host, options)

// --- the instance ----------------------------------------------------------

expectType<KladApi>(chart.api)
chart.api.fit()
chart.api.zoomTo(1.5)

chart.subscribe((state) => {
  expectType<ChartState>(state)
})

// --- events ----------------------------------------------------------------
// `on` is keyed, so a renamed event fails as an unknown key and a changed
// payload fails on the assertions inside.

chart.on('nodeClick', (event) => {
  expectType<string>(event.id)
  expectType<string>(event.item.id)
})

chart.on('nodeHover', (event) => {
  expectType<string | null>(event.id)
})

chart.on('nodeDrop', (event) => {
  expectType<NodeDropEvent>(event)
  event.preventDefault()
})

chart.on('toggle', (event) => {
  expectType<boolean>(event.open)
})

chart.on('ready', () => {})

chart.update(options.data, options)
chart.destroy()
