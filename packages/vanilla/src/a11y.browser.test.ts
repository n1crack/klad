import { describe, expect, it } from 'vitest'
import { createOrgChart } from './index.js'

const DATA = [
  { id: 'a', name: 'Root' },
  { id: 'b', parentId: 'a', name: 'Left' },
  { id: 'c', parentId: 'a', name: 'Right' },
  { id: 'd', parentId: 'b', name: 'Leaf' },
]

function make() {
  const el = document.createElement('div')
  el.style.width = '800px'
  el.style.height = '600px'
  document.body.appendChild(el)
  return createOrgChart(el, {
    data: DATA,
    nodeSize: { w: 120, h: 48 },
    label: (item) => String(item.name ?? ''),
    worker: false,
  })
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)))

describe('accessibility tree', () => {
  it('mirrors the chart as a role=tree', async () => {
    const chart = make()
    await nextFrame()
    const tree = document.querySelector('[role="tree"]')
    expect(tree).not.toBeNull()
    expect(tree!.querySelectorAll('[role="treeitem"]').length).toBe(4)
    chart.destroy()
  })

  it('exposes names, levels, and expanded state', async () => {
    const chart = make()
    await nextFrame()
    const root = document.querySelector('[role="treeitem"]')!
    expect(root.getAttribute('aria-level')).toBe('1')
    expect(root.getAttribute('aria-expanded')).toBe('true')
    expect(root.textContent).toContain('Root')
    chart.destroy()
  })

  it('omits aria-expanded on leaves', async () => {
    const chart = make()
    await nextFrame()
    const leaf = Array.from(document.querySelectorAll('[role="treeitem"]')).find((el) =>
      el.textContent?.includes('Leaf'),
    )!
    expect(leaf.hasAttribute('aria-expanded')).toBe(false)
    chart.destroy()
  })

  it('reflects a collapse in aria-expanded', async () => {
    const chart = make()
    await nextFrame()
    chart.api.collapse('b')
    await nextFrame()
    const node = Array.from(document.querySelectorAll('[role="treeitem"]')).find((el) =>
      el.textContent?.includes('Left'),
    )!
    expect(node.getAttribute('aria-expanded')).toBe('false')
    chart.destroy()
  })

  it('stays in the accessibility tree rather than being display:none', async () => {
    const chart = make()
    await nextFrame()
    const tree = document.querySelector('[role="tree"]') as HTMLElement
    expect(getComputedStyle(tree).display).not.toBe('none')
    chart.destroy()
  })

  it('toggles a node on Enter', async () => {
    const chart = make()
    await nextFrame()
    const node = Array.from(document.querySelectorAll('[role="treeitem"]')).find((el) =>
      el.textContent?.includes('Left'),
    )! as HTMLElement
    node.focus()
    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await nextFrame()
    expect(chart.api.getState().visibleCount).toBe(3)
    chart.destroy()
  })

  it('moves the camera when focus moves', async () => {
    const chart = make()
    chart.api.zoomTo(2)
    await nextFrame()
    const before = { ...chart.api.getState().camera }
    const leaf = Array.from(document.querySelectorAll('[role="treeitem"]')).find((el) =>
      el.textContent?.includes('Leaf'),
    )! as HTMLElement
    leaf.focus()
    await nextFrame()
    const after = chart.api.getState().camera
    expect(after.x !== before.x || after.y !== before.y).toBe(true)
    chart.destroy()
  })

  it('returns to the root on Home', async () => {
    const chart = make()
    await nextFrame()
    const leaf = Array.from(document.querySelectorAll('[role="treeitem"]')).find((el) =>
      el.textContent?.includes('Leaf'),
    )! as HTMLElement
    leaf.focus()
    leaf.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    await nextFrame()
    expect(document.activeElement?.textContent).toContain('Root')
    chart.destroy()
  })

  it('is removed on destroy', async () => {
    const chart = make()
    await nextFrame()
    chart.destroy()
    expect(document.querySelector('[role="tree"]')).toBeNull()
  })
})
