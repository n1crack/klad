import { describe, expect, it } from 'vitest'
import { createOrgChart } from './index.js'

function buildOrg(target: number): { id: string; parentId?: string; name: string }[] {
  const data: { id: string; parentId?: string; name: string }[] = [{ id: 'root', name: 'Root' }]
  let frontier = ['root']
  let counter = 0
  while (data.length < target) {
    const next: string[] = []
    for (const parentId of frontier) {
      for (let i = 0; i < 3 && data.length < target; i++) {
        const id = `n${counter++}`
        data.push({ id, parentId, name: id })
        next.push(id)
      }
    }
    frontier = next
  }
  return data
}

const SMALL_DATA = [
  { id: 'a', name: 'Root' },
  { id: 'b', parentId: 'a', name: 'Left' },
  { id: 'c', parentId: 'a', name: 'Right' },
  { id: 'd', parentId: 'b', name: 'Leaf' },
]

function host(): HTMLElement {
  const el = document.createElement('div')
  el.style.width = '800px'
  el.style.height = '600px'
  document.body.appendChild(el)
  return el
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)))

describe('minimap', () => {
  it('is absent by default', async () => {
    const el = host()
    const chart = createOrgChart(el, {
      data: SMALL_DATA,
      nodeSize: { w: 120, h: 48 },
      worker: false,
    })
    await nextFrame()
    expect(el.querySelector('.orgchart-minimap')).toBeNull()
    // Only the main chart canvas exists.
    expect(el.querySelectorAll('canvas').length).toBe(1)
    chart.destroy()
  })

  it('paints a non-empty silhouette once data is laid out', async () => {
    const el = host()
    const chart = createOrgChart(el, {
      data: buildOrg(300),
      nodeSize: { w: 120, h: 48 },
      worker: false,
      minimap: true,
    })
    await nextFrame()
    await nextFrame()

    const canvases = el.querySelectorAll('canvas')
    expect(canvases.length).toBe(2)
    const minimapCanvas = canvases[1] as HTMLCanvasElement
    const ctx = minimapCanvas.getContext('2d')!
    const image = ctx.getImageData(0, 0, minimapCanvas.width, minimapCanvas.height)
    let coveredPixels = 0
    for (let i = 3; i < image.data.length; i += 4) {
      if (image.data[i]! > 0) coveredPixels++
    }
    // A 300-node tree fanning out 3-wide should cover a meaningful fraction
    // of a 200x140 default minimap, not a handful of stray pixels.
    expect(coveredPixels).toBeGreaterThan(50)
    chart.destroy()
  })

  it('respects a custom size and position', async () => {
    const el = host()
    const chart = createOrgChart(el, {
      data: SMALL_DATA,
      nodeSize: { w: 120, h: 48 },
      worker: false,
      minimap: { width: 120, height: 90, position: 'top-left' },
    })
    await nextFrame()
    await nextFrame()
    const canvases = el.querySelectorAll('canvas')
    const minimapCanvas = canvases[1] as HTMLCanvasElement
    expect(minimapCanvas.width).toBe(120)
    expect(minimapCanvas.height).toBe(90)
    chart.destroy()
  })

  it('can be toggled on and off via update()', async () => {
    const el = host()
    const chart = createOrgChart(el, {
      data: SMALL_DATA,
      nodeSize: { w: 120, h: 48 },
      worker: false,
    })
    await nextFrame()
    expect(el.querySelectorAll('canvas').length).toBe(1)

    chart.update(SMALL_DATA, { minimap: true })
    await nextFrame()
    await nextFrame()
    expect(el.querySelectorAll('canvas').length).toBe(2)

    chart.update(SMALL_DATA, { minimap: false })
    await nextFrame()
    expect(el.querySelectorAll('canvas').length).toBe(1)
    chart.destroy()
  })

  it('clicking inside the minimap pans the camera', async () => {
    const el = host()
    const chart = createOrgChart(el, {
      data: buildOrg(300),
      nodeSize: { w: 120, h: 48 },
      worker: false,
      minimap: true,
    })
    await nextFrame()
    await nextFrame()

    const before = chart.api.getState().camera
    const minimapRoot = el.querySelector<HTMLElement>('.orgchart-minimap')!
    const rect = minimapRoot.getBoundingClientRect()

    minimapRoot.dispatchEvent(
      new PointerEvent('pointerdown', {
        clientX: rect.left + rect.width * 0.9,
        clientY: rect.top + rect.height * 0.9,
        pointerId: 1,
        bubbles: true,
      }),
    )
    minimapRoot.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }))
    await nextFrame()

    const after = chart.api.getState().camera
    expect(after.x !== before.x || after.y !== before.y).toBe(true)
    chart.destroy()
  })

  it('repaints the silhouette only on relayout, never on a camera-only frame', async () => {
    // Regression guard for the design invariant (spec §11.5): the silhouette
    // is rasterised once per relayout and blitted via putImageData; a pure
    // camera change (pan/zoom/tween) must reposition the viewport rectangle
    // with a CSS transform only, never repaint the silhouette. If this test
    // ever fails, something is doing per-frame work that should be per-relayout.
    const el = host()
    const chart = createOrgChart(el, {
      data: buildOrg(2_000),
      nodeSize: { w: 120, h: 48 },
      worker: false,
      minimap: true,
    })
    await nextFrame()
    await nextFrame()

    const canvases = el.querySelectorAll('canvas')
    const minimapCanvas = canvases[1] as HTMLCanvasElement
    const ctx = minimapCanvas.getContext('2d')!
    let putImageDataCalls = 0
    type PutImageDataArgs =
      | [ImageData, number, number]
      | [ImageData, number, number, number, number, number, number]
    const original = ctx.putImageData.bind(ctx)
    ctx.putImageData = ((...args: PutImageDataArgs) => {
      putImageDataCalls++
      ;(original as (...a: PutImageDataArgs) => void)(...args)
    }) as typeof ctx.putImageData

    const before = chart.api.getState().camera
    // zoomTo animates over several frames (a tween), which is exactly the
    // "many camera-only frames in a row" case a per-frame bug would show up in.
    chart.api.zoomTo(2)
    for (let i = 0; i < 15; i++) await nextFrame()
    const after = chart.api.getState().camera

    expect(after.k).not.toBe(before.k) // the tween actually ran
    expect(putImageDataCalls).toBe(0) // yet the silhouette was never repainted
    chart.destroy()
  })

  it('clamps the viewport rectangle to the minimap bounds when panned past the tree edge', async () => {
    const el = host()
    const chart = createOrgChart(el, {
      data: buildOrg(300),
      nodeSize: { w: 120, h: 48 },
      worker: false,
      minimap: true,
    })
    await nextFrame()
    await nextFrame()

    const minimapRoot = el.querySelector<HTMLElement>('.orgchart-minimap')!
    // The viewport-rectangle overlay is the minimap's only other child
    // (see createMinimap: canvas appended first, this div second).
    const viewportEl = minimapRoot.children[1] as HTMLElement
    const rect = minimapRoot.getBoundingClientRect()

    minimapRoot.dispatchEvent(
      new PointerEvent('pointerdown', {
        clientX: rect.left + rect.width * 0.9,
        clientY: rect.top + rect.height * 0.9,
        pointerId: 3,
        bubbles: true,
      }),
    )
    // Dragging far outside the minimap's own DOM rect -- still delivered
    // because pointerdown captured the pointer -- pans the camera to a world
    // point wildly outside the tree's bounds, which is exactly the "panned
    // past the edge" case the drawn rectangle must not spill out from under.
    minimapRoot.dispatchEvent(
      new PointerEvent('pointermove', {
        clientX: rect.left - rect.width * 25,
        clientY: rect.top - rect.height * 25,
        pointerId: 3,
        bubbles: true,
      }),
    )
    minimapRoot.dispatchEvent(new PointerEvent('pointerup', { pointerId: 3, bubbles: true }))
    await nextFrame()

    const x = parseFloat(viewportEl.style.transform.match(/translate\(([-\d.]+)px/)?.[1] ?? 'NaN')
    const y = parseFloat(viewportEl.style.transform.match(/,\s*([-\d.]+)px\)/)?.[1] ?? 'NaN')
    const w = parseFloat(viewportEl.style.width)
    const h = parseFloat(viewportEl.style.height)

    expect(x).toBeGreaterThanOrEqual(0)
    expect(y).toBeGreaterThanOrEqual(0)
    expect(w).toBeGreaterThanOrEqual(0)
    expect(h).toBeGreaterThanOrEqual(0)
    expect(x + w).toBeLessThanOrEqual(200 + 0.01) // default minimap width
    expect(y + h).toBeLessThanOrEqual(140 + 0.01) // default minimap height
    chart.destroy()
  })

  it('covers (approximately) the whole minimap once the camera is zoomed out past the whole tree', async () => {
    const el = host()
    // A tiny tree: the configured zoom floor (0.05, well below what's needed
    // to fit four nodes on an 800x600 host) is reached before the "don't zoom
    // out further than fit needs" floor in recomputeLimits ever binds, so
    // zoomTo can actually push the viewport far larger than the tree bounds
    // through the public API, no internal reach-in required.
    const chart = createOrgChart(el, {
      data: SMALL_DATA,
      nodeSize: { w: 120, h: 48 },
      worker: false,
      minimap: true,
    })
    await nextFrame()
    await nextFrame()

    const minimapRoot = el.querySelector<HTMLElement>('.orgchart-minimap')!
    const viewportEl = minimapRoot.children[1] as HTMLElement

    chart.api.zoomTo(0.05)
    for (let i = 0; i < 15; i++) await nextFrame()

    const x = parseFloat(viewportEl.style.transform.match(/translate\(([-\d.]+)px/)?.[1] ?? 'NaN')
    const y = parseFloat(viewportEl.style.transform.match(/,\s*([-\d.]+)px\)/)?.[1] ?? 'NaN')
    const w = parseFloat(viewportEl.style.width)
    const h = parseFloat(viewportEl.style.height)

    // "You can see everything" reads as the clamped rectangle covering the
    // full minimap -- not an inverted or zero-size box.
    expect(x).toBeCloseTo(0, 0)
    expect(y).toBeCloseTo(0, 0)
    expect(w).toBeGreaterThan(200 * 0.9)
    expect(h).toBeGreaterThan(140 * 0.9)
    chart.destroy()
  })

  // Regression: the silhouette (and the transform derived with it) used to be
  // rebuilt the instant a toggle's relayout landed, while the canvas was still
  // animating its way there. The minimap's whole coordinate space therefore
  // jumped to the FINAL layout on the toggle frame, and the viewport rectangle
  // — still drawn from the pre-toggle camera, since the camera anchor has not
  // moved it yet — landed somewhere else entirely (far to one side on a root
  // expand, where the layout's own origin shifts the most) and then slid back
  // across the whole minimap as the camera caught up.
  it('takes up a toggle’s new layout only once its transition has finished', async () => {
    const el = host()
    const chart = createOrgChart(el, {
      data: buildOrg(300),
      nodeSize: { w: 120, h: 48 },
      worker: false,
      minimap: true,
    })
    await new Promise((r) => setTimeout(r, 260))
    await nextFrame()

    const minimapCanvas = el.querySelectorAll('canvas')[1] as HTMLCanvasElement
    const ctx = minimapCanvas.getContext('2d')!
    let repaints = 0
    const original = ctx.putImageData.bind(ctx)
    ctx.putImageData = ((...args: [ImageData, number, number]) => {
      repaints++
      original(...args)
    }) as typeof ctx.putImageData

    chart.api.collapse('root')
    // Four frames in, the transition is still running: the minimap must still
    // be showing — and measuring against — the layout that was on screen when
    // the toggle landed, because that is what the canvas is still showing too.
    for (let i = 0; i < 4; i++) await nextFrame()
    expect(chart.api.getState().visibleCount).toBeGreaterThan(0)
    expect(repaints).toBe(0)

    await new Promise((r) => setTimeout(r, 550))
    await nextFrame()
    await nextFrame()
    // Settled: exactly one repaint, for the one relayout the toggle produced.
    expect(repaints).toBe(1)

    chart.destroy()
  })

  it('destroy() removes the minimap element', async () => {
    const el = host()
    const chart = createOrgChart(el, {
      data: SMALL_DATA,
      nodeSize: { w: 120, h: 48 },
      worker: false,
      minimap: true,
    })
    await nextFrame()
    await nextFrame()
    expect(el.querySelectorAll('canvas').length).toBe(2)
    chart.destroy()
    expect(el.querySelectorAll('canvas').length).toBe(0)
  })
})
