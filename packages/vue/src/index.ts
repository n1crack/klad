import type { Plugin } from 'vue'
import Klad from './Klad.js'

export { Klad }
export type { KladHandle } from './Klad.js'
export { useKlad } from './useKlad.js'
export type { KladContext } from './useKlad.js'

/**
 * Everything below is `@klad/core`'s, re-exported because an adapter consumer
 * has to be able to NAME every type this API makes them write — without adding
 * the vanilla package as a dependency to do it. See the same block in
 * `@klad/react`'s entry: the two adapters export the same set on purpose, and
 * were missing the same twelve types until now.
 *
 * `NodeData` is the case that shows why it matters: it is the type of every
 * item in `options.data` and of the `item` on every event payload, so it
 * appears in the public surface more than any other type here, and a consumer
 * who wanted to declare `const people: NodeData[]` could not. Inline object
 * literals happened to infer, which is what kept it from being noticed.
 *
 * Four of core's exports are deliberately still absent: `createKlad` and
 * `createOverlay` are the frameworkless entry points this adapter replaces,
 * `OverlayItem` belongs to `createOverlay`, and `KladInstance` is the chart
 * object the adapter owns on the consumer's behalf and never hands over —
 * `useKlad()` gives out its `api`, not the instance.
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

export const KladPlugin: Plugin = {
  install(app) {
    app.component('Klad', Klad)
  },
}
