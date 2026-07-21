import { createChartHost, type ChartHost } from '@n1crack/orgchart-core/host'
import {
  DEFAULT_LOD,
  fit as fitCamera,
  normalize,
  overlayEnabled,
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

  const refreshA11y = (): void => {
    if (!a11yDirty) return
    a11yDirty = false
    a11y?.update(tree, open, (i) => labelOf(itemFor(i)))
  }

  const scheduleFrame = (): void => {
    if (frameRequested || destroyed) return
    frameRequested = true
    requestAnimationFrame(async () => {
      frameRequested = false
      if (destroyed) return
      drawn = await chartHost.render()
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
        camera = openingCamera()
        chartHost.setCamera(camera)
        drawn = await chartHost.render()
        boxes = chartHost.boxes
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
    })
  }

  const setCamera = (next: Camera): void => {
    camera = next
    chartHost.setCamera(camera)
    emit('viewportChange', { camera })
    scheduleFrame()
  }

  const setOpenFlag = (index: number, value: boolean): void => {
    open[index] = value ? 1 : 0
    chartHost.setOpen(index, value)
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

  const detachInput = attachInput(canvas, () => limits, {
    getCamera: () => camera,
    setCamera,
    onTap(screenX, screenY) {
      const world = screenToWorld(camera, screenX, screenY)
      void chartHost.hitTest(world.x, world.y).then((index) => {
        if (index === -1) return
        emit('nodeClick', { id: tree.indexToId[index]!, item: itemFor(index) })
      })
    },
  })

  const api: OrgChartApi = {
    zoomTo(k) {
      const rect = host.getBoundingClientRect()
      setCamera(zoomAt(camera, rect.width / 2, rect.height / 2, k / camera.k, limits))
    },
    zoomIn() {
      api.zoomTo(camera.k * 1.25)
    },
    zoomOut() {
      api.zoomTo(camera.k / 1.25)
    },
    fit() {
      const rect = host.getBoundingClientRect()
      setCamera(fitCamera(bounds, { width: rect.width, height: rect.height }, FIT_PADDING, limits))
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
      setCamera({
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
      while (stack.length > 0) {
        const node = stack.pop()!
        open[node] = 1
        chartHost.setOpen(node, true)
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
      while (stack.length > 0) {
        const node = stack.pop()!
        open[node] = 0
        chartHost.setOpen(node, false)
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
        chartHost.setOpen(i, true)
      }
      a11yDirty = true
      scheduleFrame()
    },
    collapseAll() {
      for (let i = 0; i < tree.count; i++) {
        open[i] = 0
        chartHost.setOpen(i, false)
      }
      a11yDirty = true
      scheduleFrame()
    },
    expandTo(id) {
      const index = tree.idToIndex.get(id)
      if (index === undefined) return
      let node = tree.parent[index]!
      while (node !== -1) {
        open[node] = 1
        chartHost.setOpen(node, true)
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
  initOpen()
  applyData()
  resize()
  queueMicrotask(() => emit('ready'))

  return {
    api,
    destroy() {
      destroyed = true
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
      initOpen()
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
