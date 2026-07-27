/**
 * This package's version, for a consumer that wants to report or log which one
 * it has.
 *
 * A literal rather than a read of `package.json`: this entry has to be
 * importable inside a Web Worker with `types: []` and no JSON module
 * resolution. The cost is a number in two places, which had already drifted
 * three releases before anyone noticed — so `scripts/check-packages.mjs`
 * asserts the two agree, in the release path, where a mismatch can still be
 * fixed without another publish.
 */
export const VERSION = '1.2.0'

export type { NodeData, Warning, WarningCode, Size, Bounds } from './types.js'
export type { Tree, SubtreeStats } from './tree.js'
export { normalize, subtreeOf, wouldCreateCycle, computeSubtreeStats } from './tree.js'

export type { LayoutFn, LayoutOptions, LayoutResult } from './layout/types.js'
export { layout } from './layout/tidy.js'
export type { LayoutName } from './layout/index.js'
export { LAYOUTS, edgeStyleForLayout, isPolarLayout, resolveLayout } from './layout/index.js'
export { file } from './layout/file.js'
export { radial } from './layout/radial.js'
export { hitTestSector, sunburst } from './layout/sunburst.js'

export type { DropMode, DropTarget } from './drag/drop-target.js'
export { dropPosition, isDropAllowed, resolveDropMode, subtreeMask } from './drag/drop-target.js'

export type { Orientation } from './layout/orientation.js'
export { applyOrientation } from './layout/orientation.js'

export type { QuadTree } from './spatial/quadtree.js'
export { buildQuadTree } from './spatial/quadtree.js'

export type { Camera, ViewportSize, ZoomLimits } from './viewport.js'
export {
  centreOn,
  easeInOutCubic,
  easeInQuad,
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
export { DARK_THEME, DEFAULT_THEME, resolveTheme } from './render/theme.js'
export { DARK_PALETTE, DEFAULT_PALETTE, computeNodeFills, depthStep, inkOn } from './render/palette.js'
export type { LodThresholds, LodTier } from './render/lod.js'
export { DEFAULT_LOD, lodFor, overlayEnabled } from './render/lod.js'

export type {
  DrawCallStats,
  EdgeStyle,
  Frame,
  Renderer,
  RenderContext2D,
  RenderSurface,
} from './render/renderer.js'
export { createCanvas2DRenderer } from './render/canvas2d.js'
export type { ExportData, SvgExportOptions } from './render/svg.js'
export { escapeXml, toSVG } from './render/svg.js'

export type { ChartEngine } from './engine.js'
export { createChartEngine, transitionAnchorProgress } from './engine.js'
export type { EngineOptions, MainToWorker, WireTree, WorkerToMain } from './worker/protocol.js'
export { toWireTree, wireTreeToTree } from './worker/protocol.js'

// ChartHost is deliberately NOT re-exported here. It is the only DOM-bound module
// in this package, and keeping it off the main entry is what lets this entry be
// imported inside a Web Worker. Reach it at '@klad/engine/host'.
