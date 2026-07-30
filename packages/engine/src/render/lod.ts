/**
 * How much detail to draw at the current zoom.
 * - `block`: rectangles and connectors only, no text.
 * - `label`: adds one truncated line of text per node.
 * - `full`: the complete card; the DOM overlay is also active at this tier.
 */
export type LodTier = 'block' | 'label' | 'full'

export interface LodThresholds {
  /** Zoom at which labels start being drawn. */
  text: number
  /** Zoom at which full cards are drawn and the DOM overlay activates. */
  overlay: number
}

export const DEFAULT_LOD: LodThresholds = { text: 0.25, overlay: 0.6 }

/**
 * Both thresholds are inclusive lower bounds, so a tier begins exactly at its
 * value. `overlay` is expected to be `>= text`; if a caller supplies an
 * inverted pair, the effective overlay threshold is normalised up to
 * `max(text, overlay)` so the `label` tier is never silently deleted by a
 * lower zoom returning `'full'` before `text` has even been reached.
 * A non-finite `zoom` (e.g. `NaN`) fails every `>=` comparison and falls
 * through to `'block'`, the cheapest tier — the correct failsafe.
 */
export function lodFor(zoom: number, thresholds: LodThresholds): LodTier {
  const overlay = Math.max(thresholds.text, thresholds.overlay)
  if (zoom >= overlay) return 'full'
  if (zoom >= thresholds.text) return 'label'
  return 'block'
}

/** Delegates to `lodFor`, so it inherits the same threshold normalisation. */
export function overlayEnabled(zoom: number, thresholds: LodThresholds): boolean {
  return lodFor(zoom, thresholds) === 'full'
}
