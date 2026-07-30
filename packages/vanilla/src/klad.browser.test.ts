import { describe, expect, it } from 'vitest'
import {
  createKlad,
  type NodeContext,
  type NodeData,
  type Change,
  type ChartView,
  type LayoutSettings,
  type NodePlace,
  type Options,
} from './index.js'

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

  // Keyboard camera. Not the accessibility tree — that mirrors the STRUCTURE
  // and its arrows move between nodes; these move the VIEW, which is what a
  // sighted user reaches for after clicking the chart.
  it('makes the host a tab stop, and gives it back on destroy', async () => {
    const el = host()
    const chart = createKlad(el, { data: DATA, worker: false })
    await nextFrame()
    // Without this the chart cannot be reached from the keyboard at all: it is
    // clickable, and then Tab walks straight past it into the overlay cards.
    expect(el.tabIndex).toBe(0)
    chart.destroy()
    expect(el.hasAttribute('tabindex')).toBe(false)
  })

  it('pans with the arrow keys, and strides with shift held', async () => {
    const chart = make()
    await settle()
    const el = document.querySelector('canvas')!.parentElement!
    const before = chart.api.getState().camera.x

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await nextFrame()
    const stepped = chart.api.getState().camera.x
    // Right moves the VIEW right, so the content goes the other way — the
    // relationship a scrollbar has with its page, not the one dragging has.
    expect(stepped).toBeLessThan(before)

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }))
    await nextFrame()
    // One shifted press in the opposite direction more than undoes one plain
    // press: the stride is a multiple of the step, not the same distance.
    expect(chart.api.getState().camera.x).toBeGreaterThan(before)
    chart.destroy()
  })

  it('zooms on + and -, about the middle of the host', async () => {
    const chart = make()
    await settle()
    const el = document.querySelector('canvas')!.parentElement!
    const before = chart.api.getState().camera.k

    el.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }))
    await nextFrame()
    const zoomedIn = chart.api.getState().camera.k
    expect(zoomedIn).toBeGreaterThan(before)

    el.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true }))
    await nextFrame()
    expect(chart.api.getState().camera.k).toBeLessThan(zoomedIn)
    chart.destroy()
  })

  it('clears the highlight on Escape', async () => {
    const chart = make()
    await settle()
    chart.api.highlight(['a', 'b'])
    await nextFrame()
    const el = document.querySelector('canvas')!.parentElement!
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextFrame()
    expect(chart.api.getState().highlighted).toBeNull()
    chart.destroy()
  })

  // A card can hold a real form control (see the playground's dropdown
  // example). Panning the chart out from under someone typing in it would be
  // a bug, not a feature.
  it('leaves the keys alone when a card\'s own control has focus', async () => {
    const chart = make()
    await settle()
    const el = document.querySelector('canvas')!.parentElement!
    const before = chart.api.getState().camera.x

    const input = document.createElement('input')
    el.append(input)
    input.focus()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await nextFrame()

    expect(chart.api.getState().camera.x).toBe(before)
    input.remove()
    chart.destroy()
  })

  it('binds nothing, and takes no focus, when keyboard is off', async () => {
    const el = host()
    const chart = createKlad(el, { data: DATA, worker: false, keyboard: false })
    await settle()
    const before = chart.api.getState().camera.x
    expect(el.hasAttribute('tabindex')).toBe(false)
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await nextFrame()
    expect(chart.api.getState().camera.x).toBe(before)
    chart.destroy()
  })

  // `fitSubtree` — the question people actually have on a large chart is not
  // "show me everything", it is "show me this branch".
  it('frames one branch tighter than the whole chart', async () => {
    const chart = make()
    await settle()
    chart.api.fit()
    await settle()
    const whole = chart.api.getState().camera.k

    chart.api.fitSubtree('b')
    await settle()
    // 'b' and its one child occupy a fraction of the tree, so framing them
    // has to arrive closer than framing all four nodes did.
    expect(chart.api.getState().camera.k).toBeGreaterThan(whole)
    chart.destroy()
  })

  it('ignores fitSubtree for an unknown id rather than throwing', async () => {
    const chart = make()
    await settle()
    const before = { ...chart.api.getState().camera }
    chart.api.fitSubtree('nope')
    await settle()
    expect(chart.api.getState().camera).toEqual(before)
    chart.destroy()
  })

  // A view is where a viewer IS: camera, what is open, what is lit. It has to
  // survive a round trip through JSON, because the point of it is a URL.
  it('restores a camera, an open set and a highlight from a saved view', async () => {
    const chart = make()
    await settle()
    chart.api.collapse('b')
    chart.api.highlight(['a', 'c'])
    chart.api.zoomTo(1.75)
    await settle()

    const view = JSON.parse(JSON.stringify(chart.api.getView()))
    expect(view.open).not.toContain('b')
    expect(view.highlighted).toEqual(['a', 'c'])

    // Move everything somewhere else, then come back.
    chart.api.expandAll()
    chart.api.highlight(null)
    chart.api.zoomTo(0.5)
    await settle()

    chart.api.setView(view)
    await settle()

    const state = chart.api.getState()
    expect(state.camera.k).toBeCloseTo(1.75, 5)
    expect(state.highlighted).toEqual(['a', 'c'])
    // 'b' closed again, so its child is out of the visible tree.
    expect(state.visibleCount).toBe(3)
    chart.destroy()
  })

  it('drops ids a view names that are no longer in the tree', async () => {
    const chart = make()
    await settle()
    // A view saved when the chart had a node it no longer has: it should open
    // what is left rather than throw, which is what makes an old bookmark
    // still usable.
    chart.api.setView({ camera: { x: 0, y: 0, k: 1 }, open: ['a', 'ghost'], highlighted: ['ghost'] })
    await settle()
    expect(chart.api.getState().visibleCount).toBe(3)
    chart.destroy()
  })

  // Isolation: one branch AS the chart, rather than one branch with the rest
  // still there off screen (which is what `fitSubtree` does).
  it('re-roots the chart at one branch, and puts the rest back', async () => {
    const chart = make()
    await settle()
    expect(chart.api.getState().visibleCount).toBe(4)

    chart.api.isolate('b')
    await settle()
    const isolated = chart.api.getState()
    // 'b' and its child 'd'. 'a' is an ancestor, 'c' a sibling — both gone,
    // not merely off screen.
    expect(isolated.visibleCount).toBe(2)
    expect(isolated.isolated).toBe('b')
    // The export is the same tree, so it is the cheapest place to check that
    // "gone" reaches everything downstream rather than only the canvas.
    const svg = chart.api.toSVG()
    expect(svg).toContain('Leaf')
    expect(svg).not.toContain('Right')

    chart.api.isolate(null)
    await settle()
    expect(chart.api.getState().visibleCount).toBe(4)
    expect(chart.api.getState().isolated).toBeNull()
    chart.destroy()
  })

  it('mirrors an isolated branch in the accessibility tree, not the whole org', async () => {
    const chart = make()
    await settle()
    chart.api.isolate('b')
    await settle()
    // A screen reader reading out nodes the chart is not showing is a mirror
    // that contradicts what it mirrors.
    const labels = [...document.querySelectorAll('[role="treeitem"]')].map((el) => el.textContent)
    expect(labels).toEqual(['Left', 'Leaf'])
    chart.destroy()
  })

  it('keeps collapsing working inside an isolated branch', async () => {
    const chart = make()
    await settle()
    chart.api.isolate('b')
    chart.api.collapse('b')
    await settle()
    expect(chart.api.getState().visibleCount).toBe(1)
    chart.destroy()
  })

  it('carries isolation through a saved view', async () => {
    const chart = make()
    await settle()
    chart.api.isolate('b')
    await settle()

    const view = JSON.parse(JSON.stringify(chart.api.getView()))
    expect(view.isolated).toBe('b')

    chart.api.isolate(null)
    await settle()
    expect(chart.api.getState().visibleCount).toBe(4)

    chart.api.setView(view)
    await settle()
    expect(chart.api.getState().isolated).toBe('b')
    expect(chart.api.getState().visibleCount).toBe(2)
    chart.destroy()
  })

  // Worker mode specifically. The layout lives in the worker and is posted
  // back on the messages that change it; `isolate` was missing from that list,
  // so the main thread kept the whole tree's boxes and bounds — the overlay
  // drew nothing, the camera fitted the old bounds (which put the zoom below
  // the tier where nodes are drawn at all), and the minimap showed a chart
  // that was no longer on screen.
  it('sends the new layout back to the main thread when isolating in worker mode', async () => {
    const chart = make({ worker: true })
    await settle()
    const whole = chart.api.getState().bounds

    chart.api.isolate('b')
    await settle()
    const branch = chart.api.getState().bounds

    expect(chart.api.getState().visibleCount).toBe(2)
    // The bounds the main thread holds have to describe the branch, not the
    // tree it came out of — everything it does with them (fit, overlay,
    // minimap) is wrong otherwise.
    expect(branch.maxX - branch.minX).toBeLessThan(whole.maxX - whole.minX)
    chart.destroy()
  })

  it('ignores isolate for an unknown id', async () => {
    const chart = make()
    await settle()
    chart.api.isolate('nope')
    await settle()
    expect(chart.api.getState().visibleCount).toBe(4)
    chart.destroy()
  })

  // Selection: what the viewer picked, as opposed to what `highlight` says the
  // chart is pointing at.
  it('selects through the API, reports it, and clears', async () => {
    const chart = make()
    await settle()
    const heard: string[][] = []
    chart.on('selectionChange', ({ ids }) => heard.push(ids))

    chart.api.select(['a', 'c'])
    await nextFrame()
    expect(chart.api.getSelection()).toEqual(['a', 'c'])
    expect(chart.api.getState().selected).toEqual(['a', 'c'])
    expect(heard).toEqual([['a', 'c']])

    // Setting the same selection again is not a change, and must not tell
    // anyone it was.
    chart.api.select(['a', 'c'])
    await nextFrame()
    expect(heard.length).toBe(1)

    chart.api.select(null)
    await nextFrame()
    expect(chart.api.getSelection()).toEqual([])
    expect(heard.length).toBe(2)
    chart.destroy()
  })

  it('drops ids that are not in the tree rather than keeping ghosts', async () => {
    const chart = make()
    await settle()
    chart.api.select(['a', 'ghost'])
    await nextFrame()
    expect(chart.api.getSelection()).toEqual(['a'])
    chart.destroy()
  })

  it('carries the selection through a saved view', async () => {
    const chart = make()
    await settle()
    chart.api.select(['b', 'd'])
    await settle()
    const view = JSON.parse(JSON.stringify(chart.api.getView()))
    chart.api.select(null)
    await settle()
    chart.api.setView(view)
    await settle()
    expect(chart.api.getSelection()).toEqual(['b', 'd'])
    chart.destroy()
  })

  it('leaves the pointer alone until selection is switched on', async () => {
    const chart = make()
    await settle()
    const canvas = document.querySelector('canvas')!
    const centre = chart.api.getState().rootScreenCentre
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: centre.x, clientY: centre.y, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: centre.x, clientY: centre.y, bubbles: true }))
    await settle()
    // A chart written before selection existed has its own meaning for a
    // click; switching this on underneath it would change what that chart does.
    expect(chart.api.getSelection()).toEqual([])
    chart.destroy()
  })

  it('selects on click, adds with ctrl, and clears on the background', async () => {
    const chart = make({ selection: true })
    await settle()
    const canvas = document.querySelector('canvas')!
    const tap = (x: number, y: number, init: PointerEventInit = {}) => {
      canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true, ...init }))
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, bubbles: true, ...init }))
    }
    const root = chart.api.getState().rootScreenCentre

    tap(root.x, root.y)
    await settle()
    expect(chart.api.getSelection()).toEqual(['a'])

    // Ctrl on the same node takes it back out — a toggle, as in every list.
    // Waited out first: two taps on one node inside 300ms are a double click
    // (see `DOUBLE_CLICK_MS`), which is a different event and does not select.
    await settleTransition()
    tap(root.x, root.y, { ctrlKey: true })
    await settle()
    expect(chart.api.getSelection()).toEqual([])

    tap(root.x, root.y)
    await settle()
    // Far from any node: "never mind".
    tap(root.x + 400, root.y + 260)
    await settle()
    expect(chart.api.getSelection()).toEqual([])
    chart.destroy()
  })

  it('selects a dragged box, and Escape drops it', async () => {
    const chart = make({ selection: true })
    await settle()
    const el = document.querySelector('canvas')!.parentElement!
    const rect = el.getBoundingClientRect()

    // Shift-drag across the whole chart: everything visible is inside it.
    el.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: rect.left + 2, clientY: rect.top + 2, shiftKey: true, bubbles: true }),
    )
    window.dispatchEvent(
      new PointerEvent('pointermove', { clientX: rect.right - 2, clientY: rect.bottom - 2, bubbles: true }),
    )
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    await settle()
    expect(chart.api.getSelection().length).toBe(4)

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    expect(chart.api.getSelection()).toEqual([])
    chart.destroy()
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

    // a(1..8): b(2..5) contains d(3,4); then c(6,7).
    expect(chart.api.stats('a')).toEqual({
      directChildren: 2,
      descendants: 3,
      depth: 0,
      height: 2,
      leafCount: 2,
      lft: 1,
      rgt: 8,
    })
    expect(chart.api.stats('b')).toEqual({
      directChildren: 1,
      descendants: 1,
      depth: 1,
      height: 1,
      leafCount: 1,
      lft: 2,
      rgt: 5,
    })
    expect(chart.api.stats('d')).toEqual({
      directChildren: 0,
      descendants: 0,
      depth: 2,
      height: 0,
      leafCount: 1,
      lft: 3,
      rgt: 4,
    })
    expect(chart.api.stats('nope')).toBeNull()
    chart.destroy()
  })

  it('answers "is this node inside that branch" as a comparison', async () => {
    // The reason the bounds are exposed at all. Without them this is a walk up
    // the parent chain, of unbounded length, per node — which is what rules it
    // out of anything running per frame.
    const chart = make()
    await nextFrame()
    const inside = (child: string, ancestor: string): boolean => {
      const c = chart.api.stats(child)!
      const a = chart.api.stats(ancestor)!
      return c.lft > a.lft && c.rgt < a.rgt
    }
    expect(inside('d', 'b')).toBe(true)
    expect(inside('d', 'a')).toBe(true)
    expect(inside('d', 'c')).toBe(false)
    expect(inside('c', 'b')).toBe(false)
    // Strict on both sides: a node is not inside itself.
    expect(inside('b', 'b')).toBe(false)
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
      leafCount: 1,
      lft: 1,
      rgt: 4,
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

describe('setLayoutOptions', () => {
  it('changes the shape without resetting the tree', async () => {
    // The whole reason this exists rather than routing through `update()`:
    // `update` replaces the data and calls `initOpen()`, so every branch the
    // viewer had collapsed springs back open. A slider that did that on every
    // tick would be unusable.
    const chart = make()
    await nextFrame()
    chart.api.collapse('b')
    await settleTransition()
    expect(chart.api.getState().visibleCount).toBe(3)

    chart.api.setLayoutOptions({ layout: 'file', layoutStep: 20 })
    await nextFrame()
    await nextFrame()

    // Still three: the collapse survived the shape change, which is the
    // whole point of this method existing.
    expect(chart.api.getState().visibleCount).toBe(3)
    chart.destroy()
  })

  it('leaves the camera alone by default, and settles it when asked', async () => {
    const chart = make()
    await nextFrame()
    await settle()
    const before = chart.api.getState().camera

    chart.api.setLayoutOptions({ spacing: { x: 64, y: 120 } })
    await nextFrame()
    await nextFrame()
    expect(chart.api.getState().camera).toEqual(before)

    // `{ fit: true }` is queued rather than applied here and now — the
    // relayout it should be measured against has not run yet.
    chart.api.setLayoutOptions({ spacing: { x: 8, y: 200 } }, { fit: true })
    await nextFrame()
    await settle()
    expect(chart.api.getState().camera).not.toEqual(before)
    chart.destroy()
  })

  it('drives the sunburst’s own knobs', async () => {
    const chart = make({ layout: 'sunburst', layoutStep: 20, maxRings: 2 })
    await nextFrame()
    await settle()
    const twoRings = chart.api.getState().camera.k

    // More rings is a bigger wheel in the same viewport, so a refit has to
    // come back at a smaller zoom. That is the observable consequence of the
    // knob having reached the layout at all.
    chart.api.setLayoutOptions({ maxRings: 6 }, { fit: true })
    await nextFrame()
    await settle()
    expect(chart.api.getState().camera.k).toBeLessThan(twoRings)
    chart.destroy()
  })
})

describe('drag and drop', () => {
  /** A press, a travel past the threshold, and a release — the shape
   * `input.ts` turns into a claimed drag. `steps` matters: a single jump
   * would cross the threshold and land in the same event, leaving no move
   * for the drop preview to be resolved from. */
  async function drag(el: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }) {
    const rect = el.getBoundingClientRect()
    const at = (p: { x: number; y: number }) => ({
      clientX: rect.left + p.x,
      clientY: rect.top + p.y,
      pointerId: 1,
      button: 0,
      bubbles: true,
    })
    el.dispatchEvent(new PointerEvent('pointerdown', at(from)))
    for (let s = 1; s <= 5; s++) {
      const point = { x: from.x + ((to.x - from.x) * s) / 5, y: from.y + ((to.y - from.y) * s) / 5 }
      window.dispatchEvent(new PointerEvent('pointermove', at(point)))
      await nextFrame()
    }
    window.dispatchEvent(new PointerEvent('pointerup', at(to)))
    await nextFrame()
    await nextFrame()
  }

  /** A press and a travel past the threshold, left HELD — the caller decides
   * how the gesture ends (a release, an Escape, a `pointercancel`), and can
   * hover in place in between. */
  async function dragHold(el: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }) {
    const rect = el.getBoundingClientRect()
    const at = (p: { x: number; y: number }) => ({
      clientX: rect.left + p.x,
      clientY: rect.top + p.y,
      pointerId: 1,
      button: 0,
      bubbles: true,
    })
    el.dispatchEvent(new PointerEvent('pointerdown', at(from)))
    for (let s = 1; s <= 5; s++) {
      const point = { x: from.x + ((to.x - from.x) * s) / 5, y: from.y + ((to.y - from.y) * s) / 5 }
      window.dispatchEvent(new PointerEvent('pointermove', at(point)))
      await nextFrame()
    }
    return {
      /** Another move, without ending anything — for testing what HOLDING
       * somewhere does. */
      async hover(point: { x: number; y: number }) {
        window.dispatchEvent(new PointerEvent('pointermove', at(point)))
        await nextFrame()
      },
      async release(point = to) {
        window.dispatchEvent(new PointerEvent('pointerup', at(point)))
        await nextFrame()
        await nextFrame()
      },
      async escape() {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await nextFrame()
        await nextFrame()
      },
      async cancel() {
        window.dispatchEvent(new PointerEvent('pointercancel', at(to)))
        await nextFrame()
        await nextFrame()
      },
    }
  }

  /** The element `createKlad` was handed. The overlay root sits inside it, so
   * the tests that dispatch at `.klad-overlay-node`'s parent are aiming one
   * level in from here — fine for an event, which bubbles, but not for
   * reading back the class and cursor the chart sets on the host itself. */
  function chartHostEl(): HTMLElement {
    return document.querySelector<HTMLElement>('.klad-overlay-node')!.parentElement!.parentElement!
  }

  /** Screen-space centre of a node, from the overlay element the chart wrote
   * its id onto. */
  function centreOfCard(id: string): { x: number; y: number } | null {
    const el = document.querySelector<HTMLElement>(`.klad-overlay-node[data-klad-id="${id}"]`)
    if (el === null) return null
    const rect = el.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }

  it('is off unless asked for, so a plain drag still pans', async () => {
    const chart = make({ renderNode: (el: HTMLElement) => (el.textContent = 'x') })
    await nextFrame()
    await settle()
    const before = chart.api.getState().camera
    const host = document.querySelector<HTMLElement>('.klad-overlay-node')!.parentElement!
    // Straight across a card. With `dragAndDrop` off this is still a pan, and
    // that is the point: turning the feature on is what takes the gesture
    // away from the camera.
    await drag(host, { x: 200, y: 200 }, { x: 320, y: 260 })
    expect(chart.api.getState().camera).not.toEqual(before)
    chart.destroy()
  })

  it('reparents a node onto another, and reports it before applying', async () => {
    const dropped: { ids: string[]; parentId: string | null; mode: string }[] = []
    const chart = make({
      dragAndDrop: true,
      renderNode: (el: HTMLElement, ctx: { item: { name?: unknown } }) => {
        el.textContent = String(ctx.item.name ?? '')
      },
    })
    chart.on('nodeDrop', ({ ids, parentId, mode }) => dropped.push({ ids, parentId, mode }))
    await nextFrame()
    await settle()

    const host = document.querySelector<HTMLElement>('.klad-overlay-node')!.parentElement!
    const hostRect = host.getBoundingClientRect()
    const from = centreOfCard('d')!
    const to = centreOfCard('c')!
    await drag(
      host,
      { x: from.x - hostRect.left, y: from.y - hostRect.top },
      { x: to.x - hostRect.left, y: to.y - hostRect.top },
    )
    await settleTransition()

    expect(dropped.length).toBe(1)
    expect(dropped[0]!.ids).toEqual(['d'])
    expect(dropped[0]!.parentId).toBe('c')
    expect(dropped[0]!.mode).toBe('into')
    chart.destroy()
  })

  it('lets a handler refuse the move', async () => {
    const chart = make({
      dragAndDrop: true,
      renderNode: (el: HTMLElement, ctx: { item: { name?: unknown } }) => {
        el.textContent = String(ctx.item.name ?? '')
      },
    })
    chart.on('nodeDrop', (event) => event.preventDefault())
    await nextFrame()
    await settle()

    const host = document.querySelector<HTMLElement>('.klad-overlay-node')!.parentElement!
    const hostRect = host.getBoundingClientRect()
    const from = centreOfCard('d')!
    const to = centreOfCard('c')!
    await drag(
      host,
      { x: from.x - hostRect.left, y: from.y - hostRect.top },
      { x: to.x - hostRect.left, y: to.y - hostRect.top },
    )
    await settleTransition()

    // Refused: `d` is still a child of `a`, which is where it started. A
    // handler that had to UNDO a move it did not want would have to know how,
    // and would flash the wrong tree on the way.
    expect(centreOfCard('d')).not.toBeNull()
    expect(chart.api.stats('a')!.directChildren).toBe(2)
    chart.destroy()
  })

  it('stamps each overlay slot with the node it is showing', async () => {
    // Slots are pooled and reassigned as the camera moves, so this is the only
    // way to find a node's element — and a drag needs it in order to clone the
    // card it picked up.
    const chart = make({ renderNode: (el: HTMLElement) => (el.textContent = 'x') })
    await nextFrame()
    const ids = [...document.querySelectorAll<HTMLElement>('.klad-overlay-node')].map(
      (el) => el.dataset.kladId,
    )
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.every((id) => id !== undefined && id !== '')).toBe(true)
    chart.destroy()
  })

  it('holds the drop target still while the tree reflows around it', async () => {
    // The destination is where the viewer is looking. A chart that jumped once
    // they let go would make them find their place again for no reason — and
    // the node that IS supposed to move is the one they dragged, not the one
    // they aimed at, which is why the pin anchors the target.
    const chart = make({
      dragAndDrop: true,
      renderNode: (el: HTMLElement, ctx: { item: { name?: unknown } }) => {
        el.textContent = String(ctx.item.name ?? '')
      },
    })
    await nextFrame()
    await settle()

    const host = document.querySelector<HTMLElement>('.klad-overlay-node')!.parentElement!
    const hostRect = host.getBoundingClientRect()
    const before = centreOfCard('c')!
    const from = centreOfCard('d')!
    await drag(
      host,
      { x: from.x - hostRect.left, y: from.y - hostRect.top },
      { x: before.x - hostRect.left, y: before.y - hostRect.top },
    )
    await settleTransition()
    await settle()

    // `c` gained a child, so the whole tree reflowed around it — but the pin
    // put the camera back where `c` sits under the same screen pixel. Within a
    // pixel: the pin solves against the settled layout in CSS pixels, so this
    // is an equality with rounding rather than an approximation.
    const after = centreOfCard('c')!
    expect(Math.abs(after.x - before.x)).toBeLessThan(1.5)
    expect(Math.abs(after.y - before.y)).toBeLessThan(1.5)
    chart.destroy()
  })

  it('animates the move rather than snapping to the new layout', async () => {
    const chart = make({
      dragAndDrop: true,
      renderNode: (el: HTMLElement, ctx: { item: { name?: unknown } }) => {
        el.textContent = String(ctx.item.name ?? '')
      },
    })
    await nextFrame()
    await settle()

    const host = document.querySelector<HTMLElement>('.klad-overlay-node')!.parentElement!
    const hostRect = host.getBoundingClientRect()
    const from = centreOfCard('d')!
    const to = centreOfCard('c')!
    await drag(
      host,
      { x: from.x - hostRect.left, y: from.y - hostRect.top },
      { x: to.x - hostRect.left, y: to.y - hostRect.top },
    )

    // A frame after the drop the moved node is still on its way. Without
    // `animateNextLayout` the rebuild is a fresh dataset as far as the engine
    // is concerned, so it would already be sitting at its destination here and
    // this distance would be zero.
    await nextFrame()
    const midway = centreOfCard('d')!
    await settleTransition()
    const settled = centreOfCard('d')!
    expect(Math.abs(midway.x - settled.x) + Math.abs(midway.y - settled.y)).toBeGreaterThan(1)
    chart.destroy()
  })

  it('cancels on Escape without moving anything', async () => {
    const dropped: unknown[] = []
    const chart = make({
      dragAndDrop: true,
      renderNode: (el: HTMLElement, ctx: { item: { name?: unknown } }) => {
        el.textContent = String(ctx.item.name ?? '')
      },
    })
    chart.on('nodeDrop', (event) => dropped.push(event))
    await nextFrame()
    await settle()

    const host = document.querySelector<HTMLElement>('.klad-overlay-node')!.parentElement!
    const hostRect = host.getBoundingClientRect()
    const from = centreOfCard('d')!
    const to = centreOfCard('c')!
    const gesture = await dragHold(
      host,
      { x: from.x - hostRect.left, y: from.y - hostRect.top },
      { x: to.x - hostRect.left, y: to.y - hostRect.top },
    )
    await gesture.escape()
    // The release after an Escape is the browser's, not the viewer's — the
    // gesture is already over, and it must not resurrect the drop.
    await gesture.release()
    await settleTransition()

    expect(dropped.length).toBe(0)
    expect(chart.api.stats('b')!.directChildren).toBe(1)
    // Pooled, not removed — see `createDragGhost`. Hidden and emptied is what
    // "put down" looks like.
    expect(document.querySelector<HTMLElement>('.klad-drag-ghost')?.hidden ?? true).toBe(true)
    expect(chartHostEl().classList.contains('klad-dragging')).toBe(false)
    chart.destroy()
  })

  it('recovers from a gesture that never ended', async () => {
    // A browser that takes a gesture away without sending `pointerup` or
    // `pointercancel` leaves this layer claiming the pointer forever: every
    // move pans, nothing works, and only a reload fixes it. Reported on iOS
    // around a dropdown dismissal.
    const dropped: unknown[] = []
    const chart = make({
      dragAndDrop: true,
      renderNode: (el: HTMLElement, ctx: { item: { name?: unknown } }) => {
        el.textContent = String(ctx.item.name ?? '')
      },
    })
    chart.on('nodeDrop', (event) => dropped.push(event))
    await nextFrame()
    await settle()

    const host = document.querySelector<HTMLElement>('.klad-overlay-node')!.parentElement!
    const hostRect = host.getBoundingClientRect()
    const from = centreOfCard('d')!
    const to = centreOfCard('c')!
    // A drag that is claimed and then simply abandoned — no up, no cancel.
    await dragHold(
      host,
      { x: from.x - hostRect.left, y: from.y - hostRect.top },
      { x: to.x - hostRect.left, y: to.y - hostRect.top },
    )
    expect(chartHostEl().classList.contains('klad-dragging')).toBe(true)

    // The next press finds the stale gesture and ends it rather than adding
    // to it.
    host.dispatchEvent(
      new PointerEvent('pointerdown', {
        clientX: hostRect.left + 20,
        clientY: hostRect.top + 20,
        pointerId: 2,
        button: 0,
        bubbles: true,
      }),
    )
    await nextFrame()
    expect(chartHostEl().classList.contains('klad-dragging')).toBe(false)
    expect(dropped.length).toBe(0)
    chart.destroy()
  })

  it('cancels when the browser takes the gesture away', async () => {
    // `pointercancel` used to route to the same place as `pointerup`, so a
    // gesture the browser reclaimed — a touch it decided was a scroll — moved
    // a node on its way out.
    const dropped: unknown[] = []
    const chart = make({
      dragAndDrop: true,
      renderNode: (el: HTMLElement, ctx: { item: { name?: unknown } }) => {
        el.textContent = String(ctx.item.name ?? '')
      },
    })
    chart.on('nodeDrop', (event) => dropped.push(event))
    await nextFrame()
    await settle()

    const host = document.querySelector<HTMLElement>('.klad-overlay-node')!.parentElement!
    const hostRect = host.getBoundingClientRect()
    const from = centreOfCard('d')!
    const to = centreOfCard('c')!
    const gesture = await dragHold(
      host,
      { x: from.x - hostRect.left, y: from.y - hostRect.top },
      { x: to.x - hostRect.left, y: to.y - hostRect.top },
    )
    await gesture.cancel()
    await settleTransition()

    expect(dropped.length).toBe(0)
    expect(chart.api.stats('b')!.directChildren).toBe(1)
    chart.destroy()
  })

  it('says with the cursor whether the drop would be taken', async () => {
    const chart = make({
      dragAndDrop: true,
      renderNode: (el: HTMLElement, ctx: { item: { name?: unknown } }) => {
        el.textContent = String(ctx.item.name ?? '')
      },
    })
    await nextFrame()
    await settle()

    const host = document.querySelector<HTMLElement>('.klad-overlay-node')!.parentElement!
    const hostRect = host.getBoundingClientRect()
    const local = (id: string) => {
      const c = centreOfCard(id)!
      return { x: c.x - hostRect.left, y: c.y - hostRect.top }
    }
    // Drag `b`, which owns `d` — so `c` accepts it and `d` cannot.
    const chartHost = chartHostEl()
    const gesture = await dragHold(host, local('b'), local('c'))
    expect(chartHost.style.cursor).toBe('grabbing')
    expect(chartHost.classList.contains('klad-drag-refused')).toBe(false)
    // Cards are out of the pointer's way for the length of the drag, which is
    // what stops a card's own cursor winning inside its bounds.
    expect(host.style.pointerEvents).toBe('none')

    await gesture.hover(local('d'))
    expect(chartHost.style.cursor).toBe('no-drop')
    expect(chartHost.classList.contains('klad-drag-refused')).toBe(true)

    await gesture.escape()
    expect(chartHost.style.cursor).toBe('')
    expect(chartHost.classList.contains('klad-drag-refused')).toBe(false)
    expect(host.style.pointerEvents).toBe('')
    chart.destroy()
  })

  it('keeps the drag\u2019s own subtree off limits after a spring-load rebuilds the tree', async () => {
    // `dragMask` is a SOURCE-indexed mask, built once when the gesture starts.
    // Spring-loading an unfetched folder mid-drag renormalizes the tree, and
    // whether the mask is still pointing at the right nodes afterwards rests
    // on loaded rows being APPENDED so existing indices survive. That is true
    // — and true by accident, stated nowhere. This is the statement.
    const chart = createKlad(host(), {
      data: [
        { id: 'a', name: 'Root' },
        { id: 'b', parentId: 'a', name: 'Carried' },
        { id: 'd', parentId: 'b', name: 'Its child' },
        { id: 'c', parentId: 'a', name: 'Folder', childCount: 2 },
      ],
      nodeSize: { w: 120, h: 48 },
      label: (item) => String(item.name ?? ''),
      worker: false,
      dragAndDrop: true,
      mayHaveChildren: (item) => Number(item.childCount ?? 0) > 0,
      loadChildren: () => [{ id: 'c1', name: 'Fetched one' }, { id: 'c2', name: 'Fetched two' }],
      renderNode: (el: HTMLElement, ctx: NodeContext) => {
        el.textContent = String(ctx.item.name ?? '')
      },
    })
    await nextFrame()
    await settle()

    const el = document.querySelector<HTMLElement>('.klad-overlay-node')!.parentElement!
    const rect = el.getBoundingClientRect()
    const local = (id: string) => {
      const c = centreOfCard(id)!
      return { x: c.x - rect.left, y: c.y - rect.top }
    }
    const chartHost = chartHostEl()

    // Pick up `b`, rest on the unfetched folder until it springs and loads.
    const gesture = await dragHold(el, local('b'), local('c'))
    await new Promise((r) => setTimeout(r, 900))
    await settle()
    expect(chart.api.stats('c1')).not.toBeNull()

    // The tree has been rebuilt underneath the gesture. `d` is still `b`'s
    // child, so it is still off limits — a stale mask would say otherwise.
    await gesture.hover(local('d'))
    expect(chartHost.classList.contains('klad-drag-refused')).toBe(true)

    // And a node that was never part of it is still a legal target.
    await gesture.hover(local('c1'))
    expect(chartHost.classList.contains('klad-drag-refused')).toBe(false)

    await gesture.escape()
    chart.destroy()
  })

  it('springs a closed branch open when the drag rests on it', async () => {
    // Without this a closed branch is a wall: its children are off screen, so
    // there is nothing to aim at and no way to open it while both hands are
    // busy with the gesture.
    const chart = make({
      dragAndDrop: true,
      renderNode: (el: HTMLElement, ctx: { item: { name?: unknown } }) => {
        el.textContent = String(ctx.item.name ?? '')
      },
    })
    await nextFrame()
    await settle()
    chart.api.collapse('b')
    await settleTransition()
    expect(centreOfCard('d')).toBeNull()

    const host = document.querySelector<HTMLElement>('.klad-overlay-node')!.parentElement!
    const hostRect = host.getBoundingClientRect()
    const local = (id: string) => {
      const c = centreOfCard(id)!
      return { x: c.x - hostRect.left, y: c.y - hostRect.top }
    }
    const gesture = await dragHold(host, local('c'), local('b'))
    await new Promise<void>((resolve) => setTimeout(resolve, 700))
    await settleTransition()

    // `d` is on screen now, which it was not when the drag started.
    expect(centreOfCard('d')).not.toBeNull()
    await gesture.release(local('b'))
    await settleTransition()
    // Dropped into `b`, so `b` stays open — that is where the viewer is now
    // looking.
    expect(chart.api.getView().open).toContain('b')
    chart.destroy()
  })

  it('closes again what it sprang open, when the drop went elsewhere', async () => {
    const chart = make({
      dragAndDrop: true,
      renderNode: (el: HTMLElement, ctx: { item: { name?: unknown } }) => {
        el.textContent = String(ctx.item.name ?? '')
      },
    })
    await nextFrame()
    await settle()
    chart.api.collapse('b')
    await settleTransition()

    const host = document.querySelector<HTMLElement>('.klad-overlay-node')!.parentElement!
    const hostRect = host.getBoundingClientRect()
    const local = (id: string) => {
      const c = centreOfCard(id)!
      return { x: c.x - hostRect.left, y: c.y - hostRect.top }
    }
    const gesture = await dragHold(host, local('c'), local('b'))
    await new Promise<void>((resolve) => setTimeout(resolve, 700))
    await settleTransition()
    expect(chart.api.getView().open).toContain('b')

    // Escape: none of this happened, and a branch that only opened because
    // the pointer paused over it on the way is part of "this".
    await gesture.escape()
    await settleTransition()
    expect(chart.api.getView().open).not.toContain('b')
    chart.destroy()
  })

  it('leaves a host that a stylesheet already positioned alone', async () => {
    // `position: absolute; inset: 0` is the ordinary way to make an element
    // fill its parent. The chart used to read `host.style.position` — the
    // INLINE attribute, empty here — decide the host was unpositioned, and
    // write `position: relative` over the top. Inline beats a stylesheet, so
    // the rule was not overridden, it was defeated: the host collapsed to its
    // content height, and the minimap anchored to the bottom of a chart that
    // ended halfway up the page.
    const style = document.createElement('style')
    style.textContent = '.fills-parent { position: absolute; inset: 0; }'
    document.head.appendChild(style)
    const parent = document.createElement('div')
    parent.style.position = 'relative'
    parent.style.width = '800px'
    parent.style.height = '600px'
    document.body.appendChild(parent)
    const el = document.createElement('div')
    el.className = 'fills-parent'
    parent.appendChild(el)

    const chart = createKlad(el, { data: DATA, nodeSize: { w: 120, h: 48 }, worker: false })
    await nextFrame()
    await settle()

    expect(getComputedStyle(el).position).toBe('absolute')
    expect(el.getBoundingClientRect().height).toBe(600)
    chart.destroy()
    parent.remove()
    style.remove()
  })

  it('still positions a host that nothing else has', async () => {
    const el = document.createElement('div')
    el.style.width = '400px'
    el.style.height = '300px'
    document.body.appendChild(el)
    const chart = createKlad(el, { data: DATA, nodeSize: { w: 120, h: 48 }, worker: false })
    await nextFrame()

    // The overlay, minimap and drag ghost are absolutely positioned inside it,
    // so it has to be a containing block one way or another.
    expect(getComputedStyle(el).position).toBe('relative')
    chart.destroy()
    el.remove()
  })

  describe('a rule of your own on a move', () => {
    it('refuses under the pointer, before anything is let go of', async () => {
      // The point of the option. Refusing in `nodeDrop` answers after the
      // viewer has committed: the indicator said yes, then the node snaps back.
      const asked: { ids: string[]; parentId: string | null }[] = []
      const chart = make({
        dragAndDrop: true,
        canMove: ({ ids, parentId }: { ids: string[]; parentId: string | null }) => {
          asked.push({ ids, parentId })
          return parentId !== 'c'
        },
        renderNode: (el: HTMLElement, ctx: { item: { name?: unknown } }) => {
          el.textContent = String(ctx.item.name ?? '')
        },
      })
      await nextFrame()
      await settle()

      const host = document.querySelector<HTMLElement>('.klad-overlay-node')!.parentElement!
      const hostRect = host.getBoundingClientRect()
      const local = (id: string) => {
        const c = centreOfCard(id)!
        return { x: c.x - hostRect.left, y: c.y - hostRect.top }
      }
      const chartHost = chartHostEl()

      // `c` is a legal target as far as the chart is concerned — nothing about
      // the tree forbids it. Only the rule does.
      const gesture = await dragHold(host, local('d'), local('c'))
      expect(chartHost.style.cursor).toBe('no-drop')
      expect(chartHost.classList.contains('klad-drag-refused')).toBe(true)
      expect(asked.at(-1)).toEqual({ ids: ['d'], parentId: 'c' })

      // And the chart's own answer still wins where it applies: `b` is `d`'s
      // parent, so hovering it in "into" mode is refused by the tree rule
      // whatever the host says.
      await gesture.hover(local('b'))
      await gesture.release(local('b'))
      await settleTransition()
      expect(chart.api.pathTo('d')).toEqual(['a', 'b', 'd'])
      chart.destroy()
    })

    it('is asked once per target crossed, not once per pointer move', async () => {
      let calls = 0
      const chart = make({
        dragAndDrop: true,
        canMove: () => {
          calls++
          return true
        },
        renderNode: (el: HTMLElement, ctx: { item: { name?: unknown } }) => {
          el.textContent = String(ctx.item.name ?? '')
        },
      })
      await nextFrame()
      await settle()

      const host = document.querySelector<HTMLElement>('.klad-overlay-node')!.parentElement!
      const hostRect = host.getBoundingClientRect()
      const local = (id: string) => {
        const c = centreOfCard(id)!
        return { x: c.x - hostRect.left, y: c.y - hostRect.top }
      }
      const gesture = await dragHold(host, local('d'), local('c'))
      const afterFirst = calls
      // Four more moves, same node, same mode. Resolving where a drop lands
      // prunes the tree, so this is not just about somebody's slow predicate.
      for (let i = 0; i < 4; i++) await gesture.hover(local('c'))
      expect(calls).toBe(afterFirst)

      await gesture.escape()
      chart.destroy()
    })

    it('binds api.move too, or it is a hint rather than a rule', async () => {
      const chart = make({
        canMove: ({ parentId }: { parentId: string | null }) => parentId !== 'c',
      })
      await nextFrame()
      await settle()

      expect(chart.api.move('d', 'c')).toBe(false)
      expect(chart.api.pathTo('d')).toEqual(['a', 'b', 'd'])
      expect(chart.api.move('d', 'a')).toBe(true)
      await settleTransition()
      expect(chart.api.pathTo('d')).toEqual(['a', 'd'])
      chart.destroy()
    })
  })

})

describe('children on demand', () => {
  const ROOTS = [
    { id: 'a', name: 'Root' },
    { id: 'b', parentId: 'a', name: 'Branch', childCount: 2 },
    { id: 'c', parentId: 'a', name: 'Leaf', childCount: 0 },
  ]
  const KIDS = [
    { id: 'b1', name: 'First' },
    { id: 'b2', name: 'Second' },
  ]

  function lazy(overrides: Partial<Options> = {}) {
    return createKlad(host(), {
      data: ROOTS,
      nodeSize: { w: 120, h: 48 },
      label: (item) => String(item.name ?? ''),
      worker: false,
      mayHaveChildren: (item) => Number(item.childCount ?? 0) > 0,
      loadChildren: () => KIDS,
      renderNode: (el, ctx) => {
        el.textContent = String(ctx.item.name ?? '')
      },
      ...overrides,
    })
  }

  const cardOf = (id: string) =>
    document.querySelector<HTMLElement>(`.klad-overlay-node[data-klad-id="${id}"]`)

  it('fetches a node’s children the first time it is opened', async () => {
    let calls = 0
    const loaded: { id: string; count: number }[] = []
    const chart = lazy({
      loadChildren: (item) => {
        calls++
        expect(item.id).toBe('b')
        return KIDS
      },
    })
    chart.on('childrenLoaded', ({ id, items }) => loaded.push({ id, count: items.length }))
    await nextFrame()
    await settle()
    expect(cardOf('b1')).toBeNull()

    chart.api.expand('b')
    await settleTransition()
    await settle()

    expect(calls).toBe(1)
    expect(loaded).toEqual([{ id: 'b', count: 2 }])
    // Its own item, not the `{ id }` stub `itemFor` falls back to — every
    // per-item callback (`label`, `nodeSize`, `renderNode`) reads through the
    // same index, so a fetched node missing from it draws as its own id.
    expect(cardOf('b1')!.textContent).toBe('First')
    expect(chart.api.search('Second').map((r) => r.id)).toEqual(['b2'])
    expect(chart.api.stats('b')!.directChildren).toBe(2)
    // Opened by the load, not before it — an empty branch that says "nothing
    // here" for the length of a request is the one thing that is not true.
    expect(chart.api.getView().open).toContain('b')

    // Asked for once. The second open is an ordinary toggle.
    chart.api.collapse('b')
    await settleTransition()
    chart.api.expand('b')
    await settleTransition()
    expect(calls).toBe(1)
    chart.destroy()
  })

  it('does not ask twice while a load is in flight', async () => {
    let calls = 0
    let release: ((items: unknown[]) => void) | null = null
    const chart = lazy({
      loadChildren: () => {
        calls++
        return new Promise((resolve) => {
          release = resolve as (items: unknown[]) => void
        })
      },
    })
    await nextFrame()
    await settle()

    chart.api.expand('b')
    chart.api.expand('b')
    chart.api.expand('b')
    await nextFrame()
    expect(calls).toBe(1)

    release!(KIDS)
    await settleTransition()
    await settle()
    expect(cardOf('b1')).not.toBeNull()
    chart.destroy()
  })

  it('reports a failed load and lets the next click retry', async () => {
    let calls = 0
    const warnings: { code: string; ids: string[] }[] = []
    const chart = lazy({
      loadChildren: () => {
        calls++
        return calls === 1 ? Promise.reject(new Error('offline')) : KIDS
      },
    })
    chart.on('warning', (w) => warnings.push({ code: w.code, ids: w.ids }))
    await nextFrame()
    await settle()

    chart.api.expand('b')
    await settleTransition()
    expect(warnings).toEqual([{ code: 'load-failed', ids: ['b'] }])
    expect(cardOf('b1')).toBeNull()

    // Left unloaded on purpose, so this is a retry rather than a no-op.
    chart.api.expand('b')
    await settleTransition()
    await settle()
    expect(calls).toBe(2)
    expect(cardOf('b1')).not.toBeNull()
    chart.destroy()
  })

  it('offers a way in on a node whose children have not arrived', async () => {
    // `hasChildren` drives a host's own chevron and the screen-reader tree's
    // `aria-expanded`. If an unloaded node read as a leaf there would be
    // nothing to click, and the children could never be asked for.
    const seen = new Map<string, boolean>()
    const chart = lazy({
      renderNode: (el, ctx) => {
        seen.set(ctx.id, ctx.hasChildren)
        el.textContent = ctx.id
      },
    })
    await nextFrame()
    await settle()
    expect(seen.get('b')).toBe(true)
    expect(seen.get('c')).toBe(false)

    const row = document.querySelector(`[role="treeitem"][data-orgchart-id="b"]`)
    expect(row?.getAttribute('aria-expanded')).toBe('false')
    chart.destroy()
  })

  it('says which node is waiting, and only while it waits', async () => {
    let release: ((items: NodeData[]) => void) | null = null
    const loading: string[] = []
    const chart = lazy({
      loadChildren: () =>
        new Promise<NodeData[]>((resolve) => {
          release = resolve
        }),
      renderNode: (el, ctx) => {
        if (ctx.loading) loading.push(ctx.id)
        el.textContent = ctx.id
      },
    })
    await nextFrame()
    await settle()
    expect(loading).toEqual([])

    chart.api.expand('b')
    await nextFrame()
    await nextFrame()
    expect(new Set(loading)).toEqual(new Set(['b']))

    loading.length = 0
    release!(KIDS)
    await settleTransition()
    await settle()
    // Cleared when the answer lands — a card left saying "waiting" after the
    // children are on screen is worse than never having said it.
    expect(loading).toEqual([])
    chart.destroy()
  })

  it('starts a freshly loaded folder closed if it too has children to fetch', async () => {
    // `b1` comes back marked as having children of its own. It must arrive
    // CLOSED, whatever `collapsedByDefault` says: an unloaded node reported as
    // open claims there is nothing inside, and — worse — opening it is the
    // only thing that ever asks for a load, so one that starts open can never
    // be fetched at all.
    const chart = lazy({
      loadChildren: () => [
        { id: 'b1', name: 'First', childCount: 3 },
        { id: 'b2', name: 'Second', childCount: 0 },
      ],
    })
    await nextFrame()
    await settle()
    chart.api.expand('b')
    await settleTransition()
    await settle()

    const open = chart.api.getView().open
    expect(open).toContain('b')
    expect(open).not.toContain('b1')
    expect(open).toContain('b2')
    chart.destroy()
  })

  it('works in worker mode, mask and all', async () => {
    // Every other test here runs the engine in-process. The `unloaded` mask is
    // the one piece of this feature that crosses `postMessage`, so it is also
    // the one piece the in-process tests cannot vouch for — a field missing
    // from the wire type, or dropped in `host.ts`, would leave the marks off
    // and nothing else would notice.
    const chart = createKlad(host(), {
      data: ROOTS,
      nodeSize: { w: 120, h: 48 },
      label: (item) => String(item.name ?? ''),
      worker: true,
      mayHaveChildren: (item) => Number(item.childCount ?? 0) > 0,
      loadChildren: () => KIDS,
      renderNode: (el, ctx) => {
        el.textContent = String(ctx.item.name ?? '')
      },
    })
    await nextFrame()
    await settle()
    await settle()
    expect(cardOf('b1')).toBeNull()

    chart.api.expand('b')
    await settleTransition()
    await settle()
    await settle()

    expect(cardOf('b1')?.textContent).toBe('First')
    expect(chart.api.stats('b')!.directChildren).toBe(2)
    chart.destroy()
  })

  it('leaves the mark off a file list, which has its own disclosure', async () => {
    // The row already carries a chevron beside its name. A stub hanging off
    // the bottom of it says the same thing in a second place and reads as a
    // stray guide line.
    const chart = lazy({ layout: 'file', nodeSize: { w: 260, h: 26 } })
    await nextFrame()
    await settle()
    expect(chart.api.toSVG()).not.toContain('class="hs"')
    chart.destroy()
  })

  it('marks an unfetched branch in the export too', async () => {
    // The rule lives in two places by necessity — in worker mode the live
    // engine is unreachable from the main thread, so the export recomputes it.
    // The engine grew the unloaded branch and this mirror did not, so the mark
    // was on the canvas and missing from the picture of the canvas.
    const chart = lazy()
    await nextFrame()
    await settle()

    // `hs`/`hd` are the stub-and-dot the rectangular layouts draw for "there
    // is more inside this" — see render/svg.ts.
    expect(chart.api.toSVG()).toContain('class="hs"')

    chart.api.expand('b')
    await settleTransition()
    await settle()
    // Fetched now, so nothing is hidden and nothing is marked.
    expect(chart.api.toSVG()).not.toContain('class="hs"')
    chart.destroy()
  })

  it('keeps loaded children through refresh, and drops them on update', async () => {
    const chart = lazy()
    await nextFrame()
    await settle()
    chart.api.expand('b')
    await settleTransition()
    await settle()
    expect(cardOf('b1')).not.toBeNull()

    // `refresh()` says the data did not change. What was fetched belongs to
    // the tree that is still on screen.
    chart.api.refresh()
    await settleTransition()
    await settle()
    expect(cardOf('b1')).not.toBeNull()

    // `update()` is a new dataset — the fetched branch belonged to the old one.
    chart.update([...ROOTS])
    await settleTransition()
    await settle()
    expect(cardOf('b1')).toBeNull()
    chart.destroy()
  })

  it('does nothing lazy without a loader', async () => {
    // `mayHaveChildren` alone would put a mark on a node inviting a click that
    // cannot lead anywhere.
    const chart = createKlad(host(), {
      data: ROOTS,
      nodeSize: { w: 120, h: 48 },
      label: (item) => String(item.name ?? ''),
      worker: false,
      mayHaveChildren: (item) => Number(item.childCount ?? 0) > 0,
      renderNode: (el, ctx) => {
        el.textContent = String(ctx.item.name ?? '')
      },
    })
    await nextFrame()
    await settle()
    const seen: boolean[] = []
    chart.api.search('Branch').forEach((r) => seen.push(chart.api.stats(r.id)!.directChildren > 0))
    expect(seen).toEqual([false])
    chart.api.expand('b')
    await settleTransition()
    expect(cardOf('b1')).toBeNull()
    chart.destroy()
  })
})

describe('filter', () => {
  //  a Root
  //  ├── b Left        ── d Leaf
  //  └── c Right
  const cardOf = (id: string) =>
    document.querySelector<HTMLElement>(`.klad-overlay-node[data-klad-id="${id}"]`)
  const onScreen = () =>
    [...document.querySelectorAll<HTMLElement>('.klad-overlay-node')].map((el) => el.dataset.kladId).sort()

  function filterable(overrides: Partial<Options> = {}) {
    return createKlad(host(), {
      data: DATA,
      nodeSize: { w: 120, h: 48 },
      label: (item) => String(item.name ?? ''),
      worker: false,
      renderNode: (el, ctx) => {
        el.textContent = String(ctx.item.name ?? '')
      },
      ...overrides,
    })
  }

  it('keeps the matches and the ancestors that lead to them', async () => {
    const chart = filterable()
    await nextFrame()
    await settle()
    expect(onScreen()).toEqual(['a', 'b', 'c', 'd'])

    const matched = chart.api.filter('Leaf')
    await settleTransition()
    await settle()

    // `d` matched; `a` and `b` are the way to it. `c` leads nowhere and goes.
    expect(matched).toEqual(['d'])
    expect(onScreen()).toEqual(['a', 'b', 'd'])
    chart.destroy()
  })

  it('returns what MATCHED, not what is left on screen', async () => {
    // The ancestors are there because the tree has to hang together, not
    // because anybody asked about them.
    const chart = filterable()
    await nextFrame()
    await settle()
    expect(chart.api.filter('Leaf')).toEqual(['d'])
    expect(chart.api.filter('Root')).toEqual(['a'])
    chart.destroy()
  })

  it('hides a match’s own children unless they match too', async () => {
    // The question a filter answers is "where are the things I asked for".
    // Answering it with their subtrees attached puts back most of what was
    // taken away.
    const chart = filterable()
    await nextFrame()
    await settle()
    chart.api.filter('Left')
    await settleTransition()
    await settle()
    expect(onScreen()).toEqual(['a', 'b'])
    expect(cardOf('d')).toBeNull()
    chart.destroy()
  })

  it('takes a predicate as well as a label substring', async () => {
    const chart = filterable()
    await nextFrame()
    await settle()
    const matched = chart.api.filter((item) => item.id === 'c')
    await settleTransition()
    await settle()
    expect(matched).toEqual(['c'])
    expect(onScreen()).toEqual(['a', 'c'])
    chart.destroy()
  })

  it('shows results that are behind a collapsed ancestor', async () => {
    // A filter that found something and then left it hidden would be
    // answering a different question than the one that was asked.
    const chart = filterable()
    await nextFrame()
    await settle()
    chart.api.collapse('b')
    await settleTransition()
    expect(cardOf('d')).toBeNull()

    chart.api.filter('Leaf')
    await settleTransition()
    await settle()
    expect(onScreen()).toEqual(['a', 'b', 'd'])
    chart.destroy()
  })

  it('gives the expand state back untouched when cleared', async () => {
    const chart = filterable()
    await nextFrame()
    await settle()
    chart.api.collapse('b')
    await settleTransition()

    chart.api.filter('Leaf')
    await settleTransition()
    await settle()
    chart.api.filter(null)
    await settleTransition()
    await settle()

    // `b` is closed again — the filter overrode collapse while it ran, it did
    // not rewrite it.
    expect(chart.api.getView().open).not.toContain('b')
    expect(cardOf('d')).toBeNull()
    expect(onScreen()).toEqual(['a', 'b', 'c'])
    chart.destroy()
  })

  it('does not wedge on a focus for something the filter removed', async () => {
    // `focus` defers when the target has no box yet, waiting for the relayout
    // that reveals it. Under a filter that relayout never comes for a node the
    // filter excluded, so the wait has to end rather than sit there asking for
    // frames forever.
    const chart = filterable()
    await nextFrame()
    await settle()
    chart.api.filter('Leaf')
    await settleTransition()
    await settle()

    chart.api.focus('c')
    await settleTransition()
    await settle()

    // Still the filtered chart, and still responsive: a later command lands.
    expect(onScreen()).toEqual(['a', 'b', 'd'])
    chart.api.filter(null)
    await settleTransition()
    await settle()
    expect(onScreen()).toEqual(['a', 'b', 'c', 'd'])
    chart.destroy()
  })

  it('leaves nothing but the roots when nothing matches', async () => {
    const chart = filterable()
    await nextFrame()
    await settle()
    const matched = chart.api.filter('nothing here')
    await settleTransition()
    await settle()
    expect(matched).toEqual([])
    // Not one node: an empty chart is a clearer answer than a chart still
    // showing a root that did not match either.
    expect(onScreen()).toEqual([])
    chart.destroy()
  })

  it('survives a data change, re-derived against the new tree', async () => {
    // A source index means nothing across a `normalize`, so a mask carried
    // over would keep an arbitrary set of nodes.
    const chart = filterable()
    await nextFrame()
    await settle()
    chart.api.filter('Leaf')
    await settleTransition()
    await settle()
    expect(onScreen()).toEqual(['a', 'b', 'd'])

    chart.update([
      { id: 'a', name: 'Root' },
      { id: 'x', parentId: 'a', name: 'Other' },
      { id: 'y', parentId: 'x', name: 'Leaf' },
    ])
    await settleTransition()
    await settle()
    expect(onScreen()).toEqual(['a', 'x', 'y'])
    chart.destroy()
  })

  it('tells the screen-reader tree the same thing', async () => {
    const chart = filterable()
    await nextFrame()
    await settle()
    chart.api.filter('Leaf')
    await settleTransition()
    await settle()

    const rows = [...document.querySelectorAll('[role="treeitem"]')].map((r) =>
      r.getAttribute('data-orgchart-id'),
    )
    // A screen reader reading out nodes the filter removed is a mirror that
    // contradicts what it mirrors.
    expect(rows).toContain('d')
    expect(rows).not.toContain('c')
    chart.destroy()
  })
})

describe('very wide levels', () => {
  // One root with twenty children, three of which are "interesting".
  const WIDE = [
    { id: 'r', name: 'Root' },
    ...Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, parentId: 'r', name: `Child ${i}` })),
  ]
  const WATCHING = new Set(['c14', 'c17', 'c19'])

  /** Tall and narrow, with the file layout, so twenty-odd rows all fit on
   * screen at once. The overlay only renders what is in the viewport, so a
   * wide layout would make "is this node drawn" a question about the camera
   * rather than about the cap. */
  function tallHost(): HTMLElement {
    const el = document.createElement('div')
    el.style.width = '600px'
    el.style.height = '1400px'
    document.body.appendChild(el)
    return el
  }

  const onScreen = () =>
    [...document.querySelectorAll<HTMLElement>('.klad-overlay-node')].map((el) => el.dataset.kladId!)

  function wide(overrides: Partial<Options> = {}) {
    return createKlad(tallHost(), {
      data: WIDE,
      layout: 'file',
      nodeSize: { w: 300, h: 26 },
      rowGap: 4,
      label: (item) => String(item.name ?? ''),
      worker: false,
      renderNode: (el, ctx) => {
        el.textContent = ctx.overflow === null ? String(ctx.item.name ?? '') : `+${ctx.overflow.count}`
      },
      ...overrides,
    })
  }

  /** How many nodes the chart is actually laying out — the pruned count, not
   * whatever happens to be in the viewport. */
  const laidOut = (chart: ReturnType<typeof createKlad>) => chart.api.getState().visibleCount

  /** Drags one node onto another. `bias` shifts the release point within the
   * target row as a fraction of its height — 0 is the middle ("into"), +0.35
   * lands in the trailing band ("after"). */
  async function dragOnto(fromId: string, toId: string, bias = 0) {
    const overlay = document.querySelector<HTMLElement>('.klad-overlay-node')!.parentElement!
    const rect = overlay.getBoundingClientRect()
    const boxOf = (id: string) =>
      document.querySelector<HTMLElement>(`.klad-overlay-node[data-klad-id="${id}"]`)!.getBoundingClientRect()
    const from = boxOf(fromId)
    const to = boxOf(toId)
    const a = { x: from.left + from.width / 2, y: from.top + from.height / 2 }
    const b = { x: to.left + to.width / 2, y: to.top + to.height * (0.5 + bias) }
    const ev = (t: string, p: { x: number; y: number }) =>
      new PointerEvent(t, { clientX: p.x, clientY: p.y, pointerId: 1, button: 0, bubbles: true })
    overlay.dispatchEvent(ev('pointerdown', a))
    for (let i = 1; i <= 5; i++) {
      window.dispatchEvent(
        ev('pointermove', { x: a.x + ((b.x - a.x) * i) / 5, y: a.y + ((b.y - a.y) * i) / 5 }),
      )
      await nextFrame()
    }
    window.dispatchEvent(ev('pointerup', b))
    await nextFrame()
    await nextFrame()
    void rect
  }

  it('draws the first few and rolls the rest into one node', async () => {
    const chart = wide({ maxChildren: 5 })
    await nextFrame()
    await settle()

    // Root + 5 children + one node standing in for the fifteen that did not fit.
    expect(laidOut(chart)).toBe(7)
    const ids = onScreen()
    expect(ids).toContain('c0')
    expect(ids).toContain('c4')
    expect(ids).not.toContain('c5')
    expect(ids).toContain('klad:more:r')
    chart.destroy()
  })

  it('still CONTAINS everything it is not drawing', async () => {
    // The claim the whole feature rests on. A cap is about what you can look
    // at, not about what is there — so search, stats and the path to a node
    // must all still see the fifteen that fell past it.
    const chart = wide({ maxChildren: 5 })
    await nextFrame()
    await settle()

    // Twenty, not twenty-one: the node the cap invented is real enough to lay
    // out and hit-test, but it is not in anybody's data and a card saying "21
    // reports" would be wrong about the only tree the host has.
    expect(chart.api.stats('r')!.directChildren).toBe(20)
    expect(chart.api.stats('r')!.descendants).toBe(20)
    expect(chart.api.search('Child 19').map((r) => r.id)).toEqual(['c19'])
    expect(chart.api.pathTo('c19')).toEqual(['r', 'c19'])
    chart.destroy()
  })

  it('shows the ones you pinned, not the ones that sort first', async () => {
    const chart = wide({
      maxChildren: 5,
      pinChildren: (item) => WATCHING.has(String(item.id)),
    })
    await nextFrame()
    await settle()

    const ids = onScreen()
    for (const id of WATCHING) expect(ids).toContain(id)
    // Three of the five slots went to pins, so only two unpinned survive.
    expect(ids.filter((id) => id.startsWith('c') && !WATCHING.has(id)).length).toBe(2)
    chart.destroy()
  })

  it('lets pins exceed the cap — a pin is an instruction, a cap is a default', async () => {
    const chart = wide({
      maxChildren: 2,
      pinChildren: (item) => WATCHING.has(String(item.id)),
    })
    await nextFrame()
    await settle()
    const ids = onScreen()
    for (const id of WATCHING) expect(ids).toContain(id)
    chart.destroy()
  })

  it('keeps the data’s own order, so nothing jumps when the set changes', async () => {
    const chart = wide({
      maxChildren: 6,
      pinChildren: (item) => WATCHING.has(String(item.id)),
    })
    await nextFrame()
    await settle()
    const shown = onScreen().filter((id) => /^c\d+$/.test(id))
    const sorted = [...shown].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
    // A pinned child stays where it was among its siblings rather than being
    // hoisted to the front.
    expect(shown).toEqual(sorted)
    chart.destroy()
  })

  it('says what the aggregate node stands for', async () => {
    const seen: NonNullable<NodeContext['overflow']>[] = []
    const chart = wide({
      maxChildren: 5,
      renderNode: (el, ctx) => {
        if (ctx.overflow !== null) seen.push(ctx.overflow)
        el.textContent = ctx.id
      },
    })
    await nextFrame()
    await settle()
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[0]!.count).toBe(15)
    expect(seen[0]!.ids).toContain('c19')
    expect(seen[0]!.parentId).toBe('r')
    chart.destroy()
  })

  it('lifts the cap on showMore, and keeps it lifted', async () => {
    const chart = wide({ maxChildren: 5 })
    await nextFrame()
    await settle()

    chart.api.showMore('klad:more:r')
    await settleTransition()
    await settle()
    // All twenty, and no aggregate node left to stand for anything.
    expect(laidOut(chart)).toBe(21)
    expect(onScreen()).not.toContain('klad:more:r')

    // A rebuild is not an undo.
    chart.api.refresh()
    await settleTransition()
    await settle()
    expect(laidOut(chart)).toBe(21)
    chart.destroy()
  })

  it('brings back just the ones you ask for', async () => {
    const chart = wide({ maxChildren: 5 })
    await nextFrame()
    await settle()

    chart.api.reveal(['c17'])
    await settleTransition()
    await settle()
    const ids = onScreen()
    expect(ids).toContain('c17')
    // The cap is still on — everything else past it is still rolled up.
    expect(ids).toContain('klad:more:r')
    expect(ids).not.toContain('c19')
    chart.destroy()
  })

  it('digs a node out of a cap when you focus it', async () => {
    // Without this a node that fell past a cap is unreachable: focus opens
    // every ancestor and still shows nothing, and there is no toggle for a
    // cap the way there is for a collapsed branch.
    const chart = wide({ maxChildren: 5 })
    await nextFrame()
    await settle()
    expect(onScreen()).not.toContain('c19')

    chart.api.focus('c19')
    await settleTransition()
    await settle()
    expect(onScreen()).toContain('c19')
    chart.destroy()
  })

  it('caps nothing while a filter is running', async () => {
    // Someone who asked for specific nodes has said which ones they want.
    // Hiding part of the answer behind "and 12 more" would be a second cap
    // on top of theirs.
    const chart = wide({ maxChildren: 2 })
    await nextFrame()
    await settle()

    // 'Child 1' matches Child 1 and Child 10..19 — eleven, plus the root.
    chart.api.filter('Child 1')
    await settleTransition()
    await settle()
    expect(laidOut(chart)).toBe(12)
    expect(onScreen()).not.toContain('klad:more:r')
    chart.destroy()
  })

  it('tells the screen-reader tree the same thing', async () => {
    // A capped level draws eight children. A mirror that read out all twenty
    // would not be mirroring anything — and the aggregate node, which IS on
    // screen, has to be in there instead.
    const chart = wide({ maxChildren: 5 })
    await nextFrame()
    await settle()

    const rows = [...document.querySelectorAll('[role="treeitem"]')].map((r) =>
      r.getAttribute('data-orgchart-id'),
    )
    expect(rows).toContain('c0')
    expect(rows).not.toContain('c19')
    expect(rows).toContain('klad:more:r')
    chart.destroy()
  })

  it('refuses to drag the node a cap invented, or to drop into it', async () => {
    // It stands for other nodes rather than being one, so "move it" has no
    // meaning — and `nodeDrop` would report an id the host has never seen.
    const dropped: unknown[] = []
    const chart = wide({ maxChildren: 5, dragAndDrop: true })
    chart.on('nodeDrop', (event) => dropped.push(event))
    await nextFrame()
    await settle()

    const host = document.querySelector<HTMLElement>('.klad-overlay-node')!.parentElement!
    const hostRect = host.getBoundingClientRect()
    const at = (id: string) => {
      const el = document.querySelector<HTMLElement>(`.klad-overlay-node[data-klad-id="${id}"]`)
      if (el === null) {
        throw new Error(
          `no ${id}; have ${[...document.querySelectorAll<HTMLElement>('.klad-overlay-node')]
            .map((n) => n.dataset.kladId)
            .join(',')}`,
        )
      }
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2 - hostRect.left, y: r.top + r.height / 2 - hostRect.top }
    }
    const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const ev = (t: string, p: { x: number; y: number }) =>
        new PointerEvent(t, {
          clientX: hostRect.left + p.x,
          clientY: hostRect.top + p.y,
          pointerId: 1,
          button: 0,
          bubbles: true,
        })
      host.dispatchEvent(ev('pointerdown', from))
      for (let i = 1; i <= 5; i++) {
        window.dispatchEvent(
          ev('pointermove', {
            x: from.x + ((to.x - from.x) * i) / 5,
            y: from.y + ((to.y - from.y) * i) / 5,
          }),
        )
        await nextFrame()
      }
      window.dispatchEvent(ev('pointerup', to))
      await nextFrame()
      await nextFrame()
    }

    // Dropping INTO it: the drag is claimed, the target refuses, nothing
    // moves. Done first because the other case leaves the camera somewhere
    // else — see below.
    await drag(at('c1'), at('klad:more:r'))
    await settleTransition()
    expect(dropped.length).toBe(0)
    expect(chart.api.stats('r')!.directChildren).toBe(20)

    // Dragging IT: refused before the gesture is claimed, so it stays a pan —
    // which is the right outcome and also why this is last, since panning
    // takes the nodes the assertions above needed off screen.
    const cameraBefore = chart.api.getState().camera
    await drag(at('klad:more:r'), { x: 40, y: 40 })
    await settleTransition()
    expect(dropped.length).toBe(0)
    expect(chart.api.getState().camera).not.toEqual(cameraBefore)
    chart.destroy()
  })

  it('keeps the node a cap invented out of search results', async () => {
    // Its `item` is a stub with nothing on it but an id, so a caller looping
    // results to read a field would find nothing there.
    const chart = wide({ maxChildren: 5 })
    await nextFrame()
    await settle()
    const all = chart.api.search(() => true)
    expect(all.length).toBe(21) // the twenty children and the root
    expect(all.some((r) => r.id.startsWith('klad:more:'))).toBe(false)
    chart.destroy()
  })

  it('does not carry an invented node along in a selection', async () => {
    // A box or lasso can take it in, and a drag carrying the whole selection
    // would then report an id the host has never seen through `nodeDrop`.
    const dropped: { ids: string[] }[] = []
    const chart = wide({ maxChildren: 5, dragAndDrop: true, selection: true })
    chart.on('nodeDrop', ({ ids }) => dropped.push({ ids }))
    await nextFrame()
    await settle()

    chart.api.select(['c1', 'klad:more:r'])
    await nextFrame()

    const host = document.querySelector<HTMLElement>('.klad-overlay-node')!.parentElement!
    const hostRect = host.getBoundingClientRect()
    const at = (id: string) => {
      const r = document
        .querySelector<HTMLElement>(`.klad-overlay-node[data-klad-id="${id}"]`)!
        .getBoundingClientRect()
      return { x: r.left + r.width / 2 - hostRect.left, y: r.top + r.height / 2 - hostRect.top }
    }
    const ev = (t: string, p: { x: number; y: number }) =>
      new PointerEvent(t, {
        clientX: hostRect.left + p.x,
        clientY: hostRect.top + p.y,
        pointerId: 1,
        button: 0,
        bubbles: true,
      })
    const from = at('c1')
    const to = at('c0')
    host.dispatchEvent(ev('pointerdown', from))
    for (let i = 1; i <= 5; i++) {
      window.dispatchEvent(
        ev('pointermove', {
          x: from.x + ((to.x - from.x) * i) / 5,
          y: from.y + ((to.y - from.y) * i) / 5,
        }),
      )
      await nextFrame()
    }
    window.dispatchEvent(ev('pointerup', to))
    await settleTransition()

    expect(dropped.length).toBe(1)
    expect(dropped[0]!.ids).toEqual(['c1'])
    chart.destroy()
  })

  it('carries the caps and the filter in a view', async () => {
    // A view is a thing you put in a URL. One that restored everything except
    // what the viewer had filtered and uncapped would come back a different
    // chart.
    const chart = wide({ maxChildren: 5 })
    await nextFrame()
    await settle()
    chart.api.showMore('klad:more:r')
    chart.api.reveal(['c18'])
    await settleTransition()
    await settle()

    const view = JSON.parse(JSON.stringify(chart.api.getView()))
    expect(view.uncapped).toEqual(['r'])
    expect(view.revealed).toEqual(['c18'])

    const other = wide({ maxChildren: 5 })
    await nextFrame()
    await settle()
    expect(laidOut(other)).toBe(7)
    other.api.setView(view)
    await settleTransition()
    await settle()
    expect(laidOut(other)).toBe(21)
    other.destroy()
    chart.destroy()
  })

  it('does not bake the invented node into the data on a drop', async () => {
    // A reparent rebuilds the host's array from the chart's current rows. If
    // that includes the node a cap invented, it becomes ordinary data — and
    // the next rebuild plans a SECOND aggregate for the same parent, on top
    // of the fossil of the first.
    const warnings: string[] = []
    const chart = wide({ maxChildren: 5, dragAndDrop: true })
    chart.on('warning', (w) => warnings.push(w.code))
    await nextFrame()
    await settle()

    await dragOnto('c1', 'c0')
    await settleTransition()
    await settle()

    expect(chart.api.stats('c0')!.directChildren).toBe(1)
    expect(warnings).not.toContain('duplicate-id')
    // The chart's node count must not have grown. A second aggregate for the
    // same parent, on top of the fossil of the first, shows up here.
    // It takes a SECOND drop to show. The first writes the invented node into
    // the array; the second renormalises that array, plans another aggregate
    // for the same parent, and lands on a duplicate id.
    await dragOnto('c2', 'c3')
    await settleTransition()
    await settle()

    expect(warnings).not.toContain('duplicate-id')
    expect(chart.api.getState().nodeCount).toBe(22) // 21 real + one aggregate
    chart.destroy()
  })

  it('reports a drop index among ALL the siblings, not the drawn ones', async () => {
    // `dropPosition` works on the pruned tree, where a capped parent has five
    // children and an aggregate. "After the last drawn one" is not "after the
    // fifth of twenty", and a handler told index 5 would put the node in the
    // wrong place in its own array.
    const seen: number[] = []
    // Pinning c19 is what makes the two index spaces genuinely disagree: the
    // root's drawn children are c0..c3 and c19, so c19 is the FIFTH drawn but
    // the TWENTIETH child. Without a pin the hidden ones are all at the tail
    // and the two numbers coincide, which is why this needs one.
    const chart = wide({
      maxChildren: 5,
      dragAndDrop: true,
      pinChildren: (item) => String(item.id) === 'c19',
    })
    chart.on('nodeDrop', ({ index, preventDefault }) => {
      seen.push(index)
      preventDefault()
    })
    await nextFrame()
    await settle()

    // Drop c0 after c19. Among the root's twenty children c19 sits at 19, so
    // "after it" is 20 — the index counts before the moving nodes are taken
    // out, which is what `nodeDrop` documents. Not 5, which is where c19 sits
    // among the five the cap left drawn.
    await dragOnto('c0', 'c19', 0.35)
    await settleTransition()
    expect(seen.length).toBe(1)
    expect(seen[0]).toBe(20)
    chart.destroy()
  })

  it('forgets lifted caps when the data is replaced', async () => {
    // `uncapped` and `revealed` name nodes in the dataset being replaced.
    // Left standing they lift caps on ids that no longer exist — or, worse,
    // on ones that happen to exist again and that nobody has opened.
    const chart = wide({ maxChildren: 5 })
    await nextFrame()
    await settle()
    chart.api.showMore('klad:more:r')
    await settleTransition()
    await settle()
    expect(laidOut(chart)).toBe(21)

    chart.update(WIDE)
    await settleTransition()
    await settle()
    expect(laidOut(chart)).toBe(7)
    expect(chart.api.getView().uncapped).toEqual([])
    chart.destroy()
  })

  it('caps and filters through the worker too', async () => {
    // Both masks cross `postMessage`, and every other test here runs the
    // engine in-process. A field missing from the wire type or dropped in
    // host.ts would show as a chart that quietly ignores both.
    const chart = createKlad(tallHost(), {
      data: WIDE,
      layout: 'file',
      nodeSize: { w: 300, h: 26 },
      rowGap: 4,
      label: (item) => String(item.name ?? ''),
      worker: true,
      maxChildren: 5,
      renderNode: (el, ctx) => {
        el.textContent = ctx.overflow === null ? String(ctx.item.name ?? '') : `+${ctx.overflow.count}`
      },
    })
    await nextFrame()
    await settle()
    await settle()
    expect(laidOut(chart)).toBe(7)

    chart.api.filter('Child 1')
    await settleTransition()
    await settle()
    await settle()
    // Eleven matches plus the root, and the cap suppressed while it runs.
    expect(laidOut(chart)).toBe(12)

    chart.api.filter(null)
    await settleTransition()
    await settle()
    await settle()
    expect(laidOut(chart)).toBe(7)
    chart.destroy()
  })

  it('never sends its own invented node to loadChildren', async () => {
    // The aggregate is childless by construction, so a host predicate loose
    // enough to say yes to it — and one written for real rows will be, since
    // it is answering about a stub with none of their fields — would put a
    // "more inside" mark on the chart's own invention and then fetch it.
    const asked: string[] = []
    const chart = wide({
      maxChildren: 5,
      mayHaveChildren: () => true,
      loadChildren: (item) => {
        asked.push(String(item.id))
        return []
      },
    })
    await nextFrame()
    await settle()

    chart.api.expand('klad:more:r')
    await settleTransition()
    await settle()
    expect(asked).toEqual([])
    chart.destroy()
  })

  it('never matches its own invented node with a filter', async () => {
    // The aggregate's fallback label is `+15`, so a filter for "1" or "5"
    // would match it — and a filter is supposed to answer a question about
    // the host's data, not about the chart's bookkeeping.
    const chart = wide({ maxChildren: 5 })
    await nextFrame()
    await settle()

    const matched = chart.api.filter('+1')
    await settleTransition()
    await settle()
    expect(matched).toEqual([])
    expect(onScreen()).toEqual([])
    chart.destroy()
  })

  it('handles a cap of zero, and one bigger than the level', async () => {
    const none = wide({ maxChildren: 0 })
    await nextFrame()
    await settle()
    // The root and one node standing for all twenty.
    expect(laidOut(none)).toBe(2)
    none.destroy()

    const roomy = wide({ maxChildren: 500 })
    await nextFrame()
    await settle()
    // Nothing to roll up, so no invented node at all.
    expect(laidOut(roomy)).toBe(21)
    roomy.destroy()
  })

  it('does not cap the roots, which are nobody’s children', async () => {
    // `maxChildren` is per PARENT and a root has none. Worth a test rather
    // than left to be discovered: a flat forest of hundreds is a real shape,
    // and this says plainly that it is not what the option covers.
    const forest = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, name: `Root ${i}` }))
    const chart = createKlad(tallHost(), {
      data: forest,
      layout: 'file',
      nodeSize: { w: 300, h: 26 },
      worker: false,
      maxChildren: 5,
      renderNode: (el, ctx) => (el.textContent = ctx.id),
    })
    await nextFrame()
    await settle()
    expect(laidOut(chart)).toBe(30)
    chart.destroy()
  })

  it('holds the parent still while the level explodes around it', async () => {
    // Clicking "+15 more" makes that level fifteen nodes wider. The node you
    // clicked from is the one place you want to still be looking at — and the
    // aggregate itself is no anchor, since lifting the cap removes it.
    //
    // `tidy` rather than the file layout used elsewhere here: a tidy parent is
    // centred over its children, so widening the level is exactly what moves
    // it. In a file list the rows below simply grow downward and the parent
    // never moves, pin or no pin.
    const el = document.createElement('div')
    el.style.width = '2200px'
    el.style.height = '700px'
    document.body.appendChild(el)
    const chart = createKlad(el, {
      data: WIDE,
      nodeSize: { w: 60, h: 34 },
      label: (item) => String(item.name ?? ''),
      worker: false,
      maxChildren: 5,
      renderNode: (e, ctx) => (e.textContent = ctx.id),
    })
    await nextFrame()
    await settle()

    const boxOf = (id: string) =>
      document.querySelector<HTMLElement>(`.klad-overlay-node[data-klad-id="${id}"]`)?.getBoundingClientRect() ??
      null
    const before = boxOf('r')!
    expect(before).not.toBeNull()

    chart.api.showMore('klad:more:r')
    await settleTransition()
    await settle()

    const after = boxOf('r')
    expect(after).not.toBeNull()
    expect(Math.abs(after!.left - before.left)).toBeLessThan(1.5)
    expect(Math.abs(after!.top - before.top)).toBeLessThan(1.5)
    chart.destroy()
    el.remove()
  })

  it('animates the level opening instead of snapping to it', async () => {
    // A cap lift is the same nodes at new positions, so it goes through
    // `animateNextLayout` like a drop does. Without the remap the engine sees
    // a fresh dataset — every node snaps, and the fifteen arriving ones have
    // no relationship to the five already there.
    //
    // `tidy` again rather than the file layout used elsewhere here: appending
    // rows to a list leaves the rows above exactly where they were, so there
    // is nothing to animate and nothing to measure. Widening a tier moves
    // every sibling.
    const el = document.createElement('div')
    el.style.width = '2200px'
    el.style.height = '700px'
    document.body.appendChild(el)
    const chart = createKlad(el, {
      data: WIDE,
      nodeSize: { w: 60, h: 34 },
      label: (item) => String(item.name ?? ''),
      worker: false,
      maxChildren: 5,
      renderNode: (e, ctx) => (e.textContent = ctx.id),
    })
    await nextFrame()
    await settle()
    const boxOf = (id: string) =>
      document.querySelector<HTMLElement>(`.klad-overlay-node[data-klad-id="${id}"]`)?.getBoundingClientRect() ??
      null

    const before = Math.round(boxOf('c0')!.left)
    chart.api.showMore('klad:more:r')
    const samples: number[] = []
    for (let i = 0; i < 30; i++) {
      await nextFrame()
      const at = boxOf('c0')
      if (at !== null) samples.push(Math.round(at.left))
    }
    await settleTransition()
    await settle()
    const settled = Math.round(boxOf('c0')!.left)

    // It genuinely moved.
    expect(Math.abs(settled - before)).toBeGreaterThan(100)
    // And it was caught somewhere in between — neither still at the start nor
    // already at the end. Snapping gives every sample the settled value; a
    // camera pinned against the SETTLED box rather than the interpolated one
    // gives the same, because it pans the whole distance on the first frame
    // while the nodes are still where they were.
    const lo = Math.min(before, settled)
    const hi = Math.max(before, settled)
    expect(samples.some((x) => x > lo && x < hi)).toBe(true)
    chart.destroy()
    el.remove()
  })

  it('re-reads the working set on refresh, which is how a pin lands', async () => {
    // `pinChildren` closes over a set the host mutates. Nothing about the
    // options object or the data changes when that set does, so `refresh` is
    // the only way in — and it has to re-plan rather than just re-measure,
    // because a cap is structure.
    const watching = new Set<string>()
    const chart = wide({
      maxChildren: 5,
      pinChildren: (item) => watching.has(String(item.id)),
    })
    await nextFrame()
    await settle()
    expect(onScreen()).not.toContain('c18')

    watching.add('c18')
    chart.api.refresh()
    await settleTransition()
    await settle()
    expect(onScreen()).toContain('c18')

    // And back out again — the same call in reverse.
    watching.delete('c18')
    chart.api.refresh()
    await settleTransition()
    await settle()
    expect(onScreen()).not.toContain('c18')
    chart.destroy()
  })

  it('holds the node you are working from while the level swaps around it', async () => {
    // Ticking somebody in a picker hung off an aggregate node swaps who is on
    // that level. Without a pin the level slides out from under the panel the
    // viewer is still reading — and the aggregate is the right anchor here,
    // unlike a `showMore`, because the cap stays on and so does the node.
    const watching = new Set<string>()
    const el = document.createElement('div')
    el.style.width = '2200px'
    el.style.height = '700px'
    document.body.appendChild(el)
    const chart = createKlad(el, {
      data: WIDE,
      nodeSize: { w: 60, h: 34 },
      label: (item) => String(item.name ?? ''),
      worker: false,
      maxChildren: 5,
      pinChildren: (item) => watching.has(String(item.id)),
      renderNode: (e, ctx) => (e.textContent = ctx.id),
    })
    await nextFrame()
    await settle()

    const boxOf = (id: string) =>
      document.querySelector<HTMLElement>(`.klad-overlay-node[data-klad-id="${id}"]`)?.getBoundingClientRect() ??
      null
    const before = boxOf('klad:more:r')!
    expect(before).not.toBeNull()

    // SIX pins against a cap of five, so the level genuinely widens. Pinning
    // one would swap it for one of the five and the level would be the same
    // width — which moves nothing, and would let this test pass with no pin
    // at all.
    for (const id of ['c14', 'c15', 'c16', 'c17', 'c18', 'c19']) watching.add(id)
    chart.api.refresh({ keep: 'klad:more:r' })
    await settleTransition()
    await settle()

    const after = boxOf('klad:more:r')
    expect(after).not.toBeNull()
    expect(Math.abs(after!.left - before.left)).toBeLessThan(1.5)
    // And the ticks landed: pins outnumber the cap, so all six are on.
    for (const id of ['c14', 'c19']) expect(onScreen()).toContain(id)
    chart.destroy()
    el.remove()
  })

  it('marks the one node a pin brings in, and swaps rather than widens', async () => {
    // With slots to spare, pinning somebody does not make the level bigger —
    // it takes a slot off whoever was last. That swap is a cross-fade in the
    // same place, which reads as "the whole thing re-rendered" rather than as
    // one node arriving. The ring is what says which node.
    const watching = new Set<string>()
    const chart = wide({
      maxChildren: 3,
      pinChildren: (item) => watching.has(String(item.id)),
    })
    await nextFrame()
    await settle()
    expect(laidOut(chart)).toBe(5) // root + three + the aggregate
    expect(onScreen()).toContain('c2')

    watching.add('c17')
    chart.api.refresh()
    await settleTransition()
    await settle()

    // Swapped, not widened: still three on the level, and the one that lost
    // its slot is the last of them.
    expect(laidOut(chart)).toBe(5)
    expect(onScreen()).toContain('c17')
    expect(onScreen()).not.toContain('c2')

    // Past the cap the pins win and the level grows instead.
    for (const id of ['c14', 'c15', 'c16']) watching.add(id)
    chart.api.refresh()
    await settleTransition()
    await settle()
    expect(laidOut(chart)).toBe(6) // root + four pins + the aggregate
    chart.destroy()
  })

  it('fades the card that lost its slot instead of dropping it', async () => {
    // The canvas has faded leaving nodes since 1.0, but the overlay never
    // heard about them — they are not in `visible` and never will be. So the
    // old card blinked out on the first frame while the new one faded in, and
    // a swap in one slot read as the whole chart re-rendering.
    const watching = new Set<string>()
    const chart = wide({
      maxChildren: 3,
      pinChildren: (item) => watching.has(String(item.id)),
    })
    await nextFrame()
    await settle()
    expect(onScreen()).toContain('c2')

    const alphaOf = (id: string) => {
      const el = document.querySelector<HTMLElement>(`.klad-overlay-node[data-klad-id="${id}"]`)
      if (el === null) return null
      return el.style.opacity === '' ? 1 : Number(el.style.opacity)
    }

    watching.add('c17')
    chart.api.refresh()

    // c2 lost its slot. For several frames it is still there and on its way
    // out, rather than gone between one frame and the next.
    let sawFading = false
    for (let i = 0; i < 12; i++) {
      await nextFrame()
      const a = alphaOf('c2')
      if (a !== null && a > 0 && a < 1) sawFading = true
    }
    await settleTransition()
    await settle()

    expect(sawFading).toBe(true)
    // And it is gone once the transition ends.
    expect(alphaOf('c2')).toBeNull()
    expect(onScreen()).toContain('c17')
    chart.destroy()
  })

  it('fades the leaving card in worker mode too', async () => {
    // The ghosts cross `postMessage` as three more arrays on the frame
    // message. Every other test for them runs the engine in-process, which is
    // exactly the half that cannot tell whether the wire carries them.
    const watching = new Set<string>()
    const chart = createKlad(tallHost(), {
      data: WIDE,
      layout: 'file',
      nodeSize: { w: 300, h: 26 },
      rowGap: 4,
      label: (item) => String(item.name ?? ''),
      worker: true,
      maxChildren: 3,
      pinChildren: (item) => watching.has(String(item.id)),
      renderNode: (el, ctx) => (el.textContent = ctx.id),
    })
    await nextFrame()
    await settle()
    await settle()
    expect(onScreen()).toContain('c2')

    const alphaOf = (id: string) => {
      const el = document.querySelector<HTMLElement>(`.klad-overlay-node[data-klad-id="${id}"]`)
      if (el === null) return null
      return el.style.opacity === '' ? 1 : Number(el.style.opacity)
    }

    watching.add('c17')
    chart.api.refresh()
    let leaving = false
    let arriving = false
    // Across the WHOLE transition: the departure rides phase one and the
    // arrival phase two, so a window that only covers the first half sees one
    // of them and calls the other broken.
    for (let i = 0; i < 40; i++) {
      await nextFrame()
      const gone = alphaOf('c2')
      const came = alphaOf('c17')
      if (gone !== null && gone > 0 && gone < 1) leaving = true
      if (came !== null && came > 0 && came < 1) arriving = true
    }
    await settleTransition()
    await settle()
    expect({ leaving, arriving }).toEqual({ leaving: true, arriving: true })
    chart.destroy()
  })

  it('does nothing without a cap', async () => {
    const chart = wide()
    await nextFrame()
    await settle()
    expect(laidOut(chart)).toBe(21)
    expect(onScreen().some((id) => id.startsWith('klad:more:'))).toBe(false)
    chart.destroy()
  })
})

describe('the wheels, with the 1.5 masks', () => {
  // Enough breadth that a cap has something to do on a ring.
  const WHEEL = [
    { id: 'w', name: 'Hub' },
    ...Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, parentId: 'w', name: `Slice ${i}` })),
    ...Array.from({ length: 6 }, (_, i) => ({ id: `s0-${i}`, parentId: 's0', name: `Leaf ${i}` })),
  ]

  function wheel(overrides: Partial<Options> = {}) {
    return createKlad(host(), {
      data: WHEEL,
      label: (item) => String(item.name ?? ''),
      worker: false,
      ...overrides,
    })
  }

  for (const layout of ['sunburst', 'radial'] as const) {
    it(`filters a ${layout} without leaving it mid-animation`, async () => {
      // A filter is a hard cut, like `isolate`: the nodes that leave have
      // nowhere to animate FROM. On a wheel that matters more than on a tier,
      // because the polar transition tweens four numbers per node and a stale
      // one describes an arc that never existed.
      const chart = wheel({ layout })
      await nextFrame()
      await settle()

      const matched = chart.api.filter('Leaf 3')
      await settleTransition()
      await settle()

      expect(matched).toEqual(['s0-3'])
      // Three nodes left: the hub, s0, and the match. The DISC does not
      // shrink — a wheel's radius follows its ring count, not how many
      // segments are on each ring — which is exactly why the count, and not
      // the bounds, is the thing that says a filter worked here.
      expect(chart.api.getState().visibleCount).toBe(3)

      chart.api.filter(null)
      await settleTransition()
      await settle()
      expect(chart.api.getState().visibleCount).toBe(19)
      chart.destroy()
    })

    it(`caps a ${layout} ring and still reaches what fell off it`, async () => {
      const chart = wheel({ layout, maxChildren: 4 })
      await nextFrame()
      await settle()
      // The hub keeps four slices plus one node for the other eight; s0 is
      // among the four and keeps four of its six leaves plus one more node.
      expect(chart.api.getState().visibleCount).toBe(11)

      // Reaching one that fell off the ring works the same as anywhere else.
      const capped = chart.api.getState().visibleCount
      const rows = () =>
        [...document.querySelectorAll('[role="treeitem"]')].map((r) => r.getAttribute('data-orgchart-id'))
      expect(rows()).not.toContain('s11')

      chart.api.focus('s11')
      await settleTransition()
      await settle()

      // Revealing SWAPS rather than adds: the cap is a budget, and the one
      // you asked for takes a slot from it — same as a pin does. So the count
      // is unchanged and membership is the thing to assert.
      expect(rows()).toContain('s11')
      expect(chart.api.getState().visibleCount).toBe(capped)
      chart.destroy()
    })
  }

  it('marks a sunburst segment whose children have not been fetched', async () => {
    // The wheel's own "more inside" mark is an arc just inside the segment,
    // and an unfetched branch has to earn it the same way a collapsed one
    // does — this is the layout the mark was originally built for.
    const chart = wheel({
      layout: 'sunburst',
      data: [
        { id: 'w', name: 'Hub' },
        { id: 'a', parentId: 'w', name: 'A', kids: 3 },
        { id: 'b', parentId: 'w', name: 'B', kids: 0 },
      ],
      mayHaveChildren: (item) => Number(item.kids ?? 0) > 0,
      loadChildren: () => [{ id: 'a1', name: 'A1' }],
    })
    await nextFrame()
    await settle()
    // `h` is the sunburst's inner-arc mark — see render/svg.ts.
    expect(chart.api.toSVG()).toContain('class="h"')
    chart.destroy()
  })
})

describe('where a node sits', () => {
  // a -> b -> d, and a -> c. So `d` is the only node at depth 2, and `b`/`c`
  // are the only pair of siblings — enough to tell every field apart.
  type Seen = { id: string; depth: number; index: number; siblings: number; parent: string | null }
  const record = (into: Seen[]) => (item: NodeData, at: NodePlace) => {
    into.push({
      id: String(item.id),
      depth: at.depth,
      index: at.index,
      siblings: at.siblings,
      parent: at.parent === null ? null : String(at.parent.id),
    })
    return String(item.name ?? '')
  }
  const of = (seen: Seen[], id: string) => seen.find((s) => s.id === id)!

  it('tells label and nodeSize the depth, the sibling slot and the parent', async () => {
    const seen: Seen[] = []
    const sized: Seen[] = []
    const chart = make({
      label: record(seen),
      nodeSize: (item: NodeData, at: NodePlace) => {
        record(sized)(item, at)
        return { w: 120, h: 48 }
      },
    })
    await nextFrame()
    await settle()

    expect(of(seen, 'a')).toEqual({ id: 'a', depth: 0, index: 0, siblings: 1, parent: null })
    expect(of(seen, 'b')).toEqual({ id: 'b', depth: 1, index: 0, siblings: 2, parent: 'a' })
    expect(of(seen, 'c')).toEqual({ id: 'c', depth: 1, index: 1, siblings: 2, parent: 'a' })
    expect(of(seen, 'd')).toEqual({ id: 'd', depth: 2, index: 0, siblings: 1, parent: 'b' })
    // Both options are told the same thing about the same node.
    expect(of(sized, 'd')).toEqual(of(seen, 'd'))
    chart.destroy()
  })

  it('carries what the label made of it all the way to search', async () => {
    const chart = make({ label: (item: NodeData, at: NodePlace) => `${item.name}@${at.depth}` })
    await nextFrame()
    await settle()

    // `search` resolves labels through the same resolver the canvas draws
    // with, so a depth the label used has to survive that far or the chart
    // would find something different from what it shows.
    expect(chart.api.search('Leaf@2').map((r) => r.id)).toEqual(['d'])
    expect(chart.api.search('@1').map((r) => r.id)).toEqual(['b', 'c'])
    chart.destroy()
  })

  it('orders roots against each other', async () => {
    const seen: Seen[] = []
    const chart = createKlad(host(), {
      data: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3', parentId: 'r1' }],
      nodeSize: { w: 120, h: 48 },
      label: record(seen),
      worker: false,
    })
    await nextFrame()
    await settle()

    expect(of(seen, 'r1')).toEqual({ id: 'r1', depth: 0, index: 0, siblings: 2, parent: null })
    expect(of(seen, 'r2')).toEqual({ id: 'r2', depth: 0, index: 1, siblings: 2, parent: null })
    chart.destroy()
  })

  it('does not change when a branch is folded away', async () => {
    const seen: Seen[] = []
    const chart = make({ label: record(seen) })
    await nextFrame()
    await settle()
    const before = of(seen, 'd')
    expect(before.depth).toBe(2)

    chart.api.collapse('b')
    await settleTransition()
    seen.length = 0
    chart.api.refresh()
    await settle()

    // `d` is behind a collapsed parent and off screen — but its place in the
    // data has not moved, and an option told otherwise would give a different
    // answer the moment the branch came back.
    expect(of(seen, 'd')).toEqual(before)
    expect(of(seen, 'd').parent).toBe('b')
    chart.destroy()
  })

  it('counts siblings in the data, not the ones a filter left standing', async () => {
    const seen: Seen[] = []
    const chart = make({ label: record(seen) })
    await nextFrame()
    await settle()

    chart.api.filter('Left')
    await settleTransition()
    seen.length = 0
    chart.api.toSVG()

    // The export walks the PRUNED tree, where `b` is the only child left. Its
    // sibling slot is still one of two.
    expect(of(seen, 'b')).toEqual({ id: 'b', depth: 1, index: 0, siblings: 2, parent: 'a' })
    chart.destroy()
  })

  it('tells collapsedByDefault the depth, including for rows a load brought in', async () => {
    const seen: Seen[] = []
    const chart = createKlad(host(), {
      data: [
        { id: 'a', name: 'Root' },
        { id: 'b', parentId: 'a', name: 'Branch', childCount: 1 },
      ],
      nodeSize: { w: 120, h: 48 },
      label: (item) => String(item.name ?? ''),
      worker: false,
      mayHaveChildren: (item) => Number(item.childCount ?? 0) > 0,
      loadChildren: () => [{ id: 'b1', name: 'Fetched', childCount: 1 }],
      // Everything from depth 2 down starts folded.
      collapsedByDefault: (item: NodeData, at: NodePlace) => {
        seen.push({
          id: String(item.id),
          depth: at.depth,
          index: at.index,
          siblings: at.siblings,
          parent: at.parent === null ? null : String(at.parent.id),
        })
        return at.depth >= 2
      },
    })
    await nextFrame()
    await settle()
    expect(of(seen, 'b').depth).toBe(1)

    seen.length = 0
    chart.api.expand('b')
    await settleTransition()
    await settle()

    // The row `loadChildren` returned is in no array the host holds, so its
    // depth is the one thing the host could not have worked out itself.
    expect(of(seen, 'b1')).toEqual({ id: 'b1', depth: 2, index: 0, siblings: 1, parent: 'b' })
    // And the answer was acted on: at depth 2 it starts folded.
    expect(chart.api.getView().open).not.toContain('b1')
    chart.destroy()
  })

  it('tells mayHaveChildren the depth', async () => {
    const depths = new Map<string, number>()
    const chart = make({
      loadChildren: () => [],
      mayHaveChildren: (item: NodeData, at: NodePlace) => {
        depths.set(String(item.id), at.depth)
        return at.depth < 2
      },
    })
    await nextFrame()
    await settle()

    // Only the childless nodes are asked — `c` at depth 1 and `d` at depth 2.
    expect(depths.get('c')).toBe(1)
    expect(depths.get('d')).toBe(2)
    // The answer was acted on. A node waiting to be fetched starts CLOSED
    // whatever else says otherwise, so `c` — which said yes at depth 1 — is
    // not open, while `d`, a plain leaf at depth 2, is.
    const open = chart.api.getView().open
    expect(open).not.toContain('c')
    expect(open).toContain('d')
    chart.destroy()
  })

  it('tells pinChildren its slot among its siblings, before there is a tree', async () => {
    const seen: Seen[] = []
    const kids = Array.from({ length: 10 }, (_, i) => ({
      id: `k${i}`,
      parentId: 'b',
      name: `Kid ${i}`,
    }))
    // Tall, narrow and indented, so every row is on screen at once and "is
    // this drawn" is a question about the cap rather than about the camera.
    const el = document.createElement('div')
    el.style.width = '600px'
    el.style.height = '1400px'
    document.body.appendChild(el)
    const chart = createKlad(el, {
      data: [{ id: 'a', name: 'Root' }, { id: 'b', parentId: 'a', name: 'Branch' }, ...kids],
      layout: 'file',
      nodeSize: { w: 300, h: 26 },
      label: (item) => String(item.name ?? ''),
      worker: false,
      renderNode: (node: HTMLElement, ctx: NodeContext) => {
        node.textContent = String(ctx.item.name ?? '')
      },
      maxChildren: 3,
      // Pin the last one. Reachable only through the slot, which is the whole
      // point: `planOverflow` runs before `normalize`, so this is the one
      // place the position cannot be read off a tree.
      pinChildren: (item: NodeData, at: NodePlace) => {
        seen.push({
          id: String(item.id),
          depth: at.depth,
          index: at.index,
          siblings: at.siblings,
          parent: at.parent === null ? null : String(at.parent.id),
        })
        return at.index === at.siblings - 1
      },
    })
    await nextFrame()
    await settle()

    expect(of(seen, 'k0')).toEqual({ id: 'k0', depth: 2, index: 0, siblings: 10, parent: 'b' })
    expect(of(seen, 'k9')).toEqual({ id: 'k9', depth: 2, index: 9, siblings: 10, parent: 'b' })
    // The pin landed: the last kid is drawn even though the cap of 3 would
    // have stopped at `k2`.
    const shown = [...document.querySelectorAll<HTMLElement>('.klad-overlay-node')].map(
      (node) => node.dataset.kladId!,
    )
    expect(shown).toContain('k9')
    expect(shown).not.toContain('k5')
    chart.destroy()
  })
})

describe('the connector style, chosen on its own', () => {
  it('overrides what the layout would have picked, in the canvas and the export', async () => {
    const plain = make({})
    await nextFrame()
    await settle()
    // `tidy` asks for elbows, and an elbow is a path with bends in it.
    expect(plain.api.toSVG()).toContain('<path')
    plain.destroy()

    const bare = make({ edgeStyle: 'none' })
    await nextFrame()
    await settle()
    const svg = bare.api.toSVG()
    // Nothing joins the nodes any more. The cards are still there.
    expect(svg).not.toContain('<path')
    expect(svg).toContain('<rect')
    bare.destroy()
  })

  it('keeps the “more inside” mark on a tiered chart with no connectors', async () => {
    // The gap this option opens up. `hiddenStub` used to answer `null` for
    // `'none'`, which was right while `'none'` could only mean a sunburst —
    // that draws its own inner arc. On a tidy chart it would delete the only
    // thing saying a collapsed branch has anything in it.
    const chart = make({ edgeStyle: 'none', collapsedByDefault: true })
    await nextFrame()
    await settle()
    // `hs` is the stub and `hd` its dot — the rectangular mark. (`h` is the
    // wheel's arc, which is a different thing entirely.)
    const svg = chart.api.toSVG()
    expect(svg).toContain('class="hs"')
    expect(svg).toContain('class="hd"')
    chart.destroy()
  })

  it('still lets the file layout drop that mark, which is a judgement not a bug', async () => {
    const chart = make({ layout: 'file', collapsedByDefault: true })
    await nextFrame()
    await settle()
    // A file row has a chevron beside its name; a stub would say it twice.
    expect(chart.api.toSVG()).not.toContain('class="hs"')
    chart.destroy()
  })

  it('rebuilds the edge index when the style changes, not just the paint', async () => {
    // `'none'` skips building the index and its whole quadtree, so coming back
    // from it has to build one — a repaint alone would leave the chart with no
    // connectors and no way to get them back.
    const chart = make({ edgeStyle: 'none' })
    await nextFrame()
    await settle()
    expect(chart.api.toSVG()).not.toContain('<path')

    chart.api.setLayoutOptions({ edgeStyle: 'tiered' })
    await settleTransition()
    await settle()
    expect(chart.api.toSVG()).toContain('<path')
    chart.destroy()
  })
})

describe('editing the shape', () => {
  const parentOf = (chart: ReturnType<typeof createKlad>, id: string) => {
    const path = chart.api.pathTo(id)
    return path === null || path.length < 2 ? null : path.at(-2)!
  }
  const childIds = (chart: ReturnType<typeof createKlad>, parent: string | null) =>
    chart.api
      .getData()
      .filter((item) => (item.parentId ?? null) === parent)
      .map((item) => String(item.id))

  it('moves a node under a new parent, at the slot asked for', async () => {
    const chart = make({})
    await nextFrame()
    await settle()

    expect(chart.api.move('d', 'c')).toBe(true)
    await settleTransition()
    expect(parentOf(chart, 'd')).toBe('c')

    // Ahead of `b` this time, rather than appended.
    expect(chart.api.move('d', 'a', 0)).toBe(true)
    await settleTransition()
    expect(childIds(chart, 'a')).toEqual(['d', 'b', 'c'])
    chart.destroy()
  })

  it('refuses a move that would not leave a tree', async () => {
    const chart = make({})
    await nextFrame()
    await settle()

    // `d` is under `b`. Moving `b` into it would make a cycle.
    expect(chart.api.move('b', 'd')).toBe(false)
    // And into itself, which is the same test's degenerate case.
    expect(chart.api.move('b', 'b')).toBe(false)
    expect(chart.api.move('nobody', 'a')).toBe(false)
    expect(chart.api.move('b', 'nobody')).toBe(false)
    // Nothing moved.
    expect(parentOf(chart, 'b')).toBe('a')
    expect(parentOf(chart, 'd')).toBe('b')
    chart.destroy()
  })

  it('adds a row, and refuses one whose id is already taken', async () => {
    const chart = make({})
    await nextFrame()
    await settle()

    expect(chart.api.add({ id: 'e', name: 'New' }, 'c')).toBe(true)
    await settleTransition()
    expect(parentOf(chart, 'e')).toBe('c')
    // A first child goes in after its own parent, not at the head of the
    // array — `getData()` is something a host reads.
    const rows = chart.api.getData().map((item) => String(item.id))
    expect(rows.indexOf('e')).toBeGreaterThan(rows.indexOf('c'))

    expect(chart.api.add({ id: 'e' }, 'a')).toBe(false)
    expect(chart.api.add([{ id: 'f' }, { id: 'f' }], 'a')).toBe(false)
    expect(chart.api.add({ id: 'g' }, 'nobody')).toBe(false)
    expect(chart.api.getData().filter((item) => item.id === 'f')).toHaveLength(0)
    chart.destroy()
  })

  it('removes a node and everything below it', async () => {
    const chart = make({})
    await nextFrame()
    await settle()
    expect(chart.api.stats('d')).not.toBeNull()

    expect(chart.api.remove('b')).toBe(true)
    await settleTransition()

    // `d` went with `b`. Left behind it would have become a root, which is a
    // bigger change to the shape than the one asked for.
    expect(chart.api.stats('b')).toBeNull()
    expect(chart.api.stats('d')).toBeNull()
    expect(chart.api.stats('c')).not.toBeNull()
    expect(chart.api.remove('gone')).toBe(false)
    chart.destroy()
  })

  it('keeps the branches you had open', async () => {
    const chart = make({})
    await nextFrame()
    await settle()
    chart.api.collapse('b')
    await settleTransition()

    chart.api.move('c', 'a', 0)
    await settleTransition()

    // `b` is still folded; the move is not a reason to unfold it. The node's
    // NEW parent is opened, which is the one change an edit is entitled to.
    expect(chart.api.getView().open).not.toContain('b')
    expect(chart.api.getView().open).toContain('a')
    chart.destroy()
  })

  it('will not touch the node a capped level invented', async () => {
    const kids = Array.from({ length: 8 }, (_, i) => ({ id: `k${i}`, parentId: 'a', name: `K${i}` }))
    const chart = createKlad(host(), {
      data: [{ id: 'a', name: 'Root' }, ...kids],
      nodeSize: { w: 120, h: 48 },
      label: (item) => String(item.name ?? ''),
      worker: false,
      maxChildren: 3,
    })
    await nextFrame()
    await settle()

    // The chart's own bookkeeping — see `maxChildren`. It is a real node in
    // the tree, which is why every one of these has to say no on purpose.
    const aggregate = 'klad:more:a'
    expect(chart.api.stats(aggregate)).not.toBeNull()

    expect(chart.api.move(aggregate, null)).toBe(false)
    expect(chart.api.move('k0', aggregate)).toBe(false)
    expect(chart.api.remove(aggregate)).toBe(false)
    expect(chart.api.add({ id: 'new' }, aggregate)).toBe(false)
    // And it is not handed back as data, because it is in nobody's store.
    expect(chart.api.getData().some((item) => String(item.id) === aggregate)).toBe(false)
    chart.destroy()
  })
})

describe('reconcile', () => {
  const rows = () => [
    { id: 'a', name: 'Root' },
    { id: 'b', parentId: 'a', name: 'Left' },
    { id: 'c', parentId: 'a', name: 'Right' },
    { id: 'd', parentId: 'b', name: 'Leaf' },
  ]

  it('keeps where the viewer is, which is the whole point of it', async () => {
    const chart = make({})
    await nextFrame()
    await settle()

    chart.api.collapse('b')
    await settleTransition()
    chart.api.select(['c'])
    chart.api.highlight(['a'])
    const before = chart.api.getState().camera

    // The poll came back with one new person under `c`.
    chart.api.reconcile([...rows(), { id: 'e', parentId: 'c', name: 'New' }])
    await settleTransition()
    await settle()

    expect(chart.api.stats('e')).not.toBeNull()
    // `b` is still folded. `update` would have opened it.
    expect(chart.api.getView().open).not.toContain('b')
    expect(chart.api.getState().selected).toEqual(['c'])
    expect(chart.api.getState().highlighted).toEqual(['a'])
    expect(chart.api.getState().camera).toEqual(before)
    chart.destroy()
  })

  it('is the thing update is not', async () => {
    const chart = make({})
    await nextFrame()
    await settle()
    chart.api.collapse('b')
    await settleTransition()

    // Same data, the other door. `update` means "a different tree", so it
    // starts the expand state over — which is correct for it and is exactly
    // why `reconcile` had to be a separate call rather than a change to it.
    chart.update(rows())
    await settleTransition()
    expect(chart.api.getView().open).toContain('b')
    chart.destroy()
  })

  it('starts a new row the way data would have', async () => {
    const chart = make({ collapsedByDefault: (_item: NodeData, at: NodePlace) => at.depth >= 2 })
    await nextFrame()
    await settle()

    chart.api.reconcile([
      ...rows(),
      { id: 'e', parentId: 'c', name: 'New' },
      { id: 'f', parentId: 'e', name: 'Deep' },
    ])
    await settleTransition()

    // `e` sits at depth 2, so the option closes it — a reconcile that
    // defaulted arrivals to open would override the option on every poll.
    expect(chart.api.getView().open).not.toContain('e')
    expect(chart.api.getView().open).toContain('c')
    chart.destroy()
  })

  it('keeps a lazily-fetched branch, which data never described', async () => {
    const chart = createKlad(host(), {
      data: [
        { id: 'a', name: 'Root' },
        { id: 'b', parentId: 'a', name: 'Branch', childCount: 1 },
      ],
      nodeSize: { w: 120, h: 48 },
      label: (item) => String(item.name ?? ''),
      worker: false,
      mayHaveChildren: (item) => Number(item.childCount ?? 0) > 0,
      loadChildren: () => [{ id: 'b1', name: 'Fetched' }],
    })
    await nextFrame()
    await settle()
    chart.api.expand('b')
    await settleTransition()
    await settle()
    expect(chart.api.stats('b1')).not.toBeNull()

    chart.api.reconcile([
      { id: 'a', name: 'Root' },
      { id: 'b', parentId: 'a', name: 'Branch renamed', childCount: 1 },
      { id: 'c', parentId: 'a', name: 'Arrived' },
    ])
    await settleTransition()
    await settle()

    // Still there. Dropping it would collapse every lazily-opened branch on
    // every poll — on exactly the trees that need reconciling most.
    expect(chart.api.stats('b1')).not.toBeNull()
    expect(chart.api.stats('c')).not.toBeNull()
    chart.destroy()
  })

  it('gives the fetched copy up when the data claims the same row', async () => {
    const chart = createKlad(host(), {
      data: [
        { id: 'a', name: 'Root' },
        { id: 'b', parentId: 'a', name: 'Branch', childCount: 1 },
      ],
      nodeSize: { w: 120, h: 48 },
      label: (item) => String(item.name ?? ''),
      worker: false,
      mayHaveChildren: (item) => Number(item.childCount ?? 0) > 0,
      loadChildren: () => [{ id: 'b1', name: 'Fetched' }],
    })
    const warnings: string[] = []
    chart.on('warning', (w) => warnings.push(w.code))
    await nextFrame()
    await settle()
    chart.api.expand('b')
    await settleTransition()
    await settle()

    // The server now sends `b1` itself. Keeping both copies would be a
    // duplicate id, which is the one thing normalize cannot make sense of.
    chart.api.reconcile([
      { id: 'a', name: 'Root' },
      { id: 'b', parentId: 'a', name: 'Branch', childCount: 1 },
      { id: 'b1', parentId: 'b', name: 'Authoritative' },
    ])
    await settleTransition()
    await settle()

    expect(warnings).not.toContain('duplicate-id')
    expect(chart.api.getData().filter((item) => item.id === 'b1')).toHaveLength(1)
    expect(chart.api.getData().find((item) => item.id === 'b1')!.name).toBe('Authoritative')
    chart.destroy()
  })

  it('drops fetched children whose parent left', async () => {
    const chart = createKlad(host(), {
      data: [
        { id: 'a', name: 'Root' },
        { id: 'b', parentId: 'a', name: 'Branch', childCount: 1 },
      ],
      nodeSize: { w: 120, h: 48 },
      label: (item) => String(item.name ?? ''),
      worker: false,
      mayHaveChildren: (item) => Number(item.childCount ?? 0) > 0,
      loadChildren: () => [{ id: 'b1', name: 'Fetched' }],
    })
    const warnings: string[] = []
    chart.on('warning', (w) => warnings.push(w.code))
    await nextFrame()
    await settle()
    chart.api.expand('b')
    await settleTransition()
    await settle()

    // `b` is gone. Its fetched children would be left claiming a parent that
    // is not there — a warning and a fistful of surprise roots.
    chart.api.reconcile([{ id: 'a', name: 'Root' }])
    await settleTransition()
    await settle()

    expect(chart.api.stats('b1')).toBeNull()
    expect(warnings).toHaveLength(0)
    chart.destroy()
  })
})

describe('isolate survives the tree being rebuilt', () => {
  // `isolatedIndex` is a SOURCE index, and a source index means nothing across
  // a `normalize` — the same hazard `buildFilterMask`'s docblock describes for
  // the filter mask, which is re-run for exactly this reason. Nothing was
  // re-deriving this one.
  it('still points at the node you isolated after an edit', async () => {
    const chart = make({})
    await nextFrame()
    await settle()

    chart.api.isolate('b')
    await settleTransition()
    expect(chart.api.getState().isolated).toBe('b')

    // Any edit renormalizes, and `b` need not land on the same index.
    chart.api.add({ id: 'z', name: 'First' }, 'a', 0)
    await settleTransition()
    await settle()

    expect(chart.api.getState().isolated).toBe('b')
    // And the chart really is still showing that branch, not whatever now
    // sits at the old index.
    expect(chart.api.stats('d')).not.toBeNull()
    chart.destroy()
  })

  it('still points at it after a reconcile', async () => {
    const chart = make({})
    await nextFrame()
    await settle()
    chart.api.isolate('c')
    await settleTransition()

    chart.api.reconcile([
      { id: 'z', name: 'New root child' },
      { id: 'a', name: 'Root' },
      { id: 'b', parentId: 'a', name: 'Left' },
      { id: 'c', parentId: 'a', name: 'Right' },
      { id: 'd', parentId: 'b', name: 'Leaf' },
    ])
    await settleTransition()
    await settle()

    expect(chart.api.getState().isolated).toBe('c')
    // A plain sanity check that the chart is still drawing. Worth saying what
    // it does NOT do: reconciling while isolated used to crash the engine's
    // transition builder (see `toNewSource` there), and that surfaces as an
    // unhandled rejection inside the worker host rather than as a failed
    // assertion here — the frame still arrives, empty or not. What catches a
    // regression is vitest failing the run on the unhandled error, which it
    // does; this line is not standing in for that.
    expect(chart.api.getState().visibleCount).toBeGreaterThan(0)
    chart.destroy()
  })

  it('lets go when the node it was pointing at leaves', async () => {
    const chart = make({})
    await nextFrame()
    await settle()
    chart.api.isolate('b')
    await settleTransition()

    chart.api.remove('b')
    await settleTransition()
    await settle()

    // Nothing to isolate any more. Holding a stale index would show an
    // arbitrary branch and report somebody else's id for it.
    expect(chart.api.getState().isolated).toBeNull()
    expect(chart.api.stats('c')).not.toBeNull()
    chart.destroy()
  })
})

describe('history', () => {
  const parentOf = (chart: ReturnType<typeof createKlad>, id: string) => {
    const path = chart.api.pathTo(id)
    return path === null || path.length < 2 ? null : path.at(-2)!
  }
  const childIds = (chart: ReturnType<typeof createKlad>, parent: string | null) =>
    chart.api
      .getData()
      .filter((item) => (item.parentId ?? null) === parent)
      .map((item) => String(item.id))

  it('walks a move back and forward again', async () => {
    const chart = make({})
    await nextFrame()
    await settle()

    chart.api.move('d', 'c')
    await settleTransition()
    expect(parentOf(chart, 'd')).toBe('c')
    expect(chart.api.canUndo()).toBe(true)

    expect(chart.api.undo()).toBe(true)
    await settleTransition()
    expect(parentOf(chart, 'd')).toBe('b')
    expect(chart.api.canUndo()).toBe(false)
    expect(chart.api.canRedo()).toBe(true)

    expect(chart.api.redo()).toBe(true)
    await settleTransition()
    expect(parentOf(chart, 'd')).toBe('c')
    expect(chart.api.undo()).toBe(true)
    await settleTransition()
    expect(chart.api.undo()).toBe(false)
    chart.destroy()
  })

  it('puts each of a batch back with its OWN parent', async () => {
    // The reason a record cannot hold one "back": `b` and `d` come from
    // different places, so undoing the set is not one move.
    const chart = make({})
    await nextFrame()
    await settle()
    expect(parentOf(chart, 'b')).toBe('a')
    expect(parentOf(chart, 'd')).toBe('b')

    chart.api.move(['c', 'd'], 'a')
    await settleTransition()
    expect(parentOf(chart, 'd')).toBe('a')

    chart.api.undo()
    await settleTransition()
    expect(parentOf(chart, 'c')).toBe('a')
    expect(parentOf(chart, 'd')).toBe('b')
    chart.destroy()
  })

  it('restores the slot, not just the parent', async () => {
    const chart = make({})
    await nextFrame()
    await settle()
    expect(childIds(chart, 'a')).toEqual(['b', 'c'])

    chart.api.move('b', 'a', 2)
    await settleTransition()
    expect(childIds(chart, 'a')).toEqual(['c', 'b'])

    chart.api.undo()
    await settleTransition()
    // Back where it was among its siblings — an inverse built from an index
    // rather than from the sibling it followed would not manage this.
    expect(childIds(chart, 'a')).toEqual(['b', 'c'])
    chart.destroy()
  })

  it('brings a removed subtree back whole', async () => {
    const chart = make({})
    await nextFrame()
    await settle()

    chart.api.remove('b')
    await settleTransition()
    expect(chart.api.stats('b')).toBeNull()
    expect(chart.api.stats('d')).toBeNull()

    chart.api.undo()
    await settleTransition()
    expect(chart.api.stats('b')).not.toBeNull()
    expect(parentOf(chart, 'd')).toBe('b')
    expect(childIds(chart, 'a')).toEqual(['b', 'c'])
    chart.destroy()
  })

  it('takes an added node away again', async () => {
    const chart = make({})
    await nextFrame()
    await settle()

    chart.api.add({ id: 'e', name: 'New' }, 'c')
    await settleTransition()
    expect(chart.api.stats('e')).not.toBeNull()

    chart.api.undo()
    await settleTransition()
    expect(chart.api.stats('e')).toBeNull()
    chart.api.redo()
    await settleTransition()
    expect(chart.api.stats('e')).not.toBeNull()
    chart.destroy()
  })

  it('records a drag, because that is an edit like any other', async () => {
    const chart = make({ dragAndDrop: true })
    await nextFrame()
    await settle()
    expect(chart.api.canUndo()).toBe(false)

    // Through the same door the pointer uses.
    chart.api.move('d', 'c')
    await settleTransition()
    expect(chart.api.changes()).toEqual([{ op: 'move', ids: ['d'], parentId: 'c', index: 0 }])
    chart.destroy()
  })

  it('drops the redo branch once you do something else', async () => {
    const chart = make({})
    await nextFrame()
    await settle()

    chart.api.move('d', 'c')
    await settleTransition()
    chart.api.undo()
    await settleTransition()
    expect(chart.api.canRedo()).toBe(true)

    chart.api.add({ id: 'e' }, 'a')
    await settleTransition()
    // That future no longer follows from here.
    expect(chart.api.canRedo()).toBe(false)
    chart.destroy()
  })

  it('keeps only as many as asked, and forgets the oldest', async () => {
    const chart = make({ history: 2 })
    await nextFrame()
    await settle()

    chart.api.add({ id: 'x' }, 'a')
    chart.api.add({ id: 'y' }, 'a')
    chart.api.add({ id: 'z' }, 'a')
    await settleTransition()

    expect(chart.api.undo()).toBe(true)
    expect(chart.api.undo()).toBe(true)
    expect(chart.api.undo()).toBe(false)
    await settleTransition()
    // The first one is past the window, so it stays.
    expect(chart.api.stats('x')).not.toBeNull()
    expect(chart.api.stats('y')).toBeNull()
    chart.destroy()
  })

  it('keeps none at all when told not to', async () => {
    const chart = make({ history: false })
    await nextFrame()
    await settle()

    chart.api.move('d', 'c')
    await settleTransition()
    expect(chart.api.canUndo()).toBe(false)
    expect(chart.api.undo()).toBe(false)
    expect(chart.api.changes()).toEqual([])
    expect(chart.api.isDirty()).toBe(false)
    // The edit itself still happened.
    expect(parentOf(chart, 'd')).toBe('c')
    chart.destroy()
  })

  it('says what to send, and stops saying it once you have', async () => {
    const chart = make({})
    await nextFrame()
    await settle()
    expect(chart.api.isDirty()).toBe(false)

    chart.api.move('d', 'c')
    chart.api.add({ id: 'e', name: 'New' }, 'a')
    await settleTransition()

    expect(chart.api.isDirty()).toBe(true)
    const changes = chart.api.changes()
    expect(changes).toHaveLength(2)
    expect(changes[0]).toEqual({ op: 'move', ids: ['d'], parentId: 'c', index: 0 })
    expect(changes[1]!.op).toBe('add')

    chart.api.markSaved()
    expect(chart.api.isDirty()).toBe(false)
    expect(chart.api.changes()).toEqual([])
    // Saving does not cost you the ability to undo.
    expect(chart.api.canUndo()).toBe(true)

    chart.api.undo()
    await settleTransition()
    expect(chart.api.isDirty()).toBe(true)
    chart.destroy()
  })

  it('forgets everything when somebody else describes the tree', async () => {
    const chart = make({})
    await nextFrame()
    await settle()
    chart.api.move('d', 'c')
    await settleTransition()
    expect(chart.api.canUndo()).toBe(true)

    chart.api.reconcile([
      { id: 'a', name: 'Root' },
      { id: 'b', parentId: 'a', name: 'Left' },
      { id: 'c', parentId: 'a', name: 'Right' },
      { id: 'd', parentId: 'c', name: 'Leaf' },
    ])
    await settleTransition()

    // Undoing now would take the data somewhere neither the viewer nor the
    // server asked for.
    expect(chart.api.canUndo()).toBe(false)
    expect(chart.api.isDirty()).toBe(false)
    chart.destroy()
  })
})

describe('editing, where it meets the rest', () => {
  it('moves correctly into a parent whose level is capped', async () => {
    // The index a move lands at counts REAL children, and a capped parent
    // draws eight of forty. If the two were ever confused, "put it third"
    // would land wherever the third drawn child happens to be.
    const kids = Array.from({ length: 10 }, (_, i) => ({ id: `k${i}`, parentId: 'a', name: `K${i}` }))
    const chart = createKlad(host(), {
      data: [{ id: 'a', name: 'Root' }, { id: 'z', name: 'Other' }, ...kids],
      nodeSize: { w: 120, h: 48 },
      label: (item) => String(item.name ?? ''),
      worker: false,
      maxChildren: 3,
    })
    await nextFrame()
    await settle()

    expect(chart.api.move('z', 'a', 5)).toBe(true)
    await settleTransition()
    const children = chart.api
      .getData()
      .filter((item) => (item.parentId ?? null) === 'a')
      .map((item) => String(item.id))
    expect(children).toEqual(['k0', 'k1', 'k2', 'k3', 'k4', 'z', 'k5', 'k6', 'k7', 'k8', 'k9'])
    chart.destroy()
  })

  it('edits while a filter is running without the filter drifting', async () => {
    const chart = make({})
    await nextFrame()
    await settle()

    chart.api.filter('Leaf')
    await settleTransition()
    expect(chart.api.getState().visibleCount).toBe(3) // a -> b -> d

    chart.api.add({ id: 'z', name: 'Leaf too' }, 'c')
    await settleTransition()
    await settle()

    // The mask is source-indexed and the tree was just renumbered. If it were
    // carried rather than rebuilt, the filter would now be keeping an
    // arbitrary set.
    expect(chart.api.getState().visibleCount).toBe(5) // a -> b -> d, a -> c -> z
    chart.destroy()
  })

  it('undoes a move a rule would refuse, because going back is not a new edit', async () => {
    let strict = false
    const chart = make({ canMove: () => !strict })
    await nextFrame()
    await settle()

    chart.api.move('d', 'c')
    await settleTransition()
    // The rule tightens — a server said so, a viewer locked the branch.
    strict = true
    expect(chart.api.move('d', 'b')).toBe(false)

    // Undo still works. It is not proposing a new arrangement, it is
    // withdrawing one, and refusing would strand the viewer in a state the
    // rule also forbids.
    expect(chart.api.undo()).toBe(true)
    await settleTransition()
    expect(chart.api.pathTo('d')).toEqual(['a', 'b', 'd'])
    chart.destroy()
  })

  it('does not carry a lifted cap onto a node that merely reuses an id', async () => {
    // `update` clears `uncapped` and says why: an id that leaves and comes
    // back would arrive with its cap already lifted, which nobody asked for.
    // `reconcile` keeps them on purpose — the caps you lifted are part of
    // where you are — so the returning-id case has to be checked, not assumed.
    const wide = (parent: string) =>
      Array.from({ length: 6 }, (_, i) => ({ id: `${parent}-${i}`, parentId: parent, name: `${parent}${i}` }))
    const chart = createKlad(host(), {
      data: [{ id: 'a', name: 'Root' }, { id: 'p', parentId: 'a', name: 'Parent' }, ...wide('p')],
      nodeSize: { w: 120, h: 48 },
      label: (item) => String(item.name ?? ''),
      worker: false,
      maxChildren: 2,
    })
    await nextFrame()
    await settle()
    chart.api.showMore('klad:more:p')
    await settleTransition()
    const lifted = chart.api.getState().visibleCount

    // `p` leaves...
    chart.api.reconcile([{ id: 'a', name: 'Root' }])
    await settleTransition()
    await settle()
    // ...and a different `p` arrives, with its own crowd.
    chart.api.reconcile([
      { id: 'a', name: 'Root' },
      { id: 'p', parentId: 'a', name: 'A different parent' },
      ...wide('p'),
    ])
    await settleTransition()
    await settle()

    const now = chart.api.getState().visibleCount
    console.log(`[intersect] lifted ${lifted}, after the id came back ${now}`)
    // Capped again: 'a', 'p', two children and the node standing for the rest.
    expect(now).toBe(5)
    chart.destroy()
  })
})

describe('editing from the keyboard', () => {
  const DEEP = [
    { id: 'a', name: 'Root' },
    { id: 'b', parentId: 'a', name: 'First' },
    { id: 'c', parentId: 'a', name: 'Second' },
    { id: 'd', parentId: 'a', name: 'Third' },
    { id: 'b1', parentId: 'b', name: 'Under first' },
  ]
  const keys = (overrides: Partial<Options> = {}) =>
    createKlad(host(), {
      data: DEEP,
      nodeSize: { w: 120, h: 48 },
      label: (item) => String(item.name ?? ''),
      worker: false,
      keyboardEditing: true,
      ...overrides,
    })
  const rowOf = (id: string) =>
    [...document.querySelectorAll<HTMLElement>('[role="treeitem"]')].find(
      (el) => el.dataset.orgchartId === id,
    )!
  const press = async (id: string, key: string, mods: Partial<KeyboardEventInit> = {}) => {
    const row = rowOf(id)
    row.focus()
    row.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...mods }))
    await settleTransition()
    await settle()
  }
  const childIds = (chart: ReturnType<typeof createKlad>, parent: string | null) =>
    chart.api
      .getData()
      .filter((item) => (item.parentId ?? null) === parent)
      .map((item) => String(item.id))

  it('nudges a node one slot among its siblings', async () => {
    const chart = keys()
    await nextFrame()
    await settle()
    expect(childIds(chart, 'a')).toEqual(['b', 'c', 'd'])

    await press('c', 'ArrowDown', { altKey: true })
    expect(childIds(chart, 'a')).toEqual(['b', 'd', 'c'])

    await press('c', 'ArrowUp', { altKey: true })
    expect(childIds(chart, 'a')).toEqual(['b', 'c', 'd'])
    chart.destroy()
  })

  it('stops at the ends rather than wrapping', async () => {
    const chart = keys()
    await nextFrame()
    await settle()

    await press('b', 'ArrowUp', { altKey: true })
    expect(childIds(chart, 'a')).toEqual(['b', 'c', 'd'])
    await press('d', 'ArrowDown', { altKey: true })
    expect(childIds(chart, 'a')).toEqual(['b', 'c', 'd'])

    // And it declined rather than doing a no-op move. The order looks the same
    // either way, because `move` clamps the index — but a no-op move is a full
    // relayout and an undo entry for nothing.
    expect(chart.api.canUndo()).toBe(false)
    expect(chart.api.isDirty()).toBe(false)
    chart.destroy()
  })

  it('goes in under the sibling above, and back out after its old parent', async () => {
    const chart = keys()
    await nextFrame()
    await settle()

    // `c` goes under `b`, which is the row above it.
    await press('c', 'ArrowRight', { altKey: true })
    expect(chart.api.pathTo('c')).toEqual(['a', 'b', 'c'])
    expect(childIds(chart, 'b')).toEqual(['b1', 'c'])

    // And out again: a sibling of `b`, directly after it.
    await press('c', 'ArrowLeft', { altKey: true })
    expect(chart.api.pathTo('c')).toEqual(['a', 'c'])
    expect(childIds(chart, 'a')).toEqual(['b', 'c', 'd'])
    chart.destroy()
  })

  it('refuses to go in when there is nothing above it, or out of a root', async () => {
    const chart = keys()
    await nextFrame()
    await settle()

    await press('b', 'ArrowRight', { altKey: true })
    expect(chart.api.pathTo('b')).toEqual(['a', 'b'])
    await press('a', 'ArrowLeft', { altKey: true })
    expect(chart.api.pathTo('a')).toEqual(['a'])
    chart.destroy()
  })

  it('removes the node and everything under it', async () => {
    const chart = keys()
    await nextFrame()
    await settle()

    await press('b', 'Delete')
    expect(chart.api.stats('b')).toBeNull()
    expect(chart.api.stats('b1')).toBeNull()
    expect(chart.api.stats('c')).not.toBeNull()
    // And it is one edit, so one undo puts the branch back.
    chart.api.undo()
    await settleTransition()
    expect(chart.api.stats('b1')).not.toBeNull()
    chart.destroy()
  })

  it('asks for a sibling rather than inventing one', async () => {
    const asked: { afterId: string; parentId: string | null; index: number }[] = []
    const chart = keys()
    chart.on('addRequested', (event) => asked.push(event))
    await nextFrame()
    await settle()

    await press('c', 'Enter', { shiftKey: true })
    // Nothing appeared — the chart does not know what a row of yours looks
    // like, the same reason there is no rename.
    expect(childIds(chart, 'a')).toEqual(['b', 'c', 'd'])
    expect(asked).toEqual([{ afterId: 'c', parentId: 'a', index: 2 }])

    // And the values it handed over are the ones `add` wants.
    chart.api.add({ id: 'new', name: 'Added' }, asked[0]!.parentId, asked[0]!.index)
    await settleTransition()
    expect(childIds(chart, 'a')).toEqual(['b', 'c', 'new', 'd'])
    chart.destroy()
  })

  it('does nothing at all unless asked for', async () => {
    const chart = keys({ keyboardEditing: false })
    await nextFrame()
    await settle()

    await press('c', 'ArrowDown', { altKey: true })
    await press('b', 'Delete')
    expect(childIds(chart, 'a')).toEqual(['b', 'c', 'd'])
    expect(chart.api.stats('b')).not.toBeNull()
    chart.destroy()
  })

  it('honours your rule, exactly as a drag does', async () => {
    const chart = keys({ canMove: ({ parentId }: { parentId: string | null }) => parentId !== 'b' })
    await nextFrame()
    await settle()

    // Going in would put it under `b`, which the rule forbids.
    await press('c', 'ArrowRight', { altKey: true })
    expect(chart.api.pathTo('c')).toEqual(['a', 'c'])
    // Reordering within `a` is still fine.
    await press('c', 'ArrowDown', { altKey: true })
    expect(childIds(chart, 'a')).toEqual(['b', 'd', 'c'])
    chart.destroy()
  })
})

describe('walking the results, and hearing about changes', () => {
  const PEOPLE = [
    { id: 'a', name: 'Root' },
    { id: 'b', parentId: 'a', name: 'Rossi one' },
    { id: 'c', parentId: 'a', name: 'Bianchi' },
    { id: 'd', parentId: 'c', name: 'Rossi two' },
    { id: 'e', parentId: 'c', name: 'Rossi three' },
  ]
  const find = (overrides: Partial<Options> = {}) =>
    createKlad(host(), {
      data: PEOPLE,
      nodeSize: { w: 120, h: 48 },
      label: (item) => String(item.name ?? ''),
      worker: false,
      ...overrides,
    })

  it('steps through the hits and wraps', async () => {
    const chart = find()
    await nextFrame()
    await settle()

    expect(chart.api.findNext('rossi')?.id).toBe('b')
    expect(chart.api.findNext()?.id).toBe('d')
    expect(chart.api.findNext()?.id).toBe('e')
    // Round again rather than stopping.
    expect(chart.api.findNext()?.id).toBe('b')
    expect(chart.api.findPrevious()?.id).toBe('e')
    chart.destroy()
  })

  it('leaves the tree alone, unlike a filter', async () => {
    const chart = find()
    await nextFrame()
    await settle()
    const before = chart.api.getState().visibleCount

    chart.api.findNext('rossi')
    await settleTransition()
    // Every node is still there. That is the whole difference from `filter`.
    expect(chart.api.getState().visibleCount).toBe(before)
    chart.destroy()
  })

  it('opens whatever the hit was behind', async () => {
    const chart = find({ collapsedByDefault: true })
    await nextFrame()
    await settle()
    expect(chart.api.getState().visibleCount).toBe(1)

    chart.api.findNext('rossi two')
    await settleTransition()
    await settle()
    // `d` sits under a folded `c`; getting to it has to unfold it.
    expect(chart.api.getView().open).toContain('c')
    chart.destroy()
  })

  it('says nothing when nothing matches', async () => {
    const chart = find()
    await nextFrame()
    await settle()
    expect(chart.api.findNext('nobody')).toBeNull()
    expect(chart.api.findNext()).toBeNull()
    chart.destroy()
  })

  it('forgets where it was once the tree changes', async () => {
    const chart = find()
    await nextFrame()
    await settle()
    expect(chart.api.findNext('rossi')?.id).toBe('b')

    chart.api.remove('d')
    await settleTransition()
    // A place in a list of nodes that have since moved is not a place.
    expect(chart.api.findNext()).toBeNull()
    // And the query can simply be given again.
    expect(chart.api.findNext('rossi')?.id).toBe('b')
    chart.destroy()
  })

  it('counts the leaves under a node, and leaves the invented one out', async () => {
    const chart = find()
    await nextFrame()
    await settle()

    // `c` holds two leaves; `a` holds those two plus `b`.
    expect(chart.api.stats('c')!.leafCount).toBe(2)
    expect(chart.api.stats('a')!.leafCount).toBe(3)
    expect(chart.api.stats('b')!.leafCount).toBe(1)
    chart.destroy()

    const kids = Array.from({ length: 8 }, (_, i) => ({ id: `k${i}`, parentId: 'a', name: `K${i}` }))
    const capped = createKlad(host(), {
      data: [{ id: 'a', name: 'Root' }, ...kids],
      nodeSize: { w: 120, h: 48 },
      label: (item) => String(item.name ?? ''),
      worker: false,
      maxChildren: 3,
    })
    await nextFrame()
    await settle()
    // Eight, not nine: the node a cap invents is childless, so it counted
    // itself until it was taken back out.
    expect(capped.api.stats('a')!.leafCount).toBe(8)
    capped.destroy()
  })

  it('tells you when the filter changed, and what matched', async () => {
    const seen: { query: string | null; matched: string[] }[] = []
    const chart = find()
    chart.on('filterChange', (event) => seen.push(event))
    await nextFrame()
    await settle()

    chart.api.filter('rossi')
    await settleTransition()
    expect(seen).toHaveLength(1)
    expect(seen[0]!.query).toBe('rossi')
    expect(seen[0]!.matched).toEqual(['b', 'd', 'e'])

    chart.api.filter(null)
    await settleTransition()
    expect(seen[1]).toEqual({ query: null, matched: [] })

    // A predicate cannot be written down — the same limit `getView` states.
    chart.api.filter((item) => item.id === 'b')
    await settleTransition()
    expect(seen[2]!.query).toBeNull()
    expect(seen[2]!.matched).toEqual(['b'])
    chart.destroy()
  })

  it('tells you when the layout changed, resolved', async () => {
    const seen: LayoutSettings[] = []
    const chart = find()
    chart.on('layoutChange', (event) => seen.push(event.settings))
    await nextFrame()
    await settle()

    chart.api.setLayoutOptions({ layout: 'file', rowGap: 4 })
    await settleTransition()
    expect(seen).toHaveLength(1)
    expect(seen[0]!.layout).toBe('file')
    expect(seen[0]!.rowGap).toBe(4)

    // The second change carries BOTH, not just the delta — a sidebar mirroring
    // the chart reads what is, not what it last sent.
    chart.api.setLayoutOptions({ edgeStyle: 'none' })
    await settleTransition()
    expect(seen[1]!.layout).toBe('file')
    expect(seen[1]!.rowGap).toBe(4)
    expect(seen[1]!.edgeStyle).toBe('none')
    // And a key nobody set is absent rather than undefined.
    expect('maxRings' in seen[1]!).toBe(false)
    chart.destroy()
  })
})

describe('one event for the whole view', () => {
  it('reports every part of it, and only when it changed', async () => {
    const seen: ChartView[] = []
    const chart = make({})
    chart.on('viewChange', (view) => seen.push(view))
    await nextFrame()
    await settle()
    const afterMount = seen.length

    chart.api.collapse('b')
    await settleTransition()
    await settle()
    expect(seen.at(-1)!.open).not.toContain('b')

    chart.api.select(['c'])
    await settle()
    expect(seen.at(-1)!.selected).toEqual(['c'])

    chart.api.filter('Leaf')
    await settleTransition()
    await settle()
    expect(seen.at(-1)!.filter).toBe('Leaf')

    // Redrawing on its own says nothing — a frame is not a change.
    const before = seen.length
    chart.api.refresh()
    await settleTransition()
    await settle()
    expect(seen.length).toBe(before)
    expect(seen.length).toBeGreaterThan(afterMount)
    chart.destroy()
  })

  it('goes straight back into setView', async () => {
    let latest: ChartView | null = null
    const chart = make({})
    chart.on('viewChange', (view) => (latest = view))
    await nextFrame()
    await settle()
    chart.api.collapse('b')
    chart.api.select(['c'])
    await settleTransition()
    await settle()
    const saved = latest!

    chart.api.expand('b')
    chart.api.select(null)
    await settleTransition()
    await settle()
    expect(chart.api.getView().open).toContain('b')

    chart.api.setView(saved)
    await settleTransition()
    await settle()
    expect(chart.api.getView().open).not.toContain('b')
    expect(chart.api.getState().selected).toEqual(['c'])
    chart.destroy()
  })

  it('does not relist the open nodes for a camera move', async () => {
    // The payload names every open node, and this fires once per drawn frame —
    // so a pan would walk the whole tree per frame if the list were rebuilt
    // each time. It is cached, and the proof is that two views published
    // across a camera change share the very same array.
    const seen: ChartView[] = []
    const chart = make({})
    chart.on('viewChange', (view) => seen.push(view))
    await nextFrame()
    await settle()

    chart.api.zoomTo(1.5)
    await settle()
    chart.api.zoomTo(2)
    await settle()
    const last = seen.at(-1)!
    const previous = seen.at(-2)!
    expect(last.camera.k).not.toBe(previous.camera.k)
    expect(last.open).toBe(previous.open)

    // And it is frozen, because it is shared: a holder sorting it in place
    // would corrupt the cache every later comparison reads.
    expect(Object.isFrozen(last.open)).toBe(true)

    // Opening something does rebuild it.
    chart.api.collapse('b')
    await settleTransition()
    await settle()
    expect(seen.at(-1)!.open).not.toBe(last.open)
    chart.destroy()
  })
})

describe('the edit event', () => {
  it('fires after the edit is in the history, not before', async () => {
    // Emitted first, every listener asking `canUndo()` got the answer from
    // before the edit it was being told about — so a toolbar wired to this
    // sat one edit behind, which reads as nothing happening.
    const seen: { change: Change; canUndo: boolean; pending: number }[] = []
    const chart = make({})
    chart.on('edit', (change) =>
      seen.push({ change, canUndo: chart.api.canUndo(), pending: chart.api.changes().length }),
    )
    await nextFrame()
    await settle()

    chart.api.move('d', 'c')
    await settleTransition()
    expect(seen).toHaveLength(1)
    expect(seen[0]!.canUndo).toBe(true)
    expect(seen[0]!.pending).toBe(1)
    chart.destroy()
  })

  it('reports a keyboard edit, which nothing else does', async () => {
    // A drag says so through `nodeDrop` and an API call is something the host
    // made itself. `Alt+Up` and `Delete` are the case with nobody in the room.
    const seen: Change[] = []
    const chart = createKlad(host(), {
      data: [
        { id: 'a', name: 'Root' },
        { id: 'b', parentId: 'a', name: 'First' },
        { id: 'c', parentId: 'a', name: 'Second' },
      ],
      nodeSize: { w: 120, h: 48 },
      label: (item) => String(item.name ?? ''),
      worker: false,
      keyboardEditing: true,
    })
    chart.on('edit', (change) => seen.push(change))
    await nextFrame()
    await settle()

    const row = [...document.querySelectorAll<HTMLElement>('[role="treeitem"]')].find(
      (el) => el.dataset.orgchartId === 'b',
    )!
    row.focus()
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }))
    await settleTransition()
    await settle()

    expect(seen).toHaveLength(1)
    expect(seen[0]).toEqual({ op: 'move', ids: ['b'], parentId: 'a', index: 1 })
    chart.destroy()
  })

  it('still speaks with the history turned off', async () => {
    const seen: Change[] = []
    const chart = make({ history: false })
    chart.on('edit', (change) => seen.push(change))
    await nextFrame()
    await settle()

    chart.api.remove('d')
    await settleTransition()
    // "Keep no way back" and "tell me nothing" are different requests.
    expect(seen).toEqual([{ op: 'remove', ids: ['d'] }])
    expect(chart.api.canUndo()).toBe(false)
    chart.destroy()
  })

  it('says nothing for an undo, which the host asked for itself', async () => {
    const seen: Change[] = []
    const chart = make({})
    chart.on('edit', (change) => seen.push(change))
    await nextFrame()
    await settle()

    chart.api.move('d', 'c')
    await settleTransition()
    chart.api.undo()
    await settleTransition()
    // Treating a withdrawal as a new edit would have anyone mirroring this
    // apply the move twice.
    expect(seen).toHaveLength(1)
    chart.destroy()
  })
})
