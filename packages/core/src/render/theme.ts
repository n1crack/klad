/** Drawing tokens for the canvas layers. Colours are any CSS colour string. */
export interface Theme {
  nodeFill: string
  /**
   * Fill for the `block` LOD tier (the smallest/most-zoomed-out tier — shapes
   * only, no text; see `render/lod.ts`) — deliberately SEPARATE from
   * `nodeFill` rather than reusing it, so the far-zoom "just the tree's
   * connector skeleton" view can be styled (or left invisible) independently
   * of the readable-zoom node colour. Defaults to `'transparent'`: at that
   * tier, by default, only the connectors (`edgeStroke`) are visible, not
   * solid boxes — zoomed all the way out, a chart with thousands of solid
   * `nodeFill` boxes reads as a wall of colour, not a tree shape; leaving
   * `block` tier see-through shows the STRUCTURE instead, with the option to
   * opt back into a colour by setting this. The renderer (`canvas2d.ts`)
   * treats the exact string `'transparent'` as a signal to skip the fill
   * call entirely, not merely as a colour that happens to paint nothing — a
   * real (if wasted) `ctx.fill()` per on-screen node is exactly the kind of
   * per-node cost the 50k budget can't absorb at the tier BUSIEST with nodes
   * on screen at once.
   */
  blockFill: string
  nodeStroke: string
  nodeStrokeWidth: number
  cornerRadius: number
  edgeStroke: string
  edgeWidth: number
  /**
   * World units, like `cornerRadius` — scales with zoom the same way (the
   * renderer multiplies it by `camera.k` right alongside the node corner
   * radius). Defaults to `0`: a sharp 90-degree elbow, unchanged from every
   * existing consumer's current output. Set above `0` for a rounded elbow —
   * an arc/quadratic at each bend instead of a hard `lineTo` corner, in both
   * `canvas2d.ts` and `svg.ts` (the export deliberately mirrors the canvas
   * exactly). Clamped per-edge against that edge's own two segment lengths
   * (see each renderer's elbow-drawing code) so a short connector's arcs
   * never overshoot and cross — the clamp is applied at draw time, not
   * here, since it depends on the specific edge's geometry.
   */
  edgeCornerRadius: number
  labelColour: string
  /** A full CSS font shorthand, e.g. '14px system-ui, sans-serif'. */
  labelFont: string
  /** Inset from the node box to the label, in world units. */
  labelPadding: number
  highlightFill: string
  highlightStroke: string
  /** Alpha applied to a node while it is being dragged. */
  dragGhostAlpha: number
  /** Colour of the one-shot expand/collapse confirmation ring. */
  ringStroke: string
  /**
   * Screen pixels, constant regardless of zoom — NOT divided by `camera.k`
   * before drawing. Node/edge coordinates in this renderer are already
   * converted to screen space by the time they reach the canvas context
   * (`world * k + camera.xy`, computed in JS — see canvas2d.ts), and
   * `ctx.lineWidth` operates directly in that already-converted space, the
   * same way `nodeStrokeWidth`/`edgeWidth` already do above. Dividing by
   * `k` would be correct only in a pipeline that draws in world units under
   * a `ctx.scale(k, k)` transform, which this one deliberately does not
   * use; doing so here would invert the intended effect (a fat ring when
   * zoomed out, a near-invisible one zoomed in).
   */
  ringStrokeWidth: number
  /**
   * Maximum outward growth of the ring over its lifetime, in screen pixels
   * — a few pixels reads as "expands slightly", not a bloom. Same
   * screen-space reasoning as `ringStrokeWidth`: canvas2d.ts adds this
   * directly to the node's already-screen-space box, so it needs no
   * division by `k` either.
   */
  ringMaxOffset: number
}

// Frozen so no consumer can poison it module-globally (e.g.
// `DEFAULT_THEME.nodeFill = 'hotpink'`, which would silently change every
// later `resolveTheme()` call's result). `resolveTheme` only ever spreads
// from this object into a fresh one, so freezing it changes nothing else.
export const DEFAULT_THEME: Readonly<Theme> = Object.freeze({
  nodeFill: '#ffffff',
  blockFill: 'transparent',
  nodeStroke: '#d4d4d8',
  nodeStrokeWidth: 1,
  cornerRadius: 6,
  edgeStroke: '#d4d4d8',
  edgeWidth: 1,
  edgeCornerRadius: 0,
  labelColour: '#18181b',
  labelFont: '14px system-ui, -apple-system, Segoe UI, sans-serif',
  labelPadding: 10,
  highlightFill: '#fef3c7',
  highlightStroke: '#f59e0b',
  dragGhostAlpha: 0.6,
  // Reuses the highlight accent rather than introducing a new hue — the
  // ring and the highlight both mean "this node", so sharing a colour
  // keeps the palette's visual vocabulary small.
  ringStroke: '#f59e0b',
  ringStrokeWidth: 1.5,
  ringMaxOffset: 4,
})

/** Assigns `value` into `target[key]` only when it is not `undefined`. */
function assignDefined<T, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value
}

/**
 * Merges `partial` over `base` (defaults to `DEFAULT_THEME`). Keys explicitly
 * set to `undefined` are skipped rather than overwriting `base`'s own value
 * with `undefined` — `exactOptionalPropertyTypes` blocks that at the TS
 * boundary, but a JS consumer or an `as` cast can still produce
 * `{ nodeStroke: undefined }`, and that should leave `base`'s value in place
 * rather than erasing it.
 *
 * The `base` parameter is what lets a runtime theme update (see
 * `OrgChartApi.setTheme` in packages/vanilla) merge a partial over the
 * chart's CURRENT (already-resolved) theme rather than always back over the
 * built-in defaults — a second `resolveTheme({ nodeFill }, currentTheme)`
 * call keeps every token an earlier `setTheme` call already set, changing
 * only the one this call names. Defaulting to `DEFAULT_THEME` keeps every
 * existing single-argument call site (construction-time resolution) exactly
 * as it was.
 */
export function resolveTheme(partial?: Partial<Theme>, base: Theme = DEFAULT_THEME): Theme {
  const theme: Theme = { ...base }
  if (partial !== undefined) {
    for (const key of Object.keys(partial) as (keyof Theme)[]) {
      assignDefined(theme, key, partial[key])
    }
  }
  return theme
}
