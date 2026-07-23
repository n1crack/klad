import type { Plugin } from 'vue'
import OrgChart from './OrgChart.vue'

export { OrgChart }
export { useOrgChart } from './useOrgChart.js'
export type { OrgChartContext } from './useOrgChart.js'
export type {
  ChartState,
  NodeContext,
  Options,
  OrgChartApi,
  SearchResult,
} from '@n1crack/orgchart'

// A host doing light/dark needs the palettes, and should not have to add the
// vanilla package as a dependency to name them.
export { DARK_THEME, DEFAULT_THEME } from '@n1crack/orgchart'
export type { Theme } from '@n1crack/orgchart'

export const Vue3OrgChartPlugin: Plugin = {
  install(app) {
    app.component('OrgChart', OrgChart)
  },
}
