import { describe, expect, it } from 'vitest'
import { createChartHost } from './host.js'
import { toWireTree } from './protocol.js'
import { normalize } from '../tree.js'
import { DEFAULT_THEME } from '../render/theme.js'

const DATA = [{ id: 'a' }, { id: 'b', parentId: 'a' }, { id: 'c', parentId: 'a' }]

function sizes(count: number): Float64Array {
  const s = new Float64Array(count * 2)
  for (let i = 0; i < count; i++) {
    s[i * 2] = 100
    s[i * 2 + 1] = 50
  }
  return s
}

function mount() {
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
  return canvas
}

async function seed(preferWorker: boolean) {
  const host = createChartHost(mount(), DEFAULT_THEME, preferWorker)
  const tree = normalize(DATA)
  host.setViewport(800, 600, 1)
  host.setData(toWireTree(tree), sizes(tree.count), ['a', 'b', 'c'], new Uint8Array(tree.count).fill(1))
  host.setCamera({ x: 0, y: 0, k: 1 })
  return { host, tree }
}

describe('createChartHost in-process', () => {
  it('reports that it is not using a worker', async () => {
    const { host } = await seed(false)
    expect(host.usingWorker).toBe(false)
    host.destroy()
  })

  it('renders and reports the drawn source indices', async () => {
    const { host } = await seed(false)
    const drawn = await host.render()
    expect(drawn.length).toBe(3)
    host.destroy()
  })

  it('hit-tests without a round trip', async () => {
    const { host, tree } = await seed(false)
    await host.render()
    // The root is centred over its children, so it is not guaranteed to sit at
    // the layout origin (only the leftmost node is) — read its actual box back
    // out and hit-test its centre instead of assuming a fixed point.
    const rootIndex = tree.idToIndex.get('a')!
    const pruned = Array.from(host.visibleToSource).indexOf(rootIndex)
    const cx = host.boxes[pruned * 4]! + host.boxes[pruned * 4 + 2]! / 2
    const cy = host.boxes[pruned * 4 + 1]! + host.boxes[pruned * 4 + 3]! / 2
    expect(await host.hitTest(cx, cy)).toBe(rootIndex)
    expect(await host.hitTest(-999, -999)).toBe(-1)
    host.destroy()
  })
})

describe('createChartHost with a worker', () => {
  it('starts a worker when asked', async () => {
    const { host } = await seed(true)
    expect(host.usingWorker).toBe(true)
    host.destroy()
  })

  it('renders through the worker and reports drawn indices', async () => {
    const { host } = await seed(true)
    const drawn = await host.render()
    expect(drawn.length).toBe(3)
    host.destroy()
  })

  it('hit-tests on the main thread even in worker mode', async () => {
    const { host, tree } = await seed(true)
    await host.render()
    // Same reasoning as the in-process case above: the root is centred, not
    // pinned to the origin.
    const rootIndex = tree.idToIndex.get('a')!
    const pruned = Array.from(host.visibleToSource).indexOf(rootIndex)
    const cx = host.boxes[pruned * 4]! + host.boxes[pruned * 4 + 2]! / 2
    const cy = host.boxes[pruned * 4 + 1]! + host.boxes[pruned * 4 + 3]! / 2
    expect(await host.hitTest(cx, cy)).toBe(rootIndex)
    host.destroy()
  })

  it('produces the same drawn set as the in-process path', async () => {
    const a = await seed(false)
    const b = await seed(true)
    const viaMain = Array.from(await a.host.render()).sort()
    const viaWorker = Array.from(await b.host.render()).sort()
    expect(viaWorker).toEqual(viaMain)
    a.host.destroy()
    b.host.destroy()
  })

  it('exposes identical layout output on both paths', async () => {
    const a = await seed(false)
    const b = await seed(true)
    await a.host.render()
    await b.host.render()
    expect(Array.from(b.host.boxes)).toEqual(Array.from(a.host.boxes))
    expect(Array.from(b.host.visibleToSource)).toEqual(Array.from(a.host.visibleToSource))
    a.host.destroy()
    b.host.destroy()
  })

  it('exposes lastDrawnBoxes across the worker boundary, aligned with the drawn set, bounded when idle', async () => {
    const NESTED = [
      { id: 'a' },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
      { id: 'd', parentId: 'a' },
    ]
    async function seedNested(preferWorker: boolean) {
      const h = createChartHost(mount(), DEFAULT_THEME, preferWorker)
      const t = normalize(NESTED)
      h.setViewport(800, 600, 1)
      h.setAnimate(true)
      h.setData(toWireTree(t), sizes(t.count), ['a', 'b', 'c', 'd'], new Uint8Array(t.count).fill(1))
      h.setCamera({ x: 0, y: 0, k: 1 })
      await h.render()
      return { host: h, tree: t }
    }

    const main = await seedNested(false)
    const worker = await seedNested(true)

    // Idle on both paths: nothing to duplicate, so this stays `null`.
    expect(main.host.lastDrawnBoxes).toBeNull()
    expect(worker.host.lastDrawnBoxes).toBeNull()

    // Collapsing 'b' removes 'c' and reflows the rest — a real transition.
    main.host.setOpen(main.tree.idToIndex.get('b')!, false)
    worker.host.setOpen(worker.tree.idToIndex.get('b')!, false)
    const drawnMain = await main.host.render()
    const drawnWorker = await worker.host.render()

    expect(main.host.transitioning).toBe(true)
    expect(worker.host.transitioning).toBe(true)
    expect(main.host.lastDrawnBoxes).not.toBeNull()
    expect(worker.host.lastDrawnBoxes).not.toBeNull()
    // Bounded to the drawn/visible set on both paths — never the total node
    // count — and the SAME shape on either path.
    expect(main.host.lastDrawnBoxes!.length).toBe(drawnMain.length * 4)
    expect(worker.host.lastDrawnBoxes!.length).toBe(drawnWorker.length * 4)

    // Once the transition finishes (real wall-clock time: neither path
    // threads a caller clock across the worker boundary), it goes back to
    // `null` on both.
    await new Promise((r) => setTimeout(r, 550))
    await main.host.render()
    await worker.host.render()
    expect(main.host.transitioning).toBe(false)
    expect(worker.host.transitioning).toBe(false)
    expect(main.host.lastDrawnBoxes).toBeNull()
    expect(worker.host.lastDrawnBoxes).toBeNull()

    main.host.destroy()
    worker.host.destroy()
  })

  it('falls back in-process when the canvas cannot be transferred', async () => {
    const canvas = mount()
    // Taking a 2D context first makes transferControlToOffscreen throw.
    canvas.getContext('2d')
    const host = createChartHost(canvas, DEFAULT_THEME, true)
    expect(host.usingWorker).toBe(false)
    host.setViewport(400, 300, 1)
    const tree = normalize(DATA)
    host.setData(toWireTree(tree), sizes(tree.count), ['a', 'b', 'c'], new Uint8Array(tree.count).fill(1))
    host.setCamera({ x: 0, y: 0, k: 1 })
    expect((await host.render()).length).toBe(3)
    host.destroy()
  })
})
