import { inject, shallowRef, type ShallowRef } from 'vue'
import type { ChartState, OrgChartApi } from '@n1crack/orgchart'

export interface OrgChartContext {
  api: ShallowRef<OrgChartApi | null>
  state: ShallowRef<ChartState | null>
}

const ORG_CHART_KEY = 'orgchart'

/** Reads the chart context provided by the nearest `OrgChart` ancestor. */
export function useOrgChart(): OrgChartContext {
  return inject<OrgChartContext>(ORG_CHART_KEY, () => ({ api: shallowRef(null), state: shallowRef(null) }), true)
}

export { ORG_CHART_KEY }
