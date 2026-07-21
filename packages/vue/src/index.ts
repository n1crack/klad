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

export const Vue3OrgChartPlugin: Plugin = {
  install(app) {
    app.component('OrgChart', OrgChart)
  },
}
