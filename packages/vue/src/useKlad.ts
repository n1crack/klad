import { inject, shallowRef, type ShallowRef } from 'vue'
import type { ChartState, KladApi } from 'klad'

export interface KladContext {
  api: ShallowRef<KladApi | null>
  state: ShallowRef<ChartState | null>
}

const ORG_CHART_KEY = 'orgchart'

/** Reads the chart context provided by the nearest `Klad` ancestor. */
export function useKlad(): KladContext {
  return inject<KladContext>(ORG_CHART_KEY, () => ({ api: shallowRef(null), state: shallowRef(null) }), true)
}

export { ORG_CHART_KEY }
