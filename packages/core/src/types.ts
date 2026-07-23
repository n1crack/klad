export interface NodeData {
  id: string
  parentId?: string | null
  [key: string]: unknown
}

export type WarningCode = 'duplicate-id' | 'orphan-parent' | 'cycle'

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
