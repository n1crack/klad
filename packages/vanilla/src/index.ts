import { createChartHost, type ChartHost } from '@n1crack/orgchart-core/host'
import {
  centreOn,
  DEFAULT_LOD,
  easeInOutCubic,
  fit as fitCamera,
  interpolate,
  normalize,
  overlayEnabled,
  pan,
  resolveTheme,
  screenToWorld,
  toWireTree,
  zoomAt,
  type Bounds,
  type Camera,
  type LodThresholds,
  type NodeData,
  type Orientation,
  type Size,
  type Theme,
  type Tree,
  type Warning,
  type ZoomLimits,
} from '@n1crack/orgchart-core'
import { createA11yTree, type A11yTree } from './a11y.js'
import { attachInput } from './input.js'
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
   * sensible response), tween the camera to approach the toggled node: on
   * expand, framed together with its immediate children; on collapse, the
   * node alone. This runs every time, on- or off-screen alike — the point is
   * to take the user's eye to what they just acted on, not merely to nudge it
   * into view when it happens to be out of frame. Never re-fits the whole
   * chart (that would throw away a zoom level the user chose) and never zooms
   * in past 1:1 — a two-child node blowing up to an enormous card would look
   * broken, not attentive. Defaults to `true`.
   */
  autoPanOnToggle?: boolean
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

export function createOrgChart(host: HTMLElement, options: Options): OrgChartInstance {
  const theme = resolveTheme(options.theme)
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

  /**
   * Set by a single-node `expand`/`collapse` (see `setOpenFlag`). Consumed on
   * the next frame that reports fresh boxes, because the region to pan to
   * cannot be known until the toggle's relayout has actually run. Cleared by
   * `update()` since a data reload invalidates the index it names.
   */
  let pendingAutoPanIndex: number | null = null

  /**
   * Set by `expandAll`/`collapseAll`: the whole chart changed shape, so the
   * sensible response is a full `fit()` rather than trying to frame a region —
   * there is no single "affected region" for a bulk operation. Takes priority
   * over `pendingAutoPanIndex` if somehow both end up set before the next frame.
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
      // The engine's expand/collapse transition is a pure function of time and
      // takes its clock from here, the same discipline `viewport.ts` follows.
      drawn = await chartHost.render(now)
      // Layout output only changes on relayout, but reading it every frame is a
      // property access, and it keeps the overlay from ever using stale boxes.
      boxes = chartHost.boxes
      bounds = chartHost.bounds
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
      }
      // Runs after the relayout above, so it sees the boxes the toggle actually
      // produced rather than stale ones from before it.
      if (pendingFullFit) {
        pendingFullFit = false
        pendingAutoPanIndex = null
        api.fit()
      } else if (pendingAutoPanIndex !== null) {
        const index = pendingAutoPanIndex
        pendingAutoPanIndex = null
        autoPanToRegion(index)
      }
      refreshA11y()
      if (overlay !== null) {
        if (overlayEnabled(camera.k, lod) && currentOptions.renderNode !== undefined) {
          overlay.update(
            Array.from(drawn, (index) => ({ index, id: tree.indexToId[index]! })),
            boxOfSource,
            camera,
          )
        } else {
          overlay.update([], boxOfSource, camera)
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

  /**
   * World-space bounding box of `index` together with its immediate children
   * — but only if `index` is open, i.e. an expand just revealed them.
   * Otherwise just `index`'s own box, which is exactly the collapse case:
   * its children just left the visible set, so there is nothing else to
   * frame.
   */
  const affectedRegion = (index: number): Bounds | null => {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let any = false
    const include = (node: number): void => {
      const box = boxOfSource(node)
      if (box === null) return
      any = true
      if (box.x < minX) minX = box.x
      if (box.y < minY) minY = box.y
      if (box.x + box.w > maxX) maxX = box.x + box.w
      if (box.y + box.h > maxY) maxY = box.y + box.h
    }
    include(index)
    if (open[index] === 1) {
      for (let c = tree.childStart[index]!; c < tree.childStart[index + 1]!; c++) {
        include(tree.childIndex[c]!)
      }
    }
    return any ? { minX, minY, maxX, maxY } : null
  }

  /**
   * Tweens the camera to approach the node just toggled by a single-node
   * expand/collapse. Runs every time — on screen or off — because the point
   * of the interaction is to take the user's eye to what they acted on, not
   * merely to nudge the camera when the node happens to already be out of
   * frame.
   *
   * On expand this frames the node together with its immediate children (see
   * `affectedRegion`); on collapse, the node alone, since there is nothing
   * else left to include. Zoom is chosen to fit that group with the same
   * padding `fit()` uses elsewhere — comfortable, not edge-to-edge — but is
   * capped at 1:1: a node with only two children blowing up to an enormous
   * card would look broken, not attentive. If the group is too wide to fit
   * even at that capped zoom, the toggled node itself stays centred rather
   * than compromising to include every child — the node is what the user
   * acted on, not its children.
   */
  const autoPanToRegion = (index: number): void => {
    const region = affectedRegion(index)
    if (region === null) return
    const rect = host.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const size = { width: rect.width, height: rect.height }

    const fitted = fitCamera(region, size, FIT_PADDING, limits)
    const k = Math.min(1, fitted.k)
    const available = {
      width: size.width - FIT_PADDING * 2,
      height: size.height - FIT_PADDING * 2,
    }
    const regionFits =
      (region.maxX - region.minX) * k <= available.width &&
      (region.maxY - region.minY) * k <= available.height

    if (regionFits) {
      animateTo(centreOn({ ...camera, k }, region, size))
      return
    }

    const nodeBox = boxOfSource(index)
    if (nodeBox === null) return
    const nodeBounds: Bounds = {
      minX: nodeBox.x,
      minY: nodeBox.y,
      maxX: nodeBox.x + nodeBox.w,
      maxY: nodeBox.y + nodeBox.h,
    }
    animateTo(centreOn({ ...camera, k }, nodeBounds, size))
  }

  const setOpenFlag = (index: number, value: boolean): void => {
    open[index] = value ? 1 : 0
    // A single-node toggle — the exact case the ring exists for — so `ring`
    // is explicitly `true` here (matching the engine's default, but spelled
    // out since every OTHER `chartHost.setOpen` call site in this file has
    // to say `false` explicitly; see engine.ts's `setOpen` for the contract).
    chartHost.setOpen(index, value, true)
    emit('toggle', { id: tree.indexToId[index]!, open: value })
    a11yDirty = true
    if (currentOptions.autoPanOnToggle !== false) pendingAutoPanIndex = index
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
      let ring = true
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
      let ring = true
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
      // A pending auto-pan/full-fit names indices or relies on state from the
      // tree that just got replaced; a reload invalidates both.
      pendingAutoPanIndex = null
      pendingFullFit = false
      applyData()
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
