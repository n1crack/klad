export const VERSION = '1.0.0-alpha.0'

export type { NodeData, Warning, WarningCode, Size, Bounds } from './types.js'
export type { Tree } from './tree.js'
export { normalize, subtreeOf, wouldCreateCycle } from './tree.js'

export type { LayoutOptions, LayoutResult } from './layout/tidy.js'
export { layout } from './layout/tidy.js'

export type { Orientation } from './layout/orientation.js'
export { applyOrientation } from './layout/orientation.js'

export type { QuadTree } from './spatial/quadtree.js'
export { buildQuadTree } from './spatial/quadtree.js'

export type { Camera, ViewportSize, ZoomLimits } from './viewport.js'
export {
  centreOn,
  easeInOutCubic,
  easeOutCubic,
  fit,
  interpolate,
  pan,
  screenToWorld,
  visibleRect,
  worldToScreen,
  zoomAt,
} from './viewport.js'

export type { VisibleTree } from './visible.js'
export { pruneToVisible } from './visible.js'

export type { MinimapSize, MinimapTransform, SilhouetteOptions, Silhouette } from './minimap.js'
export {
  computeMinimapTransform,
  computeSilhouette,
  DEFAULT_SILHOUETTE_OPTIONS,
  minimapToWorld,
  viewportRectInMinimap,
  worldToMinimap,
} from './minimap.js'

export type { TextMeasurer, TextMetricsSource } from './text/measure.js'
export { createTextMeasurer } from './text/measure.js'

export type { Theme } from './render/theme.js'
export { DEFAULT_THEME, resolveTheme } from './render/theme.js'
export type { LodThresholds, LodTier } from './render/lod.js'
export { DEFAULT_LOD, lodFor, overlayEnabled } from './render/lod.js'

export type {
  DrawCallStats,
  Frame,
  Renderer,
  RenderContext2D,
  RenderSurface,
} from './render/renderer.js'
export { createCanvas2DRenderer } from './render/canvas2d.js'
export type { ExportData, SvgExportOptions } from './render/svg.js'
export { escapeXml, toSVG } from './render/svg.js'

export type { ChartEngine } from './engine.js'
export { createChartEngine } from './engine.js'
export type { EngineOptions, MainToWorker, WireTree, WorkerToMain } from './worker/protocol.js'
export { toWireTree, wireTreeToTree } from './worker/protocol.js'

// ChartHost is deliberately NOT re-exported here. It is the only DOM-bound module
// in this package, and keeping it off the main entry is what lets this entry be
// imported inside a Web Worker. Reach it at '@n1crack/orgchart-core/host'.
