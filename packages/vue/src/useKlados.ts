import { inject, shallowRef, type ShallowRef } from 'vue'
import type { ChartState, KladosApi } from 'klados'

export interface KladosContext {
  api: ShallowRef<KladosApi | null>
  state: ShallowRef<ChartState | null>
}

const ORG_CHART_KEY = 'orgchart'

/** Reads the chart context provided by the nearest `Klados` ancestor. */
export function useKlados(): KladosContext {
  return inject<KladosContext>(ORG_CHART_KEY, () => ({ api: shallowRef(null), state: shallowRef(null) }), true)
}

export { ORG_CHART_KEY }
