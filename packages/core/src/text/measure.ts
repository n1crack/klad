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

// Grapheme-cluster segmentation, not code-unit slicing: `Intl.Segmenter` keeps
// surrogate pairs, ZWJ sequences, and combining marks intact, so a cut index
// can never land inside one. Available under this package's `lib: ["ES2023"]`
// (which pulls in `es2022.intl`) with no DOM dependency.
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * Cumulative code-unit offsets of every grapheme-cluster boundary in `text`.
 * `offsets[0] === 0` and `offsets[offsets.length - 1] === text.length`; slicing
 * `text` at any offset in between is always safe.
 */
function clusterOffsets(text: string): number[] {
  const offsets = [0]
  let cursor = 0
  for (const { segment } of graphemeSegmenter.segment(text)) {
    cursor += segment.length
    offsets.push(cursor)
  }
  return offsets
}

/**
 * Caches measured widths and truncates by binary search over grapheme-cluster
 * boundaries, so the number of measurements per label grows with log(length)
 * rather than length. Eviction from the width cache is oldest-first, which
 * `Map` gives for free through insertion order.
 *
 * Two things are deliberately kept out of the shared width cache:
 *  - Binary-search probes (intermediate prefixes) live in a `Map` local to
 *    each `truncate` call. They are never requested again, and leaving them
 *    in the shared FIFO cache would flush genuinely reusable entries — the
 *    stable, on-screen labels a real render loop re-measures every frame —
 *    with throwaway lookups from the same frame's own search.
 *  - The truncation *result* is memoised separately, keyed by
 *    `text|maxWidth|ellipsis`, since that's the value the render loop
 *    actually re-requests every frame. A stable viewport then costs a map
 *    lookup per label instead of a full binary search.
 *
 * `maxEntries` is clamped to at least 1 — a measurer configured to cache
 * nothing isn't a smaller version of a normal one, it's a different, unsupported
 * shape (every lookup would re-measure AND still allocate a Map entry). Clamping
 * keeps the class of "at most maxEntries" bound meaningful for any input.
 */
export function createTextMeasurer(
  source: TextMetricsSource,
  maxEntries = DEFAULT_MAX_ENTRIES,
): TextMeasurer {
  const cap = Math.max(1, maxEntries)
  const cache = new Map<string, number>()
  const truncateCache = new Map<string, string>()

  const width = (text: string): number => {
    if (text === '') return 0
    const hit = cache.get(text)
    if (hit !== undefined) return hit
    const w = source.measureWidth(text)
    if (cache.size >= cap) {
      const oldest = cache.keys().next()
      if (!oldest.done) cache.delete(oldest.value)
    }
    cache.set(text, w)
    return w
  }

  const computeTruncation = (text: string, maxWidth: number, ellipsis: string): string => {
    if (width(text) <= maxWidth) return text

    const ellipsisWidth = width(ellipsis)
    // Not even a bare ellipsis fits: nothing meaningful can be returned.
    if (ellipsisWidth > maxWidth) return ''

    // Probe widths live only here: intermediate binary-search prefixes that
    // are never requested again (see the module docblock for why they must
    // not enter the shared cache).
    const probes = new Map<string, number>()
    const probeWidth = (s: string): number => {
      const hit = probes.get(s)
      if (hit !== undefined) return hit
      const w = source.measureWidth(s)
      probes.set(s, w)
      return w
    }

    const offsets = clusterOffsets(text)
    let lo = 0
    let hi = offsets.length - 1
    // Search on width(slice + ellipsis) directly, not width(slice) +
    // width(ellipsis): real fonts kern the last glyph against the ellipsis,
    // so the two widths don't add. `lo = 0` (bare ellipsis) is always a valid
    // baseline here because of the `ellipsisWidth > maxWidth` guard above.
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      const candidate = text.slice(0, offsets[mid]!) + ellipsis
      if (probeWidth(candidate) <= maxWidth) lo = mid
      else hi = mid - 1
    }
    // When lo === 0 this is just `ellipsis` — deliberate: it tells the reader
    // something was cut, whereas '' would look like there was nothing there.
    return text.slice(0, offsets[lo]!) + ellipsis
  }

  const truncate = (text: string, maxWidth: number, ellipsis = DEFAULT_ELLIPSIS): string => {
    if (text === '') return ''

    const cacheKey = `${text}|${maxWidth}|${ellipsis}`
    const cached = truncateCache.get(cacheKey)
    if (cached !== undefined) return cached

    const result = computeTruncation(text, maxWidth, ellipsis)
    if (truncateCache.size >= cap) {
      const oldest = truncateCache.keys().next()
      if (!oldest.done) truncateCache.delete(oldest.value)
    }
    truncateCache.set(cacheKey, result)
    return result
  }

  return {
    width,
    truncate,
    clear: () => {
      cache.clear()
      truncateCache.clear()
    },
    get size() {
      return cache.size
    },
  }
}
