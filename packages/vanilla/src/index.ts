import { createChartHost, type ChartHost } from '@n1crack/orgchart-core/host'
import {
  applyOrientation,
  centreOn,
  createCanvas2DRenderer,
  createTextMeasurer,
  DEFAULT_LOD,
  easeInOutCubic,
  fit as fitCamera,
  interpolate,
  layout,
  normalize,
  overlayEnabled,
  pan,
  pruneToVisible,
  resolveTheme,
  screenToWorld,
  toSVG as coreToSVG,
  toWireTree,
  transitionAnchorProgress,
  zoomAt,
  type Bounds,
  type Camera,
  type ExportData,
  type Frame,
  type LodThresholds,
  type NodeData,
  type Orientation,
  type RenderSurface,
  type Size,
  type SvgExportOptions,
  type Theme,
  type Tree,
  type Warning,
  type ZoomLimits,
} from '@n1crack/orgchart-core'
import { createA11yTree, type A11yTree } from './a11y.js'
import { attachInput } from './input.js'
import { createMinimap, type Minimap, type MinimapOptions } from './minimap.js'
import { createOverlay } from './overlay.js'

export interface NodeContext {
  id: string
  item: NodeData
  open: boolean
  hasChildren: boolean
  toggle(): void
}

export interface Options {
  data: NodeData[]
  nodeSize: Size | ((item: NodeData) => Size)
  label?: (item: NodeData) => string
  orientation?: Orientation
  rtl?: boolean
  spacing?: { x?: number; y?: number }
  lodThresholds?: LodThresholds
  collapsedByDefault?: boolean | ((item: NodeData) => boolean)
  theme?: Partial<Theme>
  /**
   * A filled silhouette of the occupied area plus a draggable viewport
   * rectangle (design doc §11.5) — not a shrunken chart: at minimap scale
   * individual boxes fall below a pixel and connectors vanish, so what's
   * useful is the shape of the tree, not a miniature redraw of it. Painted
   * once per relayout, never per frame; clicking or dragging inside it pans
   * the camera. `true` uses the default 200x140 size, bottom-right. Default
   * `false`.
   */
  minimap?: boolean | MinimapOptions
  zoomLimits?: ZoomLimits
  worker?: boolean
  renderNode?: (element: HTMLElement, context: NodeContext) => void
  /**
   * Governs every camera *animation* this layer produces on its own initiative:
   * the 200ms ease tween behind `focus`/`fit`/`reset`/`zoomTo`/`zoomIn`/`zoomOut`
   * and the accessibility layer's focus-follows-camera, the auto-pan-into-view
   * after a single-node expand/collapse, and kinetic panning's momentum coast
   * after a drag release. `false` makes all of these instantaneous — the camera
   * still moves, just without the animation. Defaults to `true`, but is
   * overridden to `false` whenever the OS reports `prefers-reduced-motion:
   * reduce`: an unrequested slide or coast is exactly what that setting exists
   * to suppress, so it is not treated as optional polish.
   */
  animate?: boolean
  /**
   * After a single-node `expand`/`collapse` (not `expandAll`/`collapseAll`,
   * which always `fit()` — the whole chart changed, so a full fit is the
   * sensible response), pins the toggled node to a FIXED screen position for
   * the whole staged layout transition (see engine.ts's two-phase
   * choreography), rather than panning the camera TO it: the node is the
   * fixed point everything else grows out of or collapses back into, on- or
   * off-screen alike — the point is to hold what the user just acted on
   * still, not to move the camera at all. Zoom is never touched by this —
   * only the pan. Defaults to `true`.
   */
  autoPanOnToggle?: boolean
  /**
   * The one-shot confirmation ring (`theme.ringStroke`) that flashes on the
   * node a single-node `expand`/`collapse` just acted on. Some consumers
   * don't want it at all — a dense chart with frequent toggling can read the
   * repeated flash as noise rather than confirmation. `false` suppresses it
   * on every genuine single-toggle call site this layer has (`setOpenFlag`,
   * and the FIRST node of a deep `expand`/`collapse`) by passing `false`
   * through to `ChartHost.setOpen`'s own `ring` argument instead of this
   * layer's usual hardcoded `true` — the SAME per-call mechanism
   * `expandAll`/`collapseAll`/`expandTo` already use to opt individual calls
   * out (see engine.ts's `setOpen` docblock), just driven by this option
   * instead of "is this call the one the user acted on". Nothing else about
   * the toggle changes: the layout transition, camera anchor, and every
   * other effect of expanding/collapsing still run exactly as before —
   * only the ring itself is suppressed. Defaults to `true`.
   */
  ring?: boolean
  /**
   * When `true`, tapping a node with children expands or collapses it —
   * without this, a `renderNode` layout that has no room for its own toggle
   * button (a compact chip, a dense status card) has no way to be expanded
   * or collapsed at all. Defaults to `false`: existing consumers who render
   * their own toggle button (or rely on the a11y tree's Enter/Space
   * activation) get no behaviour change merely by upgrading.
   *
   * Contract, spelled out because this touches two other things a consumer
   * might already depend on:
   *  - **`nodeClick` still fires, unconditionally, before the toggle.** This
   *    option adds a side effect; it does not replace or gate the existing
   *    event. There is deliberately no way for a `nodeClick` listener to
   *    suppress the toggle (no `preventDefault`-style hook) — that keeps the
   *    contract simple: either enable this option and accept that a tap on a
   *    parent node toggles it, or leave it off and drive toggling yourself
   *    (from your own `nodeClick` handler, or a rendered button) exactly as
   *    before.
   *  - **A tap on genuinely interactive content inside a card — a `<button>`,
   *    `<a>`, `<input>`, `<select>`, `<textarea>`, or `[contenteditable]` —
   *    never toggles**, so a card's own toggle button (or any other control)
   *    keeps working exactly as it does today even with this turned on;
   *    only a tap that lands on the card's inert body (or bare canvas) does.
   *  - **A double click toggles once, not twice.** The toggle is wired into
   *    the same single-tap branch that emits `nodeClick` (see the
   *    `DOUBLE_CLICK_MS` handling below) — the second tap of a recognised
   *    pair already skips `nodeClick` in favour of `nodeDblClick`, so it
   *    skips the toggle for the same reason, with no separate bookkeeping.
   *  - **A leaf (no children) does nothing.** No `setOpen` call, no `toggle`
   *    event — there is nothing to toggle, so nothing is emitted.
   */
  toggleOnNodeClick?: boolean
}

export interface SearchResult {
  id: string
  item: NodeData
  path: string[]
}

/** Re-exported so a caller never has to reach past this package into core. */
export type ExportOpts = SvgExportOptions

export interface ToBlobOptions {
  format: 'png' | 'jpeg'
  /** Multiplies the canvas backing-store resolution — see `toBlob`'s docblock. Default 1. */
  scale?: number
}

export interface ChartState {
  nodeCount: number
  visibleCount: number
  camera: Camera
  bounds: Bounds
  /** Screen-space centre of the first root, for tests and for `focus`. */
  rootScreenCentre: { x: number; y: number }
}

export interface OrgChartEvents {
  nodeClick: (event: { id: string; item: NodeData }) => void
  /**
   * Fires with `{ id, item }` the instant the pointer enters a node, and with
   * `{ id: null, item: null }` when it leaves all nodes (including plain
   * canvas background). Never fires twice in a row for the same id — moving
   * within a single node's box is not a re-entry.
   */
  nodeHover: (event: { id: string; item: NodeData } | { id: null; item: null }) => void
  /**
   * Fires with `{ id, item }` when two taps land on the same node within the
   * platform double-click window. See the `DOUBLE_CLICK_MS` comment in
   * `index.ts` for why the second tap of the pair does not also emit a second
   * `nodeClick`.
   */
  nodeDblClick: (event: { id: string; item: NodeData }) => void
  toggle: (event: { id: string; open: boolean }) => void
  viewportChange: (event: { camera: Camera }) => void
  warning: (warning: Warning) => void
  ready: () => void
}

export interface OrgChartApi {
  zoomTo(k: number): void
  zoomIn(): void
  zoomOut(): void
  fit(): void
  reset(): void
  focus(id: string): void
  expand(id: string, deep?: boolean): void
  collapse(id: string, deep?: boolean): void
  expandAll(): void
  collapseAll(): void
  expandTo(id: string): void
  search(query: string | ((item: NodeData) => boolean)): SearchResult[]
  highlight(ids: string[] | null): void
  /**
   * Serializes the whole VISIBLE tree (collapsed branches excluded, same rule
   * as everywhere else) to a standalone SVG document string — vector,
   * resolution-independent, real selectable `<text>`. Never reads a canvas
   * pixel; see `render/svg.ts` in core.
   */
  toSVG(opts?: ExportOpts): string
  /**
   * Redraws the whole visible tree to an offscreen canvas at `scale` DPI and
   * returns the encoded image as a `Blob` — a correct document at whatever
   * size was asked for, not a screenshot of wherever the camera happened to
   * be. See `toBlob`'s docblock in index.ts for why this never rasterizes
   * the SVG string.
   */
  toBlob(opts: ToBlobOptions): Promise<Blob>
  /** Writes the SVG export into a hidden iframe and prints it. */
  print(): void
  /**
   * Turns the minimap on or off after construction, without the tree-state
   * reset that routing this through `update()` would cause. Passing an options
   * object also repositions or resizes it.
   */
  setMinimap(minimap: boolean | MinimapOptions): void
  /**
   * Merges `partial` over the CURRENT theme (not the built-in defaults —
   * a previous `setTheme` call's tokens stay in place unless this one
   * overrides them too), re-resolves it, and repaints. Paint-only, like
   * `setMinimap`: it never touches tree/layout state, so camera position,
   * expand/collapse state and scroll position are all untouched — unlike the
   * remount a caller had to do for this before this method existed. Takes
   * effect on the very next frame; if a transition is mid-flight, it keeps
   * animating with the new theme's colours from that frame on.
   */
  setTheme(theme: Partial<Theme>): void
  /**
   * Turns the one-shot confirmation ring on or off after construction,
   * without the tree-state reset routing this through `update()` would
   * cause — same reasoning as `setMinimap`. Takes effect on the very next
   * single-node `expand`/`collapse`; an already-flashing ring finishes its
   * current fade rather than being cut off mid-flight. See `Options.ring`'s
   * docblock for exactly which call sites this governs.
   */
  setRing(enabled: boolean): void
  getState(): ChartState
}

export interface OrgChartInstance {
  destroy(): void
  update(data: NodeData[], options?: Partial<Options>): void
  subscribe(callback: (state: ChartState) => void): () => void
  on<E extends keyof OrgChartEvents>(event: E, callback: OrgChartEvents[E]): () => void
  readonly api: OrgChartApi
}

const DEFAULT_LIMITS: ZoomLimits = { minK: 0.05, maxK: 4 }

/** Screen-space breathing room left around the chart by `fit()`. */
const FIT_PADDING = 32

/**
 * World-unit margin around the exported bounds, shared by `toSVG` (as
 * `render/svg.ts`'s own default) and `toBlob` (applied by hand below, since
 * `Frame`/`createCanvas2DRenderer` has no padding concept of its own) — kept
 * equal so the two export forms frame the chart the same way.
 */
const EXPORT_PADDING = 16

// Reused across every `toBlob` call rather than allocated per call: a "whole
// visible tree" frame never has ghosts or an active ring (those are
// transition-in-progress concepts that don't apply to a static export
// snapshot), so these are always empty/inert. Explicitly annotated with the
// bare (`ArrayBufferLike`-backed) typed-array form per the brief: under
// TS 5.9 a bare `new Float64Array(0)` infers the narrower `Float64Array<ArrayBuffer>`,
// which `Frame`'s fields (typed against the wider form) don't accept without
// this annotation.
const EMPTY_GHOST_BOXES: Float64Array = new Float64Array(0)
const EMPTY_GHOST_ALPHA: Float32Array = new Float32Array(0)
const INERT_RING_BOX: Float64Array = new Float64Array(4)

export function createOrgChart(host: HTMLElement, options: Options): OrgChartInstance {
  // Mutable so `api.setTheme` can swap it in place — `createChartHost`
  // captures this same value at construction, and every later reader (the
  // `toBlob` export renderer below, `api.setTheme` itself) closes over this
  // binding rather than a snapshot, so reassigning it here is exactly what a
  // live theme update needs. See `api.setTheme` for the merge-and-repaint
  // side of this.
  let theme = resolveTheme(options.theme)
  const configuredLimits = options.zoomLimits ?? DEFAULT_LIMITS

  /**
   * The zoom floor has to be able to move. A wide org chart is far larger than any
   * viewport — 200 nodes at a fan-out of six is already ~30,000px across — so a fixed
   * `minK` means the Fit button cannot actually fit, which is worse than useless
   * because it looks broken. The floor is therefore lowered to whatever "show me
   * everything" requires, and no further, so ordinary zooming out still stops at the
   * configured limit on charts that comfortably fit.
   */
  let limits: ZoomLimits = { ...configuredLimits }

  const recomputeLimits = (): void => {
    const rect = host.getBoundingClientRect()
    const w = bounds.maxX - bounds.minX
    const h = bounds.maxY - bounds.minY
    if (w <= 0 || h <= 0 || rect.width <= 0 || rect.height <= 0) return
    const needed = Math.min(
      Math.max(1, rect.width - FIT_PADDING * 2) / w,
      Math.max(1, rect.height - FIT_PADDING * 2) / h,
    )
    limits = { minK: Math.min(configuredLimits.minK, needed), maxK: configuredLimits.maxK }
  }
  const lod = options.lodThresholds ?? DEFAULT_LOD

  host.style.position = host.style.position || 'relative'
  host.style.overflow = 'hidden'

  const canvas = document.createElement('canvas')
  canvas.style.display = 'block'
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  host.appendChild(canvas)

  const overlayRoot = document.createElement('div')
  overlayRoot.className = 'orgchart-overlay'
  overlayRoot.style.position = 'absolute'
  overlayRoot.style.inset = '0'
  overlayRoot.style.pointerEvents = 'none'
  host.appendChild(overlayRoot)

  let currentOptions = options
  let tree: Tree = normalize(options.data)
  let open = new Uint8Array(tree.count)
  let camera: Camera = { x: 0, y: 0, k: 1 }
  // Explicitly annotated: under TS 5.9, `new Uint32Array(0)` infers
  // `Uint32Array<ArrayBuffer>`, but ChartHost's methods return/expose the wider
  // `Uint32Array<ArrayBufferLike>` (same for Float64Array/Int32Array below).
  // Annotating the binding, rather than casting at each assignment, is what the
  // brief calls for here.
  let drawn: Uint32Array = new Uint32Array(0)
  let boxes: Float64Array = new Float64Array(0)
  let visibleToSource: Int32Array = new Int32Array(0)
  let bounds: Bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  let frameRequested = false
  let destroyed = false

  /**
   * Source index -> this frame's INTERPOLATED box, rebuilt every frame from
   * `chartHost.lastDrawnBoxes` (which is aligned 1:1 with `drawn` — see its
   * docblock in `worker/host.ts`) — `null` whenever no transition is
   * running, in which case every consumer below falls back to the ordinary
   * final-layout `boxOfSource`. Bounded to `drawn.length` (the near-viewport
   * drawn set), never total node count, matching the 50k budget: this is
   * exactly the same set the canvas itself just painted with these exact
   * positions, so nothing here scans, or even sizes itself against, the
   * whole tree.
   */
  let renderBoxBySource: Map<number, { x: number; y: number; w: number; h: number }> | null = null

  let minimap: Minimap | null = null
  // Identity check, not a dirty flag some mutation sets: `chartHost.boxes` is
  // a fresh array only on an actual relayout (see engine.ts's `layout()`),
  // so comparing references is exactly "did the layout change" — the same
  // trick already used for `visibleToSource` below. Reset to `null` whenever
  // the minimap is (re)created so the very next frame always paints it, even
  // if the layout array reference happens not to have changed since it was
  // last read.
  let lastMinimapBoxes: Float64Array | null = null

  const stateListeners = new Set<(state: ChartState) => void>()
  const eventListeners = new Map<string, Set<(payload: never) => void>>()

  const emit = <E extends keyof OrgChartEvents>(
    event: E,
    ...payload: Parameters<OrgChartEvents[E]>
  ): void => {
    for (const listener of eventListeners.get(event) ?? []) {
      ;(listener as (...args: unknown[]) => void)(...payload)
    }
  }

  const chartHost: ChartHost = createChartHost(canvas, theme, options.worker !== false)

  const sizeOf = (item: NodeData): Size =>
    typeof currentOptions.nodeSize === 'function'
      ? currentOptions.nodeSize(item)
      : currentOptions.nodeSize

  const labelOf = (item: NodeData): string => currentOptions.label?.(item) ?? ''

  const applyData = (): void => {
    const sizes = new Float64Array(tree.count * 2)
    const labels: string[] = Array.from({ length: tree.count })
    for (let i = 0; i < tree.count; i++) {
      const item = itemFor(i)
      const size = sizeOf(item)
      sizes[i * 2] = size.w
      sizes[i * 2 + 1] = size.h
      labels[i] = labelOf(item)
    }
    chartHost.setData(toWireTree(tree), sizes, labels, open)
    chartHost.setOptions({
      spacingX: currentOptions.spacing?.x ?? 16,
      spacingY: currentOptions.spacing?.y ?? 48,
      orientation: currentOptions.orientation ?? 'tb',
      rtl: currentOptions.rtl ?? false,
      lod,
    })
    // Deferred: applyData() runs synchronously inside createOrgChart, before the
    // caller has had a chance to attach a 'warning' listener via `on()`. Emitting
    // here directly would drop every warning raised on the initial load. Queuing
    // a microtask defers emission until after the constructor returns (and after
    // any `on()` call the caller makes in the same synchronous tick), while still
    // running well before the next animation frame.
    const warnings = tree.warnings
    if (warnings.length > 0) {
      queueMicrotask(() => {
        for (const warning of warnings) emit('warning', warning)
      })
    }
    a11y?.update(tree, open, (index) => labelOf(itemFor(index)))
  }

  const initOpen = (): void => {
    open = new Uint8Array(tree.count)
    const collapsed = currentOptions.collapsedByDefault
    for (let i = 0; i < tree.count; i++) {
      if (collapsed === true) open[i] = 0
      else if (typeof collapsed === 'function') {
        open[i] = collapsed(itemFor(i)) ? 0 : 1
      } else open[i] = 1
    }
  }

  // Both of these are consulted per node per frame, so neither may scan.
  // A `data.find()` or a linear search over `visibleToSource` here costs
  // O(nodes) inside an O(visible) loop, which is what turns a 50k chart into a
  // slideshow. Both maps are rebuilt only when their source changes.
  let itemById = new Map<string, NodeData>()
  const rebuildItemIndex = (): void => {
    itemById = new Map(currentOptions.data.map((item) => [item.id, item]))
  }

  const itemFor = (index: number): NodeData => {
    const id = tree.indexToId[index]!
    return itemById.get(id) ?? { id }
  }

  let sourceToPruned = new Map<number, number>()
  const rebuildPrunedIndex = (): void => {
    sourceToPruned = new Map()
    for (let i = 0; i < visibleToSource.length; i++) sourceToPruned.set(visibleToSource[i]!, i)
  }

  const boxOfSource = (source: number) => {
    const i = sourceToPruned.get(source)
    if (i === undefined) return null
    return {
      x: boxes[i * 4]!,
      y: boxes[i * 4 + 1]!,
      w: boxes[i * 4 + 2]!,
      h: boxes[i * 4 + 3]!,
    }
  }

  /**
   * `boxOfSource`, but returns wherever a node visually IS on the canvas
   * THIS FRAME rather than where it will settle — the interpolated box, for
   * as long as the engine's own layout transition is moving it, falling
   * back to `boxOfSource`'s ordinary final-layout box otherwise (identical
   * to it outside a transition, and for any node outside the bounded
   * drawn/visible set `renderBoxBySource` covers — see its docblock).
   *
   * This is what the DOM overlay positions cards from (see `scheduleFrame`'s
   * `overlay.update` call) and what `setOpenFlag` reads a node's CURRENT
   * on-screen position from when arming a new camera anchor — both need
   * "what's actually drawn right now", not "the settled target". The one
   * deliberate exception is the anchor's OWN `toCentre` (the settled target
   * itself, resolved via `boxOfSource` directly in `scheduleFrame`'s
   * `pendingAnchor` branch) — that one must stay on the final layout
   * regardless of what's mid-flight, or the anchor would be chasing a
   * moving target instead of holding a fixed one.
   */
  const interpolatedBoxOfSource = (source: number) => {
    const interpolated = renderBoxBySource?.get(source)
    return interpolated ?? boxOfSource(source)
  }

  /**
   * Rebuilds `renderBoxBySource` from whatever `chartHost.lastDrawnBoxes` says
   * right now, keyed against the CURRENT `drawn` (the two are always aligned
   * 1:1 — see `ChartHost.lastDrawnBoxes`'s docblock). Called once per
   * `render()` this layer actually awaits, so a caller reading
   * `interpolatedBoxOfSource` between frames (e.g. `setOpenFlag`, triggered
   * by a click) always sees the most recently drawn frame's geometry.
   */
  const refreshRenderBoxBySource = (): void => {
    const lastDrawnBoxes = chartHost.lastDrawnBoxes
    if (lastDrawnBoxes === null) {
      renderBoxBySource = null
      return
    }
    const map = new Map<number, { x: number; y: number; w: number; h: number }>()
    for (let i = 0; i < drawn.length; i++) {
      const o = i * 4
      map.set(drawn[i]!, {
        x: lastDrawnBoxes[o]!,
        y: lastDrawnBoxes[o + 1]!,
        w: lastDrawnBoxes[o + 2]!,
        h: lastDrawnBoxes[o + 3]!,
      })
    }
    renderBoxBySource = map
  }

  /**
   * Recreates (or tears down) the minimap widget to match the current
   * `minimap` option. Called on construction and on every `update()`, since
   * either can change the config. Cheap to call even when nothing changed:
   * the widget itself is only a couple of small DOM nodes.
   */
  const setupMinimap = (): void => {
    minimap?.destroy()
    minimap = null
    const opt = currentOptions.minimap
    if (opt === undefined || opt === false) return
    minimap = createMinimap(host, opt === true ? {} : opt, {
      onPan(worldX, worldY) {
        const rect = host.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return
        cancelCameraAnimation()
        setCameraInstant(
          centreOn(
            camera,
            { minX: worldX, minY: worldY, maxX: worldX, maxY: worldY },
            { width: rect.width, height: rect.height },
          ),
        )
      },
    })
    // Force the next frame to paint it, even if `boxes`' reference happens to
    // be unchanged since the last time it was read (e.g. the minimap was just
    // switched on with no relayout in between).
    lastMinimapBoxes = null
  }

  /**
   * Builds a fresh `ExportData` snapshot for `toSVG`/`toBlob`/`print`, by
   * independently re-running the same pure pipeline `ChartEngine.getExportData()`
   * uses internally (`pruneToVisible` -> `layout` -> `applyOrientation`) against
   * the CURRENT `tree`/`open`/sizing state, rather than reaching into the
   * engine directly.
   *
   * This is a deliberate workaround, not a shortcut: `ChartHost` (see
   * `@n1crack/orgchart-core/host`) does not expose `getExportData()`, and in
   * worker mode the live `ChartEngine` lives inside the worker and is not
   * reachable from here at all — only `boxes`/`bounds`/`visibleToSource` are
   * mirrored back across the protocol, not the pruned `parent`/`labels`
   * arrays export needs. Recomputing here, from data this layer already
   * holds, works identically on both the worker and main-thread paths and is
   * always fresh (never a stale mirrored buffer from before the latest
   * `setOpen`/`update`) — see this function's callers' docblocks for why that
   * freshness matters. The cost is one extra synchronous layout pass at
   * export time, which is fine: export is a deliberate, infrequent user
   * action, not a per-frame path.
   */
  const buildExportData = (): ExportData => {
    const visible = pruneToVisible(tree, open)
    const n = visible.tree.count
    const sizes: Float64Array = new Float64Array(n * 2)
    const labels: string[] = Array.from({ length: n })
    for (let i = 0; i < n; i++) {
      const src = visible.toSource[i]!
      const item = itemFor(src)
      const size = sizeOf(item)
      sizes[i * 2] = size.w
      sizes[i * 2 + 1] = size.h
      labels[i] = labelOf(item)
    }
    const spacingX = currentOptions.spacing?.x ?? 16
    const spacingY = currentOptions.spacing?.y ?? 48
    const result = layout(visible.tree, sizes, { spacingX, spacingY })
    const orientation = currentOptions.orientation ?? 'tb'
    const rtl = currentOptions.rtl ?? false
    const exportBounds = applyOrientation(result.boxes, result.bounds, orientation, rtl)
    return {
      boxes: result.boxes,
      parent: visible.tree.parent,
      labels,
      bounds: exportBounds,
      horizontal: orientation === 'lr' || orientation === 'rl',
    }
  }

  // `overlay` and `a11y` both call into `api`, so they are created after it —
  // see below the `api` declaration.
  let overlay: ReturnType<typeof createOverlay> | null = null
  let a11y: A11yTree | null = null

  /**
   * Where the chart opens.
   *
   * Not a fit. An org chart is far wider than it is tall — a few hundred nodes is
   * already tens of thousands of pixels across — so fitting the whole thing shrinks
   * every card to an unreadable sliver, which reads as a broken chart rather than a
   * zoomed-out one. Open at a readable scale anchored on the first root instead, and
   * leave "show me everything" to an explicit `fit()`. Charts small enough to fit
   * whole still do, because the scale is capped at the fit scale rather than exceeding it.
   */
  const openingCamera = (): Camera => {
    const rect = host.getBoundingClientRect()
    const size = { width: rect.width, height: rect.height }
    const fitted = fitCamera(bounds, size, FIT_PADDING, limits)
    // 1:1. Not the fit scale — on a wide chart that is a tiny number, which is the
    // whole problem this avoids.
    const k = 1

    const rootIndex = tree.roots[0]
    const rootBox = rootIndex === undefined ? null : boxOfSource(rootIndex)
    if (rootBox === null) return fitted

    return {
      x: size.width / 2 - (rootBox.x + rootBox.w / 2) * k,
      // Sit the root near the top, not the middle: everything of interest hangs below it.
      y: FIT_PADDING - rootBox.y * k,
      k,
    }
  }

  const getState = (): ChartState => {
    const rootBox = tree.roots.length > 0 ? boxOfSource(tree.roots[0]!) : null
    const centre =
      rootBox === null
        ? { x: 0, y: 0 }
        : {
            x: (rootBox.x + rootBox.w / 2) * camera.k + camera.x,
            y: (rootBox.y + rootBox.h / 2) * camera.k + camera.y,
          }
    return {
      nodeCount: tree.count,
      visibleCount: visibleToSource.length,
      camera,
      bounds,
      rootScreenCentre: centre,
    }
  }

  const publish = (): void => {
    const state = getState()
    for (const listener of stateListeners) listener(state)
  }

  /**
   * Set by anything that mutates `open`. The accessibility mirror is rebuilt from
   * scratch, which measures ~16ms at 10k nodes, so it must not run on a camera move —
   * but it also must not be left to each call site to remember. One flag refreshed in
   * one place is what stops a new bulk operation from silently shipping a mirror that
   * lies about which nodes are expanded.
   */
  let a11yDirty = false

  /**
   * The chart cannot be fitted at construction time: `bounds` is empty until the
   * first render triggers a layout, so fitting eagerly produces an arbitrary camera
   * and the first paint shows the chart adrift. Defer it to the first frame that
   * reports real bounds, then re-render once so the user never sees the wrong view.
   */
  let needsInitialFit = true

  /** Screen-space centre of `box`, in this element's own coordinate space —
   * `camera.x/y` units, not CSS pixels of the page. */
  const boxCentre = (box: { x: number; y: number; w: number; h: number }): { x: number; y: number } => ({
    x: box.x + box.w / 2,
    y: box.y + box.h / 2,
  })

  const lerpPoint = (
    from: { x: number; y: number },
    to: { x: number; y: number },
    t: number,
  ): { x: number; y: number } => ({
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
  })

  /**
   * Keeps a single-node `expand`/`collapse`'s toggled node pinned to a FIXED
   * screen position for as long as the engine's layout transition is moving
   * things around it — the camera no longer pans TO the node (see the
   * removed `autoPanToRegion`); instead the node is the fixed point the rest
   * of the layout grows out of or collapses back into, and this is what
   * keeps it fixed, frame by frame, by adjusting the camera instead.
   *
   * `fromCentre`/`toCentre` are the node's own world-space centre a moment
   * before the toggle and once the toggle's relayout has run — the node
   * always survives its own toggle (only its DESCENDANTS' visibility
   * changes), so it always has both. Interpolating between them with
   * `transitionAnchorProgress` (exported by core for exactly this) replays
   * the SAME curve the engine itself is drawing that node's own box with
   * internally, without this layer ever reaching into the engine's
   * transition state — which also means it works unchanged whether the
   * engine is rendering in-process or in a Web Worker.
   */
  interface CameraAnchor {
    source: number
    screenX: number
    screenY: number
    fromCentre: { x: number; y: number }
    toCentre: { x: number; y: number }
    /** This toggle's direction (expand/collapse) — `transitionAnchorProgress`
     * needs it to know which of the two staged phases the node's OWN
     * reposition tween falls into. */
    opening: boolean
    /** This layer's own `requestAnimationFrame` clock, at the instant the
     * relayout this toggle triggered actually ran — the same instant the
     * engine used as its OWN transition's start (see `setOpenFlag` and
     * `scheduleFrame` for how the two stay in sync without the engine
     * exposing that timestamp directly). */
    startedAt: number
  }
  let cameraAnchor: CameraAnchor | null = null

  /**
   * Set by a single-node `expand`/`collapse` (see `setOpenFlag`), captured
   * BEFORE the toggle is even sent to the engine: the node's current on-screen
   * position (the pin point) and its current world-space centre. Promoted
   * into `cameraAnchor` on the next frame that reports fresh boxes, because
   * the node's POST-toggle centre cannot be known until the toggle's relayout
   * has actually run. Cleared by `update()` since a data reload invalidates
   * the index it names.
   */
  let pendingAnchor: {
    source: number
    screenX: number
    screenY: number
    fromCentre: { x: number; y: number }
    opening: boolean
  } | null = null

  /**
   * Set by `expandAll`/`collapseAll`: the whole chart changed shape, so the
   * sensible response is a full `fit()` rather than trying to pin any single
   * node — there is no one "the toggled node" for a bulk operation. Takes
   * priority over `pendingAnchor`/`cameraAnchor` if somehow both end up set
   * before the next frame.
   */
  let pendingFullFit = false

  const refreshA11y = (): void => {
    if (!a11yDirty) return
    a11yDirty = false
    a11y?.update(tree, open, (i) => labelOf(itemFor(i)))
  }

  const scheduleFrame = (): void => {
    if (frameRequested || destroyed) return
    frameRequested = true
    requestAnimationFrame(async (now) => {
      frameRequested = false
      if (destroyed) return
      // An ALREADY-ACTIVE anchor advances BEFORE the render it belongs to,
      // not after it. Both the engine's node tween and this anchor are pure
      // functions of `now`, so solving the camera for `now` first is what
      // makes the frame internally coherent: the canvas is then painted with
      // the camera that pins the toggled node exactly where the same frame's
      // interpolated box puts it. Applying it after `render()` instead — as
      // this used to — left every frame drawn with the PREVIOUS frame's
      // camera against THIS frame's positions, i.e. a one-frame lag against a
      // curve whose speed peaks mid-transition. That reads as the pinned node
      // (typically the root) sliding off its spot along the growth-axis
      // cross direction and swinging back as the curve decelerates — the
      // owner's "toggling the root sloshes left/right" report. The anchor
      // ESTABLISHED by this frame's own relayout still has to be resolved
      // after `render()` (its `toCentre` needs the layout that render just
      // produced); at `t = 0` it has nothing to advance yet, so there is no
      // lag to inherit.
      if (cameraAnchor !== null) applyCameraAnchor(now)
      // The engine's expand/collapse transition is a pure function of time and
      // takes its clock from here, the same discipline `viewport.ts` follows.
      drawn = await chartHost.render(now)
      // Layout output only changes on relayout, but reading it every frame is a
      // property access, and it keeps the overlay from ever using stale boxes.
      boxes = chartHost.boxes
      bounds = chartHost.bounds
      refreshRenderBoxBySource()
      recomputeLimits()
      // Identity changes only on relayout, which is exactly when the reverse
      // map is stale.
      if (chartHost.visibleToSource !== visibleToSource) {
        visibleToSource = chartHost.visibleToSource
        rebuildPrunedIndex()
      }
      if (needsInitialFit && bounds.maxX > bounds.minX && bounds.maxY > bounds.minY) {
        needsInitialFit = false
        // Deliberately NOT `animateTo`: the opening camera must appear already
        // positioned. Tweening in from an arbitrary starting camera on load
        // would read as a glitch, not a courtesy.
        camera = openingCamera()
        chartHost.setCamera(camera)
        drawn = await chartHost.render(now)
        boxes = chartHost.boxes
        refreshRenderBoxBySource()
      }
      // Runs after the relayout above, so it sees the boxes the toggle actually
      // produced rather than stale ones from before it.
      if (pendingFullFit) {
        pendingFullFit = false
        pendingAnchor = null
        cameraAnchor = null
        api.fit()
      } else if (pendingAnchor !== null) {
        const anchor = pendingAnchor
        pendingAnchor = null
        // The node's post-relayout box — always present (see `CameraAnchor`'s
        // docblock), but degrade to "no anchor" rather than trust that if it
        // somehow isn't.
        const toBox = boxOfSource(anchor.source)
        cameraAnchor =
          toBox === null
            ? null
            : {
                source: anchor.source,
                screenX: anchor.screenX,
                screenY: anchor.screenY,
                fromCentre: anchor.fromCentre,
                toCentre: boxCentre(toBox),
                opening: anchor.opening,
                startedAt: now,
              }
        // Only the frame that ESTABLISHES an anchor applies it here; every
        // later frame advances it before `render()` instead (see the call at
        // the top of this callback, and its docblock, for why). At `t = 0`
        // this is a no-op on the camera in the common case — the anchor is
        // built from where the node already is — so running it after the
        // render costs the frame nothing.
        applyCameraAnchor(now)
      }
      if (minimap !== null) {
        // Identity check, not "every frame": `computeSilhouette` walks every
        // node, so it only runs when `boxes` is actually a NEW array, i.e. a
        // real relayout happened — see `lastMinimapBoxes`'s docblock.
        if (boxes !== lastMinimapBoxes) {
          lastMinimapBoxes = boxes
          minimap.onLayout(boxes, bounds)
        }
        // Cheap by contrast: two point transforms and a CSS transform write.
        const rect = host.getBoundingClientRect()
        minimap.onCamera(camera, { width: rect.width, height: rect.height })
      }
      refreshA11y()
      if (overlay !== null) {
        if (overlayEnabled(camera.k, lod) && currentOptions.renderNode !== undefined) {
          overlay.update(
            Array.from(drawn, (index) => ({ index, id: tree.indexToId[index]! })),
            interpolatedBoxOfSource,
            camera,
          )
        } else {
          overlay.update([], interpolatedBoxOfSource, camera)
        }
      }
      publish()

      // A layout transition (or the toggle ring) advances only when a frame is
      // drawn, so keep asking for frames until BOTH finish. Nothing else would
      // drive either: the camera may be perfectly still while the nodes are
      // still moving, or while the ring is still fading. Checking only
      // `transitioning` here was the bug behind "the ring doesn't fade" — the
      // ring's `RING_DURATION_MS` (350ms) deliberately outlives the layout
      // transition's `TRANSITION_DURATION_MS` (250ms, see engine.ts), so a
      // toggle with no other camera/hover activity stopped scheduling frames
      // the instant the transition ended and froze the ring wherever its alpha
      // happened to be at that moment, rather than letting it finish fading.
      if (chartHost.transitioning || chartHost.ringActive) scheduleFrame()
    })
  }

  /** Applies a camera value immediately: no easing, no animation bookkeeping. */
  const applyCamera = (next: Camera): void => {
    camera = next
    chartHost.setCamera(camera)
    emit('viewportChange', { camera })
    scheduleFrame()
  }

  /**
   * Advances the active `cameraAnchor`, if any, for the current frame — see
   * its docblock for the overall design. Two cases:
   *
   *  - Reduced motion / `animate: false`: the engine skips its own transition
   *    entirely and snaps straight to the final layout, so there is nothing
   *    to track frame by frame. Jump the camera once, using the node's FINAL
   *    centre (`t = 1`), and drop the anchor immediately — "jump straight to
   *    the final layout with the node anchored, no tween", per the brief.
   *  - Animated and still running: `transitionAnchorProgress` replays the
   *    engine's OWN reposition curve for this one node to find exactly where
   *    its centre is RIGHT NOW, and the camera is solved so that point maps
   *    to the fixed screen anchor. Dropped the instant the engine's own
   *    transition ends — after that both ends of the interpolation are the
   *    SAME point, so there is nothing left for it to do, and the camera it
   *    leaves behind already holds the node exactly at its pinned spot.
   */
  const applyCameraAnchor = (now: number): void => {
    const anchor = cameraAnchor
    if (anchor === null) return
    const stillAnimating = animationsEnabled() && chartHost.transitioning
    const t = stillAnimating ? transitionAnchorProgress(anchor.startedAt, now, anchor.opening) : 1
    const world = lerpPoint(anchor.fromCentre, anchor.toCentre, t)
    const nextCamera = { x: anchor.screenX - world.x * camera.k, y: anchor.screenY - world.y * camera.k, k: camera.k }
    applyCamera(nextCamera)
    if (!stillAnimating) cameraAnchor = null
  }

  /**
   * Keeps the engine's transition setting in step with ours. The engine cannot
   * read `prefers-reduced-motion` — it has no DOM — so this layer owns the
   * decision and pushes it down.
   */
  const syncAnimate = (): void => {
    chartHost.setAnimate(animationsEnabled())
  }

  const prefersReducedMotion = (): boolean =>
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  /**
   * Whether this layer is allowed to animate a camera move on its own
   * initiative right now. `false` covers both the explicit `animate: false`
   * option and the OS `prefers-reduced-motion: reduce` setting — the latter is
   * not optional polish, an unrequested 200ms slide (or a coasting pan) is
   * exactly what that setting exists to suppress.
   */
  const animationsEnabled = (): boolean => currentOptions.animate !== false && !prefersReducedMotion()

  const TWEEN_MS = 200

  /**
   * Shared by the ease-tween (`animateTo`) and the momentum coast
   * (`startMomentum`) — only one of the two is ever running, and cancelling
   * one is indistinguishable from cancelling the other from the caller's side.
   * Camera-changing pointer/wheel/pinch input always goes through
   * `setCameraInstant`, which clears this before applying its own change —
   * that is the whole cancellation rule in one place: **the user's hand on the
   * canvas always wins immediately**, whether what it's interrupting is a
   * `focus()` tween or a kinetic-pan coast.
   */
  let cameraAnimHandle: number | null = null
  let tweenFrom: Camera | null = null
  let tweenTo: Camera | null = null
  let tweenStart = 0
  let momentumVX = 0
  let momentumVY = 0
  let momentumLastT = 0

  const cancelCameraAnimation = (): void => {
    if (cameraAnimHandle !== null) {
      cancelAnimationFrame(cameraAnimHandle)
      cameraAnimHandle = null
    }
    tweenFrom = null
    tweenTo = null
    momentumVX = 0
    momentumVY = 0
    // Same "the user's hand always wins immediately" rule extends to the
    // toggle camera anchor: a `focus()`/`fit()`/manual pan or zoom while a
    // toggle's anchor is still holding a node in place is deliberate action
    // that should simply win, not fight the anchor on the next frame.
    cameraAnchor = null
    pendingAnchor = null
  }

  /** Used by pointer, wheel, and pinch input — see `cancelCameraAnimation`. */
  const setCameraInstant = (next: Camera): void => {
    cancelCameraAnimation()
    applyCamera(next)
  }

  const stepTween = (now: number): void => {
    if (destroyed || tweenFrom === null || tweenTo === null) {
      cameraAnimHandle = null
      return
    }
    const t = Math.min(1, (now - tweenStart) / TWEEN_MS)
    applyCamera(interpolate(tweenFrom, tweenTo, easeInOutCubic(t)))
    if (t >= 1) {
      cameraAnimHandle = null
      tweenFrom = null
      tweenTo = null
      return
    }
    cameraAnimHandle = requestAnimationFrame(stepTween)
  }

  /**
   * Entry point for every API-triggered camera move: `focus`, `fit`, `reset`,
   * `zoomTo`/`zoomIn`/`zoomOut`, and the accessibility layer's
   * focus-follows-camera (via `focus`).
   *
   * A second call while a tween (or a momentum coast) is already under way
   * does not snap back to restart from the original starting point — it
   * retargets from `camera`, i.e. wherever the animation has actually gotten
   * to *right now*. Since cancelling and re-issuing from that same live value
   * changes nothing visible, this reads as "now heading somewhere else"
   * rather than a stutter.
   */
  const animateTo = (target: Camera): void => {
    cancelCameraAnimation()
    if (!animationsEnabled()) {
      applyCamera(target)
      return
    }
    tweenFrom = { ...camera }
    tweenTo = target
    tweenStart = performance.now()
    cameraAnimHandle = requestAnimationFrame(stepTween)
  }

  // Kinetic panning: released with a velocity estimated from a short rolling
  // window of recent pointer samples (see input.ts), not the single last
  // delta — a momentary jitter right at release must not fling the chart.
  // Decays exponentially and stops once it drops below a small threshold.
  // Total glide distance is roughly release velocity x tau, so tau is the knob
  // that decides how far a flick carries. 300ms was the first guess and read as
  // too fast in use — the chart ran away from the finger. 180ms keeps the coast
  // obviously present without overshooting what the user aimed at.
  const MOMENTUM_TAU_MS = 180
  const MOMENTUM_MIN_VELOCITY = 0.02 // px/ms (~20px/s) — below this, stop rather than crawl forever.
  // Clamps a sample-noise spike into something a hand could plausibly have done.
  const MOMENTUM_MAX_VELOCITY = 2 // px/ms (~2000px/s)

  const stepMomentum = (now: number): void => {
    if (destroyed) {
      cameraAnimHandle = null
      return
    }
    const dt = now - momentumLastT
    momentumLastT = now
    applyCamera(pan(camera, momentumVX * dt, momentumVY * dt))
    const decay = Math.exp(-dt / MOMENTUM_TAU_MS)
    momentumVX *= decay
    momentumVY *= decay
    if (Math.hypot(momentumVX, momentumVY) < MOMENTUM_MIN_VELOCITY) {
      cameraAnimHandle = null
      momentumVX = 0
      momentumVY = 0
      return
    }
    cameraAnimHandle = requestAnimationFrame(stepMomentum)
  }

  /** `vx`/`vy` are screen px/ms, as measured by input.ts at pointer release. */
  const startMomentum = (vx: number, vy: number): void => {
    cancelCameraAnimation()
    if (!animationsEnabled()) return
    const speed = Math.hypot(vx, vy)
    if (speed < MOMENTUM_MIN_VELOCITY) return
    const scale = speed > MOMENTUM_MAX_VELOCITY ? MOMENTUM_MAX_VELOCITY / speed : 1
    momentumVX = vx * scale
    momentumVY = vy * scale
    momentumLastT = performance.now()
    cameraAnimHandle = requestAnimationFrame(stepMomentum)
  }

  const setOpenFlag = (index: number, value: boolean): void => {
    if (currentOptions.autoPanOnToggle !== false) {
      // `interpolatedBoxOfSource`, not `boxOfSource`: toggling a DIFFERENT
      // node than whichever one a PRIOR toggle's anchor is already holding
      // (the `cameraAnchor.source === index` branch below handles the SAME-
      // node case on its own, via the anchor's own curve) can land while
      // that earlier transition is still running — the final-layout box
      // would then disagree with wherever `index` actually reads on screen
      // right now, producing exactly the snap this whole feature exists to
      // avoid.
      const box = interpolatedBoxOfSource(index)
      if (box !== null) {
        const centre = boxCentre(box)
        let fromCentre = centre
        let screenX = centre.x * camera.k + camera.x
        let screenY = centre.y * camera.k + camera.y
        if (cameraAnchor !== null && cameraAnchor.source === index) {
          // Re-toggling the SAME node the anchor is already holding: keep the
          // exact same pin point (not the FINAL box's screen position, which
          // during a transition is generally NOT where the node currently
          // reads on screen), and continue from wherever it visually is right
          // now — via the same curve `applyCameraAnchor` used to put it there
          // — rather than the stale final box `boxOfSource` would otherwise
          // give. This is the camera-side half of "a second toggle
          // mid-transition retargets instead of snapping".
          const now = performance.now()
          const stillAnimating = animationsEnabled() && chartHost.transitioning
          const t = stillAnimating
            ? transitionAnchorProgress(cameraAnchor.startedAt, now, cameraAnchor.opening)
            : 1
          fromCentre = lerpPoint(cameraAnchor.fromCentre, cameraAnchor.toCentre, t)
          screenX = cameraAnchor.screenX
          screenY = cameraAnchor.screenY
        }
        pendingAnchor = { source: index, screenX, screenY, fromCentre, opening: value }
      }
    }
    open[index] = value ? 1 : 0
    // A single-node toggle — the exact case the ring exists for — so `ring`
    // would be `true` here (matching the engine's default, and every OTHER
    // `chartHost.setOpen` call site in this file has to say `false`
    // explicitly; see engine.ts's `setOpen` for the contract) UNLESS this
    // layer's own `ring` option turns the confirmation flash off entirely
    // (see `Options.ring`'s docblock).
    chartHost.setOpen(index, value, currentOptions.ring !== false)
    emit('toggle', { id: tree.indexToId[index]!, open: value })
    a11yDirty = true
    scheduleFrame()
  }

  const resize = (): void => {
    const rect = host.getBoundingClientRect()
    chartHost.setViewport(rect.width, rect.height, window.devicePixelRatio || 1)
    scheduleFrame()
  }

  const observer = new ResizeObserver(resize)
  observer.observe(host)

  /**
   * Two taps on the same node within this window count as a double click —
   * 300ms is the conventional platform figure (there is no portable API to
   * read the OS value, so it is hard-coded, same as elsewhere in the web
   * platform's own implementations).
   */
  const DOUBLE_CLICK_MS = 300
  let lastTapId: string | null = null
  let lastTapAt = 0

  /**
   * True when `target` is (or is contained in) a genuinely interactive
   * element — a `<button>`, a link, a form control, or an editable region —
   * bounded to inside `host` so a match somewhere ABOVE the chart in the
   * page (an accident of DOM nesting this chart didn't create) never counts.
   * Used only by `toggleOnNodeClick`, to keep a card's own toggle button (or
   * any other control) from also toggling the node underneath it — see that
   * option's docblock for the full contract.
   */
  const isInteractiveTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false
    const interactive = target.closest('button, a, input, select, textarea, [contenteditable]')
    return interactive !== null && host.contains(interactive)
  }

  let hoveredId: string | null = null
  const setHover = (id: string | null, item: NodeData | null): void => {
    if (id === hoveredId) return
    hoveredId = id
    emit('nodeHover', id === null ? { id: null, item: null } : { id, item: item! })
  }

  const detachInput = attachInput(host, () => limits, {
    getCamera: () => camera,
    setCamera: setCameraInstant,
    cancelAnimation: cancelCameraAnimation,
    onTap(screenX, screenY, target) {
      const world = screenToWorld(camera, screenX, screenY)
      void chartHost.hitTest(world.x, world.y).then((index) => {
        if (destroyed) return
        if (index === -1) {
          lastTapId = null
          return
        }
        const id = tree.indexToId[index]!
        const item = itemFor(index)
        const now = performance.now()
        const isDoubleClick = id === lastTapId && now - lastTapAt <= DOUBLE_CLICK_MS
        if (isDoubleClick) {
          // Consumed: a third tap starts a fresh pair rather than chaining
          // into another double click.
          lastTapId = null
          // Deliberately does NOT also emit a second `nodeClick` for this tap:
          // the first tap of the pair already emitted its own `nodeClick`
          // below, so a listener that only wants single clicks still sees
          // exactly one, and a listener that wants both isn't forced to
          // de-duplicate a same-node, same-instant click it didn't ask for.
          // For the same reason, this is also NOT where `toggleOnNodeClick`
          // toggles: the first tap of the pair already did that below, so a
          // double click toggles once overall, not twice — see that option's
          // docblock.
          emit('nodeDblClick', { id, item })
        } else {
          lastTapId = id
          lastTapAt = now
          // `nodeClick` always fires first, unconditionally — see
          // `toggleOnNodeClick`'s docblock for why the toggle is an
          // unsuppressable side effect of this event rather than a
          // competing one.
          emit('nodeClick', { id, item })
          if (currentOptions.toggleOnNodeClick === true && !isInteractiveTarget(target)) {
            const hasChildren = tree.childStart[index + 1]! > tree.childStart[index]!
            // A leaf has nothing to toggle — do nothing rather than emit a
            // pointless `toggle` event for it.
            if (hasChildren) setOpenFlag(index, open[index] !== 1)
          }
        }
      })
    },
    onMove(screenX, screenY) {
      if (destroyed) return
      const world = screenToWorld(camera, screenX, screenY)
      void chartHost.hitTest(world.x, world.y).then((index) => {
        if (destroyed) return
        if (index === -1) {
          setHover(null, null)
          return
        }
        setHover(tree.indexToId[index]!, itemFor(index))
      })
    },
    onLeave() {
      if (destroyed) return
      setHover(null, null)
    },
    onRelease(vx, vy) {
      startMomentum(vx, vy)
    },
  })

  const api: OrgChartApi = {
    zoomTo(k) {
      const rect = host.getBoundingClientRect()
      animateTo(zoomAt(camera, rect.width / 2, rect.height / 2, k / camera.k, limits))
    },
    zoomIn() {
      api.zoomTo(camera.k * 1.25)
    },
    zoomOut() {
      api.zoomTo(camera.k / 1.25)
    },
    fit() {
      const rect = host.getBoundingClientRect()
      animateTo(fitCamera(bounds, { width: rect.width, height: rect.height }, FIT_PADDING, limits))
    },
    reset() {
      api.fit()
    },
    focus(id) {
      api.expandTo(id)
      const index = tree.idToIndex.get(id)
      if (index === undefined) return
      const box = boxOfSource(index)
      if (box === null) return
      const rect = host.getBoundingClientRect()
      animateTo({
        x: rect.width / 2 - (box.x + box.w / 2) * camera.k,
        y: rect.height / 2 - (box.y + box.h / 2) * camera.k,
        k: camera.k,
      })
    },
    expand(id, deep = false) {
      const index = tree.idToIndex.get(id)
      if (index === undefined) return
      if (!deep) return setOpenFlag(index, true)
      const stack = [index]
      // This is still ONE user action on ONE node — a deep expand of `index`
      // — even though it opens every descendant too. Only the very first
      // `setOpen` call here (always `index` itself: `stack` starts as
      // `[index]` alone, so the first pop is always it) asks for a ring;
      // every descendant this loop also opens passes `ring: false` so the
      // flash lands on the node the user actually acted on, not on whichever
      // descendant happens to resolve last. See engine.ts's `setOpen` for why
      // this explicit per-call signal replaced a distinct-index heuristic
      // that could not tell "one deep toggle" apart from a real bulk burst.
      // Starts at `false` outright when this layer's own `ring` option is
      // off (see `Options.ring`'s docblock) — there is then no node in this
      // deep toggle that should ever flash, not just the descendants.
      let ring = currentOptions.ring !== false
      while (stack.length > 0) {
        const node = stack.pop()!
        open[node] = 1
        chartHost.setOpen(node, true, ring)
        ring = false
        for (let c = tree.childStart[node]!; c < tree.childStart[node + 1]!; c++) {
          stack.push(tree.childIndex[c]!)
        }
      }
      a11yDirty = true
      scheduleFrame()
    },
    collapse(id, deep = false) {
      const index = tree.idToIndex.get(id)
      if (index === undefined) return
      if (!deep) return setOpenFlag(index, false)
      const stack = [index]
      // Same reasoning as `expand`'s deep branch above.
      let ring = currentOptions.ring !== false
      while (stack.length > 0) {
        const node = stack.pop()!
        open[node] = 0
        chartHost.setOpen(node, false, ring)
        ring = false
        for (let c = tree.childStart[node]!; c < tree.childStart[node + 1]!; c++) {
          stack.push(tree.childIndex[c]!)
        }
      }
      a11yDirty = true
      scheduleFrame()
    },
    expandAll() {
      for (let i = 0; i < tree.count; i++) {
        open[i] = 1
        // A real bulk operation: every call explicitly opts out of the ring
        // (flashing every node at once is the strobing effect the ring must
        // never produce), rather than relying on the engine to infer "bulk"
        // from how many distinct indices got touched.
        chartHost.setOpen(i, true, false)
      }
      a11yDirty = true
      // The whole chart just changed shape — a full fit is the sensible
      // response here, unlike the single-node case (see `pendingFullFit`).
      if (currentOptions.autoPanOnToggle !== false) pendingFullFit = true
      scheduleFrame()
    },
    collapseAll() {
      for (let i = 0; i < tree.count; i++) {
        open[i] = 0
        chartHost.setOpen(i, false, false) // see expandAll's comment
      }
      a11yDirty = true
      if (currentOptions.autoPanOnToggle !== false) pendingFullFit = true
      scheduleFrame()
    },
    expandTo(id) {
      const index = tree.idToIndex.get(id)
      if (index === undefined) return
      let node = tree.parent[index]!
      while (node !== -1) {
        open[node] = 1
        // Opens every ancestor in one synchronous burst on the way to
        // revealing `id` — not the single-node toggle case the ring exists
        // for, so this opts out explicitly rather than flashing whichever
        // ancestor happens to resolve last.
        chartHost.setOpen(node, true, false)
        node = tree.parent[node]!
      }
      a11yDirty = true
      scheduleFrame()
    },
    search(query) {
      const predicate =
        typeof query === 'function'
          ? query
          : (item: NodeData) => labelOf(item).toLowerCase().includes(query.toLowerCase())
      const results: SearchResult[] = []
      for (let i = 0; i < tree.count; i++) {
        const item = itemFor(i)
        if (!predicate(item)) continue
        const path: string[] = []
        let node = tree.parent[i]!
        while (node !== -1) {
          path.unshift(tree.indexToId[node]!)
          node = tree.parent[node]!
        }
        results.push({ id: tree.indexToId[i]!, item, path })
      }
      return results
    },
    highlight(ids) {
      if (ids === null) {
        chartHost.setHighlight(null)
      } else {
        const indices = ids
          .map((id) => tree.idToIndex.get(id))
          .filter((i): i is number => i !== undefined)
        chartHost.setHighlight(Uint32Array.from(indices))
      }
      // No a11y refresh: highlighting does not change which nodes are expanded,
      // and the mirror rebuild is expensive enough that doing it per search would
      // be felt.
      scheduleFrame()
    },
    toSVG(opts) {
      return coreToSVG(buildExportData(), opts)
    },
    // `Frame`/`createCanvas2DRenderer` are core's, but the canvas that backs
    // this — an OffscreenCanvas that never touches `host` or the visible
    // chart — is unavoidably DOM-bound, which is exactly why this method
    // lives here and not in core.
    async toBlob(opts) {
      if (typeof OffscreenCanvas === 'undefined') {
        throw new Error('OrgChart: toBlob() requires OffscreenCanvas, unavailable in this environment')
      }
      const scale = opts.scale ?? 1
      const data = buildExportData()
      const cssWidth = Math.max(1, data.bounds.maxX - data.bounds.minX) + EXPORT_PADDING * 2
      const cssHeight = Math.max(1, data.bounds.maxY - data.bounds.minY) + EXPORT_PADDING * 2

      const surface = new OffscreenCanvas(
        Math.max(1, Math.round(cssWidth * scale)),
        Math.max(1, Math.round(cssHeight * scale)),
      )
      // Cast through `unknown`, exactly like `host.ts`'s own main-thread
      // fallback does for a real `HTMLCanvasElement`: the DOM lib's
      // `roundRect`/`measureText` overloads are narrower than
      // `RenderContext2D`'s structural declaration, which fails strict
      // parameter-type assignability even though every call this renderer
      // makes is valid at runtime.
      const renderer = createCanvas2DRenderer(surface as unknown as RenderSurface, theme, (font) => {
        const probe = new OffscreenCanvas(1, 1).getContext('2d')
        if (probe === null) throw new Error('OrgChart: 2D canvas context unavailable')
        probe.font = font
        return createTextMeasurer({ measureWidth: (t) => probe.measureText(t).width })
      })
      renderer.resize(cssWidth, cssHeight, scale)

      const n = data.parent.length
      // Every node, every edge, no culling — see this method's contract in
      // `OrgChartApi`. `edges`/`visible` share the same full index range:
      // `canvas2d.ts`'s edge loop already skips roots (`parent[i] === -1`)
      // on its own, so passing root indices through here costs nothing.
      const allIndices: Uint32Array = Uint32Array.from({ length: n }, (_, i) => i)
      const frame: Frame = {
        boxes: data.boxes,
        parent: data.parent,
        visible: allIndices,
        visibleCount: n,
        edges: allIndices,
        edgeCount: n,
        labels: data.labels,
        camera: { x: EXPORT_PADDING - data.bounds.minX, y: EXPORT_PADDING - data.bounds.minY, k: 1 },
        dpr: scale,
        tier: 'full',
        horizontal: data.horizontal,
        highlight: null,
        dragIndex: -1,
        revealAlpha: null,
        ghostBoxes: EMPTY_GHOST_BOXES,
        ghostAlpha: EMPTY_GHOST_ALPHA,
        ghostCount: 0,
        ringActive: false,
        ringBox: INERT_RING_BOX,
        ringProgress: 0,
      }
      renderer.draw(frame)
      return surface.convertToBlob({ type: opts.format === 'jpeg' ? 'image/jpeg' : 'image/png' })
    },
    print() {
      const svg = coreToSVG(buildExportData())
      const doc = `<!DOCTYPE html><html><head><title>Org Chart</title><style>html,body{margin:0;padding:0}</style></head><body>${svg}</body></html>`
      const iframe = document.createElement('iframe')
      iframe.setAttribute('aria-hidden', 'true')
      iframe.style.position = 'fixed'
      iframe.style.right = '0'
      iframe.style.bottom = '0'
      iframe.style.width = '0'
      iframe.style.height = '0'
      iframe.style.border = '0'
      const cleanup = (): void => {
        iframe.remove()
      }
      iframe.addEventListener(
        'load',
        () => {
          const win = iframe.contentWindow
          if (win === null) {
            cleanup()
            return
          }
          win.addEventListener('afterprint', cleanup, { once: true })
          win.focus()
          win.print()
        },
        { once: true },
      )
      document.body.appendChild(iframe)
      iframe.srcdoc = doc
    },
    setMinimap(minimap) {
      currentOptions = { ...currentOptions, minimap }
      setupMinimap()
      scheduleFrame()
    },
    setTheme(partial) {
      // Merges over the CURRENT (already-resolved) theme, not the built-in
      // defaults — passing `theme` as `resolveTheme`'s `base` is what keeps
      // every earlier `setTheme` call's tokens in place instead of resetting
      // them each time a new one comes in.
      theme = resolveTheme(partial, theme)
      currentOptions = { ...currentOptions, theme }
      chartHost.setTheme(theme)
      scheduleFrame()
    },
    setRing(enabled) {
      // Every genuine single-toggle call site reads `currentOptions.ring`
      // live at the moment it toggles (see `setOpenFlag`/`expand`/`collapse`
      // above) — mutating just this key, the same way `setMinimap` mutates
      // just `minimap`, is enough; there is no separate engine-side state to
      // push, since the ring is armed per-call through `ChartHost.setOpen`'s
      // own `ring` argument, not a standing engine option.
      currentOptions = { ...currentOptions, ring: enabled }
    },
    getState,
  }

  // Created here, after `api`, because both call back into it.
  overlay = createOverlay(overlayRoot, {
    render(element, item) {
      element.style.pointerEvents = 'auto'
      currentOptions.renderNode?.(element, {
        id: item.id,
        item: itemFor(item.index),
        open: open[item.index] === 1,
        hasChildren: tree.childStart[item.index + 1]! > tree.childStart[item.index]!,
        toggle: () => (open[item.index] === 1 ? api.collapse(item.id) : api.expand(item.id)),
      })
    },
  })

  // Created here, after `api`, for the same reason as `overlay`: its `onFocus`
  // callback calls `api.focus`.
  a11y = createA11yTree(host, {
    onActivate(id) {
      const index = tree.idToIndex.get(id)
      if (index === undefined) return
      setOpenFlag(index, open[index] !== 1)
    },
    onFocus(id) {
      api.focus(id)
    },
  })

  rebuildItemIndex()
  syncAnimate()
  initOpen()
  applyData()
  setupMinimap()
  resize()
  queueMicrotask(() => emit('ready'))

  return {
    api,
    destroy() {
      destroyed = true
      cancelCameraAnimation()
      observer.disconnect()
      detachInput()
      overlay?.destroy()
      a11y?.destroy()
      minimap?.destroy()
      chartHost.destroy()
      canvas.remove()
      overlayRoot.remove()
      stateListeners.clear()
      eventListeners.clear()
    },
    update(data, partial) {
      currentOptions = { ...currentOptions, ...partial, data }
      tree = normalize(data)
      rebuildItemIndex()
      syncAnimate()
      initOpen()
      // A pending/active anchor or full-fit names an index or relies on state
      // from the tree that just got replaced; a reload invalidates all of it.
      pendingAnchor = null
      cameraAnchor = null
      pendingFullFit = false
      applyData()
      setupMinimap()
      scheduleFrame()
    },
    subscribe(callback) {
      stateListeners.add(callback)
      return () => stateListeners.delete(callback)
    },
    on(event, callback) {
      const set = eventListeners.get(event) ?? new Set()
      set.add(callback as (payload: never) => void)
      eventListeners.set(event, set)
      return () => set.delete(callback as (payload: never) => void)
    },
  }
}

export { createOverlay } from './overlay.js'
export type { OverlayItem } from './overlay.js'
export type { MinimapOptions, MinimapPosition } from './minimap.js'

// Re-exported so a consumer never has to reach past this package into the core to
// name the shapes it already receives.
export type {
  Bounds,
  Camera,
  LodThresholds,
  NodeData,
  Orientation,
  Size,
  Theme,
  Warning,
  ZoomLimits,
} from '@n1crack/orgchart-core'
