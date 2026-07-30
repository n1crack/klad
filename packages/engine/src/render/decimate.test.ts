import { describe, expect, it } from 'vitest'
import { decimateByCell, gridSizeFor, type DecimationViewport } from './decimate.js'
import type { Camera } from '../viewport.js'

const IDENTITY: Camera = { x: 0, y: 0, k: 1 }
const VP: DecimationViewport = { width: 100, height: 100, dpr: 1 }

/** Packs [x,y,w,h] rows into a Float64Array indexed 0..n-1. */
function boxesOf(rows: [number, number, number, number][]): Float64Array {
  const a = new Float64Array(rows.length * 4)
  rows.forEach((r, i) => a.set(r, i * 4))
  return a
}

function freshGrid(vp: DecimationViewport, cell: number): Uint8Array {
  return new Uint8Array(gridSizeFor(vp, cell))
}

describe('gridSizeFor', () => {
  it('is cols*rows, rounding up and scaling by dpr', () => {
    expect(gridSizeFor({ width: 100, height: 100, dpr: 1 }, 2)).toBe(50 * 50)
    expect(gridSizeFor({ width: 100, height: 100, dpr: 2 }, 2)).toBe(100 * 100)
    expect(gridSizeFor({ width: 3, height: 3, dpr: 1 }, 2)).toBe(2 * 2)
  })
})

describe('decimateByCell', () => {
  it('keeps entries that land in distinct cells', () => {
    // Two 0-size boxes 50px apart at cell=2 -> different cells -> both kept.
    const boxes = boxesOf([
      [0, 0, 0, 0],
      [50, 50, 0, 0],
    ])
    const buffer = Uint32Array.from([0, 1])
    const kept = decimateByCell(boxes, buffer, 2, IDENTITY, VP, 2, freshGrid(VP, 2))
    expect(kept).toBe(2)
    expect(Array.from(buffer.subarray(0, kept))).toEqual([0, 1])
  })

  it('collapses entries sharing a cell to one, first-seen wins', () => {
    // Three boxes whose centres all fall inside the same 2px cell.
    const boxes = boxesOf([
      [0, 0, 0, 0],
      [0.5, 0.5, 0, 0],
      [1, 1, 0, 0],
    ])
    const buffer = Uint32Array.from([0, 1, 2])
    const kept = decimateByCell(boxes, buffer, 3, IDENTITY, VP, 2, freshGrid(VP, 2))
    expect(kept).toBe(1)
    expect(buffer[0]).toBe(0)
  })

  it('uses the box CENTRE, not its origin', () => {
    // Box origin at 0 but 40 wide -> centre at 20 -> a different cell than a
    // point box at 0.
    const boxes = boxesOf([
      [0, 0, 0, 0],
      [0, 0, 40, 40],
    ])
    const buffer = Uint32Array.from([0, 1])
    const kept = decimateByCell(boxes, buffer, 2, IDENTITY, VP, 2, freshGrid(VP, 2))
    expect(kept).toBe(2)
  })

  it('bounds the survivor count by the number of cells', () => {
    // 200 boxes scattered across the viewport; survivors <= cols*rows and never
    // exceed the input count.
    const rows: [number, number, number, number][] = []
    for (let i = 0; i < 200; i++) rows.push([(i * 7) % 100, (i * 13) % 100, 0, 0])
    const boxes = boxesOf(rows)
    const buffer = Uint32Array.from(rows.map((_, i) => i))
    const cell = 10
    const kept = decimateByCell(boxes, buffer, rows.length, IDENTITY, VP, cell, freshGrid(VP, cell))
    expect(kept).toBeLessThanOrEqual(gridSizeFor(VP, cell))
    expect(kept).toBeLessThan(200)
  })

  it('clamps off-screen centres into the edge cells instead of overflowing the grid', () => {
    // Negative and past-edge centres must not read/write outside the grid, and
    // still dedupe against the edge cell.
    const boxes = boxesOf([
      [-1000, -1000, 0, 0],
      [-2000, -2000, 0, 0],
      [9999, 9999, 0, 0],
    ])
    const buffer = Uint32Array.from([0, 1, 2])
    const kept = decimateByCell(boxes, buffer, 3, IDENTITY, VP, 2, freshGrid(VP, 2))
    // First two clamp to the top-left cell (one survives); third to bottom-right.
    expect(kept).toBe(2)
  })

  it('reuses the grid across calls (zeroes its own region)', () => {
    const boxes = boxesOf([[0, 0, 0, 0]])
    const grid = freshGrid(VP, 2)
    const b1 = Uint32Array.from([0])
    expect(decimateByCell(boxes, b1, 1, IDENTITY, VP, 2, grid)).toBe(1)
    const b2 = Uint32Array.from([0])
    expect(decimateByCell(boxes, b2, 1, IDENTITY, VP, 2, grid)).toBe(1)
  })

  it('handles fractional dpr without losing entries to out-of-range indices', () => {
    // Regression test for floating-point divergence between gridSizeFor and
    // decimateByCell. With fractional dpr, the two functions computed cols/rows
    // differently: gridSizeFor used Math.ceil((width * dpr) / cellDevicePx)
    // while decimateByCell used Math.ceil(width / (cellDevicePx / dpr)).
    // This could cause decimateByCell's cols to be LARGER than gridSizeFor's,
    // leading to out-of-range grid indices that silently dropped entries.
    const vp: DecimationViewport = { width: 1600, height: 100, dpr: 1.1 }
    const cellDevicePx = 4
    const gridSize = gridSizeFor(vp, cellDevicePx)
    const grid = new Uint8Array(gridSize)

    // Create boxes with centres spanning the full width (including near the right edge).
    // Each box is small (1x1) so their centres determine the cell uniquely.
    const rows: [number, number, number, number][] = []
    const positions = [0, 400, 800, 1200, 1599] // Near left, middle, and right edge
    for (const x of positions) {
      rows.push([x, 50, 1, 1]) // Center at (x+0.5, 50.5)
    }
    const boxes = boxesOf(rows)
    const buffer = Uint32Array.from(rows.map((_, i) => i))

    const kept = decimateByCell(boxes, buffer, rows.length, IDENTITY, vp, cellDevicePx, grid)

    // All boxes occupy distinct cells, so all should be kept.
    expect(kept).toBe(rows.length)
    // Verify the survivor indices match (in order, no duplicates).
    expect(Array.from(buffer.subarray(0, kept))).toEqual([0, 1, 2, 3, 4])
  })
})
