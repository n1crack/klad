import type { LayoutFn } from './types.js'
import type { EdgeStyle } from '../render/renderer.js'
import { layout as tidy } from './tidy.js'
import { file } from './file.js'
import { radial } from './radial.js'
import { sunburst } from './sunburst.js'

/**
 * The built-in layouts, keyed by name.
 *
 * A NAME, not a function, is what crosses the engine's option surface: the
 * engine may be running inside a Web Worker, and a function cannot survive
 * `postMessage`. A caller who wants a layout of their own reaches
 * `resolveLayout` (or the `LayoutFn` type) from the pure core and drives it
 * themselves; there is no way to smuggle one through `EngineOptions`, and
 * pretending otherwise would work in-process and fail in a worker.
 */
export const LAYOUTS = { tidy, file, radial, sunburst } satisfies Record<string, LayoutFn>

export type LayoutName = keyof typeof LAYOUTS

/**
 * Resolves a layout name to its function. A bare function passes through, for
 * a main-thread caller supplying their own. Anything unrecognised — or
 * `undefined` — falls back to `tidy`, the 1.0 default, so a bad name degrades
 * to a working chart rather than throwing somewhere unreachable inside a
 * worker.
 */
export function resolveLayout(layout: LayoutName | LayoutFn | undefined): LayoutFn {
  if (typeof layout === 'function') return layout
  return LAYOUTS[layout as LayoutName] ?? tidy
}

/**
 * True for the layouts that place their nodes on a circle. Two things follow
 * from it, both in the engine:
 *
 *  - orientation and RTL are meaningless (a wheel has no reading direction to
 *    flip), so `applyOrientation` is skipped entirely rather than applied as a
 *    no-op;
 *  - `fit()` should frame the layout's own square bounds, which already put
 *    the centre in the middle, instead of a tight box.
 */
export function isPolarLayout(layout: LayoutName | undefined): boolean {
  return layout === 'radial' || layout === 'sunburst'
}

/**
 * The connector style each built-in layout asks for — see `EdgeStyle`. An
 * unknown name falls back to `'tiered'`, matching `resolveLayout`'s own
 * fallback to `tidy`, so a bad name gives an ordinary chart rather than one
 * with no connectors.
 */
export function edgeStyleForLayout(layout: LayoutName | undefined): EdgeStyle {
  switch (layout) {
    case 'file':
      return 'folder'
    case 'radial':
      return 'spoke'
    case 'sunburst':
      return 'none'
    default:
      return 'tiered'
  }
}
