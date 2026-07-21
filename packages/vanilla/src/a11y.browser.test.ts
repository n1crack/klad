import { describe, expect, it } from 'vitest'
import { normalize } from '@n1crack/orgchart-core'
import { createA11yTree, type A11yTree } from './a11y.js'
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

  // Regression: expandAll, collapseAll, and deep expand/collapse all mutate `open`
  // without going through setOpenFlag. They used to leave aria-expanded stale, so the
  // mirror told a screen-reader user the opposite of what the chart showed.
  it('refreshes aria-expanded after collapseAll and expandAll', async () => {
    const chart = make()
    await nextFrame()
    const expandedOf = (name: string) =>
      Array.from(document.querySelectorAll('[role="treeitem"]'))
        .find((el) => el.textContent?.includes(name))
        ?.getAttribute('aria-expanded')

    expect(expandedOf('Root')).toBe('true')

    chart.api.collapseAll()
    await nextFrame()
    expect(expandedOf('Root')).toBe('false')

    chart.api.expandAll()
    await nextFrame()
    expect(expandedOf('Root')).toBe('true')
    chart.destroy()
  })

  it('refreshes aria-expanded after a deep collapse', async () => {
    const chart = make()
    await nextFrame()
    chart.api.collapse('a', true)
    await nextFrame()
    const root = Array.from(document.querySelectorAll('[role="treeitem"]')).find((el) =>
      el.textContent?.includes('Root'),
    )!
    expect(root.getAttribute('aria-expanded')).toBe('false')
    chart.destroy()
  })

  it('does not rebuild the mirror when only the highlight changes', async () => {
    const chart = make()
    await nextFrame()
    const before = document.querySelector('[role="treeitem"]')
    chart.api.highlight(['b'])
    await nextFrame()
    // Same element object means the mirror was not torn down and rebuilt.
    expect(document.querySelector('[role="treeitem"]')).toBe(before)
    chart.destroy()
  })

  it('is removed on destroy', async () => {
    const chart = make()
    await nextFrame()
    chart.destroy()
    expect(document.querySelector('[role="tree"]')).toBeNull()
  })

  // Pooling reuses rows positionally, so a row that holds focus can end up
  // reassigned to a different node after an update. Focus must follow the
  // *node*: inserting 'e' as a new first child of the root shifts every node
  // in that subtree over by one slot in preorder (a, e, b, d, c instead of
  // a, b, d, c), so the pooled row that used to show 'Leaf' gets repurposed
  // for 'Left' — the focused row's content changes out from under it unless
  // focus is explicitly re-pointed at wherever 'Leaf' landed.
  it('keeps focus on the same node when pooling reassigns its row', async () => {
    const chart = make()
    await nextFrame()
    const leafBefore = Array.from(document.querySelectorAll('[role="treeitem"]')).find((el) =>
      el.textContent?.includes('Leaf'),
    )! as HTMLElement
    leafBefore.focus()
    expect(document.activeElement).toBe(leafBefore)

    chart.update([
      { id: 'a', name: 'Root' },
      { id: 'e', parentId: 'a', name: 'Extra' },
      { id: 'b', parentId: 'a', name: 'Left' },
      { id: 'c', parentId: 'a', name: 'Right' },
      { id: 'd', parentId: 'b', name: 'Leaf' },
    ])
    await nextFrame()

    // The DOM node that used to hold focus now shows a different node.
    expect(leafBefore.textContent).not.toContain('Leaf')
    // Focus followed 'Leaf' to wherever it landed instead.
    const active = document.activeElement as HTMLElement
    expect(active.dataset.orgchartId).toBe('d')
    expect(active.textContent).toContain('Leaf')
    chart.destroy()
  })

  it('drops focus rather than leaving it on a row that now shows a different node', async () => {
    const chart = make()
    await nextFrame()
    const leaf = Array.from(document.querySelectorAll('[role="treeitem"]')).find((el) =>
      el.textContent?.includes('Leaf'),
    )! as HTMLElement
    leaf.focus()
    expect(document.activeElement).toBe(leaf)

    // 'd' (Leaf) no longer exists; the row that used to represent it is
    // repurposed for 'c' (Right), which lands in that same slot.
    chart.update([
      { id: 'a', name: 'Root' },
      { id: 'b', parentId: 'a', name: 'Left' },
      { id: 'c', parentId: 'a', name: 'Right' },
    ])
    await nextFrame()

    expect(document.activeElement).not.toBe(leaf)
    expect(
      Array.from(document.querySelectorAll('[role="treeitem"]')).some((el) =>
        el.textContent?.includes('Leaf'),
      ),
    ).toBe(false)
    chart.destroy()
  })
})

describe('pooled row reuse', () => {
  function makeTree(ids: string[]) {
    const root = ids[0]!
    const data = ids.map((id, i) => (i === 0 ? { id } : { id, parentId: root }))
    const tree = normalize(data)
    const open = new Uint8Array(tree.count).fill(1)
    const labelOf = (index: number) => tree.indexToId[index]!
    return { tree, open, labelOf }
  }

  function makeA11y(): { host: HTMLElement; a11y: A11yTree } {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const a11y = createA11yTree(host, { onActivate() {}, onFocus() {} })
    return { host, a11y }
  }

  it('reuses the same row elements when the tree shape is unchanged', () => {
    const { host, a11y } = makeA11y()
    const { tree, open, labelOf } = makeTree(['a', 'b', 'c'])

    a11y.update(tree, open, labelOf)
    const first = Array.from(host.querySelectorAll('[role="treeitem"]'))

    a11y.update(tree, open, labelOf)
    const second = Array.from(host.querySelectorAll('[role="treeitem"]'))

    expect(second.length).toBe(first.length)
    for (let i = 0; i < first.length; i++) expect(second[i]).toBe(first[i])
    a11y.destroy()
  })

  it('regrows by reclaiming detached rows instead of creating new ones', () => {
    const { host, a11y } = makeA11y()
    const big = makeTree(['a', 'b', 'c', 'd', 'e'])
    a11y.update(big.tree, big.open, big.labelOf)
    const rows = Array.from(host.querySelectorAll('[role="treeitem"]')) as HTMLElement[]
    expect(rows.length).toBe(5)
    // Tag every row so identity survives externally-observable detach/reattach.
    rows.forEach((row, i) => row.setAttribute('data-test-tag', `row-${i}`))

    const small = makeTree(['a', 'b'])
    a11y.update(small.tree, small.open, small.labelOf)
    // Surplus rows are detached, not discarded.
    expect(host.querySelectorAll('[role="treeitem"]').length).toBe(2)

    a11y.update(big.tree, big.open, big.labelOf)
    const regrown = Array.from(host.querySelectorAll('[role="treeitem"]')) as HTMLElement[]
    expect(regrown.length).toBe(5)
    // Same tags in the same slots means the reclaimed elements are the very
    // same objects, not freshly created ones.
    expect(regrown.map((row) => row.getAttribute('data-test-tag'))).toEqual(
      rows.map((row) => row.getAttribute('data-test-tag')),
    )
    a11y.destroy()
  })

  it('writes nothing to the DOM when an update repeats unchanged state', () => {
    const { host, a11y } = makeA11y()
    const { tree, open, labelOf } = makeTree(['a', 'b', 'c'])
    a11y.update(tree, open, labelOf)

    const observer = new MutationObserver(() => {})
    observer.observe(host, {
      attributes: true,
      characterData: true,
      subtree: true,
      childList: true,
    })

    a11y.update(tree, open, labelOf)

    expect(observer.takeRecords().length).toBe(0)
    observer.disconnect()
    a11y.destroy()
  })

  it('omits aria-expanded only for actual leaves after a shape change', () => {
    const { host, a11y } = makeA11y()
    // 'b' starts as a leaf (no children), then gains one.
    const before = normalize([{ id: 'a' }, { id: 'b', parentId: 'a' }])
    const beforeOpen = new Uint8Array(before.count).fill(1)
    a11y.update(before, beforeOpen, (i) => before.indexToId[i]!)
    const bRowBefore = Array.from(host.querySelectorAll('[role="treeitem"]')).find(
      (el) => (el as HTMLElement).dataset.orgchartId === 'b',
    )!
    expect(bRowBefore.hasAttribute('aria-expanded')).toBe(false)

    const after = normalize([{ id: 'a' }, { id: 'b', parentId: 'a' }, { id: 'c', parentId: 'b' }])
    const afterOpen = new Uint8Array(after.count).fill(1)
    a11y.update(after, afterOpen, (i) => after.indexToId[i]!)
    const bRowAfter = Array.from(host.querySelectorAll('[role="treeitem"]')).find(
      (el) => (el as HTMLElement).dataset.orgchartId === 'b',
    )!
    expect(bRowAfter.getAttribute('aria-expanded')).toBe('true')
    a11y.destroy()
  })
})

describe('pooled update performance', () => {
  /** A branching-factor-6 tree, the shape a wide org chart actually has. */
  function buildBushy(n: number): { id: string; parentId?: string }[] {
    const data: { id: string; parentId?: string }[] = [{ id: 'root' }]
    let frontier = ['root']
    while (data.length < n && frontier.length > 0) {
      const next: string[] = []
      for (const parentId of frontier) {
        for (let i = 0; i < 6 && data.length < n; i++) {
          const id = `${parentId}.${i}`
          data.push({ id, parentId })
          next.push(id)
        }
      }
      frontier = next
    }
    return data
  }

  it('reports full-population and single-toggle timings for 10,000 nodes', () => {
    const tree = normalize(buildBushy(10_000))
    expect(tree.count).toBe(10_000)
    const labelOf = (i: number) => tree.indexToId[i]!
    const RUNS = 5

    // Same method as the pre-pooling baseline (measured at 15.86ms, range
    // 14.0-18.8ms over five runs, see docs/superpowers/decisions-to-revisit.md
    // #23): build the tree once, then measure update() populating a mirror
    // from nothing, averaged over several runs. Each run uses its own fresh
    // createA11yTree so every measured call is a cold "populate from
    // nothing" call — the one call in the pooled implementation that still
    // has to create every row, and so the fair like-for-like comparison to
    // what the old implementation did on *every* call.
    let fullTotal = 0
    for (let r = 0; r < RUNS; r++) {
      const host = document.createElement('div')
      document.body.appendChild(host)
      const a11y = createA11yTree(host, { onActivate() {}, onFocus() {} })
      const open = new Uint8Array(tree.count).fill(1)
      const start = performance.now()
      a11y.update(tree, open, labelOf)
      fullTotal += performance.now() - start
      a11y.destroy()
      host.remove()
    }
    const fullAvg = fullTotal / RUNS

    // The realistic case: an expand/collapse changes exactly one node's open
    // flag and calls update() again. This is where pooling should pay off
    // most, since only that one row's aria-expanded needs a write.
    let diffTotal = 0
    for (let r = 0; r < RUNS; r++) {
      const host = document.createElement('div')
      document.body.appendChild(host)
      const a11y = createA11yTree(host, { onActivate() {}, onFocus() {} })
      const open = new Uint8Array(tree.count).fill(1)
      a11y.update(tree, open, labelOf) // first call: populates the mirror
      open[tree.roots[0]!] = 0 // simulate collapsing the root
      const start = performance.now()
      a11y.update(tree, open, labelOf) // second call: the expand/collapse case
      diffTotal += performance.now() - start
      a11y.destroy()
      host.remove()
    }
    const diffAvg = diffTotal / RUNS

    // eslint-disable-next-line no-console
    console.info(`[a11y perf] 10k full population avg/${RUNS}: ${fullAvg.toFixed(3)}ms`)
    // eslint-disable-next-line no-console
    console.info(`[a11y perf] 10k single-toggle update avg/${RUNS}: ${diffAvg.toFixed(3)}ms`)

    // The single-flag diff touches one row; it must be well under a full
    // population of the same tree.
    expect(diffAvg).toBeLessThan(fullAvg)
  })
})
