import { describe, expect, it } from 'vitest'
import { applyOrientation } from './orientation.js'
import type { Orientation } from './orientation.js'
import type { Bounds } from '../types.js'

/** Two boxes: a 100x50 at the origin and a 60x40 to its lower right. */
function fixture(): { boxes: Float64Array; bounds: Bounds } {
  return {
    boxes: Float64Array.from([0, 0, 100, 50, 20, 70, 60, 40]),
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 110 },
  }
}

/**
 * Three siblings, asymmetric on every axis (distinct x, y, w, h across all
 * three boxes, and no coincidental symmetry between them). A 2-node fixture
 * can't distinguish "flipped the right axis" from "flipped the wrong axis"
 * when both produce the same pairwise swap — this fixture can, and pins
 * relative sibling order (not just absolute coordinates).
 */
function asymmetricFixture(): { boxes: Float64Array; bounds: Bounds } {
  return {
    boxes: Float64Array.from([
      0, 0, 10, 5, // A
      15, 8, 20, 6, // B
      40, 20, 5, 15, // C
    ]),
    bounds: { minX: 0, minY: 0, maxX: 45, maxY: 35 },
  }
}

const ORIENTATIONS: Orientation[] = ['tb', 'bt', 'lr', 'rl']

function assertWithinBounds(boxes: Float64Array, bounds: Bounds): void {
  const n = boxes.length / 4
  for (let i = 0; i < n; i++) {
    const o = i * 4
    const x = boxes[o]!
    const y = boxes[o + 1]!
    const w = boxes[o + 2]!
    const h = boxes[o + 3]!
    expect(x).toBeGreaterThanOrEqual(bounds.minX)
    expect(y).toBeGreaterThanOrEqual(bounds.minY)
    expect(x + w).toBeLessThanOrEqual(bounds.maxX)
    expect(y + h).toBeLessThanOrEqual(bounds.maxY)
  }
}

describe('applyOrientation', () => {
  it('leaves tb untouched', () => {
    const { boxes, bounds } = fixture()
    const out = applyOrientation(boxes, bounds, 'tb', false)
    expect(Array.from(boxes)).toEqual([0, 0, 100, 50, 20, 70, 60, 40])
    expect(out).toEqual(bounds)
  })

  it('mirrors vertically for bt', () => {
    const { boxes, bounds } = fixture()
    const out = applyOrientation(boxes, bounds, 'bt', false)
    // First box: y becomes 110 - (0 + 50) = 60.
    expect(boxes[1]).toBe(60)
    // Second box: y becomes 110 - (70 + 40) = 0.
    expect(boxes[5]).toBe(0)
    expect(boxes[0]).toBe(0) // x untouched
    expect(out).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 110 })
  })

  it('transposes for lr, swapping both position and size', () => {
    const { boxes, bounds } = fixture()
    const out = applyOrientation(boxes, bounds, 'lr', false)
    // Box 0: (x,y,w,h) 0,0,100,50 -> 0,0,50,100
    expect(Array.from(boxes.slice(0, 4))).toEqual([0, 0, 50, 100])
    // Box 1: 20,70,60,40 -> 70,20,40,60
    expect(Array.from(boxes.slice(4, 8))).toEqual([70, 20, 40, 60])
    expect(out).toEqual({ minX: 0, minY: 0, maxX: 110, maxY: 100 })
  })

  it('transposes then mirrors horizontally for rl', () => {
    const { boxes, bounds } = fixture()
    const out = applyOrientation(boxes, bounds, 'rl', false)
    // After transpose box 0 is 0,0,50,100; mirrored: x = 110 - (0 + 50) = 60.
    expect(boxes[0]).toBe(60)
    // After transpose box 1 is 70,20,40,60; mirrored: x = 110 - (70 + 40) = 0.
    expect(boxes[4]).toBe(0)
    expect(out).toEqual({ minX: 0, minY: 0, maxX: 110, maxY: 100 })
  })

  it('mirrors horizontally when rtl is set on a vertical orientation', () => {
    const { boxes, bounds } = fixture()
    applyOrientation(boxes, bounds, 'tb', true)
    expect(boxes[0]).toBe(0) // 100 - (0 + 100)
    expect(boxes[4]).toBe(20) // 100 - (20 + 60)
  })

  // Decided semantics: rtl always mirrors the sibling (cross) axis — x for
  // tb/bt, y for lr/rl — independently of the orientation's own main-axis
  // flip. 'lr + rtl' must NOT equal 'rl'.
  describe('rtl mirrors the cross axis, independent of orientation', () => {
    it('lr + rtl is not the same layout as rl (rtl=false)', () => {
      const lrRtl = asymmetricFixture()
      const rl = asymmetricFixture()
      applyOrientation(lrRtl.boxes, lrRtl.bounds, 'lr', true)
      applyOrientation(rl.boxes, rl.bounds, 'rl', false)
      expect(Array.from(lrRtl.boxes)).not.toEqual(Array.from(rl.boxes))
    })

    it('lr + rtl leaves x (depth) exactly as plain lr and reverses y (sibling) order', () => {
      const plainLr = asymmetricFixture()
      const rtlLr = asymmetricFixture()
      applyOrientation(plainLr.boxes, plainLr.bounds, 'lr', false)
      applyOrientation(rtlLr.boxes, rtlLr.bounds, 'lr', true)

      // Depth axis (x) is untouched by rtl.
      expect(rtlLr.boxes[0]).toBe(plainLr.boxes[0])
      expect(rtlLr.boxes[4]).toBe(plainLr.boxes[4])
      expect(rtlLr.boxes[8]).toBe(plainLr.boxes[8])

      // Plain lr keeps sibling order A, B, C along y (ascending).
      const plainYs = [plainLr.boxes[1]!, plainLr.boxes[5]!, plainLr.boxes[9]!]
      expect(plainYs).toEqual([...plainYs].sort((a, b) => a - b))

      // rtl reverses that sibling order: C, B, A along y (ascending) — note
      // the mirrored *positions* aren't a plain index-swap of the originals
      // (each box's size shifts its mirrored position too), but the order
      // itself is exactly reversed.
      const rtlYs = [rtlLr.boxes[1]!, rtlLr.boxes[5]!, rtlLr.boxes[9]!]
      expect(rtlYs).toEqual([...rtlYs].sort((a, b) => b - a))
    })

    it('tb + rtl leaves y untouched and reverses x (sibling) order', () => {
      const plainTb = asymmetricFixture()
      const rtlTb = asymmetricFixture()
      applyOrientation(plainTb.boxes, plainTb.bounds, 'tb', false)
      applyOrientation(rtlTb.boxes, rtlTb.bounds, 'tb', true)

      // Depth axis (y) is untouched by rtl.
      expect(rtlTb.boxes[1]).toBe(plainTb.boxes[1])
      expect(rtlTb.boxes[5]).toBe(plainTb.boxes[5])
      expect(rtlTb.boxes[9]).toBe(plainTb.boxes[9])

      const plainXs = [plainTb.boxes[0]!, plainTb.boxes[4]!, plainTb.boxes[8]!]
      expect(plainXs).toEqual([...plainXs].sort((a, b) => a - b))

      const rtlXs = [rtlTb.boxes[0]!, rtlTb.boxes[4]!, rtlTb.boxes[8]!]
      expect(rtlXs).toEqual([...rtlXs].sort((a, b) => b - a))
    })

    it.each(ORIENTATIONS)('keeps every box within the returned bounds for %s, rtl=false', (orientation) => {
      const { boxes, bounds } = asymmetricFixture()
      const out = applyOrientation(boxes, bounds, orientation, false)
      assertWithinBounds(boxes, out)
    })

    it.each(ORIENTATIONS)('keeps every box within the returned bounds for %s, rtl=true', (orientation) => {
      const { boxes, bounds } = asymmetricFixture()
      const out = applyOrientation(boxes, bounds, orientation, true)
      assertWithinBounds(boxes, out)
    })
  })

  it('handles an empty layout', () => {
    const bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 }
    const out = applyOrientation(new Float64Array(0), bounds, 'lr', true)
    expect(out).toEqual(bounds)
  })
})
