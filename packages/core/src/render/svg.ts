import type { Bounds } from '../types.js'
import type { EdgeStyle, RenderContext2D } from './renderer.js'
import type { Theme } from './theme.js'
import { resolveTheme } from './theme.js'
import { bezierControls, edgeAnchors, edgeStyleDrawsConnectors, hiddenStub } from './edge-geometry.js'
import { computeNodeFills, inkOn } from './palette.js'
import { HIDDEN_DOT_PX, HIDDEN_STUB_PX } from './canvas2d.js'
import {
  isSectorVisible,
  labelPlacement,
  lineHeightOf,
  normaliseUpright,
  SECTOR_LABEL_PAD,
  sectorPath,
} from './sector.js'

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
  /**
   * Mirrors `Frame.rtl`. Only the `folder` connector style reads it — see
   * `render/edge-geometry.ts`.
   */
  rtl: boolean
  /** Mirrors `Frame.edgeStyle`: which shape the connectors take. */
  edgeStyle: EdgeStyle
  /** Mirrors `Frame.sectors` — polar geometry for a sunburst, `null`
   * otherwise. When present, nodes are exported as arc segments rather than
   * rects, and `boxes` is used only for the bounds it already produced. */
  sectors: Float64Array | null
  /** Mirrors `Frame.angles` — per-node outward label angle for a radial
   * chart, `null` otherwise. */
  angles: Float64Array | null
  /** Mirrors `Frame.labelSpace` — the world-unit room the layout reserved
   * outside each node for its label. `0` for every layout but `radial`. */
  labelSpace: number
  /** Mirrors `Frame.hasHidden` — 1 per node whose children are all off screen.
   * Exported too: a picture that left the "there is more inside this" marks
   * off would be a picture of a chart nobody is looking at. */
  hasHidden: Uint8Array | null
  /** Mirrors `Frame.branchOf` / `Frame.branchDepth` — the branch structure the
   * palette colours nodes from, or `null` for a layout that doesn't. */
  branchOf: Int32Array | null
  branchDepth: Int32Array | null
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
 * An elbow is three axis-aligned segments meeting at two bends: `seg0`
 * (leaving the parent) and `seg2` (entering the child) each touch exactly
 * ONE bend, but `segMid` (the crossbar) touches BOTH — so a naive per-corner
 * clamp (`radius <= seg0`, `radius <= seg2`) is not enough on its own: if
 * both bends round INTO `segMid` from opposite ends, the two arcs overshoot
 * and cross exactly when `segMid < 2 * radius`. Halving the `segMid` budget
 * between the two corners (`segMid / 2`) is what prevents that — must match
 * canvas2d.ts's `clampEdgeCornerRadius` exactly, since the export's whole
 * promise is to look like the canvas.
 */
function clampEdgeCornerRadius(seg0: number, segMid: number, seg2: number, radius: number): number {
  if (radius <= 0) return 0
  const limit = Math.min(seg0, seg2, segMid / 2)
  return radius < limit ? radius : limit
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
 * this is the exact thing svg.test.ts's cross-check asserts stays true. That
 * now includes `edgeRadius`: when greater than 0 (and the clamp above hasn't
 * reduced it to 0 for a too-short segment), each bend becomes a quadratic
 * `Q` segment — the SVG equivalent of `quadraticCurveTo` — instead of a
 * hard `L` corner, using the corner point itself as the control point,
 * exactly like the canvas renderer. Iterates the flat index space directly
 * (no recursion), so a 50k-deep chain costs one pass, not one stack frame
 * per level.
 */
function buildEdgePath(
  boxes: Float64Array,
  parent: Int32Array,
  horizontal: boolean,
  rtl: boolean,
  style: EdgeStyle,
  offsetX: number,
  offsetY: number,
  edgeRadius: number,
): string {
  if (!edgeStyleDrawsConnectors(style)) return ''
  const n = parent.length
  const parts: string[] = []
  for (let i = 0; i < n; i++) {
    const p = parent[i]!
    if (p === -1) continue
    const io = i * 4
    const po = p * 4
    // Same shared anchors the canvas and the culler use — see
    // `render/edge-geometry.ts`. Only the `tiered` elbow's own bend maths is
    // restated below, and svg.test.ts cross-checks it against canvas2d.
    const anchors = edgeAnchors(
      style,
      horizontal,
      rtl,
      boxes[po]!,
      boxes[po + 1]!,
      boxes[po + 2]!,
      boxes[po + 3]!,
      boxes[io]!,
      boxes[io + 1]!,
      boxes[io + 2]!,
      boxes[io + 3]!,
    )
    const px = anchors.px + offsetX
    const py = anchors.py + offsetY
    const cx = anchors.cx + offsetX
    const cy = anchors.cy + offsetY
    if (style === 'spoke') {
      parts.push(`M${fmt(px)},${fmt(py)} L${fmt(cx)},${fmt(cy)}`)
      continue
    }
    if (style === 'bezier') {
      // The same control points canvas2d uses, from the same function — an
      // export whose curve bulged differently would be a different picture.
      const c = bezierControls(anchors, horizontal)
      parts.push(
        `M${fmt(px)},${fmt(py)}` +
          ` C${fmt(c.c1x + offsetX)},${fmt(c.c1y + offsetY)}` +
          ` ${fmt(c.c2x + offsetX)},${fmt(c.c2y + offsetY)}` +
          ` ${fmt(cx)},${fmt(cy)}`,
      )
      continue
    }
    if (style === 'folder') {
      // Mirrors canvas2d's `folder` branch exactly: down the gutter, one bend,
      // then a stub into the child's leading edge.
      const r = Math.min(edgeRadius, Math.abs(cy - py), Math.abs(cx - px))
      if (r <= 0) {
        parts.push(`M${fmt(px)},${fmt(py)} L${fmt(px)},${fmt(cy)} L${fmt(cx)},${fmt(cy)}`)
      } else {
        const dirDown = cy > py ? 1 : -1
        const dirOut = cx > px ? 1 : -1
        parts.push(
          `M${fmt(px)},${fmt(py)}` +
            ` L${fmt(px)},${fmt(cy - dirDown * r)}` +
            ` Q${fmt(px)},${fmt(cy)} ${fmt(px + dirOut * r)},${fmt(cy)}` +
            ` L${fmt(cx)},${fmt(cy)}`,
        )
      }
      continue
    }
    if (horizontal) {
      const midX = (px + cx) / 2
      const r =
        edgeRadius > 0
          ? clampEdgeCornerRadius(Math.abs(midX - px), Math.abs(cy - py), Math.abs(cx - midX), edgeRadius)
          : 0
      if (r <= 0) {
        parts.push(
          `M${fmt(px)},${fmt(py)} L${fmt(midX)},${fmt(py)} L${fmt(midX)},${fmt(cy)} L${fmt(cx)},${fmt(cy)}`,
        )
      } else {
        const dir0 = midX > px ? 1 : -1
        const dirMid = cy > py ? 1 : -1
        const dir2 = cx > midX ? 1 : -1
        parts.push(
          `M${fmt(px)},${fmt(py)}` +
            ` L${fmt(midX - dir0 * r)},${fmt(py)}` +
            ` Q${fmt(midX)},${fmt(py)} ${fmt(midX)},${fmt(py + dirMid * r)}` +
            ` L${fmt(midX)},${fmt(cy - dirMid * r)}` +
            ` Q${fmt(midX)},${fmt(cy)} ${fmt(midX + dir2 * r)},${fmt(cy)}` +
            ` L${fmt(cx)},${fmt(cy)}`,
        )
      }
    } else {
      const midY = (py + cy) / 2
      const r =
        edgeRadius > 0
          ? clampEdgeCornerRadius(Math.abs(midY - py), Math.abs(cx - px), Math.abs(cy - midY), edgeRadius)
          : 0
      if (r <= 0) {
        parts.push(
          `M${fmt(px)},${fmt(py)} L${fmt(px)},${fmt(midY)} L${fmt(cx)},${fmt(midY)} L${fmt(cx)},${fmt(cy)}`,
        )
      } else {
        const dir0 = midY > py ? 1 : -1
        const dirMid = cx > px ? 1 : -1
        const dir2 = cy > midY ? 1 : -1
        parts.push(
          `M${fmt(px)},${fmt(py)}` +
            ` L${fmt(px)},${fmt(midY - dir0 * r)}` +
            ` Q${fmt(px)},${fmt(midY)} ${fmt(px + dirMid * r)},${fmt(midY)}` +
            ` L${fmt(cx - dirMid * r)},${fmt(midY)}` +
            ` Q${fmt(cx)},${fmt(midY)} ${fmt(cx)},${fmt(midY + dir2 * r)}` +
            ` L${fmt(cx)},${fmt(cy)}`,
        )
      }
    }
  }
  return parts.join(' ')
}

/**
 * A `RenderContext2D` that records path commands as SVG path data instead of
 * painting them.
 *
 * This exists so the sunburst's sector outline has exactly ONE implementation.
 * The alternative — writing the arcs a second time in SVG syntax — is the
 * classic way an export drifts from what is on screen: the two are written to
 * match, then one gets a fix the other doesn't, and nobody notices until
 * someone prints a chart. `sectorPath` is handed this recorder and the result
 * is, by construction, the same shape the canvas draws.
 *
 * Only the four path methods are real. Everything else on the interface is a
 * no-op or a discarded property, and never called: `sectorPath` touches
 * nothing else, and this object never leaves this module.
 */
function createPathRecorder(): RenderContext2D & { data(): string } {
  const parts: string[] = []
  let cursorX = 0
  let cursorY = 0
  const noop = (): void => {}
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    globalAlpha: 1,
    textBaseline: '',
    textAlign: '',
    save: noop,
    restore: noop,
    scale: noop,
    translate: noop,
    rotate: noop,
    setTransform: noop,
    clearRect: noop,
    beginPath: () => {
      parts.length = 0
    },
    moveTo(x, y) {
      cursorX = x
      cursorY = y
      parts.push(`M${fmt(x)},${fmt(y)}`)
    },
    lineTo(x, y) {
      cursorX = x
      cursorY = y
      parts.push(`L${fmt(x)},${fmt(y)}`)
    },
    arc(x, y, radius, startAngle, endAngle, counterclockwise) {
      // SVG has no "sweep from angle to angle" — only "arc to this point" —
      // so the endpoints are resolved here and the two flags derived from the
      // sweep. A sweep of a full turn cannot be one `A` command (its start and
      // end points coincide, which SVG treats as a no-op), so it is emitted as
      // two half-turns.
      const ccw = counterclockwise === true
      let sweep = endAngle - startAngle
      if (ccw && sweep > 0) sweep -= Math.PI * 2
      if (!ccw && sweep < 0) sweep += Math.PI * 2
      const sweepFlag = sweep > 0 ? 1 : 0
      const at = (a: number): [number, number] => [x + radius * Math.cos(a), y + radius * Math.sin(a)]
      const [sx, sy] = at(startAngle)
      // `sectorPath` always moves or lines to the arc's start before calling
      // this, except on the full-circle path where it moves to (x + r, y) —
      // which is angle 0. Emit a line only when the recorder is genuinely
      // somewhere else, so no zero-length segment lands in the data.
      if (Math.abs(sx - cursorX) > 1e-9 || Math.abs(sy - cursorY) > 1e-9) {
        parts.push(`L${fmt(sx)},${fmt(sy)}`)
      }
      if (Math.abs(sweep) >= Math.PI * 2 - 1e-9) {
        const [mx, my] = at(startAngle + (sweep > 0 ? Math.PI : -Math.PI))
        parts.push(`A${fmt(radius)},${fmt(radius)} 0 0 ${sweepFlag} ${fmt(mx)},${fmt(my)}`)
        parts.push(`A${fmt(radius)},${fmt(radius)} 0 0 ${sweepFlag} ${fmt(sx)},${fmt(sy)}`)
        cursorX = sx
        cursorY = sy
        return
      }
      const [ex, ey] = at(endAngle)
      const largeArc = Math.abs(sweep) > Math.PI ? 1 : 0
      parts.push(`A${fmt(radius)},${fmt(radius)} 0 ${largeArc} ${sweepFlag} ${fmt(ex)},${fmt(ey)}`)
      cursorX = ex
      cursorY = ey
    },
    quadraticCurveTo: noop,
    bezierCurveTo: noop,
    setLineDash: noop,
    lineDashOffset: 0,
    roundRect: noop,
    rect: noop,
    closePath: () => {
      parts.push('Z')
    },
    fill: noop,
    stroke: noop,
    fillText: noop,
    measureText: () => ({ width: 0 }),
    data: () => parts.join(' '),
  }
}

/**
 * Rough text width, for the export's own "does this label fit its sector"
 * decision.
 *
 * The live renderer asks the canvas to measure; this module has no canvas and
 * deliberately takes no measurer (see `toSVG`'s docblock — it never truncates,
 * because a truncation baked into an export is permanent and the consumer may
 * be rendering at a size this code cannot know). But a sunburst NEEDS the
 * fit/skip decision, or the export gets labels sprawling across rings that the
 * canvas correctly left out.
 *
 * So the export skips on an estimate rather than truncating on a measurement:
 * 0.55em per character is a reasonable mean advance width for a UI sans at
 * text sizes. It errs toward dropping a borderline label rather than emitting
 * one that overflows, which is the right way for an estimate to be wrong here.
 */
function estimateWidth(text: string, font: string): number {
  const match = /(\d+(?:\.\d+)?)px/.exec(font)
  const size = match === null ? 14 : Number.parseFloat(match[1]!)
  return text.length * size * 0.55
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

  const edgePath = buildEdgePath(
    boxes,
    parent,
    horizontal,
    data.rtl,
    data.edgeStyle,
    offsetX,
    offsetY,
    theme.edgeCornerRadius,
  )

  const sectors = data.sectors
  const fills =
    data.branchOf !== null && data.branchDepth !== null
      ? computeNodeFills(n, data.branchOf, data.branchDepth, theme.palette, theme.paletteOther, theme.hubFill)
      : null

  const radiusAttr = theme.cornerRadius > 0 ? ` rx="${fmt(theme.cornerRadius)}"` : ''
  const nodeParts: string[] = []
  if (sectors !== null) {
    // Sectors carry their own fill (the branch palette), so each is its own
    // element rather than sharing the `.n` class's single colour. The stroke
    // is the surface-coloured gap, exactly as on the canvas.
    const recorder = createPathRecorder()
    for (let i = 0; i < n; i++) {
      const s = i * 6
      const r0 = sectors[s + 2]!
      const r1 = sectors[s + 3]!
      const a0 = sectors[s + 4]!
      const a1 = sectors[s + 5]!
      // Collapsed sectors — out of focus, or past the last ring — have no
      // extent. They exist in the layout so the live chart has something to
      // animate; an export is a still, and an empty path in it is just bytes.
      if (!isSectorVisible(r0, r1, a0, a1)) continue
      recorder.beginPath()
      sectorPath(recorder, sectors[s]! + offsetX, sectors[s + 1]! + offsetY, r0, r1, a0, a1)
      const fill = fills === null ? theme.nodeFill : (fills[i] ?? theme.nodeFill)
      nodeParts.push(`<path class="s" fill="${escapeXml(fill)}" d="${recorder.data()}"/>`)
    }
  } else {
    for (let i = 0; i < n; i++) {
      const o = i * 4
      const x = fmt(boxes[o]! + offsetX)
      const y = fmt(boxes[o + 1]! + offsetY)
      const w = fmt(boxes[o + 2]!)
      const h = fmt(boxes[o + 3]!)
      const fill = fills === null ? '' : ` fill="${escapeXml(fills[i] ?? theme.nodeFill)}"`
      nodeParts.push(`<rect class="n" x="${x}" y="${y}" width="${w}" height="${h}"${radiusAttr}${fill}/>`)
    }
  }

  // "There is more inside this" — see `Frame.hasHidden`. Emitted with the
  // nodes, before the labels, so it sits over its own segment and under the
  // text, exactly as on the canvas.
  const hidden = data.hasHidden
  if (hidden !== null && sectors !== null) {
    for (let i = 0; i < n; i++) {
      if (hidden[i] !== 1) continue
      const s = i * 6
      const r0 = sectors[s + 2]!
      const r1 = sectors[s + 3]!
      const a0 = sectors[s + 4]!
      const a1 = sectors[s + 5]!
      if (!isSectorVisible(r0, r1, a0, a1)) continue
      const inset = Math.min(4, (r1 - r0) * 0.28)
      if (inset < 1.5) continue
      const recorder = createPathRecorder()
      recorder.beginPath()
      const r = r1 - inset
      const cx = sectors[s]! + offsetX
      const cy = sectors[s + 1]! + offsetY
      recorder.moveTo(cx + r * Math.cos(a0), cy + r * Math.sin(a0))
      recorder.arc(cx, cy, r, a0, a1, false)
      const ink = fills === null ? theme.labelColour : inkOn(fills[i]!, theme.labelColour, theme.labelColourInverse)
      nodeParts.push(`<path class="h" stroke="${escapeXml(ink)}" d="${recorder.data()}"/>`)
    }
  } else if (hidden !== null && data.angles !== null) {
    for (let i = 0; i < n; i++) {
      if (hidden[i] !== 1) continue
      const o = i * 4
      const w = boxes[o + 2]!
      const h = boxes[o + 3]!
      const ink = fills === null ? theme.labelColour : (fills[i] ?? theme.labelColour)
      nodeParts.push(
        `<circle class="h" stroke="${escapeXml(ink)}"` +
          ` cx="${fmt(boxes[o]! + offsetX + w / 2)}" cy="${fmt(boxes[o + 1]! + offsetY + h / 2)}"` +
          ` r="${fmt(Math.max(w, h) / 2 + 3)}"/>`,
      )
    }
  } else if (hidden !== null) {
    // Rectangular: the same stub-and-dot the canvas draws. An export is at
    // 1:1, so the canvas's SCREEN-pixel lengths are world units here — which
    // is exactly the size the canvas draws them at a zoom of 1.
    for (let i = 0; i < n; i++) {
      if (hidden[i] !== 1) continue
      const o = i * 4
      const stub = hiddenStub(
        data.edgeStyle,
        data.horizontal,
        data.rtl,
        boxes[o]!,
        boxes[o + 1]!,
        boxes[o + 2]!,
        boxes[o + 3]!,
      )
      if (stub === null) continue
      const sx = stub.x + offsetX
      const sy = stub.y + offsetY
      const ex = sx + stub.dx * HIDDEN_STUB_PX
      const ey = sy + stub.dy * HIDDEN_STUB_PX
      const ink = escapeXml(theme.edgeStroke)
      nodeParts.push(
        `<path class="hs" stroke="${ink}" d="M${fmt(sx)} ${fmt(sy)}L${fmt(ex)} ${fmt(ey)}"/>` +
          `<circle class="hd" fill="${ink}"` +
          ` cx="${fmt(ex)}" cy="${fmt(ey)}" r="${fmt(HIDDEN_DOT_PX)}"/>`,
      )
    }
  }

  const labelParts: string[] = []
  if (sectors !== null) {
    // Same placement function the canvas uses, so a label that is drawn on
    // screen is drawn here and one that is skipped is skipped here — see
    // `labelPlacement`, and `estimateWidth` for the one thing this path has to
    // decide without a text measurer.
    const lineHeight = lineHeightOf(theme.labelFont)
    for (let i = 0; i < n; i++) {
      const label = labels[i]
      if (label === undefined || label === '') continue
      const s = i * 6
      const place = labelPlacement(sectors[s + 2]!, sectors[s + 3]!, sectors[s + 4]!, sectors[s + 5]!, lineHeight)
      if (place === null) continue
      if (estimateWidth(label, theme.labelFont) > place.maxWidth) continue
      const cx = sectors[s]! + offsetX + place.x
      const cy = sectors[s + 1]! + offsetY + place.y
      const ink = fills === null ? theme.labelColour : inkOn(fills[i]!, theme.labelColour, theme.labelColourInverse)
      const rot = place.angle === 0 ? '' : ` rotate(${fmt((place.angle * 180) / Math.PI)})`
      labelParts.push(
        `<text class="l" text-anchor="middle" fill="${escapeXml(ink)}"` +
          ` transform="translate(${fmt(cx)},${fmt(cy)})${rot}">${escapeXml(label)}</text>`,
      )
    }
  } else if (data.angles !== null) {
    const angles = data.angles
    for (let i = 0; i < n; i++) {
      const label = labels[i]
      if (label === undefined || label === '') continue
      const o = i * 4
      const w = boxes[o + 2]!
      const h = boxes[o + 3]!
      const cx = boxes[o]! + offsetX + w / 2
      const cy = boxes[o + 1]! + offsetY + h / 2
      const angle = angles[i]!
      if (Number.isNaN(angle)) {
        // The centre node: horizontal, through the middle. Mirrors canvas2d.
        labelParts.push(
          `<text class="l" text-anchor="middle" x="${fmt(cx)}" y="${fmt(cy)}">${escapeXml(label)}</text>`,
        )
        continue
      }
      const upright = normaliseUpright(angle)
      const flipped = upright !== angle
      const offset = Math.max(w, h) / 2 + SECTOR_LABEL_PAD
      labelParts.push(
        `<text class="l" text-anchor="${flipped ? 'end' : 'start'}"` +
          ` transform="translate(${fmt(cx)},${fmt(cy)}) rotate(${fmt((upright * 180) / Math.PI)})"` +
          ` x="${fmt(flipped ? -offset : offset)}">${escapeXml(label)}</text>`,
      )
    }
  } else {
    for (let i = 0; i < n; i++) {
      const label = labels[i]
      if (label === undefined || label === '') continue
      const o = i * 4
      const x = fmt(boxes[o]! + offsetX + theme.labelPadding)
      const y = fmt(boxes[o + 1]! + offsetY + boxes[o + 3]! / 2)
      labelParts.push(`<text class="l" x="${x}" y="${y}">${escapeXml(label)}</text>`)
    }
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
    // Sectors carry their own `fill` attribute (per-branch), so the class only
    // supplies the gap between them — the surface showing through, matching
    // the canvas. `stroke-linejoin: round` keeps the corners where a wedge's
    // two straight sides meet its arcs from spiking outward at narrow angles.
    `.s{stroke:${css(theme.surface)};stroke-width:${css(theme.sectorGap)};stroke-linejoin:round}` +
    `.h{fill:none;stroke-width:1.5;opacity:0.55}` +
    // The rectangular mark, at the canvas's own alpha for it. Its own classes
    // rather than `.h`: that rule's `fill:none` would beat the dot's own
    // `fill` attribute (a stylesheet always does), leaving a hollow ring where
    // the canvas draws a solid dot.
    `.hs{fill:none;stroke-width:1.5;opacity:0.75}` +
    `.hd{stroke:none;opacity:0.75}` +
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
