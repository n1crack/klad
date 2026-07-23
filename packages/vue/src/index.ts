import type { Plugin } from 'vue'
import Klados from './Klados.vue'

export { Klados }
export { useKlados } from './useKlados.js'
export type { KladosContext } from './useKlados.js'
export type {
  ChartState,
  NodeContext,
  Options,
  KladosApi,
  SearchResult,
} from 'klados'

// A host doing light/dark needs the palettes, and should not have to add the
// vanilla package as a dependency to name them.
export { DARK_THEME, DEFAULT_THEME } from 'klados'
export type { Theme } from 'klados'

export const KladosPlugin: Plugin = {
  install(app) {
    app.component('Klados', Klados)
  },
}
