import { describe, expect, it } from 'vitest'
import { createKlad } from './index.js'

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

/** Waits out a camera tween (200ms — see `animateTo` in index.ts) and its last paint. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 260))

describe('minimap', () => {
  it('is absent by default', async () => {
    const el = host()
    const chart = createKlad(el, {
      data: SMALL_DATA,
      nodeSize: { w: 120, h: 48 },
      worker: false,
    })
    await nextFrame()
    expect(el.querySelector('.klad-minimap')).toBeNull()
    // Only the main chart canvas exists.
    expect(el.querySelectorAll('canvas').length).toBe(1)
    chart.destroy()
  })

  it('paints a non-empty silhouette once data is laid out', async () => {
    const el = host()
    const chart = createKlad(el, {
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

  it('paints the silhouette in a requested colour, and keeps its coverage as the alpha', async () => {
    const el = host()
    const chart = createKlad(el, {
      data: buildOrg(300),
      nodeSize: { w: 120, h: 48 },
      worker: false,
      // The silhouette is the one part of the widget a host stylesheet cannot
      // reach — it is pixels, not DOM — so a dark theme needs this option.
      minimap: { silhouetteColour: '#ff0000' },
    })
    await nextFrame()
    await nextFrame()

    const minimapCanvas = el.querySelectorAll('canvas')[1] as HTMLCanvasElement
    const image = minimapCanvas
      .getContext('2d')!
      .getImageData(0, 0, minimapCanvas.width, minimapCanvas.height)
    let covered = 0
    let wrongHue = 0
    for (let i = 0; i < image.data.length; i += 4) {
      if (image.data[i + 3]! === 0) continue
      covered++
      // Red, not the default slate — and the pixel's own alpha is still the
      // coverage value, not the colour's.
      if (image.data[i]! < 200 || image.data[i + 1]! > 40 || image.data[i + 2]! > 40) wrongHue++
    }
    expect(covered).toBeGreaterThan(50)
    expect(wrongHue).toBe(0)
    chart.destroy()
  })

  it('falls back to the default silhouette colour when handed nonsense', async () => {
    const el = host()
    const chart = createKlad(el, {
      data: buildOrg(300),
      nodeSize: { w: 120, h: 48 },
      worker: false,
      minimap: { silhouetteColour: 'not-a-colour' },
    })
    await nextFrame()
    await nextFrame()

    const minimapCanvas = el.querySelectorAll('canvas')[1] as HTMLCanvasElement
    const image = minimapCanvas
      .getContext('2d')!
      .getImageData(0, 0, minimapCanvas.width, minimapCanvas.height)
    // The browser ignores an invalid `fillStyle` assignment outright, so a
    // colour that cannot be parsed must leave the default slate (71, 85, 105)
    // in place rather than whatever happened to be in the probe canvas.
    //
    // Read at the MOST opaque pixel: `getImageData` un-premultiplies, so a
    // faint pixel's channels come back rounded off by a few, which says
    // nothing about the colour that was asked for.
    let best = -1
    let bestAlpha = 0
    for (let i = 3; i < image.data.length; i += 4) {
      if (image.data[i]! > bestAlpha) {
        bestAlpha = image.data[i]!
        best = i - 3
      }
    }
    expect(bestAlpha).toBeGreaterThan(0)
    expect(image.data[best]).toBe(71)
    expect(image.data[best + 1]).toBe(85)
    expect(image.data[best + 2]).toBe(105)
    chart.destroy()
  })

  // Isolating replaces the tree the minimap is a map OF. Holding the frame
  // steady — which is right for a toggle, where the same tree changes shape —
  // leaves the branch drawn at the whole org's scale, in the corner the org
  // used to occupy. Measured before the fix: the silhouette spanned 80px of a
  // 200px widget and sat against the left edge; after, 191px.
  it('refits the frame when a branch is isolated', async () => {
    const el = host()
    const chart = createKlad(el, {
      data: buildOrg(300),
      nodeSize: { w: 120, h: 48 },
      worker: false,
      minimap: true,
    })
    await nextFrame()
    await nextFrame()

    const canvas = el.querySelectorAll('canvas')[1] as HTMLCanvasElement
    /** How far across the widget the painted silhouette actually reaches. */
    const inkWidth = (): number => {
      const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      let minX = canvas.width
      let maxX = -1
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          if (data[(y * canvas.width + x) * 4 + 3]! === 0) continue
          if (x < minX) minX = x
          if (x > maxX) maxX = x
        }
      }
      return maxX < 0 ? 0 : maxX - minX
    }

    expect(inkWidth()).toBeGreaterThan(canvas.width * 0.6)

    chart.api.isolate('n1')
    await nextFrame()
    await nextFrame()
    await nextFrame()

    // A tree is a tree: an isolated branch fills the widget like any other.
    expect(inkWidth()).toBeGreaterThan(canvas.width * 0.6)
    chart.destroy()
  })

  it('respects a custom size and position', async () => {
    const el = host()
    const chart = createKlad(el, {
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
    const chart = createKlad(el, {
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
    const chart = createKlad(el, {
      data: buildOrg(300),
      nodeSize: { w: 120, h: 48 },
      worker: false,
      minimap: true,
    })
    await nextFrame()
    await nextFrame()

    const before = chart.api.getState().camera
    const minimapRoot = el.querySelector<HTMLElement>('.klad-minimap')!
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
    // The pan the minimap asks for is an eased camera move, and its first step
    // shares a frame with this `await`. One frame is therefore not enough to
    // see it: if that frame fires with no measurable time elapsed, the eased
    // progress is 0 and the camera is still exactly where it was.
    await settle()

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
    const chart = createKlad(el, {
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
    const chart = createKlad(el, {
      data: buildOrg(300),
      nodeSize: { w: 120, h: 48 },
      worker: false,
      minimap: true,
    })
    await nextFrame()
    await nextFrame()

    const minimapRoot = el.querySelector<HTMLElement>('.klad-minimap')!
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
    const chart = createKlad(el, {
      data: SMALL_DATA,
      nodeSize: { w: 120, h: 48 },
      worker: false,
      minimap: true,
    })
    await nextFrame()
    await nextFrame()

    const minimapRoot = el.querySelector<HTMLElement>('.klad-minimap')!
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
    const chart = createKlad(el, {
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

  // Round-trips the minimap's two directions against each other, which is the
  // only way to catch a shift between them without restating one in terms of
  // the other: click a point in the widget (widget px -> world, via
  // `minimapToWorld`), let the camera centre on it, then read back where the
  // viewport rectangle lands (world -> widget px, via `worldToMinimap`). Click
  // the widget's centre and the rectangle must come back centred on the
  // widget's centre. A padding applied on one direction only, or a viewport
  // measured differently by the two, lands the rectangle off to one side.
  it('round-trips a click at its centre back to a rectangle centred on it', async () => {
    const el = host()
    const chart = createKlad(el, {
      data: buildOrg(300),
      nodeSize: { w: 120, h: 48 },
      worker: false,
      minimap: true,
    })
    await new Promise((r) => setTimeout(r, 260))
    await nextFrame()

    const minimapRoot = el.querySelector<HTMLElement>('.klad-minimap')!
    const widget = minimapRoot.getBoundingClientRect()
    minimapRoot.dispatchEvent(
      new PointerEvent('pointerdown', {
        clientX: widget.left + widget.width / 2,
        clientY: widget.top + widget.height / 2,
        pointerId: 1,
        bubbles: true,
      }),
    )
    minimapRoot.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }))
    // The pan is a camera tween, not an instant jump.
    await new Promise((r) => setTimeout(r, 260))
    await nextFrame()

    const viewportEl = minimapRoot.querySelector('div') as HTMLElement
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(viewportEl.style.transform)!
    const centreX = parseFloat(m[1]!) + parseFloat(viewportEl.style.width) / 2
    const centreY = parseFloat(m[2]!) + parseFloat(viewportEl.style.height) / 2

    // Against the minimap's OWN coordinate space (the canvas), not the root
    // element's border box: the widget draws a 1px border outside a 200x140
    // content box, so its `getBoundingClientRect()` is 202x142 while every
    // coordinate inside — the canvas, the rectangle's `translate` — is
    // measured from the padding box the border encloses.
    const minimapCanvas = minimapRoot.querySelector('canvas') as HTMLCanvasElement
    expect(centreX).toBeCloseTo(minimapCanvas.width / 2, 1)
    expect(centreY).toBeCloseTo(minimapCanvas.height / 2, 1)

    chart.destroy()
  })

  // Collapsing shrinks the laid-out bounds — collapsing the root shrinks them
  // to a single node. Fitting those bounds to the widget on every relayout
  // made that one node fill the entire minimap: the scale lurched on every
  // toggle and nothing stayed where it was. The frame is held steady instead,
  // and only refitted when a layout genuinely no longer fits inside it.
  it('holds its scale across a toggle instead of refitting to the collapsed bounds', async () => {
    const el = host()
    const chart = createKlad(el, {
      data: buildOrg(300),
      nodeSize: { w: 120, h: 48 },
      worker: false,
      minimap: true,
      // The viewport rectangle's size is `visible world size * scale`, so with
      // the camera's zoom held fixed it is a direct read-out of the minimap's
      // own scale. The toggle anchor only ever pans, never zooms.
      ring: false,
    })
    await new Promise((r) => setTimeout(r, 260))
    await nextFrame()

    const minimapRoot = el.querySelector<HTMLElement>('.klad-minimap')!
    const viewportEl = minimapRoot.querySelector('div') as HTMLElement
    const rectWidth = (): number => parseFloat(viewportEl.style.width)

    const before = rectWidth()
    const zoomBefore = chart.api.getState().camera.k
    expect(before).toBeGreaterThan(0)

    chart.api.collapse('root')
    await new Promise((r) => setTimeout(r, 700))
    await nextFrame()
    await nextFrame()

    // Sanity: the toggle really did collapse the tree, and really did leave
    // the camera's zoom alone — otherwise the rectangle's size would be free
    // to change for a reason that has nothing to do with the minimap.
    expect(chart.api.getState().visibleCount).toBe(1)
    expect(chart.api.getState().camera.k).toBeCloseTo(zoomBefore, 5)
    expect(rectWidth()).toBeCloseTo(before, 3)

    chart.destroy()
  })

  // What the user actually watches is the blue viewport rectangle, and a root
  // toggle must leave it exactly where it was: the chart's camera anchor pins
  // the root's SCREEN position through the toggle, so if the minimap pins the
  // root's WIDGET position too, the region the rectangle describes is
  // unchanged in both spaces. It moves if either half is missing — a refit
  // changes its size, an unshifted frame changes its position — which is why
  // this one assertion covers both.
  it('leaves the viewport rectangle where it was after a root toggle', async () => {
    const el = host()
    const chart = createKlad(el, {
      data: buildOrg(300),
      nodeSize: { w: 120, h: 48 },
      worker: false,
      minimap: true,
      ring: false,
    })
    await new Promise((r) => setTimeout(r, 260))
    await nextFrame()

    const minimapRoot = el.querySelector<HTMLElement>('.klad-minimap')!
    const viewportEl = minimapRoot.children[1] as HTMLElement
    const readRect = (): { x: number; y: number; w: number; h: number } => {
      const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(viewportEl.style.transform)!
      return {
        x: parseFloat(m[1]!),
        y: parseFloat(m[2]!),
        w: parseFloat(viewportEl.style.width),
        h: parseFloat(viewportEl.style.height),
      }
    }

    const before = readRect()
    expect(before.w).toBeGreaterThan(0)

    chart.api.collapse('root')
    await new Promise((r) => setTimeout(r, 700))
    await nextFrame()
    await nextFrame()

    expect(chart.api.getState().visibleCount).toBe(1)
    const after = readRect()
    expect(after.w).toBeCloseTo(before.w, 0)
    expect(after.h).toBeCloseTo(before.h, 0)
    expect(after.x).toBeCloseTo(before.x, 0)
    expect(after.y).toBeCloseTo(before.y, 0)

    chart.destroy()
  })

  // The same invariant, sampled DURING the toggle rather than only after it.
  // The silhouette deliberately holds the pre-toggle layout until the
  // transition ends, but the camera starts moving on the first frame, so a
  // rectangle mapped through the stale transform slides across the widget for
  // the whole ~450ms and snaps back at the end. Only a mid-transition sample
  // catches that.
  it('holds the viewport rectangle still for every frame of a root toggle', async () => {
    const el = host()
    const chart = createKlad(el, {
      data: buildOrg(300),
      nodeSize: { w: 120, h: 48 },
      worker: false,
      minimap: true,
      ring: false,
    })
    await new Promise((r) => setTimeout(r, 260))
    await nextFrame()

    const minimapRoot = el.querySelector<HTMLElement>('.klad-minimap')!
    const viewportEl = minimapRoot.children[1] as HTMLElement
    const readX = (): number => {
      const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(viewportEl.style.transform)!
      return parseFloat(m[1]!)
    }

    const before = readX()
    chart.api.collapse('root')
    let worst = 0
    let samples = 0
    for (let i = 0; i < 30; i++) {
      await nextFrame()
      samples++
      worst = Math.max(worst, Math.abs(readX() - before))
    }
    expect(samples).toBeGreaterThan(10)
    expect(worst).toBeLessThan(1)

    chart.destroy()
  })

  it('destroy() removes the minimap element', async () => {
    const el = host()
    const chart = createKlad(el, {
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
