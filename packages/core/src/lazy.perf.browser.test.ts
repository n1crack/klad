import { describe, expect, it } from 'vitest'
import { createKlad, type NodeData } from './index.js'

/**
 * What children on demand costs, on a tree big enough for it to show.
 *
 * The bad case is not a small lazily-grown tree — that is small by
 * construction — but a host that hands over twenty thousand nodes AND a
 * loader, so the whole array is rescanned whenever the data changes.
 *
 * The load-bearing assertion here COUNTS rather than times. An earlier version
 * of this file asserted milliseconds against a fixed bound, which passed on a
 * developer machine at 28ms and failed on a CI runner at 139ms — the number it
 * was measuring was the runner, not the code. A call count is the same on
 * every machine, and it is also the thing that actually goes wrong: the mask
 * calls the host's predicate once per node, so a regression that builds it
 * twice, or per frame, shows up here as a multiple and nowhere else.
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

/**
 * Waits until the chart has actually stopped drawing, rather than for a fixed
 * guess at how long that should take.
 *
 * `settle`'s 300ms is right for the toggle benchmarks above, where the
 * question is how long a relayout took and one late frame changes no number.
 * It is wrong for "does this chart stop asking for frames AT ALL": on a
 * 20,000-node tree the zoom that precedes such a measurement can still be
 * finishing 300ms later on a slower machine, and the single trailing frame it
 * then delivers lands inside the measuring window and reads as an animation
 * that never stopped. That is exactly how this failed on CI — `farOut` came
 * back 1 — while passing on the developer machine it was written on.
 *
 * Waiting for real quiet keeps the assertion at a strict zero and makes it a
 * statement about the feature instead of about the runner's speed. `capMs`
 * only bounds the wait for a chart that never goes quiet; the assertion that
 * follows is what fails in that case, and it should.
 */
async function quiet(chart: ReturnType<typeof createKlad>, quietMs = 300, capMs = 10_000): Promise<void> {
  let last = performance.now()
  const stop = chart.subscribe(() => {
    last = performance.now()
  })
  const started = performance.now()
  while (performance.now() - last < quietMs && performance.now() - started < capMs) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  stop()
}

/** Median of `runs` collapse-and-expand pairs, in ms. Median rather than mean:
 * one GC pause in the middle of a run should not decide the number. */
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

describe('capping and filtering: cost', () => {
  const N = 20_000

  it('caps a wide level without a pass that scales worse than the tree', async () => {
    // `planOverflow` groups the whole array by parent on every rebuild. That
    // is the same O(n) `normalize` is about to spend, and this is here to say
    // so with a number rather than a claim.
    const data = bigTree(N)
    const plain = createKlad(host(), { data, nodeSize: { w: 120, h: 40 }, worker: false })
    await nextFrame()
    await settle()
    const t0 = performance.now()
    plain.api.refresh()
    await nextFrame()
    await settle()
    const plainMs = performance.now() - t0
    plain.destroy()

    const capped = createKlad(host(), {
      data,
      nodeSize: { w: 120, h: 40 },
      worker: false,
      maxChildren: 8,
      pinChildren: (item) => item.leaf === true && String(item.id).endsWith('7'),
    })
    await nextFrame()
    await settle()
    const t1 = performance.now()
    capped.api.refresh()
    await nextFrame()
    await settle()
    const cappedMs = performance.now() - t1

    console.log(`[perf] 20k refresh — plain ${plainMs.toFixed(1)}ms, capped ${cappedMs.toFixed(1)}ms`)
    // A cap DRAWS far less, so it should not be slower in any meaningful way.
    // Loose because a shared runner is noisy; what this rules out is the
    // grouping pass turning quadratic.
    expect(cappedMs).toBeLessThan(Math.max(plainMs * 3, 60))
    capped.destroy()
  })

  it('filters twenty thousand nodes in one pass', async () => {
    const data = bigTree(N)
    const chart = createKlad(host(), {
      data,
      nodeSize: { w: 120, h: 40 },
      worker: false,
      label: (item) => String(item.name ?? ''),
    })
    await nextFrame()
    await settle()

    const t0 = performance.now()
    const matched = chart.api.filter('n1')
    await nextFrame()
    await settle()
    const ms = performance.now() - t0
    console.log(`[perf] 20k filter — ${matched.length} matches in ${ms.toFixed(1)}ms`)
    expect(matched.length).toBeGreaterThan(1000)
    // The mask walks up from each match and stops at the first node already
    // marked, so ancestors are climbed once and the whole thing is O(nodes).
    // A version that walked the full chain per match would be O(nodes x depth)
    // and would not come back in this budget on a wide forest.
    expect(ms).toBeLessThan(1500)
    chart.destroy()
  })
})

describe('children on demand: cost', () => {
  const N = 20_000

  it('scans the tree once per data change, not twice', async () => {
    // `applyData` used to build the mask twice in the same function — once for
    // the engine and once for the screen-reader mirror — so a 20k tree made
    // forty thousand calls into somebody else's predicate per data change
    // instead of twenty.
    const data = bigTree(N)
    let calls = 0
    const chart = createKlad(host(), {
      data,
      nodeSize: { w: 120, h: 40 },
      worker: false,
      mayHaveChildren: (item) => {
        calls++
        return item.leaf === true
      },
      loadChildren: () => [],
    })
    await nextFrame()
    await settle()

    // Only nodes with NO children reach the predicate — a node that already
    // has some is not waiting for anything, and `isUnloaded` returns before
    // asking. So the expected count is the leaf count, not the node count.
    const parents = new Set(data.map((item) => item.parentId).filter((id) => id !== undefined))
    const leaves = data.filter((item) => !parents.has(item.id)).length
    expect(leaves).toBeGreaterThan(19_000) // this shape is almost all leaves

    calls = 0
    chart.api.refresh()
    await nextFrame()
    await settle()

    // Exactly one pass over the leaves. Both consumers of the mask — the
    // engine and the screen-reader mirror — are handed the same array.
    expect(calls).toBe(leaves)
    chart.destroy()
  })

  it('costs a chart with a loader no more than one without', async () => {
    // A ratio, not a bound: the absolute number is whatever machine this runs
    // on. What must not change is the ORDER — a mask built per frame, or a
    // predicate called per node per node, would show as a multiple here.
    const data = bigTree(N)
    const plain = createKlad(host(), { data, nodeSize: { w: 120, h: 40 }, worker: false })
    await nextFrame()
    await settle()
    const plainMs = await medianToggle(plain, 7)
    plain.destroy()

    const lazy = createKlad(host(), {
      data,
      nodeSize: { w: 120, h: 40 },
      worker: false,
      mayHaveChildren: (item) => item.leaf === true,
      loadChildren: () => [],
    })
    await nextFrame()
    await settle()
    const lazyMs = await medianToggle(lazy, 7)
    lazy.destroy()

    console.log(
      `[perf] 20k collapse+expand — no loader ${plainMs.toFixed(1)}ms, with loader ${lazyMs.toFixed(1)}ms`,
    )
    // Generous, deliberately. Timing on a shared runner is noisy enough that a
    // tight ratio would fail for reasons that have nothing to do with this
    // code; 2x still catches every regression worth catching, all of which are
    // order-of-magnitude.
    expect(lazyMs).toBeLessThan(Math.max(plainMs * 2, 40))
  })
})

describe('where a node sits: cost', () => {
  const N = 20_000

  it('builds a place per node without it showing on a 20k refresh', async () => {
    // `nodeSize` and `label` are both handed a `NodePlace`, so a data change
    // on a 20k tree allocates forty thousand short-lived objects and does two
    // parent lookups per node. This is here to say with a number that the
    // per-node position costs about what reading the node itself does — the
    // options that use it are the documented hot path.
    const data = bigTree(N)

    const flat = createKlad(host(), { data, nodeSize: { w: 120, h: 40 }, worker: false })
    await nextFrame()
    await settle()
    const t0 = performance.now()
    flat.api.refresh()
    await nextFrame()
    await settle()
    const flatMs = performance.now() - t0
    flat.destroy()

    const placed = createKlad(host(), {
      data,
      worker: false,
      nodeSize: (_item, at) => ({ w: 120 - at.depth, h: 40 }),
      label: (item, at) => `${item.name}/${at.index}of${at.siblings}`,
    })
    await nextFrame()
    await settle()
    const t1 = performance.now()
    placed.api.refresh()
    await nextFrame()
    await settle()
    const placedMs = performance.now() - t1

    console.log(`[perf] 20k refresh — flat ${flatMs.toFixed(1)}ms, placed ${placedMs.toFixed(1)}ms`)
    // Loose, because a shared runner is noisy and the relayout dominates
    // either way. What this rules out is the sibling index turning into a scan
    // — which it would if it were read off the CSR per node rather than swept
    // once per tree.
    expect(placedMs).toBeLessThan(Math.max(flatMs * 2, 60))
    placed.destroy()
  })
})

describe('history: what it costs', () => {
  const N = 20_000

  it('records an edit without it showing, and holds nothing per node', async () => {
    // The claim the option's docblock makes: a record follows the size of the
    // EDIT, not the size of the tree. Snapshots would have been an array of
    // every row per entry — 20,000 pointers each, on this tree.
    const data = bigTree(N)
    const off = createKlad(host(), {
      data,
      nodeSize: { w: 120, h: 40 },
      worker: false,
      history: false,
    })
    await nextFrame()
    await settle()
    const t0 = performance.now()
    off.api.move('b1-0', 'b2')
    await nextFrame()
    await settle()
    const withoutMs = performance.now() - t0
    off.destroy()

    const on = createKlad(host(), { data, nodeSize: { w: 120, h: 40 }, worker: false })
    await nextFrame()
    await settle()
    const t1 = performance.now()
    on.api.move('b1-1', 'b2')
    await nextFrame()
    await settle()
    const withMs = performance.now() - t1

    // Fill the window right up, so the stack is as deep as it ever gets.
    const t2 = performance.now()
    for (let k = 2; k < 102; k++) on.api.move(`b1-${k}`, 'b3')
    await nextFrame()
    await settle()
    const hundredMs = performance.now() - t2

    console.log(
      `[history] 20k — one move without ${withoutMs.toFixed(0)}ms, with ${withMs.toFixed(0)}ms, ` +
        `100 more ${hundredMs.toFixed(0)}ms, changes ${on.api.changes().length}`,
    )
    // Recording is a handful of ids next to a 350ms relayout.
    expect(withMs).toBeLessThan(Math.max(withoutMs * 1.5, 60))
    // And the window held.
    expect(on.api.changes().length).toBe(100)
    on.destroy()
  }, 120_000)
})

describe('flowing edges: what they cost', () => {
  const N = 20_000

  it('animates when it can be seen and goes still when it cannot', async () => {
    // The honest question about this feature: what does it do to a big chart?
    // Two answers, and they are different — drawing cost, and whether the
    // chart draws at all.
    const data = bigTree(N)
    const el = host()
    const chart = createKlad(el, {
      data,
      nodeSize: { w: 120, h: 40 },
      worker: false,
      // Every edge, which is the worst case and not a sensible setting.
      edgeFlow: () => true,
    })
    await nextFrame()
    await settle()

    const framesOver = async (ms: number): Promise<number> => {
      let count = 0
      const stop = chart.subscribe(() => {
        count++
      })
      await new Promise((r) => setTimeout(r, ms))
      stop()
      return count
    }

    chart.api.zoomTo(1)
    await settle()
    const closeUp = await framesOver(400)

    // Zoomed out past the `block` threshold the dashes are not drawn at all,
    // so there is nothing to advance and the chart stops asking for frames.
    // `quiet` rather than `settle`: the claim is that the frames STOP, so the
    // measurement has to start after the zoom's own last frame rather than a
    // fixed 300ms later — see `quiet`.
    chart.api.zoomTo(0.1)
    await quiet(chart)
    const farOut = await framesOver(400)

    console.log(`[flow] 20k — frames in 400ms: close up ${closeUp}, zoomed out ${farOut}`)
    expect(closeUp).toBeGreaterThan(5)
    expect(farOut).toBe(0)
    chart.destroy()
  }, 120_000)

  it('costs a chart with no flowing edge nothing at all', async () => {
    const data = bigTree(N)
    const chart = createKlad(host(), { data, nodeSize: { w: 120, h: 40 }, worker: false })
    await nextFrame()
    // Same reasoning as the test above: this one also asserts a strict zero,
    // so it has to start counting after the mount's own last frame rather
    // than a fixed interval after it began.
    await quiet(chart)
    let count = 0
    const stop = chart.subscribe(() => {
      count++
    })
    await new Promise((r) => setTimeout(r, 400))
    stop()
    expect(count).toBe(0)
    chart.destroy()
  }, 60_000)
})
