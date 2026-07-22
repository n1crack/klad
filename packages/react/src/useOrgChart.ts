import { createContext, useContext } from 'react'
import type { ChartState, OrgChartApi } from '@n1crack/orgchart'

export interface OrgChartContextValue {
  api: OrgChartApi | null
  state: ChartState | null
}

const DEFAULT_CONTEXT: OrgChartContextValue = { api: null, state: null }

/** Provided by the nearest `<OrgChart>` ancestor — see OrgChart.tsx. */
export const OrgChartContext = createContext<OrgChartContextValue>(DEFAULT_CONTEXT)

/** Reads the chart context provided by the nearest `OrgChart` ancestor. */
export function useOrgChart(): OrgChartContextValue {
  return useContext(OrgChartContext)
}
