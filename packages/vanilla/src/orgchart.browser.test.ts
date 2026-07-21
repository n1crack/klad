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

  // Regression: fit() used to run at construction, before the first render had
  // produced any layout, so bounds were empty and every chart opened on an
  // arbitrary camera. The first thing a user saw was the chart adrift.
  it('opens already fitted, not on an arbitrary camera', async () => {
    const chart = make()
    await nextFrame()
    await nextFrame()

    const state = chart.api.getState()
    expect(state.bounds.maxX).toBeGreaterThan(0)
    // A real fit of this fixture into 800x600 lands well above 1x; an unfitted
    // chart would still be sitting at the default k = 1.
    expect(state.camera.k).not.toBe(1)

    // And the content is actually on screen: the root's centre falls inside the host.
    expect(state.rootScreenCentre.x).toBeGreaterThan(0)
    expect(state.rootScreenCentre.x).toBeLessThan(800)
    expect(state.rootScreenCentre.y).toBeGreaterThan(0)
    expect(state.rootScreenCentre.y).toBeLessThan(600)
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
})
