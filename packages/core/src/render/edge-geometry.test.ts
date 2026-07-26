import { describe, expect, it } from 'vitest'
import { edgeAnchors, edgeBBox, edgeStyleDrawsConnectors, FOLDER_SPINE_FRAC } from './edge-geometry.js'

// A parent row and a child row indented under it, the shape the `file` layout
// produces: same width, same height, the child one indent to the right and one
// row down.
const PARENT = { x: 0, y: 0, w: 300, h: 20 }
const CHILD = { x: 18, y: 24, w: 300, h: 20 }

const anchors = (style: Parameters<typeof edgeAnchors>[0], rtl = false) =>
  edgeAnchors(
    style,
    false,
    rtl,
    PARENT.x,
    PARENT.y,
    PARENT.w,
    PARENT.h,
    CHILD.x,
    CHILD.y,
    CHILD.w,
    CHILD.h,
  )

describe('edgeAnchors', () => {
  it('runs the folder spine down the indent gutter, not across the row', () => {
    const a = anchors('folder')
    // Halfway between the two LEADING edges — i.e. the middle of the indent.
    // Deriving it from the parent's own WIDTH instead (the obvious-looking
    // alternative) lands the spine on top of the child's leading edge on a
    // list of uniform full-width rows, which draws a stub instead of a guide
    // line.
    expect(a.px).toBeCloseTo(PARENT.x + (CHILD.x - PARENT.x) * FOLDER_SPINE_FRAC)
    expect(a.px).toBeCloseTo(9)
    expect(a.px).toBeLessThan(CHILD.x)
    expect(a.py).toBe(PARENT.y + PARENT.h)
    expect(a.cx).toBe(CHILD.x)
    expect(a.cy).toBe(CHILD.y + CHILD.h / 2)
  })

  it('puts every child of one parent on the same spine', () => {
    // The property that makes a run of siblings read as one guide line rather
    // than a bracket per row: the spine's x may not depend on which child the
    // edge leads to.
    const first = anchors('folder')
    const later = edgeAnchors('folder', false, false, 0, 0, 300, 20, 18, 500, 300, 20)
    expect(later.px).toBeCloseTo(first.px)
  })

  it('mirrors the folder spine for a right-to-left list', () => {
    const a = anchors('folder', true)
    expect(a.px).toBeCloseTo(PARENT.x + PARENT.w + (CHILD.x + CHILD.w - (PARENT.x + PARENT.w)) * FOLDER_SPINE_FRAC)
    expect(a.cx).toBe(CHILD.x + CHILD.w)
  })

  it('runs a spoke between the two centres', () => {
    const a = anchors('spoke')
    expect(a.px).toBe(PARENT.x + PARENT.w / 2)
    expect(a.py).toBe(PARENT.y + PARENT.h / 2)
    expect(a.cx).toBe(CHILD.x + CHILD.w / 2)
    expect(a.cy).toBe(CHILD.y + CHILD.h / 2)
  })

  it('leaves the tiered elbow exactly as it was', () => {
    const vertical = anchors('tiered')
    expect(vertical.px).toBe(PARENT.x + PARENT.w / 2)
    expect(vertical.py).toBe(PARENT.y + PARENT.h)
    expect(vertical.cx).toBe(CHILD.x + CHILD.w / 2)
    expect(vertical.cy).toBe(CHILD.y)

    const horizontal = edgeAnchors('tiered', true, false, 0, 0, 300, 20, 18, 24, 300, 20)
    expect(horizontal.px).toBe(PARENT.x + PARENT.w)
    expect(horizontal.py).toBe(PARENT.y + PARENT.h / 2)
    expect(horizontal.cx).toBe(CHILD.x)
    expect(horizontal.cy).toBe(CHILD.y + CHILD.h / 2)
  })

  it('degenerates rather than producing NaN for a style that draws nothing', () => {
    const a = anchors('none')
    expect(a.px).toBe(a.cx)
    expect(a.py).toBe(a.cy)
    expect(Number.isFinite(a.px)).toBe(true)
  })
})

describe('edgeStyleDrawsConnectors', () => {
  it('is false only for none', () => {
    expect(edgeStyleDrawsConnectors('none')).toBe(false)
    for (const style of ['tiered', 'folder', 'spoke'] as const) {
      expect(edgeStyleDrawsConnectors(style)).toBe(true)
    }
  })
})

describe('edgeBBox', () => {
  it('spans the two anchors whichever way round they are', () => {
    expect(edgeBBox({ px: 10, py: 4, cx: 2, cy: 30 })).toEqual({ x: 2, y: 4, w: 8, h: 26 })
    expect(edgeBBox({ px: 2, py: 30, cx: 10, cy: 4 })).toEqual({ x: 2, y: 4, w: 8, h: 26 })
  })

  it('contains every point of the folder path it describes', () => {
    // The cull box has to bound what is actually PAINTED, or the culler drops
    // connectors that are on screen. A folder edge is two segments: down the
    // spine, then out to the child.
    const a = anchors('folder')
    const box = edgeBBox(a)
    const points = [
      { x: a.px, y: a.py },
      { x: a.px, y: a.cy },
      { x: a.cx, y: a.cy },
    ]
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(box.x)
      expect(p.x).toBeLessThanOrEqual(box.x + box.w)
      expect(p.y).toBeGreaterThanOrEqual(box.y)
      expect(p.y).toBeLessThanOrEqual(box.y + box.h)
    }
  })
})
