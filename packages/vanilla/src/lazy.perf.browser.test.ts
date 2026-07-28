import { describe, expect, it } from 'vitest'
import { createKlad, type NodeData } from './index.js'

/**
 * Two questions this file exists to answer, both about the cost of children on
 * demand rather than about its behaviour (which lives in klad.browser.test.ts).
 *
 *  - Does a chart that does NO lazy loading pay anything for the feature? It
 *    must not: `loadChildren` is undefined for every existing user.
 *  - What does a chart that DOES pay, on a tree big enough for it to show?
 *    The bad case is not a small lazily-grown tree — that is small by
 *    construction — but a host that hands over twenty thousand nodes AND a
 *    loader, so the whole array is rescanned on every toggle.
 */

function host(): HTMLElement {
  const el = document.createElement('div')
  el.style.width = '900px'
  el.style.height = '700px'
  document.body.appendChild(el)
  return el
}

/** A wide, shallow forest — the shape that maximises the per-node scan. */
function bigTree(n: number): NodeData[] {
  const data: NodeData[] = [{ id: 'r', name: 'root', leaf: false }]
  let i = 1
  for (let a = 0; a < 40 && i < n; a++) {
    const branch = `b${a}`
    data.push({ id: branch, parentId: 'r', name: branch, leaf: false })
    i++
    for (let c = 0; c < 500 && i < n; c++) {
      data.push({ id: `${branch}-${c}`, parentId: branch, name: `n${i}`, leaf: true })
      i++
    }
  }
  return data
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)))
const settle = () => new Promise<void>((resolve) => setTimeout(() => resolve(), 300))

/** Median of `runs` toggles, in ms. Median rather than mean: one GC pause in
 * the middle of a run should not decide the number. */
async function medianToggle(chart: ReturnType<typeof createKlad>, runs: number): Promise<number> {
  const samples: number[] = []
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    chart.api.collapse('b0')
    await nextFrame()
    chart.api.expand('b0')
    await nextFrame()
    samples.push(performance.now() - t0)
  }
  samples.sort((a, b) => a - b)
  return samples[Math.floor(samples.length / 2)]!
}

describe('children on demand: cost', () => {
  const N = 20_000

  it('costs a chart with no loader nothing measurable', async () => {
    const data = bigTree(N)
    const chart = createKlad(host(), { data, nodeSize: { w: 120, h: 40 }, worker: false })
    await nextFrame()
    await settle()
    const ms = await medianToggle(chart, 9)
    // Not a tight bound — the point is the ORDER. This path is a single
    // `loadChildren === undefined` check per call; anything near the lazy
    // number below would mean the early-out is not where it is supposed to be.
    expect(ms).toBeLessThan(120)
    console.log(`[perf] 20k, no loader: ${ms.toFixed(1)}ms per collapse+expand`)
    chart.destroy()
  })

  it('stays in the same order with a loader over the whole array', async () => {
    const data = bigTree(N)
    let asked = 0
    const chart = createKlad(host(), {
      data,
      nodeSize: { w: 120, h: 40 },
      worker: false,
      mayHaveChildren: (item) => {
        asked++
        return item.leaf === true
      },
      loadChildren: () => [],
    })
    await nextFrame()
    await settle()
    const ms = await medianToggle(chart, 9)
    console.log(`[perf] 20k, loader over the whole array: ${ms.toFixed(1)}ms, ${asked} predicate calls`)
    expect(ms).toBeLessThan(250)
    chart.destroy()
  })
})
