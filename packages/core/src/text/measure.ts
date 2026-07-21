/**
 * Whatever can measure a string. The Canvas2D backend adapts `ctx.measureText`;
 * tests pass a deterministic fake. Core never sees a canvas type through this.
 */
export interface TextMetricsSource {
  measureWidth(text: string): number
}

export interface TextMeasurer {
  width(text: string): number
  /** Longest prefix of `text` that fits `maxWidth`, plus an ellipsis if shortened. */
  truncate(text: string, maxWidth: number, ellipsis?: string): string
  clear(): void
  readonly size: number
}

const DEFAULT_MAX_ENTRIES = 4096
const DEFAULT_ELLIPSIS = '…'

/**
 * Caches measured widths and truncates by binary search over prefixes, so the
 * number of measurements per label grows with log(length) rather than length.
 * Eviction is oldest-first, which `Map` gives for free through insertion order.
 */
export function createTextMeasurer(
  source: TextMetricsSource,
  maxEntries = DEFAULT_MAX_ENTRIES,
): TextMeasurer {
  const cache = new Map<string, number>()

  const width = (text: string): number => {
    if (text === '') return 0
    const hit = cache.get(text)
    if (hit !== undefined) return hit
    const w = source.measureWidth(text)
    if (cache.size >= maxEntries) {
      const oldest = cache.keys().next()
      if (!oldest.done) cache.delete(oldest.value)
    }
    cache.set(text, w)
    return w
  }

  const truncate = (text: string, maxWidth: number, ellipsis = DEFAULT_ELLIPSIS): string => {
    if (text === '') return ''
    if (width(text) <= maxWidth) return text

    const ellipsisWidth = width(ellipsis)
    const budget = maxWidth - ellipsisWidth
    if (budget <= 0) return ''

    // Largest `len` with width(text.slice(0, len)) <= budget.
    let lo = 0
    let hi = text.length
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (width(text.slice(0, mid)) <= budget) lo = mid
      else hi = mid - 1
    }
    return lo === 0 ? '' : text.slice(0, lo) + ellipsis
  }

  return {
    width,
    truncate,
    clear: () => cache.clear(),
    get size() {
      return cache.size
    },
  }
}
