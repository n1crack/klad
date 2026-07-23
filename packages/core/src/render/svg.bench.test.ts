import { describe, expect, it } from 'vitest'
import { normalize } from '../tree.js'
import { layout } from '../layout/tidy.js'
import { applyOrientation } from '../layout/orientation.js'
import { toSVG, type ExportData } from './svg.js'
import type { NodeData } from '../types.js'

// Same reasoning as tidy.bench.test.ts's `declare const performance`: this
// package's tsconfig sets `types: []` and `lib: ["ES2023"]`, so neither
// `performance` nor `TextEncoder` resolves without help. Both are bare,
// module-scoped `declare const`s — never `declare global` (see that file's
// docblock for why a global augmentation would leak into every other module
// in this package) — describing just enough of each host global's shape for
// what this file actually calls.
declare const performance: { now: () => number }
declare const TextEncoder: new () => { encode(input: string): Uint8Array }
declare const console: { log: (...args: unknown[]) => void }

/** Same bushy-plus-chains shape as tidy.bench.test.ts's `build50k` (unequal
 * subtree depths so the tree isn't a degenerate uniform grid), duplicated
 * locally rather than imported since that helper isn't exported — this file
 * only needs SOME realistic 50k-node tree, not that exact one. */
function build50k(): NodeData[] {
  const data: NodeData[] = [{ id: 'root' }]
  let frontier = ['root']
  while (data.length < 40_000) {
    const next: string[] = []
    for (const parentId of frontier) {
      for (let i = 0; i < 10 && data.length < 40_000; i++) {
        const id = `${parentId}.${i}`
        data.push({ id, parentId })
        next.push(id)
      }
    }
    frontier = next
  }
  let idx = 0
  while (data.length < 50_000) {
    const leaf = frontier[idx % frontier.length]!
    const chainLen = (idx % 37) + 1
    let prev = `${leaf}.chain${idx}`
    data.push({ id: prev, parentId: leaf })
    for (let c = 1; c < chainLen && data.length < 50_000; c++) {
      const id = `${prev}.c${c}`
      data.push({ id, parentId: prev })
      prev = id
    }
    idx++
  }
  return data
}

describe('toSVG size and performance at 50k nodes', () => {
  it('serializes a 50k-node tree in bounded time and bounded output size', () => {
    const tree = normalize(build50k())
    const n = tree.count
    expect(n).toBe(50_000)

    const sizes = new Float64Array(n * 2)
    const labels: string[] = Array.from({ length: n })
    for (let i = 0; i < n; i++) {
      sizes[i * 2] = 160 + (i % 7) * 24
      sizes[i * 2 + 1] = 48 + (i % 11) * 12
      // A realistic-length label, not a bare id, since label byte count
      // dominates output size far more than coordinate digits do.
      labels[i] = `Employee ${tree.indexToId[i]} — Senior Staff Engineer`
    }

    const result = layout(tree, sizes, { spacingX: 16, spacingY: 48 })
    const bounds = applyOrientation(result.boxes, result.bounds, 'tb', false)
    const data: ExportData = { boxes: result.boxes, parent: tree.parent, labels, bounds, horizontal: false }

    // Warm up so the measured run isn't dominated by first-call JIT compilation.
    toSVG(data)

    const start = performance.now()
    const svg = toSVG(data)
    const elapsed = performance.now() - start

    const bytes = new TextEncoder().encode(svg).length
    const mib = bytes / (1024 * 1024)

    // Logged rather than only asserted: these are the actual measured
    // numbers `toSVG`'s "Size" docblock and the p3 export report describe —
    // "measure rather than guess" only means something if the measurement is
    // visible, not just gated behind a pass/fail.
    console.log(`toSVG(50k nodes): ${elapsed.toFixed(1)}ms, ${mib.toFixed(2)} MiB`)

    // Generous bounds — regression guards, not tight performance assertions.
    // A single synchronous string-building pass over flat arrays; no
    // recursion, so this is expected to stay comfortably under a second even
    // on slow CI hardware. Measured ~10.5 MiB / ~75ms on this machine for
    // 50k nodes with a ~50-character label each (see the console.log above,
    // and the p3 export report, for the exact figures this bound is based
    // on) — capped generously above that so this stays a regression guard
    // for a real blowup, not a tripwire on machine noise.
    expect(elapsed).toBeLessThan(2000)
    expect(mib).toBeLessThan(16)
  })
})
