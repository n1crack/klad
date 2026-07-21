import type { Bounds } from './types.js'
import type { Camera } from './viewport.js'
import type { Renderer } from './render/renderer.js'
import type { EngineOptions, WireTree } from './worker/protocol.js'
import { wireTreeToTree } from './worker/protocol.js'
import { pruneToVisible } from './visible.js'
import { layout } from './layout/tidy.js'
import { applyOrientation } from './layout/orientation.js'
import { buildQuadTree, type QuadTree } from './spatial/quadtree.js'
import { visibleRect } from './viewport.js'
import { DEFAULT_LOD, lodFor } from './render/lod.js'
import type { Tree } from './tree.js'

export interface ChartEngine {
  setData(tree: WireTree, sizes: Float64Array, labels: string[], open: Uint8Array): void
  setOptions(partial: Partial<EngineOptions>): void
  setOpen(index: number, open: boolean): void
  setCamera(camera: Camera): void
  setViewport(width: number, height: number, dpr: number): void
  setHighlight(sourceIds: Uint32Array | null): void
  setDrag(sourceIndex: number): void
  /** Draws a frame and returns the SOURCE indices currently on screen. */
  render(): Uint32Array
  /** Boxes in the pruned index space. */
  readonly boxes: Float64Array
  readonly bounds: Bounds
  /** Pruned index -> source index. */
  readonly visibleToSource: Int32Array
  /** World-space hit test; returns a SOURCE index or -1. */
  hitTest(worldX: number, worldY: number): number
}

const DEFAULT_OPTIONS: EngineOptions = {
  spacingX: 16,
  spacingY: 48,
  orientation: 'tb',
  rtl: false,
  lod: DEFAULT_LOD,
}

const EMPTY_BOUNDS: Bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 }

/**
 * Owns all mutable chart state. Deliberately free of any transport concern: the
 * worker entry wraps it, and the main-thread fallback drives the identical
 * object, so the two paths cannot drift apart.
 *
 * Layout runs only when data, options, or open state change. A camera move
 * re-culls and redraws but never re-lays-out — that separation is what keeps a
 * 50k chart at 60fps.
 */
export function createChartEngine(renderer: Renderer): ChartEngine {
  let sourceTree: Tree = wireTreeToTree({
    count: 0,
    parent: new Int32Array(0),
    childStart: new Int32Array(1),
    childIndex: new Int32Array(0),
    roots: new Int32Array(0),
    depth: new Int32Array(0),
    order: new Int32Array(0),
  })
  let sourceSizes: Float64Array = new Float64Array(0)
  let sourceLabels: string[] = []
  let open: Uint8Array = new Uint8Array(0)
  let options: EngineOptions = { ...DEFAULT_OPTIONS }

  let boxes: Float64Array = new Float64Array(0)
  let bounds: Bounds = EMPTY_BOUNDS
  let visibleToSource: Int32Array = new Int32Array(0)
  let prunedParent: Int32Array = new Int32Array(0)
  let prunedLabels: string[] = []
  let quad: QuadTree | null = null

  let camera: Camera = { x: 0, y: 0, k: 1 }
  let viewport = { width: 0, height: 0, dpr: 1 }
  let highlightSource: Uint32Array | null = null
  let dragSource = -1

  let layoutDirty = true
  let cullBuffer = new Uint32Array(0)
  let highlightBuffer: Uint8Array | null = null

  const relayout = (): void => {
    const pruned = pruneToVisible(sourceTree, open)
    visibleToSource = pruned.toSource
    prunedParent = pruned.tree.parent

    const n = pruned.tree.count
    const sizes = new Float64Array(n * 2)
    prunedLabels = Array.from({ length: n })
    for (let i = 0; i < n; i++) {
      const src = visibleToSource[i]!
      sizes[i * 2] = sourceSizes[src * 2] ?? 0
      sizes[i * 2 + 1] = sourceSizes[src * 2 + 1] ?? 0
      prunedLabels[i] = sourceLabels[src] ?? ''
    }

    const result = layout(pruned.tree, sizes, {
      spacingX: options.spacingX,
      spacingY: options.spacingY,
    })
    boxes = result.boxes
    bounds = applyOrientation(boxes, result.bounds, options.orientation, options.rtl)
    quad = buildQuadTree(boxes, bounds)

    if (cullBuffer.length < n) cullBuffer = new Uint32Array(n)
    layoutDirty = false
  }

  const render = (): Uint32Array => {
    if (layoutDirty) relayout()

    const n = visibleToSource.length
    let count = 0
    if (n > 0 && quad !== null && viewport.width > 0 && viewport.height > 0) {
      const rect = visibleRect(camera, { width: viewport.width, height: viewport.height })
      count = quad.query(rect, cullBuffer)
    }

    if (highlightSource === null) {
      highlightBuffer = null
    } else {
      if (highlightBuffer === null || highlightBuffer.length < n) highlightBuffer = new Uint8Array(n)
      else highlightBuffer.fill(0)
      // highlightSource holds SOURCE indices; translate into pruned space.
      for (const src of highlightSource) {
        for (let i = 0; i < n; i++) {
          if (visibleToSource[i] === src) {
            highlightBuffer[i] = 1
            break
          }
        }
      }
    }

    let dragPruned = -1
    if (dragSource !== -1) {
      for (let i = 0; i < n; i++) {
        if (visibleToSource[i] === dragSource) {
          dragPruned = i
          break
        }
      }
    }

    const tier = lodFor(camera.k, options.lod)
    renderer.draw({
      boxes,
      parent: prunedParent,
      visible: cullBuffer,
      visibleCount: count,
      labels: tier === 'block' ? [] : prunedLabels,
      camera,
      dpr: viewport.dpr,
      tier,
      horizontal: options.orientation === 'lr' || options.orientation === 'rl',
      highlight: highlightBuffer,
      dragIndex: dragPruned,
    })

    const drawn = new Uint32Array(count)
    for (let n2 = 0; n2 < count; n2++) drawn[n2] = visibleToSource[cullBuffer[n2]!]!
    return drawn
  }

  return {
    setData(tree, sizes, labels, openFlags) {
      sourceTree = wireTreeToTree(tree)
      sourceSizes = sizes
      sourceLabels = labels
      open = openFlags
      layoutDirty = true
    },
    setOptions(partial) {
      options = { ...options, ...partial }
      layoutDirty = true
    },
    setOpen(index, value) {
      if (index < 0 || index >= open.length) return
      open[index] = value ? 1 : 0
      layoutDirty = true
    },
    setCamera(next) {
      camera = next
    },
    setViewport(width, height, dpr) {
      viewport = { width, height, dpr }
      renderer.resize(width, height, dpr)
    },
    setHighlight(ids) {
      highlightSource = ids
    },
    setDrag(index) {
      dragSource = index
    },
    render,
    get boxes() {
      return boxes
    },
    get bounds() {
      return bounds
    },
    get visibleToSource() {
      return visibleToSource
    },
    hitTest(worldX, worldY) {
      if (layoutDirty) relayout()
      if (quad === null) return -1
      const pruned = quad.hitTest(worldX, worldY)
      return pruned === -1 ? -1 : visibleToSource[pruned]!
    },
  }
}
