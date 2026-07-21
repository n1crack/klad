import { describe, expect, it } from 'vitest'
import { createOrgChart } from './index.js'

const DATA = [
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

function make(overrides: Record<string, unknown> = {}) {
  return createOrgChart(host(), {
    data: DATA,
    nodeSize: { w: 120, h: 48 },
    label: (item) => String(item.name ?? ''),
    worker: false,
    ...overrides,
  })
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)))

// Camera moves triggered through the API now ease over 200ms (see the tween
// in index.ts) instead of landing instantly. A test that cares about the
// *destination* camera, not the motion itself, has to wait out the tween
// first — real wall-clock time, since the animation is driven by the
// browser's own requestAnimationFrame loop rather than anything fake-timer
// controlled. One extra `nextFrame()` afterward lets the final frame the
// tween's last step scheduled actually run, so the overlay/DOM reflects the
// settled camera too.
const settle = () => new Promise<void>((resolve) => setTimeout(() => resolve(), 260))

describe('createOrgChart', () => {
  it('creates a canvas inside the host', () => {
    const el = host()
    createOrgChart(el, { data: DATA, nodeSize: { w: 120, h: 48 }, worker: false })
    expect(el.querySelector('canvas')).not.toBeNull()
  })

  it('removes everything it created on destroy', () => {
    const el = host()
    const chart = createOrgChart(el, { data: DATA, nodeSize: { w: 120, h: 48 }, worker: false })
    chart.destroy()
    expect(el.querySelector('canvas')).toBeNull()
  })

  it('reports state through subscribe', async () => {
    const chart = make()
    let seen = 0
    chart.subscribe(() => seen++)
    await nextFrame()
    expect(seen).toBeGreaterThan(0)
    chart.destroy()
  })

  it('accepts a nodeSize function', async () => {
    const chart = make({
      nodeSize: (item: { id: string }) => (item.id === 'a' ? { w: 200, h: 60 } : { w: 120, h: 48 }),
    })
    await nextFrame()
    expect(chart.api.getState().nodeCount).toBe(4)
    chart.destroy()
  })

  it('collapses and expands, changing the visible count', async () => {
    const chart = make()
    await nextFrame()
    chart.api.collapse('b')
    await nextFrame()
    expect(chart.api.getState().visibleCount).toBe(3)
    chart.api.expand('b')
    await nextFrame()
    expect(chart.api.getState().visibleCount).toBe(4)
    chart.destroy()
  })

  it('honours collapsedByDefault', async () => {
    const chart = make({ collapsedByDefault: true })
    await nextFrame()
    // Only the roots remain visible.
    expect(chart.api.getState().visibleCount).toBe(1)
    chart.destroy()
  })

  it('searches by substring and returns matching ids', async () => {
    const chart = make()
    await nextFrame()
    expect(chart.api.search('lef').map((r) => r.id)).toEqual(['b'])
    chart.destroy()
  })

  it('expands the ancestor chain when focusing a hidden node', async () => {
    const chart = make({ collapsedByDefault: true })
    await nextFrame()
    chart.api.expandTo('d')
    await nextFrame()
    expect(chart.api.getState().visibleCount).toBe(4)
    chart.destroy()
  })

  it('pans on pointer drag', async () => {
    const chart = make()
    await nextFrame()
    const before = chart.api.getState().camera.x
    const canvas = document.querySelector('canvas')!
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 160, clientY: 100, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 160, clientY: 100, bubbles: true }))
    await nextFrame()
    expect(chart.api.getState().camera.x).toBeCloseTo(before + 60, 5)
    chart.destroy()
  })

  it('zooms about the cursor on wheel', async () => {
    const chart = make()
    await nextFrame()
    const before = chart.api.getState().camera.k
    document
      .querySelector('canvas')!
      .dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 400, clientY: 300, bubbles: true }))
    await nextFrame()
    expect(chart.api.getState().camera.k).toBeGreaterThan(before)
    chart.destroy()
  })

  it('emits nodeClick with the clicked id', async () => {
    const chart = make()
    chart.api.fit()
    await nextFrame()
    const clicked: string[] = []
    chart.on('nodeClick', (e) => clicked.push(e.id))

    const state = chart.api.getState()
    const canvas = document.querySelector('canvas')!
    const rect = canvas.getBoundingClientRect()
    // Aim at the centre of the root box in screen space.
    const sx = rect.left + state.rootScreenCentre.x
    const sy = rect.top + state.rootScreenCentre.y
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: sx, clientY: sy, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: sx, clientY: sy, bubbles: true }))
    await nextFrame()
    expect(clicked).toEqual(['a'])
    chart.destroy()
  })

  it('renders overlay elements only when zoomed in', async () => {
    const chart = make({ renderNode: (el: HTMLElement, ctx: { id: string }) => (el.textContent = ctx.id) })
    chart.api.zoomTo(1)
    await nextFrame()
    expect(document.querySelectorAll('.orgchart-overlay-node').length).toBeGreaterThan(0)
    chart.api.zoomTo(0.1)
    await settle()
    await nextFrame()
    expect(document.querySelectorAll('.orgchart-overlay-node').length).toBe(0)
    chart.destroy()
  })

  it('reuses overlay elements instead of recreating them while panning', async () => {
    const chart = make({ renderNode: (el: HTMLElement, ctx: { id: string }) => (el.textContent = ctx.id) })
    chart.api.zoomTo(1)
    await nextFrame()
    const first = document.querySelector('.orgchart-overlay-node')
    chart.api.zoomTo(1.01)
    await nextFrame()
    expect(document.querySelector('.orgchart-overlay-node')).toBe(first)
    chart.destroy()
  })

  // Regression: the opening camera used to be computed at construction, before the
  // first render had produced any layout, so bounds were empty and every chart opened
  // on an arbitrary camera — zooming from there walked off into empty space.
  it('opens with the root on screen, not on an arbitrary camera', async () => {
    const chart = make()
    await nextFrame()
    await nextFrame()

    const state = chart.api.getState()
    expect(state.bounds.maxX).toBeGreaterThan(0)

    // The root is visible and sits near the top, since the tree hangs below it.
    expect(state.rootScreenCentre.x).toBeGreaterThan(0)
    expect(state.rootScreenCentre.x).toBeLessThan(800)
    expect(state.rootScreenCentre.y).toBeGreaterThan(0)
    expect(state.rootScreenCentre.y).toBeLessThan(300)

    // Readable scale, never blown up past 1x even though this fixture would fit larger.
    expect(state.camera.k).toBeLessThanOrEqual(1)
    expect(state.camera.k).toBeGreaterThan(0)
    chart.destroy()
  })

  it('fit() zooms out far enough to show a chart wider than the viewport', async () => {
    // A deliberately wide tree: one root, forty children, each 120 wide.
    const wide = [
      { id: 'root', name: 'Root' },
      ...Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, parentId: 'root', name: `C${i}` })),
    ]
    const el = document.createElement('div')
    el.style.width = '800px'
    el.style.height = '600px'
    document.body.appendChild(el)
    const chart = createOrgChart(el, {
      data: wide,
      nodeSize: { w: 120, h: 48 },
      worker: false,
    })
    await nextFrame()
    await nextFrame()

    chart.api.fit()
    await settle()
    await nextFrame()

    const state = chart.api.getState()
    const width = state.bounds.maxX - state.bounds.minX
    // The content is far wider than the viewport, so fit must go well below the
    // default 0.05 floor. A fixed floor here would leave the chart clipped.
    expect(width).toBeGreaterThan(800)
    expect(state.camera.k * width).toBeLessThanOrEqual(800)
    chart.destroy()
  })

  it('warns instead of throwing on unresolvable parents', async () => {
    const warnings: unknown[] = []
    const chart = createOrgChart(host(), {
      data: [{ id: 'a' }, { id: 'x', parentId: 'ghost' }],
      nodeSize: { w: 100, h: 40 },
      worker: false,
    })
    chart.on('warning', (w) => warnings.push(w))
    await nextFrame()
    expect(warnings.length).toBeGreaterThan(0)
    chart.destroy()
  })

  // --- camera tween ---------------------------------------------------

  it('cancels an in-flight tween the instant the pointer grabs the canvas', async () => {
    const chart = make()
    await nextFrame()
    await nextFrame()

    chart.api.zoomTo(0.2)
    // Let the tween run partway — real wall-clock time, since it's driven by
    // the browser's own requestAnimationFrame loop.
    await new Promise((r) => setTimeout(r, 60))
    const midK = chart.api.getState().camera.k
    expect(midK).toBeLessThan(1)
    expect(midK).toBeGreaterThan(0.2)

    // Grab the canvas: a drag. This must cancel the tween immediately, not
    // merely queue behind it or fight it.
    const canvas = document.querySelector('canvas')!
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 130, clientY: 100, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 130, clientY: 100, bubbles: true }))
    await nextFrame()

    // The drag only pans (x/y), so k should be frozen at exactly wherever the
    // tween had gotten to the instant the pointer went down.
    const afterDragK = chart.api.getState().camera.k
    expect(afterDragK).toBeCloseTo(midK, 5)

    // Wait well past the tween's own 200ms duration. If cancellation had not
    // actually stopped the tween's rAF loop, it would have kept running in
    // the background and landed on 0.2 by now.
    await settle()
    const finalK = chart.api.getState().camera.k
    expect(finalK).toBeCloseTo(afterDragK, 5)
    expect(finalK).not.toBeCloseTo(0.2, 2)
    chart.destroy()
  })

  it('retargets an in-flight tween from its current position instead of restarting', async () => {
    const chart = make()
    await nextFrame()
    await nextFrame()

    chart.api.zoomTo(0.2)
    await new Promise((r) => setTimeout(r, 60))
    const midK = chart.api.getState().camera.k

    // A second call while the first is still running.
    chart.api.zoomTo(0.5)
    // No visible jump the instant it's issued — it continues from `midK`,
    // it does not snap back to the first tween's start (k=1) or leap to 0.5.
    expect(chart.api.getState().camera.k).toBeCloseTo(midK, 5)

    await settle()
    await nextFrame()
    expect(chart.api.getState().camera.k).toBeCloseTo(0.5, 2)
    chart.destroy()
  })

  it('does not tween the opening camera into position', async () => {
    const chart = make()
    await nextFrame()
    await nextFrame()
    const early = chart.api.getState()

    // If the opening camera were tweened, it would still be easing toward its
    // resting position well after two frames.
    await settle()
    const later = chart.api.getState()
    expect(later.camera.x).toBeCloseTo(early.camera.x, 5)
    expect(later.camera.y).toBeCloseTo(early.camera.y, 5)
    expect(later.rootScreenCentre.x).toBeCloseTo(early.rootScreenCentre.x, 5)
    chart.destroy()
  })

  it('applies camera moves instantly when animate is false', async () => {
    const chart = make({ animate: false })
    await nextFrame()
    await nextFrame()
    chart.api.zoomTo(0.3)
    await nextFrame()
    expect(chart.api.getState().camera.k).toBeCloseTo(0.3, 5)
    chart.destroy()
  })

  it('honours prefers-reduced-motion by skipping the tween', async () => {
    const original = window.matchMedia
    window.matchMedia = ((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia

    try {
      const chart = make()
      await nextFrame()
      await nextFrame()
      chart.api.zoomTo(0.3)
      await nextFrame()
      expect(chart.api.getState().camera.k).toBeCloseTo(0.3, 5)
      chart.destroy()
    } finally {
      window.matchMedia = original
    }
  })

  // --- nodeHover --------------------------------------------------------

  it('emits nodeHover on enter and { id: null, item: null } on leave', async () => {
    const chart = make()
    chart.api.fit()
    await nextFrame()

    const events: unknown[] = []
    chart.on('nodeHover', (e) => events.push(e))

    const state = chart.api.getState()
    const canvas = document.querySelector('canvas')!
    const rect = canvas.getBoundingClientRect()
    const sx = rect.left + state.rootScreenCentre.x
    const sy = rect.top + state.rootScreenCentre.y

    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: sx, clientY: sy, bubbles: true }))
    await nextFrame()
    expect(events.length).toBe(1)
    expect((events[0] as { id: string }).id).toBe('a')

    canvas.dispatchEvent(new PointerEvent('pointerleave', { clientX: sx, clientY: sy, bubbles: true }))
    expect(events.length).toBe(2)
    expect(events[1]).toEqual({ id: null, item: null })
    chart.destroy()
  })

  it('does not re-fire nodeHover for repeated moves at the same point', async () => {
    const chart = make()
    chart.api.fit()
    await nextFrame()

    const events: unknown[] = []
    chart.on('nodeHover', (e) => events.push(e))

    const state = chart.api.getState()
    const canvas = document.querySelector('canvas')!
    const rect = canvas.getBoundingClientRect()
    const sx = rect.left + state.rootScreenCentre.x
    const sy = rect.top + state.rootScreenCentre.y

    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: sx, clientY: sy, bubbles: true }))
    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: sx, clientY: sy, bubbles: true }))
    await nextFrame()
    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: sx, clientY: sy, bubbles: true }))
    await nextFrame()

    expect(events.length).toBe(1)
    chart.destroy()
  })

  // --- nodeDblClick -------------------------------------------------------

  it('emits nodeDblClick for two taps within the window, without a second nodeClick', async () => {
    const chart = make()
    chart.api.fit()
    await nextFrame()

    const clicks: string[] = []
    const dblclicks: string[] = []
    chart.on('nodeClick', (e) => clicks.push(e.id))
    chart.on('nodeDblClick', (e) => dblclicks.push(e.id))

    const state = chart.api.getState()
    const canvas = document.querySelector('canvas')!
    const rect = canvas.getBoundingClientRect()
    const sx = rect.left + state.rootScreenCentre.x
    const sy = rect.top + state.rootScreenCentre.y
    const tap = () => {
      canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: sx, clientY: sy, bubbles: true }))
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: sx, clientY: sy, bubbles: true }))
    }

    tap()
    await nextFrame()
    tap()
    await nextFrame()

    // Exactly one nodeClick (the first tap) plus one nodeDblClick — the
    // second tap of the pair does not also emit its own nodeClick.
    expect(clicks).toEqual(['a'])
    expect(dblclicks).toEqual(['a'])
    chart.destroy()
  })

  it('does not treat two taps more than the double-click window apart as a double click', async () => {
    const chart = make()
    chart.api.fit()
    await nextFrame()

    const clicks: string[] = []
    const dblclicks: string[] = []
    chart.on('nodeClick', (e) => clicks.push(e.id))
    chart.on('nodeDblClick', (e) => dblclicks.push(e.id))

    const state = chart.api.getState()
    const canvas = document.querySelector('canvas')!
    const rect = canvas.getBoundingClientRect()
    const sx = rect.left + state.rootScreenCentre.x
    const sy = rect.top + state.rootScreenCentre.y
    const tap = () => {
      canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: sx, clientY: sy, bubbles: true }))
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: sx, clientY: sy, bubbles: true }))
    }

    tap()
    await new Promise((r) => setTimeout(r, 350))
    tap()
    await nextFrame()

    expect(clicks).toEqual(['a', 'a'])
    expect(dblclicks).toEqual([])
    chart.destroy()
  })

  // --- kinetic panning -----------------------------------------------------

  it('coasts with momentum after a fast drag release, then stops', async () => {
    const chart = make()
    await nextFrame()
    await nextFrame()

    const canvas = document.querySelector('canvas')!
    const before = chart.api.getState().camera.x

    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 400, clientY: 300, bubbles: true }))
    // A handful of fast moves in the same direction, with real elapsed time
    // between them so the velocity estimate is meaningful (see
    // MIN_VELOCITY_SAMPLE_MS in input.ts).
    for (let i = 1; i <= 5; i++) {
      await new Promise((r) => setTimeout(r, 10))
      window.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 400 + i * 20, clientY: 300, bubbles: true }),
      )
    }
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 500, clientY: 300, bubbles: true }))

    const rightAfterRelease = chart.api.getState().camera.x
    expect(rightAfterRelease).toBeGreaterThan(before)

    // Let the coast run a while with no further input.
    await new Promise((r) => setTimeout(r, 80))
    const midCoast = chart.api.getState().camera.x
    expect(midCoast).toBeGreaterThan(rightAfterRelease)

    // Long enough for the exponential decay to fall below the stop threshold.
    await new Promise((r) => setTimeout(r, 1500))
    const settled1 = chart.api.getState().camera.x
    await new Promise((r) => setTimeout(r, 200))
    const settled2 = chart.api.getState().camera.x
    expect(settled2).toBeCloseTo(settled1, 5)
    chart.destroy()
  })

  it('cancels an in-flight momentum coast the instant a new drag begins', async () => {
    const chart = make()
    await nextFrame()
    await nextFrame()

    const canvas = document.querySelector('canvas')!
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 400, clientY: 300, bubbles: true }))
    for (let i = 1; i <= 5; i++) {
      await new Promise((r) => setTimeout(r, 10))
      window.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 400 + i * 20, clientY: 300, bubbles: true }),
      )
    }
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 500, clientY: 300, bubbles: true }))

    await new Promise((r) => setTimeout(r, 40))
    const coasting = chart.api.getState().camera.x

    // Grab the canvas again — the same cancel-on-contact rule the tween
    // relies on applies here too (both share `cancelCameraAnimation`).
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 200, clientY: 300, bubbles: true }))
    const rightAfterGrab = chart.api.getState().camera.x
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 200, clientY: 300, bubbles: true }))

    await new Promise((r) => setTimeout(r, 400))
    const afterWait = chart.api.getState().camera.x

    expect(rightAfterGrab).toBeCloseTo(coasting, 5)
    expect(afterWait).toBeCloseTo(rightAfterGrab, 5)
    chart.destroy()
  })

  it('does not coast when animate is false', async () => {
    const chart = make({ animate: false })
    await nextFrame()
    await nextFrame()

    const canvas = document.querySelector('canvas')!
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 400, clientY: 300, bubbles: true }))
    for (let i = 1; i <= 3; i++) {
      await new Promise((r) => setTimeout(r, 10))
      window.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 400 + i * 20, clientY: 300, bubbles: true }),
      )
    }
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 460, clientY: 300, bubbles: true }))
    const rightAfter = chart.api.getState().camera.x
    await new Promise((r) => setTimeout(r, 150))
    expect(chart.api.getState().camera.x).toBeCloseTo(rightAfter, 5)
    chart.destroy()
  })

  // --- auto-pan on toggle --------------------------------------------------

  it('approaches the toggled node and its children on expand, never zooming past 1:1', async () => {
    const chart = make({ collapsedByDefault: true })
    await nextFrame()
    await nextFrame()

    const before = chart.api.getState().camera
    chart.api.expand('a') // root 'a' has two children, b and c
    await settle()
    await nextFrame()
    const after = chart.api.getState().camera

    expect(after.x !== before.x || after.y !== before.y || after.k !== before.k).toBe(true)
    expect(after.k).toBeLessThanOrEqual(1)
    chart.destroy()
  })

  it('approaches the toggled node on collapse', async () => {
    const chart = make()
    await nextFrame()
    await nextFrame()
    chart.api.fit()
    await settle()
    await nextFrame()

    chart.api.collapse('b')
    await settle()
    await nextFrame()
    const afterCollapse = chart.api.getState().camera
    expect(afterCollapse.k).toBeLessThanOrEqual(1)

    // `focus('b')` at the camera's now-current zoom centres squarely on 'b'.
    // If auto-pan had truly approached 'b', re-focusing on it afterward is a
    // no-op; if auto-pan had centred on the wrong point, this would move the
    // camera again.
    chart.api.focus('b')
    await settle()
    await nextFrame()
    const focused = chart.api.getState().camera

    expect(afterCollapse.x).toBeCloseTo(focused.x, 0)
    expect(afterCollapse.y).toBeCloseTo(focused.y, 0)
    chart.destroy()
  })

  it('does not auto-pan on toggle when autoPanOnToggle is false', async () => {
    const chart = make({ collapsedByDefault: true, autoPanOnToggle: false })
    await nextFrame()
    await nextFrame()

    const before = chart.api.getState().camera
    chart.api.expand('a')
    await settle()
    await nextFrame()
    const after = chart.api.getState().camera

    expect(after).toEqual(before)
    chart.destroy()
  })

  it('fits the whole chart after expandAll', async () => {
    const chart = make({ collapsedByDefault: true })
    await nextFrame()
    await nextFrame()

    chart.api.expandAll()
    await settle()
    await nextFrame()
    const afterExpandAll = chart.api.getState().camera

    // An explicit fit() afterward should be a no-op if expandAll already fit.
    chart.api.fit()
    await settle()
    await nextFrame()
    const afterExplicitFit = chart.api.getState().camera

    expect(afterExpandAll.k).toBeCloseTo(afterExplicitFit.k, 5)
    expect(afterExpandAll.x).toBeCloseTo(afterExplicitFit.x, 5)
    expect(afterExpandAll.y).toBeCloseTo(afterExplicitFit.y, 5)
    chart.destroy()
  })

  // --- input routes through the chart host, not just the canvas -----------

  it('pans when a drag starts on an overlay card', async () => {
    const chart = make({ renderNode: (el: HTMLElement, ctx: { id: string }) => (el.textContent = ctx.id) })
    chart.api.fit()
    await settle()
    await nextFrame()

    const card = document.querySelector('.orgchart-overlay-node') as HTMLElement
    expect(card).not.toBeNull()
    const rect = card.getBoundingClientRect()
    const startX = rect.left + rect.width / 2
    const startY = rect.top + rect.height / 2
    const before = chart.api.getState().camera.x

    card.dispatchEvent(new PointerEvent('pointerdown', { clientX: startX, clientY: startY, bubbles: true }))
    window.dispatchEvent(
      new PointerEvent('pointermove', { clientX: startX + 60, clientY: startY, bubbles: true }),
    )
    window.dispatchEvent(
      new PointerEvent('pointerup', { clientX: startX + 60, clientY: startY, bubbles: true }),
    )
    await nextFrame()

    expect(chart.api.getState().camera.x).toBeCloseTo(before + 60, 5)
    chart.destroy()
  })

  it("does not pan on a tap that lands on a card's own button, and the button's click still fires", async () => {
    let toggled = false
    const chart = make({
      renderNode: (el: HTMLElement) => {
        const button = document.createElement('button')
        button.textContent = 'toggle'
        button.onclick = () => {
          toggled = true
        }
        el.replaceChildren(button)
      },
    })
    chart.api.fit()
    await settle()
    await nextFrame()
    chart.api.zoomTo(1)
    await settle()
    await nextFrame()

    const button = document.querySelector('.orgchart-overlay-node button') as HTMLButtonElement
    expect(button).not.toBeNull()
    const rect = button.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const before = chart.api.getState().camera

    button.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: cx, clientY: cy, bubbles: true }))
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextFrame()

    expect(chart.api.getState().camera.x).toBeCloseTo(before.x, 5)
    expect(chart.api.getState().camera.y).toBeCloseTo(before.y, 5)
    expect(toggled).toBe(true)
    chart.destroy()
  })

  it('zooms when the wheel fires over an overlay card', async () => {
    const chart = make({ renderNode: (el: HTMLElement, ctx: { id: string }) => (el.textContent = ctx.id) })
    chart.api.zoomTo(1)
    await settle()
    await nextFrame()

    const card = document.querySelector('.orgchart-overlay-node') as HTMLElement
    expect(card).not.toBeNull()
    const rect = card.getBoundingClientRect()
    const before = chart.api.getState().camera.k

    card.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -100,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        bubbles: true,
      }),
    )
    await nextFrame()

    expect(chart.api.getState().camera.k).toBeGreaterThan(before)
    chart.destroy()
  })
})
