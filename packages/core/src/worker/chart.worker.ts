/// <reference lib="webworker" />
import { createChartEngine, type ChartEngine } from '../engine.js'
import { createCanvas2DRenderer } from '../render/canvas2d.js'
import { createTextMeasurer } from '../text/measure.js'
import type { RenderSurface } from '../render/renderer.js'
import type { Theme } from '../render/theme.js'
import type { MainToWorker, WorkerToMain } from './protocol.js'

let engine: ChartEngine | null = null

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
        const renderer = createCanvas2DRenderer(surface, theme, (font) => {
          const probe = new OffscreenCanvas(1, 1).getContext('2d')!
          probe.font = font
          return createTextMeasurer({ measureWidth: (t) => probe.measureText(t).width })
        })
        engine = createChartEngine(renderer)
        engine.setViewport(message.width, message.height, message.dpr)
        break
      }
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
        engine?.setOpen(message.index, message.open)
        break
      case 'resize':
        engine?.setViewport(message.width, message.height, message.dpr)
        break
      case 'highlight':
        engine?.setHighlight(message.ids)
        break
      case 'drag':
        engine?.setDrag(message.index)
        break
      case 'animate':
        engine?.setAnimate(message.enabled)
        break
    }

    if (engine === null) return

    // Every message can change what is on screen, so redraw and report.
    // No `now` passed to `render()`: a dedicated Worker's `performance.now()`
    // shares the same time origin as the main thread that spawned it, so the
    // engine's own default (its own `performance.now()`) already lines up
    // with the main thread's `requestAnimationFrame` clock — nothing needs
    // threading across the postMessage boundary for this to stay correct.
    const drawn = engine.render()
    post({ t: 'frame', visible: drawn, transitioning: engine.transitioning }, [drawn.buffer])

    if (message.t === 'data' || message.t === 'options' || message.t === 'open') {
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
