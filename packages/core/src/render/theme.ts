/** Drawing tokens for the canvas layers. Colours are any CSS colour string. */
export interface Theme {
  nodeFill: string
  nodeStroke: string
  nodeStrokeWidth: number
  cornerRadius: number
  edgeStroke: string
  edgeWidth: number
  labelColour: string
  /** A full CSS font shorthand, e.g. '14px system-ui, sans-serif'. */
  labelFont: string
  /** Inset from the node box to the label, in world units. */
  labelPadding: number
  highlightFill: string
  highlightStroke: string
  /** Alpha applied to a node while it is being dragged. */
  dragGhostAlpha: number
}

// Frozen so no consumer can poison it module-globally (e.g.
// `DEFAULT_THEME.nodeFill = 'hotpink'`, which would silently change every
// later `resolveTheme()` call's result). `resolveTheme` only ever spreads
// from this object into a fresh one, so freezing it changes nothing else.
export const DEFAULT_THEME: Readonly<Theme> = Object.freeze({
  nodeFill: '#ffffff',
  nodeStroke: '#d4d4d8',
  nodeStrokeWidth: 1,
  cornerRadius: 6,
  edgeStroke: '#d4d4d8',
  edgeWidth: 1,
  labelColour: '#18181b',
  labelFont: '14px system-ui, -apple-system, Segoe UI, sans-serif',
  labelPadding: 10,
  highlightFill: '#fef3c7',
  highlightStroke: '#f59e0b',
  dragGhostAlpha: 0.6,
})

/** Assigns `value` into `target[key]` only when it is not `undefined`. */
function assignDefined<T, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value
}

/**
 * Merges `partial` over the defaults. Keys explicitly set to `undefined` are
 * skipped rather than overwriting a default with `undefined` — `exactOptionalPropertyTypes`
 * blocks that at the TS boundary, but a JS consumer or an `as` cast can still
 * produce `{ nodeStroke: undefined }`, and that should leave the default in
 * place rather than erasing it.
 */
export function resolveTheme(partial?: Partial<Theme>): Theme {
  const theme: Theme = { ...DEFAULT_THEME }
  if (partial !== undefined) {
    for (const key of Object.keys(partial) as (keyof Theme)[]) {
      assignDefined(theme, key, partial[key])
    }
  }
  return theme
}
