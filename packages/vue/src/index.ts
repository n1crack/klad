import type { Plugin } from 'vue'
import Klad from './Klad.js'

export { Klad }
export type { KladHandle } from './Klad.js'
export { useKlad } from './useKlad.js'
export type { KladContext } from './useKlad.js'
export type {
  Change,
  ChartState,
  ChartView,
  EdgeStyle,
  LayoutName,
  LayoutSettings,
  NodeContext,
  NodePlace,
  Options,
  KladApi,
  NodeDropEvent,
  SearchResult,
} from '@klad/core'

// A host doing light/dark needs the palettes, and should not have to add the
// vanilla package as a dependency to name them.
export { DARK_THEME, DEFAULT_THEME, DARK_PALETTE, DEFAULT_PALETTE } from '@klad/core'
export type { Theme } from '@klad/core'

export const KladPlugin: Plugin = {
  install(app) {
    app.component('Klad', Klad)
  },
}
