import type { Plugin } from 'vue'
import Klad from './Klad.vue'

export { Klad }
export { useKlad } from './useKlad.js'
export type { KladContext } from './useKlad.js'
export type {
  ChartState,
  ChartView,
  NodeContext,
  Options,
  KladApi,
  SearchResult,
} from '@klad/core'

// A host doing light/dark needs the palettes, and should not have to add the
// vanilla package as a dependency to name them.
export { DARK_THEME, DEFAULT_THEME } from '@klad/core'
export type { Theme } from '@klad/core'

export const KladPlugin: Plugin = {
  install(app) {
    app.component('Klad', Klad)
  },
}
