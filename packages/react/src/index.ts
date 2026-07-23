export { Klad } from './Klad.js'
export type { KladHandle, KladProps } from './Klad.js'
export { useKlad } from './useKlad.js'
export type { KladContextValue } from './useKlad.js'
export type {
  ChartState,
  NodeContext,
  Options,
  KladApi,
  SearchResult,
} from '@klad/core'

// A host doing light/dark needs the palettes, and should not have to add the
// vanilla package as a dependency to name them.
export { DARK_THEME, DEFAULT_THEME } from '@klad/core'
export type { Theme } from '@klad/core'
