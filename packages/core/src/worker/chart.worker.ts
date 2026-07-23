/// <reference lib="webworker" />
import { createChartEngine, type ChartEngine } from '../engine.js'
import { createCanvas2DRenderer } from '../render/canvas2d.js'
import { createTextMeasurer } from '../text/measure.js'
import type { Renderer, RenderSurface } from '../render/renderer.js'
import type { Theme } from '../render/theme.js'
import type { MainToWorker, WorkerToMain } from './protocol.js'

let engine: ChartEngine | null = null
// Hoisted alongside `engine` (rather than staying a `const` local to the
// `'init'` case) so the `'theme'` case below can reach it — the renderer is
// the only thing a theme change actually touches; `engine` itself never
// reads a theme (see engine.ts — layout and hit-testing are theme-agnostic).
let renderer: Renderer | null = null

const post = (message: WorkerToMain, transfer: Transferable[] = []): void => {
  ;(self as unknown as { postMessage(m: WorkerToMain, t: Transferable[]): void }).postMessage(
    message,
    transfer,
  )
}

self.onmessage = (event: MessageEvent<MainToWorker>): void => {
  const message = event.data
  try {
    switch (message.t) {
      case 'init': {
        const surface = message.canvas as RenderSurface
        const theme = message.theme as Theme
        renderer = createCanvas2DRenderer(surface, theme, (font) => {
          const probe = new OffscreenCanvas(1, 1).getContext('2d')!
          probe.font = font
          return createTextMeasurer({ measureWidth: (t) => probe.measureText(t).width })
        })
        engine = createChartEngine(renderer)
        engine.setViewport(message.width, message.height, message.dpr)
        break
      }
      case 'theme':
        renderer?.setTheme(message.theme as Theme)
        break
      case 'data':
        engine?.setData(message.tree, message.sizes, message.labels, message.open)
        break
      case 'options':
        engine?.setOptions(message.options)
        break
      case 'camera':
        engine?.setCamera(message.camera)
        break
      case 'open':
        engine?.setOpen(message.index, message.open, message.ring)
        break
      case 'resize':
        engine?.setViewport(message.width, message.height, message.dpr)
        break
      case 'highlight':
        engine?.setHighlight(message.ids)
        break
      case 'isolate':
        engine?.setIsolate(message.index)
        break
      case 'drag':
        engine?.setDrag(message.index)
        break
      case 'animate':
        engine?.setAnimate(message.enabled)
        break
      case 'ring':
        engine?.flashRing(message.index)
        break
      case 'render':
        // Nothing to apply — a bare "draw now" trigger, and the `now` every
        // message carries is consumed by the render below.
        break
    }

    if (engine === null) return

    // Every message can change what is on screen, so redraw and report —
    // always against the MAIN THREAD's clock, which every message carries.
    // This worker never reads a clock of its own: its `performance.now()`
    // counts from a different origin entirely (see `MainToWorker` in
    // protocol.ts), so mixing the two would compute transition progress that
    // is wrong by seconds, not milliseconds.
    const drawn = engine.render(message.now)
    // `null` while idle (see `ChartEngine.lastDrawnBoxes`'s docblock) — so a
    // steady-state frame (the common case) transfers nothing beyond `drawn`
    // itself, exactly like before this feature existed. Transferred, not
    // cloned, when present: bounded by `drawn.length`, never total node
    // count, so this never re-introduces the O(total nodes) per-frame cost
    // the 50k budget forbids.
    const lastDrawnBoxes = engine.lastDrawnBoxes
    // Same reasoning again for the reveal alpha, and `null` on strictly more
    // frames than `lastDrawnBoxes` is (only an expand with something actually
    // fading on screen produces one), so the common case is untouched.
    const lastDrawnAlpha = engine.lastDrawnAlpha
    const transfer: Transferable[] = [drawn.buffer]
    if (lastDrawnBoxes !== null) transfer.push(lastDrawnBoxes.buffer)
    if (lastDrawnAlpha !== null) transfer.push(lastDrawnAlpha.buffer)
    post(
      {
        t: 'frame',
        visible: drawn,
        transitioning: engine.transitioning,
        transitionStartedAt: engine.transitionStartedAt,
        ringActive: engine.ringActive,
        lastDrawnBoxes,
        lastDrawnAlpha,
      },
      transfer,
    )

    // Every message that can change WHICH nodes exist or where they are has to
    // send the layout back, or the main thread keeps drawing its overlay,
    // fitting its camera and painting its minimap from boxes that no longer
    // describe the chart. Missing `isolate` off this list showed as an
    // isolated branch drawn as bare connectors: the camera had fitted the old
    // whole-tree bounds, which put the zoom below the tier where nodes are
    // drawn at all.
    if (
      message.t === 'data' ||
      message.t === 'options' ||
      message.t === 'open' ||
      message.t === 'isolate'
    ) {
      const boxes = engine.boxes.slice()
      const map = engine.visibleToSource.slice()
      post({ t: 'layout', boxes, bounds: engine.bounds, visibleToSource: map }, [
        boxes.buffer,
        map.buffer,
      ])
    }
  } catch (error) {
    post({ t: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
