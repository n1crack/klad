import { createContext, useContext } from 'react'
import type { ChartState, KladosApi } from 'klados'

export interface KladosContextValue {
  api: KladosApi | null
  state: ChartState | null
}

const DEFAULT_CONTEXT: KladosContextValue = { api: null, state: null }

/** Provided by the nearest `<Klados>` ancestor — see Klados.tsx. */
export const KladosContext = createContext<KladosContextValue>(DEFAULT_CONTEXT)

/** Reads the chart context provided by the nearest `Klados` ancestor. */
export function useKlados(): KladosContextValue {
  return useContext(KladosContext)
}
