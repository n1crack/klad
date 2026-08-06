export { Klad } from './Klad.js'
export type { KladHandle, KladProps } from './Klad.js'
export { useKlad } from './useKlad.js'
export type { KladContextValue } from './useKlad.js'

/**
 * Everything below is `@klad/core`'s, re-exported because an adapter consumer
 * has to be able to NAME every type this API makes them write — without adding
 * the vanilla package as a dependency to do it.
 *
 * That was not true until now, and `NodeData` is the case that shows why: it
 * is the type of every item in `options.data` and of the `item` on every event
 * payload, so it appears in the public surface more than any other type here,
 * and a consumer who wanted to declare `const people: NodeData[]` could not.
 * Inline object literals happened to infer, which is exactly what kept it
 * from being noticed.
 *
 * `ToBlobOptions` is the sharpest one: `api.toBlob(opts)` takes it as a
 * REQUIRED argument, so calling that method at all meant constructing a value
 * of a type the package did not export. `useKlad()` hands back the same `api`
 * in both adapters, so everything reachable through it is reachable here.
 *
 * Four of core's exports are deliberately still absent: `createKlad` and
 * `createOverlay` are the frameworkless entry points this adapter replaces,
 * `OverlayItem` belongs to `createOverlay`, and `KladInstance` is the chart
 * object the adapter owns on the consumer's behalf and never hands over.
 */
export type {
  Bounds,
  Camera,
  Change,
  ChartState,
  ChartView,
  EdgeStyle,
  ExportOpts,
  KladApi,
  KladEvents,
  LayoutName,
  LayoutSettings,
  LodThresholds,
  MinimapOptions,
  MinimapPosition,
  NodeContext,
  NodeData,
  NodeDropEvent,
  NodePlace,
  NodeStats,
  Options,
  Orientation,
  SearchResult,
  Size,
  ToBlobOptions,
  Warning,
  ZoomLimits,
} from '@klad/core'

// A host doing light/dark needs the palettes, and should not have to add the
// vanilla package as a dependency to name them. `DEFAULT_NODE_SIZE` and
// `DEFAULT_HISTORY` are here for the same reason: they are the documented
// defaults for `options.nodeSize` and `options.history`, and a host reading
// one back or building on it should not have to restate the number.
export {
  DARK_THEME,
  DEFAULT_THEME,
  DARK_PALETTE,
  DEFAULT_PALETTE,
  DEFAULT_HISTORY,
  DEFAULT_NODE_SIZE,
} from '@klad/core'
export type { Theme } from '@klad/core'
