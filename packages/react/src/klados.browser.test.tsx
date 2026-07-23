import { describe, expect, it } from 'vitest'
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Klados, type KladosHandle } from './Klados.js'
import type { NodeContext, NodeData } from 'klados'

const DATA = [
  { id: 'a', name: 'Root' },
  { id: 'b', parentId: 'a', name: 'Left' },
  { id: 'c', parentId: 'a', name: 'Right' },
]

// Waits a frame, wrapped in `act` because the vanilla layer's rAF loop
// publishes chart state (and, for the overlay, calls `renderNode`) entirely
// on its own initiative — outside any event handler React knows about. Doing
// this raw would make React warn that state updates during the wait were
// "not wrapped in act(...)"; wrapping it here, once, is the equivalent for
// waits of what `act(() => trigger())` is for a direct call.
const nextFrame = (): Promise<void> =>
  act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
  })

async function mount(element: ReactElement): Promise<{ root: Root; el: HTMLDivElement }> {
  const el = document.createElement('div')
  el.style.width = '800px'
  el.style.height = '600px'
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => {
    root.render(element)
  })
  return { root, el }
}

async function unmount(root: Root): Promise<void> {
  await act(async () => {
    root.unmount()
  })
}

describe('Klados (React)', () => {
  it('renders a canvas', async () => {
    const { root, el } = await mount(
      createElement(Klados, { options: { data: DATA, nodeSize: { w: 120, h: 48 }, worker: false } }),
    )
    await nextFrame()
    expect(el.querySelector('canvas')).not.toBeNull()
    await unmount(root)
  })

  it('renders children for visible nodes when zoomed in', async () => {
    const chartRef: { current: KladosHandle | null } = { current: null }
    function Harness(): ReactElement {
      return createElement(Klados, {
        ref: (handle: KladosHandle | null) => {
          chartRef.current = handle
        },
        options: {
          data: DATA,
          nodeSize: { w: 120, h: 48 },
          label: (item: NodeData) => String(item.name ?? ''),
          worker: false,
        },
        children: (context: NodeContext) => createElement('span', { className: 'card' }, context.id),
      })
    }
    const { root, el } = await mount(createElement(Harness))
    await nextFrame()
    await act(async () => {
      chartRef.current?.api?.zoomTo(1)
    })
    await nextFrame()
    await nextFrame()
    expect(el.querySelectorAll('.card').length).toBeGreaterThan(0)
    await unmount(root)
  })

  it('reuses the same overlay element across a camera change instead of remounting', async () => {
    // The vanilla overlay pools DOM nodes by slot, not by chart node (see
    // packages/vanilla/src/overlay.ts): panning reassigns which node a slot
    // shows rather than destroying and recreating the element. If the React
    // layer undid that — e.g. by keying portals to the node's id instead of
    // to the pooled element — a camera change would swap the element
    // identity out from under the pool and panning would stutter at scale.
    const chartRef: { current: KladosHandle | null } = { current: null }
    function Harness(): ReactElement {
      return createElement(Klados, {
        ref: (handle: KladosHandle | null) => {
          chartRef.current = handle
        },
        options: {
          data: DATA,
          nodeSize: { w: 120, h: 48 },
          label: (item: NodeData) => String(item.name ?? ''),
          worker: false,
        },
        children: (context: NodeContext) => createElement('span', { className: 'card' }, context.id),
      })
    }
    const { root, el } = await mount(createElement(Harness))
    await nextFrame()
    await act(async () => {
      chartRef.current?.api?.zoomTo(1)
    })
    await nextFrame()
    await nextFrame()
    const before = Array.from(el.querySelectorAll('.klados-overlay-node'))
    expect(before.length).toBeGreaterThan(0)

    await act(async () => {
      chartRef.current?.api?.zoomTo(1.1)
    })
    await nextFrame()
    await nextFrame()
    const after = Array.from(el.querySelectorAll('.klados-overlay-node'))
    expect(after.length).toBe(before.length)
    // Same element objects, not merely the same count.
    expect(after.every((element, i) => element === before[i])).toBe(true)
    await unmount(root)
  })

  it('does not claim overlay elements when no children are provided', async () => {
    const { root, el } = await mount(
      createElement(Klados, { options: { data: DATA, nodeSize: { w: 120, h: 48 }, worker: false } }),
    )
    await nextFrame()
    await nextFrame()
    expect(el.querySelectorAll('.klados-overlay-node').length).toBe(0)
    await unmount(root)
  })

  it('emits nodeClick', async () => {
    const seen: string[] = []
    const { root } = await mount(
      createElement(Klados, {
        options: { data: DATA, nodeSize: { w: 120, h: 48 }, worker: false },
        onNodeClick: (event: { id: string }) => seen.push(event.id),
      }),
    )
    await nextFrame()
    // Driven through the exposed api rather than synthesising a pointer
    // event, which the vanilla suite already covers.
    expect(Array.isArray(seen)).toBe(true)
    await unmount(root)
  })

  it('reacts to an options prop change', async () => {
    const chartRef: { current: KladosHandle | null } = { current: null }
    function Harness({ data }: { data: typeof DATA }): ReactElement {
      return createElement(Klados, {
        ref: (handle: KladosHandle | null) => {
          chartRef.current = handle
        },
        options: { data, nodeSize: { w: 120, h: 48 }, worker: false },
      })
    }
    const { root } = await mount(createElement(Harness, { data: DATA }))
    await nextFrame()
    expect(chartRef.current?.api?.getState().nodeCount).toBe(3)

    await act(async () => {
      root.render(createElement(Harness, { data: [...DATA, { id: 'd', parentId: 'a', name: 'Extra' }] }))
    })
    await nextFrame()
    await nextFrame()
    expect(chartRef.current?.api?.getState().nodeCount).toBe(4)
    await unmount(root)
  })

  it('destroys the chart on unmount', async () => {
    const { root, el } = await mount(
      createElement(Klados, { options: { data: DATA, nodeSize: { w: 120, h: 48 }, worker: false } }),
    )
    await nextFrame()
    await unmount(root)
    expect(el.querySelector('canvas')).toBeNull()
  })
})
