import { createChartEngine, type ChartEngine } from '../engine.js'
import { createCanvas2DRenderer } from '../render/canvas2d.js'
import { createTextMeasurer } from '../text/measure.js'
import { buildQuadTree, type QuadTree } from '../spatial/quadtree.js'
import type { RenderSurface } from '../render/renderer.js'
import type { Theme } from '../render/theme.js'
import type { Camera } from '../viewport.js'
import type { Bounds } from '../types.js'
import type { EngineOptions, MainToWorker, WireTree, WorkerToMain } from './protocol.js'

export interface ChartHost {
  setData(tree: WireTree, sizes: Float64Array, labels: string[], open: Uint8Array): void
  setOptions(partial: Partial<EngineOptions>): void
  setOpen(index: number, open: boolean): void
  setCamera(camera: Camera): void
  setViewport(width: number, height: number, dpr: number): void
  setHighlight(ids: Uint32Array | null): void
  setDrag(index: number): void
  setAnimate(enabled: boolean): void
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
export function createChartHost(
  canvas: HTMLCanvasElement,
  theme: Theme,
  preferWorker: boolean,
): ChartHost {
  let worker: Worker | null = null
  let engine: ChartEngine | null = null

  // Main-thread mirror used for hit-testing in worker mode, and for the overlay
  // on both paths.
  let quad: QuadTree | null = null
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
  let pendingFrame: { target: number; resolve: (drawn: Uint32Array) => void } | null = null
  let lastCamera: Camera = { x: 0, y: 0, k: 1 }
  // Mirrors the in-process `engine.transitioning` for worker mode, updated
  // from each `frame` message's `transitioning` flag.
  let workerTransitioning = false

  const post = (message: MainToWorker, transfer: Transferable[] = []): void => {
    if (worker === null) return
    sentCount++
    worker.postMessage(message, transfer)
  }

  if (preferWorker) {
    try {
      const offscreen = canvas.transferControlToOffscreen()
      worker = new Worker(new URL('./chart.worker.js', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<WorkerToMain>) => {
        const message = event.data
        if (message.t === 'frame') {
          framesReceived++
          workerTransitioning = message.transitioning
          if (pendingFrame !== null && framesReceived >= pendingFrame.target) {
            pendingFrame.resolve(message.visible)
            pendingFrame = null
          }
        } else if (message.t === 'layout') {
          visibleToSource = message.visibleToSource
          boxes = message.boxes
          bounds = message.bounds
          quad = buildQuadTree(message.boxes, message.bounds)
        } else if (message.t === 'error') {
          console.error(`OrgChart worker: ${message.message}`)
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
      console.warn('OrgChart: worker unavailable, rendering on the main thread.', error)
      worker = null
    }
  }

  if (worker === null) {
    const renderer = createCanvas2DRenderer(canvas as unknown as RenderSurface, theme, (font) => {
      const probe = document.createElement('canvas').getContext('2d')
      if (probe === null) throw new Error('OrgChart: 2D canvas context unavailable')
      probe.font = font
      return createTextMeasurer({ measureWidth: (t) => probe.measureText(t).width })
    })
    engine = createChartEngine(renderer)
  }

  return {
    get usingWorker() {
      return worker !== null
    },

    setData(tree, sizes, labels, open) {
      engine?.setData(tree, sizes, labels, open)
      post({ t: 'data', tree, sizes, labels, open })
    },
    setOptions(partial) {
      engine?.setOptions(partial)
      post({ t: 'options', options: partial })
    },
    setOpen(index, open) {
      engine?.setOpen(index, open)
      post({ t: 'open', index, open })
    },
    setCamera(camera) {
      lastCamera = camera
      engine?.setCamera(camera)
      post({ t: 'camera', camera })
    },
    setViewport(width, height, dpr) {
      engine?.setViewport(width, height, dpr)
      post({ t: 'resize', width, height, dpr })
    },
    setHighlight(ids) {
      engine?.setHighlight(ids)
      post({ t: 'highlight', ids })
    },
    setDrag(index) {
      engine?.setDrag(index)
      post({ t: 'drag', index })
    },
    setAnimate(enabled) {
      engine?.setAnimate(enabled)
      post({ t: 'animate', enabled })
    },

    render(now) {
      // In-process: thread `now` straight through, same caller-drives-time
      // contract as `ChartEngine.render`. Worker mode does NOT thread `now`
      // across the postMessage boundary — a dedicated Worker's
      // `performance.now()` shares the main thread's time origin (see
      // chart.worker.ts), so the small postMessage-latency skew between the
      // two is negligible against a ~250ms transition, and not worth a
      // protocol field.
      if (engine !== null) return Promise.resolve(engine.render(now))
      return new Promise<Uint32Array>((resolve) => {
        pendingFrame = { target: sentCount + 1, resolve }
        post({ t: 'camera', camera: lastCamera })
      })
    },

    hitTest(worldX, worldY) {
      if (engine !== null) return Promise.resolve(engine.hitTest(worldX, worldY))
      if (quad === null) return Promise.resolve(-1)
      const pruned = quad.hitTest(worldX, worldY)
      return Promise.resolve(pruned === -1 ? -1 : (visibleToSource[pruned] ?? -1))
    },

    destroy() {
      worker?.terminate()
      worker = null
      engine = null
      quad = null
      pendingFrame = null
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
  }
}
