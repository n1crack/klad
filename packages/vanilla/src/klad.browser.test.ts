import { describe, expect, it } from 'vitest'
import { createKlad } from './index.js'

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
  return createKlad(host(), {
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

// A single-node expand/collapse now runs the engine's own staged layout
// transition (see engine.ts's `TRANSITION_DURATION_MS`, currently 450ms —
// two phases plus a small overlap), and the camera anchor rides along with
// it for as long as that transition runs. That is LONGER than the 200ms
// camera-tween `settle()` above waits out, so a test that toggles a node and
// then reads back the camera/layout needs to wait out the transition itself,
// not just a tween.
const settleTransition = () => new Promise<void>((resolve) => setTimeout(() => resolve(), 550))

describe('createKlad', () => {
  it('creates a canvas inside the host', () => {
    const el = host()
    createKlad(el, { data: DATA, nodeSize: { w: 120, h: 48 }, worker: false })
    expect(el.querySelector('canvas')).not.toBeNull()
  })

  it('removes everything it created on destroy', () => {
    const el = host()
    const chart = createKlad(el, { data: DATA, nodeSize: { w: 120, h: 48 }, worker: false })
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

  it('setTheme repaints with the new theme without relaying out', async () => {
    const chart = make()
    await nextFrame()
    const before = chart.api.getState()

    // Spy on the canvas 2D context's `fillStyle` SETTER (not a mock context —
    // the real one `createKlad` created) so this test can tell the new
    // theme actually reached the paint, the same signal a human eye would
    // use, rather than just trusting `setTheme` didn't throw.
    const canvas = document.querySelector('canvas')!
    const ctx = canvas.getContext('2d')!
    const proto = Object.getPrototypeOf(ctx) as object
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'fillStyle')!
    const fillStyles: unknown[] = []
    Object.defineProperty(ctx, 'fillStyle', {
      configurable: true,
      get() {
        return descriptor.get!.call(ctx)
      },
      set(v: unknown) {
        fillStyles.push(v)
        descriptor.set!.call(ctx, v)
      },
    })

    chart.api.setTheme({ nodeFill: '#ff00ff' })
    await nextFrame()

    expect(fillStyles).toContain('#ff00ff')

    // Paint-only: none of the layout-derived state moved. `bounds` and
    // `visibleCount` are the closest thing the public API exposes to "the
    // layout boxes" (raw boxes aren't part of `KladApi`'s surface) — both
    // are pure functions of the tree/layout, never of theme, so either
    // moving would mean a relayout snuck in.
    const after = chart.api.getState()
    expect(after.bounds).toEqual(before.bounds)
    expect(after.visibleCount).toBe(before.visibleCount)
    expect(after.nodeCount).toBe(before.nodeCount)
    expect(after.camera).toEqual(before.camera)

    chart.destroy()
  })

  /** Spies on the canvas 2D context's `strokeStyle` SETTER, same technique as
   * the `setTheme` test above's `fillStyle` spy — the ring is drawn with
   * `ctx.strokeStyle = theme.ringStroke`, so watching every value ever
   * assigned there is the same signal a human eye would use to notice the
   * flash, without reaching into engine internals this layer doesn't expose. */
  function spyOnStrokeStyle(): unknown[] {
    const canvas = document.querySelector('canvas')!
    const ctx = canvas.getContext('2d')!
    const proto = Object.getPrototypeOf(ctx) as object
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'strokeStyle')!
    const strokeStyles: unknown[] = []
    Object.defineProperty(ctx, 'strokeStyle', {
      configurable: true,
      get() {
        return descriptor.get!.call(ctx)
      },
      set(v: unknown) {
        strokeStyles.push(v)
        descriptor.set!.call(ctx, v)
      },
    })
    return strokeStyles
  }

  it('flashes the confirmation ring on a single-node toggle by default', async () => {
    const chart = make()
    await nextFrame()
    const strokeStyles = spyOnStrokeStyle()

    chart.api.collapse('b') // single-node toggle: the exact case the ring exists for
    await nextFrame()
    await nextFrame()
    await nextFrame()

    expect(strokeStyles).toContain('#f59e0b') // DEFAULT_THEME.ringStroke
    chart.destroy()
  })

  it('suppresses the confirmation ring when `ring: false`, without touching the layout transition', async () => {
    const chart = make({ ring: false })
    await nextFrame()
    const strokeStyles = spyOnStrokeStyle()

    chart.api.collapse('b')
    await nextFrame()
    await nextFrame()
    await nextFrame()

    // The default ring colour is never assigned as a strokeStyle: no ring
    // drawn on this toggle, or any other, for as long as the option is off.
    expect(strokeStyles).not.toContain('#f59e0b')
    // The layout transition itself is untouched by `ring: false` — only the
    // ring is suppressed, per `Options.ring`'s contract.
    await settleTransition()
    expect(chart.api.getState().visibleCount).toBe(3)
    chart.destroy()
  })

  it('recolours the ring live through setTheme, without relaying out', async () => {
    const chart = make()
    await nextFrame()
    const strokeStyles = spyOnStrokeStyle()

    chart.api.setTheme({ ringStroke: '#00ff00' })
    chart.api.collapse('c')
    await nextFrame()
    await nextFrame()

    expect(strokeStyles).toContain('#00ff00')
    expect(strokeStyles).not.toContain('#f59e0b')
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

  // The smallest chart anyone can write. Both of the options this used to
  // require — a node size and a label accessor — now have defaults, and this
  // asserts what those defaults are worth: boxes of a readable size, with the
  // node's own name in them, from data alone.
  it('draws a chart from data alone, with no size and no label accessor', async () => {
    const el = host()
    const chart = createKlad(el, { data: DATA, worker: false })
    await nextFrame()

    const svg = chart.api.toSVG()
    expect(chart.api.getState().visibleCount).toBe(4)
    expect(svg).toContain('width="180"')
    expect(svg).toContain('height="64"')
    // The label came from `name` without being asked for.
    expect(svg).toContain('Root')
    expect(svg).toContain('Leaf')
    chart.destroy()
  })

  // `id` is the last resort, and the one that matters: data shaped in some
  // fourth way still identifies its nodes rather than drawing empty boxes.
  it('falls back to the id when a node carries no name, label or title', async () => {
    const el = host()
    const chart = createKlad(el, { data: [{ id: 'only-node' }], worker: false })
    await nextFrame()
    expect(chart.api.toSVG()).toContain('only-node')
    chart.destroy()
  })

  it('pans on pointer drag', async () => {
    const chart = make()
    // The opening view arrives on a tween of its own. Reading `before` one
    // frame in catches it mid-flight, and the pointerdown below then CANCELS
    // that tween (the user's hand wins immediately, by design) — so the
    // camera never reaches where `before` assumed it would be, and the drag's
    // own 60px lands somewhere else entirely. On a fast machine the tween is
    // over within that frame and the bug never shows; CI is not a fast
    // machine.
    await settle()
    const before = chart.api.getState().camera.x
    const canvas = document.querySelector('canvas')!
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 160, clientY: 100, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 160, clientY: 100, bubbles: true }))
    await nextFrame()
    expect(chart.api.getState().camera.x).toBeCloseTo(before + 60, 5)
    chart.destroy()
  })

  it('does not pan on a secondary-button drag, so a context menu stays put over the chart', async () => {
    const chart = make()
    // The opening view arrives on a tween of its own. Reading `before` one
    // frame in catches it mid-flight, and the pointerdown below then CANCELS
    // that tween (the user's hand wins immediately, by design) — so the
    // camera never reaches where `before` assumed it would be, and the drag's
    // own 60px lands somewhere else entirely. On a fast machine the tween is
    // over within that frame and the bug never shows; CI is not a fast
    // machine.
    await settle()
    const before = chart.api.getState().camera.x
    const canvas = document.querySelector('canvas')!
    // `button: 2` is the right button. The browser opens its context menu on
    // this press, and the chart sliding out from under that menu is exactly
    // what the primary-button check in input.ts prevents.
    canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 2, clientX: 100, clientY: 100, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 160, clientY: 100, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { button: 2, clientX: 160, clientY: 100, bubbles: true }))
    await nextFrame()
    expect(chart.api.getState().camera.x).toBe(before)
    chart.destroy()
  })

  it('still pans with the left button after a right-button press was ignored', async () => {
    const chart = make()
    // The opening view arrives on a tween of its own. Reading `before` one
    // frame in catches it mid-flight, and the pointerdown below then CANCELS
    // that tween (the user's hand wins immediately, by design) — so the
    // camera never reaches where `before` assumed it would be, and the drag's
    // own 60px lands somewhere else entirely. On a fast machine the tween is
    // over within that frame and the bug never shows; CI is not a fast
    // machine.
    await settle()
    const before = chart.api.getState().camera.x
    const canvas = document.querySelector('canvas')!
    // The ignored press must leave no state behind — an early return that
    // still registered the pointer would leave the next real drag looking
    // like the second finger of a pinch.
    canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 2, clientX: 50, clientY: 50, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { button: 2, clientX: 50, clientY: 50, bubbles: true }))
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 160, clientY: 100, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 160, clientY: 100, bubbles: true }))
    await nextFrame()
    expect(chart.api.getState().camera.x).toBeCloseTo(before + 60, 5)
    chart.destroy()
  })

  it("claims the host's touch gestures while mounted, and hands them back on destroy", async () => {
    const el = host()
    const chart = createKlad(el, { data: DATA, nodeSize: { w: 120, h: 48 }, worker: false })
    await nextFrame()
    // Without this the browser's own scroll/pinch consumes the same gestures
    // the chart is trying to pan and zoom with — a one-finger drag scrolls the
    // page instead of the chart.
    expect(getComputedStyle(el).touchAction).toBe('none')
    chart.destroy()
    expect(getComputedStyle(el).touchAction).not.toBe('none')
  })

  it('zooms about the cursor on wheel', async () => {
    const chart = make()
    // The opening view arrives on a tween of its own. Reading `before` one
    // frame in catches it mid-flight, and the pointerdown below then CANCELS
    // that tween (the user's hand wins immediately, by design) — so the
    // camera never reaches where `before` assumed it would be, and the drag's
    // own 60px lands somewhere else entirely. On a fast machine the tween is
    // over within that frame and the bug never shows; CI is not a fast
    // machine.
    await settle()
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
    expect(document.querySelectorAll('.klad-overlay-node').length).toBeGreaterThan(0)
    chart.api.zoomTo(0.1)
    await settle()
    await nextFrame()
    expect(document.querySelectorAll('.klad-overlay-node').length).toBe(0)
    chart.destroy()
  })

  it('reuses overlay elements instead of recreating them while panning', async () => {
    const chart = make({ renderNode: (el: HTMLElement, ctx: { id: string }) => (el.textContent = ctx.id) })
    chart.api.zoomTo(1)
    await nextFrame()
    const first = document.querySelector('.klad-overlay-node')
    chart.api.zoomTo(1.01)
    await nextFrame()
    expect(document.querySelector('.klad-overlay-node')).toBe(first)
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
    const chart = createKlad(el, {
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
    const chart = createKlad(host(), {
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

  it('pins the toggled node to its exact on-screen position through an expand', async () => {
    const chart = make({ collapsedByDefault: true })
    await nextFrame()
    await nextFrame()

    const before = chart.api.getState()
    chart.api.expand('a') // root 'a' has two children, b and c
    await settleTransition()
    await nextFrame()
    const after = chart.api.getState()

    // The whole point of the camera anchor: the toggled node ('a', the root
    // here — see `rootScreenCentre`) never moves on screen, even though the
    // camera itself has to change underneath it to hold that still while its
    // newly revealed children push the rest of the layout around.
    expect(after.rootScreenCentre.x).toBeCloseTo(before.rootScreenCentre.x, 0)
    expect(after.rootScreenCentre.y).toBeCloseTo(before.rootScreenCentre.y, 0)
    // Zoom is never touched by the toggle anchor — only pan.
    expect(after.camera.k).toBeCloseTo(before.camera.k, 5)
    chart.destroy()
  })

  it('pins the toggled node to its exact on-screen position through a collapse', async () => {
    const chart = make()
    await nextFrame()
    await nextFrame()

    // Put 'b' at a known, deliberately off-centre-of-the-fitted-view screen
    // position first (dead centre of the viewport), so pinning it there
    // through the collapse — rather than it merely happening to already be
    // near that spot — is a meaningful check.
    chart.api.focus('b')
    await settle()
    await nextFrame()
    const beforeK = chart.api.getState().camera.k

    chart.api.collapse('b')
    await settleTransition()
    await nextFrame()
    const afterCollapse = chart.api.getState().camera

    // `focus('b')` centres 'b's CURRENT (post-collapse) box on the viewport.
    // If the anchor genuinely held 'b' at the same screen position (dead
    // centre, from the `focus('b')` above) throughout the collapse, this is
    // a no-op — 'b' is already exactly where a fresh `focus('b')` would put
    // it; if the anchor drifted, this moves the camera again.
    chart.api.focus('b')
    await settle()
    await nextFrame()
    const refocused = chart.api.getState().camera

    expect(afterCollapse.x).toBeCloseTo(refocused.x, 0)
    expect(afterCollapse.y).toBeCloseTo(refocused.y, 0)
    // Zoom is never touched by the toggle anchor — only pan.
    expect(afterCollapse.k).toBeCloseTo(beforeK, 5)
    chart.destroy()
  })

  // Regression: the two tests above sample the pinned node only at the START
  // and the END of the transition, where a one-frame camera lag is invisible
  // (the anchor curve is flat at both ends). The camera anchor used to be
  // applied AFTER `chartHost.render(now)`, so every frame in between was
  // painted with the PREVIOUS frame's camera against THIS frame's node
  // positions — a lag against a curve whose speed peaks in the middle, which
  // reads as the pinned node sliding off its spot and swinging back. Only a
  // MID-transition sample catches it, and only against what the canvas
  // actually painted (the DOM overlay was never affected: it is positioned
  // after the anchor runs, so it stayed pinned while the canvas underneath it
  // did not).
  it('keeps the toggled node pinned on the canvas at every frame of the transition, not just its ends', async () => {
    // `ring: false` so the one-shot confirmation ring — which is drawn around
    // the root and grows outward — cannot widen the scanned span.
    const chart = make({ collapsedByDefault: true, ring: false })
    // Long enough for the ResizeObserver-driven `setViewport` to have landed:
    // sizing the canvas resets its bitmap, so a pixel read taken between that
    // and the next paint sees an empty surface.
    await settle()
    await nextFrame()

    const canvas = document.querySelector('canvas') as HTMLCanvasElement
    const ctx = canvas.getContext('2d')!
    const dpr = canvas.width / canvas.getBoundingClientRect().width

    // Centre of the root's drawn span on one scanline through it. In `tb`
    // (the default) the root is the only thing on its own row — its children
    // appear strictly below it, and its connectors leave from its bottom edge
    // — so the leftmost and rightmost non-transparent pixels on that row are
    // the root's own left and right edges.
    const drawnRootCentreX = (rowY: number): number | null => {
      const row = ctx.getImageData(0, Math.round(rowY * dpr), canvas.width, 1).data
      let min = -1
      let max = -1
      for (let x = 0; x < canvas.width; x++) {
        if (row[x * 4 + 3]! === 0) continue
        if (min === -1) min = x
        max = x
      }
      return min === -1 ? null : (min + max) / 2 / dpr
    }

    const centre = chart.api.getState().rootScreenCentre
    const before = drawnRootCentreX(centre.y)
    expect(before).not.toBeNull()

    chart.api.expand('a')
    let worst = 0
    let samples = 0
    // ~30 frames at 60fps covers the whole 450ms transition, sampling right
    // through its fast middle.
    for (let i = 0; i < 30; i++) {
      await nextFrame()
      const now = drawnRootCentreX(centre.y)
      if (now === null) continue
      samples++
      worst = Math.max(worst, Math.abs(now - before!))
    }
    // Guards the assertion below against passing vacuously: a scanline that
    // found nothing on every frame would leave `worst` at 0.
    expect(samples).toBeGreaterThan(10)

    // The correct answer is EXACTLY zero, and is what this measures locally:
    // the node tween and the camera anchor are solved from the same `now` on
    // the same curve, so they cancel to the last decimal and the scanned
    // span never shifts by even one pixel. The tolerance is one pixel purely
    // for antialiasing/rounding differences across platforms — a regression
    // to the old ordering is worth ~12px here, an order of magnitude clear
    // of it.
    expect(worst).toBeLessThan(1)
    chart.destroy()
  })

  // The pixel-scanning test above can only run on the main-thread path: in
  // worker mode the canvas is transferred to the worker and cannot be read
  // back. The toggled node's overlay CARD is the equivalent probe there — it
  // is positioned from the box the WORKER interpolated (`lastDrawnBoxes`,
  // carried back on each frame message) times the camera the MAIN THREAD
  // solved, so any disagreement between the two clocks shows up as the card
  // sliding, exactly as the canvas underneath it does.
  it('pins the toggled node through an expand in worker mode too', async () => {
    const chart = make({
      worker: true,
      collapsedByDefault: true,
      ring: false,
      renderNode: (el: HTMLElement, ctx: { id: string }) => {
        el.dataset.id = ctx.id
        el.textContent = ctx.id
      },
    })
    await settle()
    await nextFrame()

    const cardX = (): number | null => {
      const el = document.querySelector('[data-id="a"]') as HTMLElement | null
      if (el === null) return null
      const m = /translate3d\(([-\d.]+)px/.exec(el.style.transform)
      return m === null ? null : parseFloat(m[1]!)
    }

    const before = cardX()
    expect(before).not.toBeNull()

    chart.api.expand('a')
    let worst = 0
    let samples = 0
    for (let i = 0; i < 30; i++) {
      await nextFrame()
      const now = cardX()
      if (now === null) continue
      samples++
      worst = Math.max(worst, Math.abs(now - before!))
    }
    expect(samples).toBeGreaterThan(10)
    expect(worst).toBeLessThan(1)
    chart.destroy()
  })

  // A bare tap is not a camera gesture. Input calls `cancelAnimation` on
  // `pointerdown`, before it can know whether a pan is coming, and that used
  // to drop the toggle camera anchor outright — but the LAYOUT keeps
  // animating either way, so the tree carried on to its final positions with
  // nothing holding the toggled node. Tapping anywhere during a root collapse
  // left the root somewhere else entirely, often off screen.
  it('does not abandon the toggled node when the canvas is tapped mid-transition', async () => {
    const chart = make({ ring: false })
    await settle()
    await nextFrame()

    const before = chart.api.getState().rootScreenCentre

    chart.api.collapse('a')
    await nextFrame()
    await nextFrame()

    // A tap with no movement: down and up at the same point, nowhere near a
    // node, so it changes no camera and toggles nothing.
    const canvas = document.querySelector('canvas') as HTMLCanvasElement
    const rect = canvas.getBoundingClientRect()
    const at = { clientX: rect.left + 5, clientY: rect.top + rect.height - 5 }
    canvas.dispatchEvent(new PointerEvent('pointerdown', { ...at, pointerId: 7, bubbles: true }))
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...at, pointerId: 7, bubbles: true }))

    await settleTransition()
    await nextFrame()

    const after = chart.api.getState().rootScreenCentre
    expect(after.x).toBeCloseTo(before.x, 0)
    expect(after.y).toBeCloseTo(before.y, 0)
    chart.destroy()
  })

  // --- per-node counts -----------------------------------------------------

  it('reports direct children, descendants, depth and subtree height per node', async () => {
    // a -> b -> d, a -> c. So 'a' has 2 direct, 3 descendants, height 2.
    const chart = make()
    await nextFrame()

    expect(chart.api.stats('a')).toEqual({
      directChildren: 2,
      descendants: 3,
      depth: 0,
      height: 2,
    })
    expect(chart.api.stats('b')).toEqual({
      directChildren: 1,
      descendants: 1,
      depth: 1,
      height: 1,
    })
    expect(chart.api.stats('d')).toEqual({
      directChildren: 0,
      descendants: 0,
      depth: 2,
      height: 0,
    })
    expect(chart.api.stats('nope')).toBeNull()
    chart.destroy()
  })

  it('counts the whole tree, not just the expanded part', async () => {
    const chart = make({ collapsedByDefault: true })
    await nextFrame()

    // Only the root is on screen, but what a card should say is "3 people
    // under me" — folding a branch up does not make those people disappear.
    expect(chart.api.getState().visibleCount).toBe(1)
    expect(chart.api.stats('a')!.descendants).toBe(3)
    chart.destroy()
  })

  it('hands the same counts to renderNode', async () => {
    const seen = new Map<string, string>()
    const chart = make({
      renderNode: (
        el: HTMLElement,
        ctx: { id: string; directChildren: number; descendants: number; height: number; depth: number },
      ) => {
        seen.set(ctx.id, `${ctx.directChildren}/${ctx.descendants}/${ctx.depth}/${ctx.height}`)
        el.dataset.id = ctx.id
      },
    })
    await settle()
    await nextFrame()

    expect(seen.get('a')).toBe('2/3/0/2')
    expect(seen.get('d')).toBe('0/0/2/0')
    chart.destroy()
  })

  it('recomputes the counts when the data is replaced', async () => {
    const chart = make()
    await nextFrame()
    expect(chart.api.stats('a')!.descendants).toBe(3)

    chart.update([{ id: 'a', name: 'Root' }, { id: 'b', parentId: 'a', name: 'Only' }])
    await nextFrame()

    expect(chart.api.stats('a')).toEqual({
      directChildren: 1,
      descendants: 1,
      depth: 0,
      height: 1,
    })
    chart.destroy()
  })

  // --- go to a node --------------------------------------------------------

  // `focus` used to read the target's box synchronously, immediately after
  // expanding its ancestors — but expanding dirties the layout, and until it
  // is rebuilt a node that was collapsed away has no box at all. So the one
  // case the command exists for, "everything is closed, go to X", did
  // nothing whatsoever.
  it('goes to a node that is collapsed away, opening the way to it', async () => {
    const chart = make({ collapsedByDefault: true })
    await settle()
    await nextFrame()

    // 'd' is two levels down, under 'b', with everything shut.
    expect(chart.api.getState().visibleCount).toBe(1)
    const before = chart.api.getState().camera

    chart.api.focus('d')
    await settleTransition()
    await nextFrame()

    // The way is open...
    expect(chart.api.getState().visibleCount).toBe(4)
    // ...and 'd' is on screen, near the middle of it.
    // ...and the camera actually travelled to put it there.
    const after = chart.api.getState().camera
    expect(after.x !== before.x || after.y !== before.y).toBe(true)
    chart.destroy()
  })

  it('does not flash the ring on arrival unless asked', async () => {
    const chart = make({ collapsedByDefault: true })
    await settle()
    await nextFrame()
    const strokeStyles = spyOnStrokeStyle()

    chart.api.focus('d')
    await settleTransition()
    await nextFrame()

    expect(strokeStyles).not.toContain('#f59e0b') // DEFAULT_THEME.ringStroke
    chart.destroy()
  })

  it('flashes the ring on arrival when asked, even though nothing was toggled', async () => {
    // 'c' is already visible, so this expands nothing at all — the ring is
    // the only signal that anything happened, which is the whole point of
    // the option.
    const chart = make()
    await settle()
    await nextFrame()
    const strokeStyles = spyOnStrokeStyle()

    chart.api.focus('c', { ring: true })
    await settleTransition()
    await nextFrame()

    expect(strokeStyles).toContain('#f59e0b')
    chart.destroy()
  })

  it('honours `ring: false` on the chart even when focus asks for one', async () => {
    const chart = make({ ring: false })
    await settle()
    await nextFrame()
    const strokeStyles = spyOnStrokeStyle()

    chart.api.focus('c', { ring: true })
    await settleTransition()
    await nextFrame()

    expect(strokeStyles).not.toContain('#f59e0b')
    chart.destroy()
  })

  it('reports the path from the root to a node', async () => {
    const chart = make()
    await nextFrame()

    expect(chart.api.pathTo('d')).toEqual(['a', 'b', 'd'])
    expect(chart.api.pathTo('a')).toEqual(['a'])
    expect(chart.api.pathTo('nope')).toBeNull()
    chart.destroy()
  })

  // --- refresh -------------------------------------------------------------

  // `nodeSize` is declared, never measured — layout runs in a worker with no
  // DOM — so a card that changes its own height has to say so. `update()` is
  // the wrong tool: it replaces the data and resets the tree's open state,
  // throwing away what the user was looking at.
  it('re-reads node sizes without losing expand/collapse state, camera or highlight', async () => {
    let tall = false
    const chart = make({
      nodeSize: () => (tall ? { w: 120, h: 96 } : { w: 120, h: 48 }),
    })
    await settle()
    await nextFrame()

    chart.api.collapse('b')
    await settleTransition()
    await nextFrame()
    chart.api.highlight(['c'])
    await nextFrame()

    const before = {
      bounds: chart.api.getState().bounds,
      camera: { ...chart.api.getState().camera },
      visibleCount: chart.api.getState().visibleCount,
    }
    expect(before.visibleCount).toBe(3) // 'd' is hidden under the collapsed 'b'

    tall = true
    chart.api.refresh()
    await nextFrame()
    await nextFrame()

    const after = chart.api.getState()
    // The layout really did re-measure...
    expect(after.bounds.maxY - after.bounds.minY).toBeGreaterThan(
      before.bounds.maxY - before.bounds.minY,
    )
    // ...without disturbing any of the state the user owns.
    expect(after.visibleCount).toBe(before.visibleCount)
    expect(after.camera).toEqual(before.camera)
    chart.destroy()
  })

  it('does not re-announce data warnings on every refresh', async () => {
    const warnings: unknown[] = []
    // 'orphan' names a parent that isn't in the data — one warning, once.
    const chart = make({ data: [{ id: 'a' }, { id: 'orphan', parentId: 'ghost' }] })
    chart.on('warning', (w) => warnings.push(w))
    await settle()
    await nextFrame()
    const initial = warnings.length
    expect(initial).toBeGreaterThan(0)

    chart.api.refresh()
    await nextFrame()
    await nextFrame()

    expect(warnings.length).toBe(initial)
    chart.destroy()
  })

  it('does not auto-pan on toggle when autoPanOnToggle is false', async () => {
    const chart = make({ collapsedByDefault: true, autoPanOnToggle: false })
    await nextFrame()
    await nextFrame()

    const before = chart.api.getState().camera
    chart.api.expand('a')
    await settleTransition()
    await nextFrame()
    const after = chart.api.getState().camera

    expect(after).toEqual(before)
    chart.destroy()
  })

  // Regression: the DOM overlay used to position every card from the FINAL
  // (settled) layout even while the engine's canvas was still animating the
  // staged expand/collapse transition, so a card would snap straight to
  // where it will end up instead of gliding there with the canvas — see
  // `index.ts`'s `interpolatedBoxOfSource`.
  it('tracks a sibling card to the interpolated box mid-transition, not the final one, when an expand reflows it', async () => {
    // 'p' needs TWO children, not one: a single-child chain never widens its
    // own subtree (the child is exactly as wide as the parent), so 'b' would
    // never actually need to reflow — the very reflow this test exists to
    // observe. Two children side by side make revealing them roughly double
    // 'p's subtree width, which is what pushes 'b' over.
    const NESTED = [
      { id: 'a' },
      { id: 'p', parentId: 'a' },
      { id: 'q1', parentId: 'p' },
      { id: 'q2', parentId: 'p' },
      { id: 'b', parentId: 'a' },
    ]
    const chart = make({
      data: NESTED,
      renderNode: (el: HTMLElement, ctx: { id: string }) => {
        el.dataset.id = ctx.id
        el.textContent = ctx.id
      },
      // Isolate the box-tween check from the separate camera-anchor feature
      // (covered by its own tests above): the camera must not move here.
      autoPanOnToggle: false,
    })
    chart.api.zoomTo(1)
    await settle()
    await nextFrame()

    // Collapse 'p' (hiding 'q') first and let it fully settle, so the
    // subsequent expand is the one and only transition under test.
    chart.api.collapse('p')
    await settleTransition()
    await nextFrame()

    const readB = (): { x: number; y: number } => {
      const el = document.querySelector('[data-id="b"]') as HTMLElement
      const m = /translate3d\(([-\d.]+)px,\s*([-\d.]+)px/.exec(el.style.transform)!
      return { x: parseFloat(m[1]!), y: parseFloat(m[2]!) }
    }

    const before = readB()

    chart.api.expand('p') // 'b' must reflow to make room for the revealed 'q'
    await nextFrame() // as close to t=0 of the transition as a real rAF loop gets
    const atStart = readB()
    // The bug this fixes: 'b's card jumping straight to its settled,
    // post-reflow position the instant the transition starts, instead of
    // still reading close to its PRE-toggle position at t~0.
    expect(Math.abs(atStart.x - before.x)).toBeLessThan(5)

    await settleTransition()
    await nextFrame()
    const atEnd = readB()
    // Sanity: 'b' genuinely does move once the transition finishes —
    // otherwise the "still near start" assertion above would be trivially
    // true regardless of which layout the overlay reads from.
    expect(Math.abs(atEnd.x - before.x)).toBeGreaterThan(10)

    chart.destroy()
  })

  // Regression: an expand is a STAGED transition — phase 1 makes room while
  // the children stay hidden, phase 2 reveals them (see engine.ts). The canvas
  // implements "stay hidden" with `revealAlpha`, which is 0 for the whole of
  // phase 1. The DOM overlay applied no opacity at all, so a revealed child's
  // CARD was painted at full strength for those ~190ms, at a box that is still
  // a zero-size point on its parent's exit edge — the card's own content
  // overflowing that 0x0 element, which reads as small bubbles popping out of
  // the parent and sitting there until the reveal finally starts.
  it('keeps a revealed card invisible until its reveal phase actually starts', async () => {
    const chart = make({
      collapsedByDefault: true,
      ring: false,
      renderNode: (el: HTMLElement, ctx: { id: string }) => {
        el.dataset.id = ctx.id
        el.textContent = ctx.id
      },
    })
    await settle()
    await nextFrame()

    chart.api.expand('a')
    const opacities: number[] = []
    // ~6 frames is ~100ms — comfortably inside phase 1, which runs until 42%
    // of the 450ms transition (see PHASE_TWO_START_FRACTION).
    for (let i = 0; i < 6; i++) {
      await nextFrame()
      const el = document.querySelector('[data-id="b"]') as HTMLElement | null
      if (el === null) continue
      opacities.push(Number(getComputedStyle(el).opacity))
    }
    // The card must be in the DOM (it is in the drawn set) but invisible.
    expect(opacities.length).toBeGreaterThan(3)
    expect(Math.max(...opacities)).toBeLessThan(0.05)

    // ...and fully opaque once the transition has finished, so the assertion
    // above cannot be satisfied by simply never showing the card.
    await settleTransition()
    await nextFrame()
    const settled = document.querySelector('[data-id="b"]') as HTMLElement
    expect(Number(getComputedStyle(settled).opacity)).toBe(1)

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

    const card = document.querySelector('.klad-overlay-node') as HTMLElement
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

    const button = document.querySelector('.klad-overlay-node button') as HTMLButtonElement
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

    const card = document.querySelector('.klad-overlay-node') as HTMLElement
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

  // --- toggleOnNodeClick ---------------------------------------------------
  // DATA: 'a' (root, children b/c) -> 'b' (child d) -> 'd' (leaf); 'c' is
  // also a leaf.

  it('is off by default: a tap on a node with children does not toggle it', async () => {
    const chart = make()
    chart.api.fit()
    await nextFrame()

    const toggles: unknown[] = []
    chart.on('toggle', (e) => toggles.push(e))

    const state = chart.api.getState()
    const canvas = document.querySelector('canvas')!
    const rect = canvas.getBoundingClientRect()
    const sx = rect.left + state.rootScreenCentre.x
    const sy = rect.top + state.rootScreenCentre.y
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: sx, clientY: sy, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: sx, clientY: sy, bubbles: true }))
    await nextFrame()

    expect(toggles).toEqual([])
    chart.destroy()
  })

  it('toggles a node with children on tap when toggleOnNodeClick is enabled, after emitting nodeClick', async () => {
    const chart = make({ toggleOnNodeClick: true })
    chart.api.fit()
    await nextFrame()

    const events: string[] = []
    chart.on('nodeClick', () => events.push('nodeClick'))
    chart.on('toggle', () => events.push('toggle'))

    const before = chart.api.getState().visibleCount
    const state = chart.api.getState()
    const canvas = document.querySelector('canvas')!
    const rect = canvas.getBoundingClientRect()
    const sx = rect.left + state.rootScreenCentre.x
    const sy = rect.top + state.rootScreenCentre.y
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: sx, clientY: sy, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: sx, clientY: sy, bubbles: true }))
    await nextFrame()

    // Root starts open (every node does, by default), so this tap collapses
    // it — nodeClick unconditionally first, the toggle as its side effect.
    expect(events).toEqual(['nodeClick', 'toggle'])
    expect(chart.api.getState().visibleCount).toBeLessThan(before)
    chart.destroy()
  })

  it('does nothing on tap for a leaf node — no toggle event, nothing to toggle', async () => {
    const chart = make({
      toggleOnNodeClick: true,
      renderNode: (el: HTMLElement, ctx: { id: string }) => (el.textContent = ctx.id),
    })
    chart.api.fit()
    await settle()
    await nextFrame()
    chart.api.zoomTo(1)
    await settle()
    await nextFrame()

    const cards = Array.from(document.querySelectorAll<HTMLElement>('.klad-overlay-node'))
    const leafCard = cards.find((el) => el.textContent === 'c') // 'c' has no children
    expect(leafCard).not.toBeUndefined()

    const toggles: unknown[] = []
    chart.on('toggle', (e) => toggles.push(e))
    const before = chart.api.getState().visibleCount

    const rect = leafCard!.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    leafCard!.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: cx, clientY: cy, bubbles: true }))
    await nextFrame()

    expect(toggles).toEqual([])
    expect(chart.api.getState().visibleCount).toBe(before)
    chart.destroy()
  })

  it("does not toggle when the tap lands on a card's own interactive content", async () => {
    let buttonClicked = false
    const chart = make({
      toggleOnNodeClick: true,
      renderNode: (el: HTMLElement, ctx: { id: string; hasChildren: boolean }) => {
        el.textContent = ''
        const label = document.createElement('span')
        label.textContent = ctx.id
        el.append(label)
        if (ctx.hasChildren) {
          const button = document.createElement('button')
          button.textContent = 'toggle'
          button.onclick = () => {
            buttonClicked = true
          }
          el.append(button)
        }
      },
    })
    chart.api.fit()
    await settle()
    await nextFrame()
    chart.api.zoomTo(1)
    await settle()
    await nextFrame()

    // Root ('a') has children, so its card grew a button in the renderNode
    // above — found by its label, since 'b' also has children (and so also
    // has a button) and document order among pooled overlay nodes isn't
    // guaranteed to put 'a' first.
    const cards = Array.from(document.querySelectorAll<HTMLElement>('.klad-overlay-node'))
    const rootCard = cards.find((el) => el.querySelector('span')?.textContent === 'a')
    expect(rootCard).not.toBeUndefined()
    const button = rootCard!.querySelector('button') as HTMLButtonElement
    expect(button).not.toBeNull()

    const toggles: unknown[] = []
    chart.on('toggle', (e) => toggles.push(e))
    const before = chart.api.getState().visibleCount

    const rect = button.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    button.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: cx, clientY: cy, bubbles: true }))
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextFrame()

    // The button's own click still fires (it's never preventDefault()-ed —
    // see input.ts), but the click-to-toggle side effect is suppressed for
    // interactive content, so the node itself is untouched.
    expect(buttonClicked).toBe(true)
    expect(toggles).toEqual([])
    expect(chart.api.getState().visibleCount).toBe(before)
    chart.destroy()
  })

  it('toggles once, not twice, on a double click', async () => {
    // autoPanOnToggle disabled, and the tap coordinate recomputed after the
    // first tap, so a real effect of THIS test's own toggle — the root's
    // own box can shift once it has no visible children to centre over,
    // independently of any camera move — doesn't make the second tap of the
    // pair miss the node and turn this into a false negative.
    const chart = make({ toggleOnNodeClick: true, autoPanOnToggle: false })
    chart.api.fit()
    await nextFrame()

    const toggles: unknown[] = []
    const dblclicks: string[] = []
    chart.on('toggle', (e) => toggles.push(e))
    chart.on('nodeDblClick', (e) => dblclicks.push(e.id))

    const canvas = document.querySelector('canvas')!
    const rect = canvas.getBoundingClientRect()
    const tapRoot = () => {
      const state = chart.api.getState()
      const sx = rect.left + state.rootScreenCentre.x
      const sy = rect.top + state.rootScreenCentre.y
      canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: sx, clientY: sy, bubbles: true }))
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: sx, clientY: sy, bubbles: true }))
    }

    tapRoot()
    await nextFrame()
    tapRoot()
    await nextFrame()

    // The first tap of the pair toggles (closing the root); the second is
    // recognised as a double click and does not toggle again.
    expect(toggles.length).toBe(1)
    expect(dblclicks).toEqual(['a'])
    chart.destroy()
  })
})
