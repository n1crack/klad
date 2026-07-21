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

/** Both thresholds are inclusive lower bounds, so a tier begins exactly at its value. */
export function lodFor(zoom: number, thresholds: LodThresholds): LodTier {
  if (zoom >= thresholds.overlay) return 'full'
  if (zoom >= thresholds.text) return 'label'
  return 'block'
}

export function overlayEnabled(zoom: number, thresholds: LodThresholds): boolean {
  return lodFor(zoom, thresholds) === 'full'
}
