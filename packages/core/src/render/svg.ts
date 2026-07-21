import type { Bounds } from '../types.js'
import type { Theme } from './theme.js'
import { resolveTheme } from './theme.js'

/**
 * Pure geometry export never touches a canvas. It re-derives its own SVG
 * markup from the same laid-out boxes the Canvas2D backend paints from, so
 * the two stay provably in agreement (see svg.test.ts's "matches the canvas
 * renderer's geometry" suite) without ever reading a pixel back — a
 * rasterized canvas is viewport-cropped and resolution-locked to whatever
 * zoom the user happened to be at; this is neither.
 *
 * Deliberately a SUBSET of `Frame` (renderer.ts): export always covers the
 * whole VISIBLE tree (see `pruneToVisible` — collapsed branches already
 * excluded upstream), never a viewport-cropped slice, so there is no camera,
 * no LOD tier, and none of the transition/ghost/ring/highlight/drag fields a
 * live frame carries. Just geometry, labels, and orientation.
 */
export interface ExportData {
  /**
   * `[x, y, w, h]` per node, world units, length `4 * parent.length`. Must
   * already be final, oriented output — i.e. `layout()` followed by
   * `applyOrientation()` — not the canonical top-down layout `layout()`
   * alone produces. `ChartEngine.getExportData()` supplies this directly
   * from its own post-orientation `boxes`.
   */
  boxes: Float64Array
  /** Parent index per node, -1 for roots, in the same (visible-tree) index space as `boxes`. */
  parent: Int32Array
  /** Label per node, same index space. Never truncated by this module — see `toSVG`'s docblock. */
  labels: readonly string[]
  bounds: Bounds
  /**
   * Same convention as `Frame.horizontal`: true for `lr`/`rl`, selects which
   * axis the connector elbow splits on. Must match the orientation `boxes`
   * was already transformed for — this module does not re-derive it.
   */
  horizontal: boolean
}

export interface SvgExportOptions {
  /** World-unit margin around `bounds` so edge strokes and label ascenders/
   * descenders at the very boundary aren't clipped by the viewBox. Default 16. */
  padding?: number
  theme?: Partial<Theme>
}

const DEFAULT_PADDING = 16

/**
 * XML 1.0 forbids most C0 controls outright (only tab/LF/CR survive) and
 * forbids lone surrogates outright — neither has a numeric character
 * reference that makes it legal in text content, so both are removed here
 * rather than escaped. A lone surrogate left in place would round-trip fine
 * through a JS string but produce ill-formed UTF-8 the moment this document
 * is written to a file or a `Blob`, so it is replaced with U+FFFD instead of
 * silently dropped, to keep string length/positioning arguments closer to
 * sane for anything downstream that still tries to reason about it.
 */
function sanitizeXmlText(input: string): string {
  let out = ''
  let changed = false
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i)
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      changed = true
      continue
    }
    if (code === 0x7f) {
      changed = true
      continue
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = input.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += input[i]! + input[i + 1]!
        i++
        continue
      }
      out += '�'
      changed = true
      continue
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      out += '�'
      changed = true
      continue
    }
    out += input[i]
  }
  return changed ? out : input
}

const XML_ESCAPE_RE = /[&<>"']/g

function xmlEscapeChar(ch: string): string {
  switch (ch) {
    case '&':
      return '&amp;'
    case '<':
      return '&lt;'
    case '>':
      return '&gt;'
    case '"':
      return '&quot;'
    default:
      return '&apos;'
  }
}

/**
 * Node labels are user data — the ONE place in this library where arbitrary
 * caller-supplied strings reach a markup document. `&`, `<`, `>`, and both
 * quote characters are escaped unconditionally (cheap, and correct in both
 * text content and attribute-value position, even though this module only
 * ever uses it for text content today); see `sanitizeXmlText` for the
 * control-character/surrogate half of this. Getting either half wrong here
 * is an injection bug, not a cosmetic one.
 */
export function escapeXml(input: string): string {
  return sanitizeXmlText(input).replace(XML_ESCAPE_RE, xmlEscapeChar)
}

/**
 * Rounds to hundredths. World units here are ultimately CSS-pixel-ish
 * quantities (they come from caller-supplied `nodeSize`s and spacing), so a
 * raw float64's ~17 significant digits carries no visible information a
 * hundredth doesn't already capture — see `toSVG`'s "Size" docblock for the
 * measured byte cost at 50k nodes this buys back.
 */
function fmt(n: number): string {
  return String(Math.round(n * 100) / 100)
}

/**
 * Builds every connector as ONE batched `<path>` `d` string — a single
 * element regardless of node count, for the same reason canvas2d.ts strokes
 * every edge in one `Path2D`: a 50k-edge document with one `<path>` per
 * element pays per-element parse/layout overhead 50,000 times over for zero
 * visual benefit, since every edge shares the same stroke style anyway.
 *
 * The elbow geometry (`px,py` / `cx,cy` / the horizontal-vs-vertical split
 * on `horizontal`) is copied verbatim from canvas2d.ts's edge-drawing loop —
 * this is the exact thing svg.test.ts's cross-check asserts stays true.
 * Iterates the flat index space directly (no recursion), so a 50k-deep
 * chain costs one pass, not one stack frame per level.
 */
function buildEdgePath(
  boxes: Float64Array,
  parent: Int32Array,
  horizontal: boolean,
  offsetX: number,
  offsetY: number,
): string {
  const n = parent.length
  const parts: string[] = []
  for (let i = 0; i < n; i++) {
    const p = parent[i]!
    if (p === -1) continue
    const io = i * 4
    const po = p * 4
    let px: number
    let py: number
    let cx: number
    let cy: number
    if (horizontal) {
      px = boxes[po]! + boxes[po + 2]!
      py = boxes[po + 1]! + boxes[po + 3]! / 2
      cx = boxes[io]!
      cy = boxes[io + 1]! + boxes[io + 3]! / 2
    } else {
      px = boxes[po]! + boxes[po + 2]! / 2
      py = boxes[po + 1]! + boxes[po + 3]!
      cx = boxes[io]! + boxes[io + 2]! / 2
      cy = boxes[io + 1]!
    }
    px += offsetX
    py += offsetY
    cx += offsetX
    cy += offsetY
    if (horizontal) {
      const midX = (px + cx) / 2
      parts.push(
        `M${fmt(px)},${fmt(py)} L${fmt(midX)},${fmt(py)} L${fmt(midX)},${fmt(cy)} L${fmt(cx)},${fmt(cy)}`,
      )
    } else {
      const midY = (py + cy) / 2
      parts.push(
        `M${fmt(px)},${fmt(py)} L${fmt(px)},${fmt(midY)} L${fmt(cx)},${fmt(midY)} L${fmt(cx)},${fmt(cy)}`,
      )
    }
  }
  return parts.join(' ')
}

/**
 * Serializes the same laid-out boxes the Canvas2D backend draws from into a
 * standalone SVG document string: vector, resolution-independent, real
 * `<text>` (selectable and searchable), clean at any print size. Never reads
 * a canvas pixel — see the module docblock.
 *
 * **Text is never truncated.** Canvas truncation exists because a fixed
 * screen-pixel budget at a given zoom is real: `text/measure.ts` binary-
 * searches for the longest prefix that fits, because the alternative is
 * text spilling out over neighbouring cards on screen. None of that applies
 * to an export — there is no zoom, and the document is meant to be
 * inspected, not fit into a viewport — so truncating here would DESTROY
 * data (a person's actual name, cut down to "Alexandr…") for a screen-space
 * problem that doesn't exist in a vector document. The label is rendered in
 * full, positioned exactly like the canvas does it (left edge + `labelPadding`,
 * vertical box centre). A label wider than its box is therefore visually
 * honest: it can overlap a neighbour, which is the correct signal that the
 * caller's `nodeSize` is too small for its content, rather than a silently
 * eaten ellipsis that hides the same problem. Nothing here clips it to the
 * box, because that would reintroduce the same "some of the text is simply
 * gone" failure mode one layer down (a `clip-path` still means the browser's
 * find-in-page / a screen reader over exported HTML would see full text
 * while the print/PNG output silently loses characters — the two forms
 * would disagree). Overflow is a layout-tuning signal, not something export
 * papers over.
 *
 * **Size.** Every node contributes one `<rect>` and, when it has a label,
 * one `<text>`; every non-root node contributes one connector segment
 * batched into the single shared `<path>`. Measured on a synthetic 50,000-
 * node tree (see svg.bench.test.ts): output is on the order of single-digit
 * MB of UTF-8 text and serializes in well under a second — see the bench
 * test's logged numbers for the exact figures on this machine. That is a
 * big string to build and hand to `Blob`/a data URI/an iframe's `srcdoc`,
 * but it is a single synchronous string-building pass over flat arrays (no
 * recursion, no per-node allocation beyond the strings themselves), so nothing
 * here is a candidate for streaming — there's no natural chunk boundary a
 * consumer could act on before the whole tree is visited anyway, since the
 * `viewBox`/root `<svg>` dimensions depend on `bounds`, which are already
 * known up front. If a caller's tree is large enough that the resulting
 * string itself becomes the bottleneck (not just building it), the fix is a
 * caller-side cap on which subtree gets exported, not a change in here.
 */
export function toSVG(data: ExportData, opts: SvgExportOptions = {}): string {
  const { boxes, parent, labels, bounds } = data
  const horizontal = data.horizontal
  const theme = resolveTheme(opts.theme)
  const padding = opts.padding ?? DEFAULT_PADDING
  const n = parent.length

  const offsetX = padding - bounds.minX
  const offsetY = padding - bounds.minY
  const width = Math.max(0, bounds.maxX - bounds.minX) + padding * 2
  const height = Math.max(0, bounds.maxY - bounds.minY) + padding * 2

  const edgePath = buildEdgePath(boxes, parent, horizontal, offsetX, offsetY)

  const radiusAttr = theme.cornerRadius > 0 ? ` rx="${fmt(theme.cornerRadius)}"` : ''
  const nodeParts: string[] = Array.from({ length: n })
  for (let i = 0; i < n; i++) {
    const o = i * 4
    const x = fmt(boxes[o]! + offsetX)
    const y = fmt(boxes[o + 1]! + offsetY)
    const w = fmt(boxes[o + 2]!)
    const h = fmt(boxes[o + 3]!)
    nodeParts[i] = `<rect class="n" x="${x}" y="${y}" width="${w}" height="${h}"${radiusAttr}/>`
  }

  const labelParts: string[] = []
  for (let i = 0; i < n; i++) {
    const label = labels[i]
    if (label === undefined || label === '') continue
    const o = i * 4
    const x = fmt(boxes[o]! + offsetX + theme.labelPadding)
    const y = fmt(boxes[o + 1]! + offsetY + boxes[o + 3]! / 2)
    labelParts.push(`<text class="l" x="${x}" y="${y}">${escapeXml(label)}</text>`)
  }

  // Theme strings land inside a <style> element, where XML escaping does not
  // apply — a value containing `</style>` would close the element and escape into
  // markup. Treating the theme as trusted developer config is tempting, but a
  // theme is exactly the kind of thing that gets built from a colour picker or a
  // per-tenant row in a database. No valid colour or font shorthand contains an
  // angle bracket, so dropping them costs nothing and removes the hole.
  const css = (value: string | number): string => String(value).replace(/[<>]/g, '')

  const style =
    `.n{fill:${css(theme.nodeFill)};stroke:${css(theme.nodeStroke)};stroke-width:${css(theme.nodeStrokeWidth)}}` +
    `.e{fill:none;stroke:${css(theme.edgeStroke)};stroke-width:${css(theme.edgeWidth)}}` +
    `.l{fill:${css(theme.labelColour)};font:${css(theme.labelFont)};dominant-baseline:middle}`

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(width)} ${fmt(height)}"` +
    ` width="${fmt(width)}" height="${fmt(height)}">` +
    `<style>${style}</style>` +
    (edgePath.length > 0 ? `<path class="e" d="${edgePath}"/>` : '') +
    nodeParts.join('') +
    labelParts.join('') +
    `</svg>`
  )
}
