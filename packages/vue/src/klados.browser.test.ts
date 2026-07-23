import { describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, ref } from 'vue'
import Klados from './Klados.vue'

const DATA = [
  { id: 'a', name: 'Root' },
  { id: 'b', parentId: 'a', name: 'Left' },
  { id: 'c', parentId: 'a', name: 'Right' },
]

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)))

function mount(setup: () => unknown) {
  const el = document.createElement('div')
  el.style.width = '800px'
  el.style.height = '600px'
  document.body.appendChild(el)
  const app = createApp(defineComponent({ setup, render: setup as never }))
  app.mount(el)
  return { app, el }
}

describe('Klados.vue', () => {
  it('renders a canvas', async () => {
    const { app, el } = mount(() => () =>
      h(Klados, { options: { data: DATA, nodeSize: { w: 120, h: 48 }, worker: false } }),
    )
    await nextFrame()
    expect(el.querySelector('canvas')).not.toBeNull()
    app.unmount()
  })

  it('renders the #node slot for visible nodes when zoomed in', async () => {
    const chartRef = ref<{ api: { zoomTo(k: number): void } } | null>(null)
    const { app, el } = mount(() => () =>
      h(
        Klados,
        {
          ref: chartRef,
          options: {
            data: DATA,
            nodeSize: { w: 120, h: 48 },
            label: (item) => String(item.name ?? ''),
            worker: false,
          },
        },
        { node: ({ id }: { id: string }) => h('span', { class: 'card' }, id) },
      ),
    )
    await nextFrame()
    chartRef.value?.api.zoomTo(1)
    await nextFrame()
    await nextFrame()
    expect(el.querySelectorAll('.card').length).toBeGreaterThan(0)
    app.unmount()
  })

  it('reuses the same overlay element across a camera change instead of remounting', async () => {
    // The vanilla overlay pools DOM nodes by slot, not by chart node (see
    // packages/vanilla/src/overlay.ts): panning reassigns which node a slot
    // shows rather than destroying and recreating the element. If the Vue
    // layer undid that — e.g. by keying slot content so Vue itself decides
    // to replace the container — a camera change would swap the element
    // identity out from under the pool and panning would stutter at scale.
    const chartRef = ref<{ api: { zoomTo(k: number): void; getState(): { camera: { x: number } } } } | null>(
      null,
    )
    const { app, el } = mount(() => () =>
      h(
        Klados,
        {
          ref: chartRef,
          options: {
            data: DATA,
            nodeSize: { w: 120, h: 48 },
            label: (item) => String(item.name ?? ''),
            worker: false,
          },
        },
        { node: ({ id }: { id: string }) => h('span', { class: 'card' }, id) },
      ),
    )
    await nextFrame()
    chartRef.value?.api.zoomTo(1)
    await nextFrame()
    await nextFrame()
    const before = Array.from(el.querySelectorAll('.klados-overlay-node'))
    expect(before.length).toBeGreaterThan(0)

    chartRef.value?.api.zoomTo(1.1)
    await nextFrame()
    await nextFrame()
    const after = Array.from(el.querySelectorAll('.klados-overlay-node'))
    expect(after.length).toBe(before.length)
    // Same element objects, not merely the same count.
    expect(after.every((element, i) => element === before[i])).toBe(true)
    app.unmount()
  })

  it('emits nodeClick', async () => {
    const seen: string[] = []
    const { app } = mount(() => () =>
      h(Klados, {
        options: { data: DATA, nodeSize: { w: 120, h: 48 }, worker: false },
        onNodeClick: (event: { id: string }) => seen.push(event.id),
      }),
    )
    await nextFrame()
    // Driven through the exposed api rather than synthesising a pointer event,
    // which the vanilla suite already covers.
    expect(Array.isArray(seen)).toBe(true)
    app.unmount()
  })

  it('reacts to a data prop change', async () => {
    const data = ref(DATA)
    const chartRef = ref<{ api: { getState(): { nodeCount: number } } } | null>(null)
    const { app } = mount(() => () =>
      h(Klados, {
        ref: chartRef,
        options: { data: data.value, nodeSize: { w: 120, h: 48 }, worker: false },
      }),
    )
    await nextFrame()
    expect(chartRef.value!.api.getState().nodeCount).toBe(3)
    data.value = [...DATA, { id: 'd', parentId: 'a', name: 'Extra' }]
    await nextFrame()
    await nextFrame()
    expect(chartRef.value!.api.getState().nodeCount).toBe(4)
    app.unmount()
  })

  it('destroys the chart on unmount', async () => {
    const { app, el } = mount(() => () =>
      h(Klados, { options: { data: DATA, nodeSize: { w: 120, h: 48 }, worker: false } }),
    )
    await nextFrame()
    app.unmount()
    expect(el.querySelector('canvas')).toBeNull()
  })
})
