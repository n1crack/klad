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
