import { createContext, useContext } from 'react'
import type { ChartState, KladApi } from '@klad/core'

export interface KladContextValue {
  api: KladApi | null
  state: ChartState | null
}

const DEFAULT_CONTEXT: KladContextValue = { api: null, state: null }

/** Provided by the nearest `<Klad>` ancestor — see Klad.tsx. */
export const KladContext = createContext<KladContextValue>(DEFAULT_CONTEXT)

/** Reads the chart context provided by the nearest `Klad` ancestor. */
export function useKlad(): KladContextValue {
  return useContext(KladContext)
}
