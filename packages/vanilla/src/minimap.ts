import {
  computeSilhouette,
  minimapToWorld,
  viewportRectInMinimap,
  worldToMinimap,
  type Bounds,
  type Camera,
  type MinimapTransform,
  type Silhouette,
  type SilhouetteOptions,
  type ViewportSize,
} from '@n1crack/orgchart-core'

export type MinimapPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface MinimapOptions {
  width?: number
  height?: number
  position?: MinimapPosition
}

export interface MinimapCallbacks {
  /** A world-space point to centre the camera on — see `minimapToWorld`. */
  onPan(worldX: number, worldY: number): void
}

export interface Minimap {
  /**
   * Call once per RELAYOUT only (i.e. when `boxes`/`bounds` identity actually
   * changed) — recomputes the silhouette and repaints the small canvas.
   * Never call this per frame: `computeSilhouette` walks every node, which is
   * exactly the cost a minimap exists to avoid paying on every camera move.
   */
  onLayout(boxes: Float64Array, bounds: Bounds): void
  /**
   * Call on every camera change. Cheap: two point transforms and a CSS
   * `transform` write on an already-painted overlay, no silhouette work.
   */
  onCamera(camera: Camera, viewport: ViewportSize): void
  destroy(): void
}

const DEFAULT_WIDTH = 200
const DEFAULT_HEIGHT = 140

/**
 * Softening tuned by eye against the playground's Large (20k-node) example —
 * the design's own defaults (`blur: 1, saturateAt: 3`, meant for a synthetic
 * tree) read as too faint and speckled at real chart density, where deep
 * subtrees stack many overlapping boxes into a handful of minimap cells.
 * `saturateAt: 6` lets a cell read as "solid" only once several boxes really
 * do stack there, so sparse areas (a shallow branch) stay visibly lighter
 * than dense ones (a deep, bushy subtree) instead of both slamming to full
 * opacity; `blur: 2` fuses that into one continuous mass instead of a grid of
 * flickering single-cell dots. `padding: 6` keeps the silhouette off the
 * minimap's own border.
 */
// saturateAt is how many boxes must cover a grid cell for it to read as fully
// opaque. In a tidy tree siblings do NOT overlap, so most cells are covered by a
// single box — a high value (6 was the first guess) then leaves the whole
// silhouette near-transparent, which is why it was hard to see at all. Low, so a
// single covered cell already reads as solid, is right for tree shapes.
const SILHOUETTE_OPTIONS: Partial<SilhouetteOptions> = { padding: 6, blur: 2, saturateAt: 1.5 }

/** RGB for the silhouette fill — a neutral slate, legible on light or dark hosts. */
const SILHOUETTE_RGB: readonly [number, number, number] = [71, 85, 105]

function paintSilhouette(ctx: CanvasRenderingContext2D, silhouette: Silhouette): void {
  ctx.clearRect(0, 0, silhouette.width, silhouette.height)
  const imageData = ctx.createImageData(silhouette.width, silhouette.height)
  const data = imageData.data
  const [r, g, b] = SILHOUETTE_RGB
  for (let i = 0; i < silhouette.alpha.length; i++) {
    const o = i * 4
    data[o] = r
    data[o + 1] = g
    data[o + 2] = b
    data[o + 3] = silhouette.alpha[i]!
  }
  ctx.putImageData(imageData, 0, 0)
}

/**
 * Clamps the viewport rectangle's DRAWN edges to the minimap's own
 * `[0, width] x [0, height]` box. Purely a display concern: the rectangle
 * coming out of `viewportRectInMinimap` can legitimately extend beyond the
 * minimap entirely — zoomed out past the whole tree, or panned off its edge
 * — this only stops what gets painted from spilling past the widget's own
 * border. `transform` (and therefore `minimapToWorld`) is never touched, so
 * click-to-navigate keeps mapping a click to the true world point under the
 * pointer regardless of where the rectangle itself got clamped to.
 *
 * Each edge is clamped independently before the width/height are derived
 * from the clamped edges (not the other way around), which is what makes a
 * viewport far larger than the whole minimap collapse to exactly
 * `{ x: 0, y: 0, w: width, h: height }` — "you can see everything" — rather
 * than an inverted or negative-size box: `clamp` is monotonic, so a clamped
 * max edge can never land before a clamped min edge.
 */
function clampViewportRect(
  rect: Bounds,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  const clamp = (value: number, max: number): number => Math.min(Math.max(value, 0), max)

  const minX = clamp(Math.min(rect.minX, rect.maxX), width)
  const minY = clamp(Math.min(rect.minY, rect.maxY), height)
  const maxX = clamp(Math.max(rect.minX, rect.maxX), width)
  const maxY = clamp(Math.max(rect.minY, rect.maxY), height)

  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

function positionRoot(el: HTMLElement, position: MinimapPosition): void {
  el.style.top = position.startsWith('top') ? '8px' : 'auto'
  el.style.bottom = position.startsWith('bottom') ? '8px' : 'auto'
  el.style.left = position.endsWith('left') ? '8px' : 'auto'
  el.style.right = position.endsWith('right') ? '8px' : 'auto'
}

/**
 * A filled silhouette of the occupied area (see `computeSilhouette`'s
 * docblock in core), not a shrunken chart — at minimap scale individual
 * boxes fall below a pixel and connectors vanish, so what's useful is the
 * shape of the tree, not a miniature redraw of it. Painted once per relayout
 * into an `ImageData` alpha channel on a small canvas and cached; only the
 * viewport rectangle — a CSS-transformed overlay — moves per camera change.
 *
 * Clicking or dragging inside the minimap pans the main camera: this module
 * only reports the world point under the pointer (via `onPan`); centring the
 * camera on it is the host's job (`centreOn` + its own camera state), the
 * same division of labour `core/minimap.ts` documents for `minimapToWorld`.
 */
export function createMinimap(
  container: HTMLElement,
  options: MinimapOptions,
  callbacks: MinimapCallbacks,
): Minimap {
  const width = options.width ?? DEFAULT_WIDTH
  const height = options.height ?? DEFAULT_HEIGHT
  const position = options.position ?? 'bottom-right'

  const root = document.createElement('div')
  root.className = 'orgchart-minimap'
  root.style.position = 'absolute'
  root.style.width = `${width}px`
  root.style.height = `${height}px`
  root.style.background = 'rgba(255, 255, 255, 0.85)'
  root.style.border = '1px solid rgba(0, 0, 0, 0.15)'
  root.style.borderRadius = '4px'
  root.style.overflow = 'hidden'
  root.style.cursor = 'pointer'
  // Softened by eye against the playground: the previous `0 1px 4px / 0.2`
  // read as a hard-edged hole punched in the chart underneath it. A smaller
  // blur radius and much lower alpha let the widget read as a quiet raised
  // plate instead of a shadow the eye trips over.
  root.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.08)'
  root.style.touchAction = 'none'
  positionRoot(root, position)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.style.position = 'absolute'
  canvas.style.inset = '0'
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.display = 'block'
  root.appendChild(canvas)

  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('OrgChart: 2D canvas context unavailable for minimap')

  const viewportEl = document.createElement('div')
  viewportEl.style.position = 'absolute'
  viewportEl.style.top = '0'
  viewportEl.style.left = '0'
  viewportEl.style.transformOrigin = '0 0'
  viewportEl.style.pointerEvents = 'none'
  viewportEl.style.boxSizing = 'border-box'
  viewportEl.style.border = '1.5px solid rgba(37, 99, 235, 0.9)'
  viewportEl.style.background = 'rgba(37, 99, 235, 0.12)'
  root.appendChild(viewportEl)

  container.appendChild(root)

  let transform: MinimapTransform | null = null

  /**
   * True when `bounds` lies entirely inside the widget under `t` — i.e. the
   * existing frame can still show the whole tree, so there is no reason to
   * refit it.
   *
   * A small tolerance absorbs the rounding that a round trip through the
   * transform's own arithmetic introduces; without it a layout that fits
   * exactly (the very layout the transform was fitted to) can read as
   * overflowing by a fraction of a pixel and trigger a pointless refit.
   */
  const fitsUnder = (t: MinimapTransform, bounds: Bounds): boolean => {
    const padding = SILHOUETTE_OPTIONS.padding ?? 0
    const topLeft = worldToMinimap(t, bounds.minX, bounds.minY)
    const bottomRight = worldToMinimap(t, bounds.maxX, bounds.maxY)
    const slack = 0.5
    return (
      topLeft.x >= padding - slack &&
      topLeft.y >= padding - slack &&
      bottomRight.x <= width - padding + slack &&
      bottomRight.y <= height - padding + slack
    )
  }

  const pointToWorld = (event: PointerEvent): { x: number; y: number } | null => {
    if (transform === null) return null
    const rect = root.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    const mx = ((event.clientX - rect.left) / rect.width) * width
    const my = ((event.clientY - rect.top) / rect.height) * height
    return minimapToWorld(transform, mx, my)
  }

  let dragging = false
  const onPointerDown = (event: PointerEvent): void => {
    dragging = true
    // Best-effort: capture keeps a real drag tracking even once the pointer
    // strays outside the (small) minimap rect. Guarded because capturing a
    // pointer id with no corresponding live OS pointer session — which is
    // exactly what a synthetically dispatched PointerEvent in a test is —
    // throws `NotFoundError` in some engines; that must not abort the pan.
    try {
      root.setPointerCapture(event.pointerId)
    } catch {
      // Ignored — see above.
    }
    const world = pointToWorld(event)
    if (world !== null) callbacks.onPan(world.x, world.y)
  }
  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return
    const world = pointToWorld(event)
    if (world !== null) callbacks.onPan(world.x, world.y)
  }
  const onPointerUp = (event: PointerEvent): void => {
    dragging = false
    try {
      if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId)
    } catch {
      // Ignored — see onPointerDown's comment.
    }
  }

  root.addEventListener('pointerdown', onPointerDown)
  root.addEventListener('pointermove', onPointerMove)
  root.addEventListener('pointerup', onPointerUp)
  root.addEventListener('pointercancel', onPointerUp)

  return {
    onLayout(boxes, bounds) {
      // Keep the frame we already have whenever the new layout still fits in
      // it, and refit only when it genuinely doesn't. Refitting on every
      // relayout — which is what fitting `bounds` unconditionally amounts to
      // — makes the minimap's scale a function of what happens to be expanded
      // right now: collapsing the root shrinks `bounds` to a single node and
      // that one node then fills the whole widget. The scale lurches on every
      // toggle and nothing on the minimap stays where it was, so it reads as
      // a zoom rather than a map.
      //
      // Holding the transform steady instead means collapsing simply removes
      // mass from a frame that doesn't move, and the viewport rectangle keeps
      // the same size for the same camera. Expanding past the frame's edge
      // still refits, because at that point the alternative is drawing the
      // tree outside the widget.
      const reuse = transform !== null && fitsUnder(transform, bounds)
      const silhouette = computeSilhouette(boxes, bounds, { width, height }, {
        ...SILHOUETTE_OPTIONS,
        ...(reuse ? { transform: transform! } : {}),
      })
      transform = silhouette.transform
      paintSilhouette(ctx, silhouette)
    },
    onCamera(camera, viewport) {
      if (transform === null) return
      const rect = viewportRectInMinimap(transform, camera, viewport)
      const { x, y, w, h } = clampViewportRect(rect, width, height)
      viewportEl.style.transform = `translate(${x}px, ${y}px)`
      viewportEl.style.width = `${w}px`
      viewportEl.style.height = `${h}px`
    },
    destroy() {
      root.removeEventListener('pointerdown', onPointerDown)
      root.removeEventListener('pointermove', onPointerMove)
      root.removeEventListener('pointerup', onPointerUp)
      root.removeEventListener('pointercancel', onPointerUp)
      root.remove()
    },
  }
}
