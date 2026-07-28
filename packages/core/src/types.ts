export interface NodeData {
  id: string
  parentId?: string | null
  [key: string]: unknown
}

/**
 * `load-failed` is the odd one out: the other three are things wrong with data
 * the host already handed over, this one is a `loadChildren` that rejected.
 * It reports through the same channel because to a host watching the chart it
 * is the same kind of news — something it asked for could not be honoured, and
 * the chart carried on without it. The node stays unloaded and clicking it
 * again retries; a host that wants the `Error` itself catches it inside its
 * own `loadChildren`, which is the only place it exists.
 */
export type WarningCode = 'duplicate-id' | 'orphan-parent' | 'cycle' | 'load-failed'

export interface Warning {
  code: WarningCode
  detail: string
  ids: string[]
}

export interface Size {
  w: number
  h: number
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}
