import { createChartEngine, type ChartEngine } from '../engine.js'
import { createCanvas2DRenderer } from '../render/canvas2d.js'
import { createTextMeasurer } from '../text/measure.js'
import { buildQuadTree, type QuadTree } from '../spatial/quadtree.js'
import { hitTestSector } from '../layout/sunburst.js'
import type { DropMode } from '../drag/drop-target.js'
import type { Renderer, RenderSurface } from '../render/renderer.js'
import type { Theme } from '../render/theme.js'
import type { Camera } from '../viewport.js'
import type { Bounds } from '../types.js'
import type { EngineOptions, MainToWorkerMessage, WireTree, WorkerToMain } from './protocol.js'

export interface ChartHost {
  /** `unloaded` marks nodes whose children the host has not fetched yet — see
   * `ChartEngine.setData`. Omit for a host that loads nothing on demand. */
  setData(
    tree: WireTree,
    sizes: Float64Array,
    labels: string[],
    open: Uint8Array,
    unloaded?: Uint8Array | null,
    keep?: Uint8Array | null,
    hide?: Uint8Array | null,
  ): void
  setOptions(partial: Partial<EngineOptions>): void
  /** See `ChartEngine.setOpen`'s docblock — `ring` defaults to `true` here too. */
  setOpen(index: number, open: boolean, ring?: boolean): void
  /** Arms the confirmation ring on `index` without a toggle — see
   * `ChartEngine.flashRing`. */
  flashRing(index: number): void
  setCamera(camera: Camera): void
  setViewport(width: number, height: number, dpr: number): void
  setHighlight(ids: Uint32Array | null): void
  setIsolate(index: number): void
  /** Reduces the visible tree to the nodes in `keep` — see
   * `ChartEngine.setFilter`. */
  setFilter(keep: Uint8Array | null): void
  /** Which connectors flow, SOURCE-indexed by the child — see
   * `ChartEngine.setEdgeFlow`. */
  setEdgeFlow(flow: Uint8Array | null): void
  /** Removes the nodes a capped level pushed out of view — see
   * `ChartEngine.setOverflow`. */
  setOverflow(hide: Uint8Array | null): void
  /** Centres a sunburst on one node, with the drill-down animation — see
   * `ChartEngine.setFocus`. `-1` for the default centre. */
  /** The next relayout is a move, not a load — see
   * `ChartEngine.animateNextLayout`. */
  animateNextLayout(sourceRemap: Int32Array | null, opening?: boolean): void
  setFocus(index: number): void
  setSelection(ids: Uint32Array | null): void
  setDrag(index: number): void
  /** The drop preview — see `ChartEngine.setDropTarget`. Paint-only, so it
   * never needs a reply. */
  setDropTarget(index: number, mode: DropMode, valid: boolean): void
  setAnimate(enabled: boolean): void
  /**
   * Paint-only theme swap, effective from the next `render()` on either path
   * — see `Renderer.setTheme`'s docblock for why this never touches layout
   * or hit-testing. Takes an already-resolved `Theme`, not a partial: the
   * caller (`KladApi.setTheme` in packages/core) owns merging a
   * caller-supplied partial over the current theme and re-resolving it, so
   * this layer only ever forwards a complete, ready-to-paint theme.
   */
  setTheme(theme: Theme): void
  render(now?: number): Promise<Uint32Array>
  hitTest(worldX: number, worldY: number): Promise<number>
  destroy(): void
  readonly usingWorker: boolean
  /** Layout output in the pruned index space. Same values on both paths. */
  readonly boxes: Float64Array
  readonly bounds: Bounds
  /** Pruned index -> source index. */
  readonly visibleToSource: Int32Array
  /** True while an expand/collapse transition is still in progress, on
   * either path — a caller drives its own frame loop off this rather than
   * guessing how long to keep animating. */
  readonly transitioning: boolean
  /** True while the one-shot toggle ring is still fading, on either path —
   * see `ChartEngine.ringActive`'s docblock. A caller must keep scheduling
   * frames while EITHER this or `transitioning` is true, since the ring
   * outlives the layout transition by design. */
  readonly ringActive: boolean
  /**
   * Mirrors `ChartEngine.lastDrawnBoxes` on either path: interpolated boxes
   * for exactly the source indices in the `Uint32Array` `render()` most
   * recently resolved with, in the same order — `null` whenever no
   * transition is running. A caller (the DOM overlay, the camera anchor)
   * that wants "where this node visually IS this frame" rather than "where
   * it will end up" reads this instead of `boxes`, falling back to
   * `boxes`/`visibleToSource` when it's `null`. In worker mode this is
   * populated from each `frame` message's own `lastDrawnBoxes` field —
   * bounded by the drawn/visible count, never total node count.
   */
  readonly lastDrawnBoxes: Float64Array | null
  /**
   * Mirrors `ChartEngine.lastDrawnAlpha` on either path: the reveal alpha for
   * exactly those same source indices, in the same order — `null` whenever
   * nothing on screen is fading. A caller drawing its own DOM layer over the
   * canvas reads this so its elements honour the same fade the canvas just
   * painted with; `null` means "everything drawn is fully opaque". In worker
   * mode this comes from each `frame` message's own field of the same name.
   */
  readonly lastDrawnAlpha: Float32Array | null
  /** Mirrors `ChartEngine.lastGhostSource` and its two companions on either
   * path — the nodes leaving this frame, so a DOM overlay can fade their
   * cards rather than dropping them. */
  readonly lastGhostSource: Uint32Array | null
  readonly lastGhostBoxes: Float64Array | null
  readonly lastGhostAlpha: Float32Array | null
  /**
   * Mirrors `ChartEngine.transitionStartedAt` on either path — the origin the
   * running transition's curve is measured from, `null` when none is running.
   * A caller animating alongside the transition must measure from this, not
   * from its own frame clock: the two paths start the transition at different
   * instants (in-process on the first frame after the toggle, in worker mode
   * as soon as the `open` message is dequeued).
   */
  readonly transitionStartedAt: number | null
}

/**
 * Hides whether drawing happens in a worker or in-process.
 *
 * Worker mode transfers control of the canvas, so the worker paints directly to
 * the screen and no bitmap crosses the boundary. Hit-testing deliberately does
 * NOT go through the worker: the host keeps its own quadtree, rebuilt from each
 * `layout` message, so a pointer move never waits on a round trip.
 *
 * Anything that prevents a worker — a CSP that blocks worker scripts, an old
 * engine, or a canvas whose context was already taken — degrades to in-process
 * with a warning rather than failing.
 */
export function createChartHost(canvas: HTMLCanvasElement, theme: Theme, preferWorker: boolean): ChartHost {
  let worker: Worker | null = null
  let engine: ChartEngine | null = null
  // In-process only (`worker === null`) — the only thing a theme change
  // actually touches; hoisted out of the `if (worker === null)` block below
  // so `setTheme` can reach it without `engine` needing to know about theme
  // at all (it doesn't — see engine.ts).
  let renderer: Renderer | null = null

  // Main-thread mirror used for hit-testing in worker mode, and for the overlay
  // on both paths.
  let quad: QuadTree | null = null
  /**
   * Mirror of the worker engine's sunburst geometry, `null` for every other
   * layout. Only `hitTest` reads it, and only in worker mode — in-process the
   * engine answers directly. Without it a click on a wheel would resolve
   * against `quad`, whose sector bounding boxes overlap near the centre.
   */
  let sectors: Float64Array | null = null
  let visibleToSource: Int32Array = new Int32Array(0)
  let boxes: Float64Array = new Float64Array(0)
  let bounds: Bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 }

  // The worker posts exactly one `frame` message per `MainToWorker` message it
  // receives (see chart.worker.ts), strictly in send order. `render()` needs
  // the frame produced by ITS OWN message, not merely "whichever frame arrives
  // next" — every other host method also posts a message (and so also
  // provokes a frame reply) without anyone awaiting it, so an unrelated reply
  // can still be in flight when `render()` is called. Counting sends and
  // matching that count against arrivals — rather than a single "next frame"
  // slot — is what keeps `render()` correct regardless of that race.
  let sentCount = 0
  let framesReceived = 0
  /**
   * Every `render()` still waiting for its own frame, not just the newest.
   *
   * It used to be a single slot, and a second `render()` arriving before the
   * first had answered resolved the older one on the spot with an EMPTY
   * `visible` array — "nothing is drawn" — purely to avoid orphaning its
   * promise. That is a lie, and the caller believes it: the vanilla layer
   * rebuilds its drawn-geometry mirror from exactly this array, so for that
   * frame it thinks no node is on screen anywhere, and every question that
   * mirror answers falls back to the SETTLED layout instead. A click landing
   * in that window pins the camera on where a node will END UP rather than
   * where it is — which, mid-transition, is off screen. Two renders in flight
   * is not rare either: the frame loop awaits this promise, so any frame the
   * worker is slow to answer lets the next `requestAnimationFrame` start
   * another one, which is what a burst of rapid clicks produces.
   *
   * Waiting is the honest answer instead. Both callers get the next real
   * frame; the older one is simply told about it a frame late, which is what
   * it already was.
   */
  let pendingFrames: { target: number; resolve: (drawn: Uint32Array) => void }[] = []
  // Mirrors the in-process `engine.transitioning` for worker mode, updated
  // from each `frame` message's `transitioning` flag.
  let workerTransitioning = false
  // Same mirroring, for `engine.transitionStartedAt`.
  let workerTransitionStartedAt: number | null = null
  // Same mirroring, for `engine.ringActive` — see its docblock for why this
  // has to be tracked separately from `workerTransitioning` rather than
  // folded into it.
  let workerRingActive = false
  // Mirrors `engine.lastDrawnBoxes` for worker mode, updated from each
  // `frame` message's own field of the same name.
  let workerLastDrawnBoxes: Float64Array | null = null
  // Same mirroring for the ghosts.
  let workerGhostSource: Uint32Array | null = null
  let workerGhostBoxes: Float64Array | null = null
  let workerGhostAlpha: Float32Array | null = null
  // Same mirroring for `engine.lastDrawnAlpha`.
  let workerLastDrawnAlpha: Float32Array | null = null

  /**
   * Stamps every message with the main thread's clock — see `MainToWorker`'s
   * docblock in protocol.ts: the worker renders after each message and must
   * render against THIS clock, never one of its own. `now` defaults to "right
   * now" for the state-changing messages, which have no frame time of their
   * own; only `render()` passes its caller's `requestAnimationFrame`
   * timestamp explicitly.
   */
  const post = (
    message: MainToWorkerMessage,
    transfer: Transferable[] = [],
    now: number = performance.now(),
  ): void => {
    if (worker === null) return
    sentCount++
    worker.postMessage({ ...message, now }, transfer)
  }

  if (preferWorker) {
    try {
      const offscreen = canvas.transferControlToOffscreen()
      worker = new Worker(new URL('./chart.worker.js', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<WorkerToMain>) => {
        const message = event.data
        if (message.t === 'frame') {
          framesReceived++
          // Live state, read for scheduling decisions rather than paired with
          // any particular set of boxes: always the newest.
          workerTransitioning = message.transitioning
          workerTransitionStartedAt = message.transitionStartedAt
          workerRingActive = message.ringActive
          const arrived =
            pendingFrames.length === 0 ? [] : pendingFrames.filter((each) => framesReceived >= each.target)
          // The DRAWN GEOMETRY is published only with the frame a caller is
          // actually handed, and never on its own.
          //
          // Every message the worker receives provokes a frame reply — a
          // camera nudge, a toggle, a theme write — so between two renders
          // this layer can see several frames the caller has not been given.
          // Refreshing the mirror on each of them left `lastDrawnBoxes` from
          // a NEWER frame than the `visible` array the caller was holding,
          // and the vanilla layer pairs those two positionally to build its
          // source -> box map. Mid-transition, when a collapse has just
          // changed which nodes are drawn, that pairing silently handed a
          // child its PARENT's box: the card was drawn full-size at the
          // parent's own top-left corner and then flew down to its place —
          // the owner's "when I click fast it starts from above the mouse,
          // almost at the top border". Measured at 237 frames out of a dozen
          // fast toggles. Publishing in lockstep with `resolve` below is what
          // keeps the pair describing one frame.
          if (arrived.length > 0) {
            workerLastDrawnBoxes = message.lastDrawnBoxes
            workerLastDrawnAlpha = message.lastDrawnAlpha
            workerGhostSource = message.ghostSource
            workerGhostBoxes = message.ghostBoxes
            workerGhostAlpha = message.ghostAlpha
            // Usually one, more only when renders piled up (see
            // `pendingFrames`). They all get THIS frame's answer.
            pendingFrames = pendingFrames.filter((each) => framesReceived < each.target)
            for (const each of arrived) each.resolve(message.visible)
          }
        } else if (message.t === 'layout') {
          visibleToSource = message.visibleToSource
          boxes = message.boxes
          bounds = message.bounds
          sectors = message.sectors
          quad = buildQuadTree(message.boxes, message.bounds)
        } else if (message.t === 'error') {
          console.error(`Klad worker: ${message.message}`)
          // A frame was asked for and will never come: the worker threw before
          // it could draw one. Whoever is awaiting it has to be let go, or the
          // chart stops for good — the frame loop only asks for its NEXT frame
          // after this promise settles, so one unresolved await is not a
          // dropped frame, it is the end of the animation loop. An empty
          // `visible` is the honest answer: nothing was drawn.
          if (pendingFrames.length > 0) {
            const waiting = pendingFrames
            pendingFrames = []
            for (const each of waiting) each.resolve(new Uint32Array(0))
          }
        }
      }
      post(
        {
          t: 'init',
          canvas: offscreen,
          dpr: 1,
          width: canvas.width,
          height: canvas.height,
          theme,
        },
        [offscreen as unknown as Transferable],
      )
    } catch (error) {
      console.warn('Klad: worker unavailable, rendering on the main thread.', error)
      worker = null
    }
  }

  if (worker === null) {
    renderer = createCanvas2DRenderer(canvas as unknown as RenderSurface, theme, (font) => {
      const probe = document.createElement('canvas').getContext('2d')
      if (probe === null) throw new Error('Klad: 2D canvas context unavailable')
      probe.font = font
      return createTextMeasurer({ measureWidth: (t) => probe.measureText(t).width })
    })
    engine = createChartEngine(renderer)
    // Main-thread path: cap zoomed-out (block-tier) drawing to one node/edge per
    // ~2 device-px cell, so a huge tree stays smooth without a worker. The
    // worker's own engine (chart.worker.ts) never sets this, so the
    // worker/desktop path is unchanged. See render/decimate.ts and
    // EngineOptions.blockDecimation.
    engine.setOptions({ blockDecimation: 2 })
  }

  return {
    get usingWorker() {
      return worker !== null
    },

    setData(tree, sizes, labels, open, unloaded = null, keep = null, hide = null) {
      engine?.setData(tree, sizes, labels, open, unloaded, keep, hide)
      post({ t: 'data', tree, sizes, labels, open, unloaded, keep, hide })
    },
    setOptions(partial) {
      engine?.setOptions(partial)
      post({ t: 'options', options: partial })
    },
    setOpen(index, open, ring = true) {
      engine?.setOpen(index, open, ring)
      post({ t: 'open', index, open, ring })
    },
    flashRing(index) {
      engine?.flashRing(index)
      post({ t: 'ring', index })
    },
    setCamera(camera) {
      engine?.setCamera(camera)
      post({ t: 'camera', camera })
    },
    setViewport(width, height, dpr) {
      engine?.setViewport(width, height, dpr)
      post({ t: 'resize', width, height, dpr })
    },
    setIsolate(index) {
      engine?.setIsolate(index)
      post({ t: 'isolate', index })
    },
    setFilter(keep) {
      engine?.setFilter(keep)
      post({ t: 'filter', keep })
    },
    setEdgeFlow(flow) {
      engine?.setEdgeFlow(flow)
      post({ t: 'edgeFlow', flow })
    },
    setOverflow(hide) {
      engine?.setOverflow(hide)
      post({ t: 'overflow', hide })
    },
    setFocus(index) {
      engine?.setFocus(index)
      post({ t: 'focus', index })
    },
    animateNextLayout(sourceRemap, opening = true) {
      engine?.animateNextLayout(sourceRemap, opening)
      // Transferred rather than cloned, and a fresh copy per path: the
      // in-process engine above holds onto the caller's array, so handing the
      // same buffer to the worker would detach it out from under it.
      const copy = sourceRemap === null ? null : sourceRemap.slice()
      post({ t: 'move', sourceRemap: copy, opening }, copy === null ? [] : [copy.buffer])
    },
    setHighlight(ids) {
      engine?.setHighlight(ids)
      post({ t: 'highlight', ids })
    },
    setSelection(ids) {
      engine?.setSelection(ids)
      post({ t: 'selection', ids })
    },
    setDrag(index) {
      engine?.setDrag(index)
      post({ t: 'drag', index })
    },
    setDropTarget(index, mode, valid) {
      engine?.setDropTarget(index, mode, valid)
      post({ t: 'drop', index, mode, valid })
    },
    setAnimate(enabled) {
      engine?.setAnimate(enabled)
      post({ t: 'animate', enabled })
    },
    setTheme(next) {
      renderer?.setTheme(next)
      post({ t: 'theme', theme: next })
    },

    render(now) {
      // Both paths thread `now` through, same caller-drives-time contract as
      // `ChartEngine.render`: in-process straight into the engine, in worker
      // mode as the `render` message's clock stamp (see `post` above). The
      // worker used to be sent a re-issued `camera` message purely as a
      // "please draw" trigger and left to read its own clock — see
      // `MainToWorker` in protocol.ts for why that was wrong outright, not
      // merely imprecise.
      if (engine !== null) return Promise.resolve(engine.render(now))
      return new Promise<Uint32Array>((resolve) => {
        // Queued, not replaced: an older render still waiting keeps waiting
        // and is answered by the next real frame alongside this one. See
        // `pendingFrames` for what resolving it early with "nothing is drawn"
        // did to the caller.
        pendingFrames.push({ target: sentCount + 1, resolve })
        post({ t: 'render' }, [], now)
      })
    },

    hitTest(worldX, worldY) {
      if (engine !== null) return Promise.resolve(engine.hitTest(worldX, worldY))
      // Worker mode runs its own hit-test here rather than asking the worker,
      // to keep a pointer move off the message queue. That means this branch
      // has to make the SAME decision the engine's `hitTest` makes, including
      // the polar one: a sunburst's bounding boxes overlap near the centre, so
      // resolving a click there against the quadtree returns whichever box the
      // tree happens to reach first. Both sides call `hitTestSector`, which is
      // why it lives in `layout/sunburst.ts` and not inside the engine.
      if (sectors !== null) {
        const pruned = hitTestSector(sectors, visibleToSource.length, worldX, worldY)
        return Promise.resolve(pruned === -1 ? -1 : (visibleToSource[pruned] ?? -1))
      }
      if (quad === null) return Promise.resolve(-1)
      const pruned = quad.hitTest(worldX, worldY)
      return Promise.resolve(pruned === -1 ? -1 : (visibleToSource[pruned] ?? -1))
    },

    destroy() {
      worker?.terminate()
      worker = null
      engine = null
      renderer = null
      quad = null
      // Let go of anything still waiting: the worker is gone, so its frame is
      // never coming, and an unsettled promise here would hang the caller's
      // frame loop for good.
      const waiting = pendingFrames
      pendingFrames = []
      for (const each of waiting) each.resolve(new Uint32Array(0))
    },

    get boxes() {
      return engine !== null ? engine.boxes : boxes
    },
    get bounds() {
      return engine !== null ? engine.bounds : bounds
    },
    get visibleToSource() {
      return engine !== null ? engine.visibleToSource : visibleToSource
    },
    get transitioning() {
      return engine !== null ? engine.transitioning : workerTransitioning
    },
    get ringActive() {
      return engine !== null ? engine.ringActive : workerRingActive
    },
    get transitionStartedAt() {
      return engine !== null ? engine.transitionStartedAt : workerTransitionStartedAt
    },
    get lastDrawnAlpha() {
      return engine !== null ? engine.lastDrawnAlpha : workerLastDrawnAlpha
    },
    get lastGhostSource() {
      return engine !== null ? engine.lastGhostSource : workerGhostSource
    },
    get lastGhostBoxes() {
      return engine !== null ? engine.lastGhostBoxes : workerGhostBoxes
    },
    get lastGhostAlpha() {
      return engine !== null ? engine.lastGhostAlpha : workerGhostAlpha
    },
    get lastDrawnBoxes() {
      return engine !== null ? engine.lastDrawnBoxes : workerLastDrawnBoxes
    },
  }
}
