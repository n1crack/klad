/**
 * Colour for the layouts that fill their nodes — the sunburst's sectors, and a
 * radial chart's cards when a host asks for it. Everything here is pure maths
 * over hex strings: no DOM, no `getComputedStyle`, nothing that would stop this
 * module running inside a Web Worker alongside the engine that calls it.
 *
 * ## Why there is a palette at all
 *
 * A tiered org chart can be one colour, because its structure is carried
 * entirely by position and connectors. A sunburst has neither: it is a solid
 * disc of adjacent sectors, and if they are all the same colour it reads as a
 * pie chart of one slice. Colour is doing structural work there, which means it
 * has to be chosen the way a chart's colours are chosen, not picked by eye.
 *
 * ## The rules this follows
 *
 * - **Categorical hues in a fixed order, never cycled.** A branch's colour is
 *   its slot in `palette`, and a tree with more top-level branches than the
 *   palette has slots does NOT wrap around to slot 1 — the extra branches fold
 *   into one neutral "other" colour (`paletteOther`). Two branches sharing a
 *   hue is a lie about the data; a branch that is visibly "not one of the
 *   named ones" is not.
 * - **Colour follows the entity, not its rank.** A node's hue comes from its
 *   TOP-LEVEL ancestor and nothing else, so it does not change when a branch is
 *   collapsed, when the wheel is drilled into, or when siblings come and go.
 *   You can track a branch through a whole drill-down by its colour, which is
 *   the entire reason the drill-down animation is legible.
 * - **Depth is a sequential ramp within one hue.** Going a level deeper steps
 *   the branch's own colour lighter in OKLab — perceptually even steps, unlike
 *   the sRGB mixing that makes mid-ramp colours go muddy — and slightly less
 *   chromatic. One hue, light to dark, is what a magnitude/rank ramp is
 *   supposed to look like.
 *
 * The default palette is a validated eight-hue categorical set (worst adjacent
 * CVD ΔE 9.1 light / 8.4 dark, OKLab ×100). Three of the light hues sit below
 * 3:1 against a white surface; the relief for that is visible labels, which
 * these layouts draw on every sector wide enough to hold one — see
 * `sectorLabelFits` in canvas2d.ts. Swap `Theme.palette` for a brand's own set
 * and the same rules apply to it.
 */

/**
 * Categorical hues for a light surface, in slot order. The ORDER is the
 * colour-blind-safety mechanism, not decoration: neighbouring slots land beside
 * each other constantly (a sunburst puts branch 1 next to branch 2 around the
 * circle), so the sequence was chosen for the separation of its adjacent pairs.
 * Re-order it and that property is gone.
 */
export const DEFAULT_PALETTE: readonly string[] = Object.freeze([
  '#2a78d6', // blue
  '#eb6834', // orange
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#e87ba4', // magenta
  '#008300', // green
  '#4a3aa7', // violet
  '#e34948', // red
])

/**
 * The same eight hues stepped for a dark surface — not a different palette.
 * Each step was chosen to sit in the dark lightness band and clear 3:1 against
 * a dark chart surface, which the light steps do not.
 */
export const DARK_PALETTE: readonly string[] = Object.freeze([
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
])

/**
 * How much lighter one extra level of depth is, in OKLab L. Small on purpose:
 * the ramp has to stay inside one recognisable hue for four or five levels, and
 * a step big enough to be obvious at level 1 has run out of headroom by level
 * 3, where it clips against the sRGB gamut and the ramp visibly stops moving.
 */
const DEPTH_LIGHTEN = 0.055

/** How much less chromatic one extra level is, as a fraction. Keeps the ramp
 * from turning fluorescent as it lightens. */
const DEPTH_DESATURATE = 0.07

/**
 * Depth levels beyond which the ramp holds still. Past this the steps would be
 * too pale to carry a label and too close together to read as separate rings —
 * and a sunburst only ever shows a few rings at once anyway (`maxRings`), so
 * the levels past the cap are almost never on screen together with level 0.
 */
const DEPTH_CAP = 4

// --- sRGB <-> OKLab -------------------------------------------------------
// The standard transform (Björn Ottosson). Kept inline rather than pulled from
// a package because this file must stay dependency-free to run in a worker
// bundle, and it is forty lines of arithmetic.

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055
}

/** Parses `#rgb` or `#rrggbb` into 0..1 channels. Returns null for anything
 * else — a named colour, a `rgb()` string, a custom property — so a caller can
 * pass the value straight through untouched rather than mangling it. */
function parseHex(hex: string): [number, number, number] | null {
  const h = hex.trim()
  if (h.charCodeAt(0) !== 35 /* # */) return null
  const body = h.slice(1)
  if (body.length === 3) {
    const r = Number.parseInt(body[0]! + body[0]!, 16)
    const g = Number.parseInt(body[1]! + body[1]!, 16)
    const b = Number.parseInt(body[2]! + body[2]!, 16)
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null
    return [r / 255, g / 255, b / 255]
  }
  if (body.length !== 6) return null
  const n = Number.parseInt(body, 16)
  if (Number.isNaN(n)) return null
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function toHex(r: number, g: number, b: number): string {
  const ch = (v: number): string => {
    const n = Math.round(Math.min(1, Math.max(0, v)) * 255)
    return n < 16 ? `0${n.toString(16)}` : n.toString(16)
  }
  return `#${ch(r)}${ch(g)}${ch(b)}`
}

function rgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const R = srgbToLinear(r)
  const G = srgbToLinear(g)
  const B = srgbToLinear(b)
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function oklabToRgb(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

// --- public helpers -------------------------------------------------------

/**
 * `base` stepped `depth` levels lighter — the sequential ramp within one
 * branch's hue. `depth` 0 returns `base` untouched (string-identical, so a
 * caller can compare against the palette entry). Anything the parser doesn't
 * understand is returned unchanged, so a host is free to put `currentColor` or
 * a CSS variable in `Theme.palette` and take responsibility for depth itself.
 */
export function depthStep(base: string, depth: number): string {
  if (depth <= 0) return base
  const rgb = parseHex(base)
  if (rgb === null) return base
  const level = depth > DEPTH_CAP ? DEPTH_CAP : depth
  const [L, a, b] = rgbToOklab(rgb[0], rgb[1], rgb[2])
  const nL = Math.min(0.97, L + DEPTH_LIGHTEN * level)
  const f = Math.max(0, 1 - DEPTH_DESATURATE * level)
  const [r, g, bl] = oklabToRgb(nL, a * f, b * f)
  return toHex(r, g, bl)
}

/** WCAG relative luminance of a hex colour, or `null` if it isn't one. */
function luminance(hex: string): number | null {
  const rgb = parseHex(hex)
  if (rgb === null) return null
  return 0.2126 * srgbToLinear(rgb[0]) + 0.7152 * srgbToLinear(rgb[1]) + 0.0722 * srgbToLinear(rgb[2])
}

/**
 * Which of `dark`/`light` to write text in so it stays readable ON `fill`.
 *
 * This is what discharges the palette's contrast obligation. Several of the
 * categorical hues are mid-lightness, and a fixed label colour is unreadable on
 * roughly half of them whichever one you pick — so the label colour is chosen
 * per sector instead, by whichever candidate has more contrast against the
 * colour actually behind it. Falls back to `dark` for a fill this module can't
 * parse, which is the safer guess on the light surfaces charts default to.
 */
export function inkOn(fill: string, dark: string, light: string): string {
  const bg = luminance(fill)
  if (bg === null) return dark
  const contrastWith = (ink: string): number => {
    const fg = luminance(ink)
    if (fg === null) return 0
    const hi = fg > bg ? fg : bg
    const lo = fg > bg ? bg : fg
    return (hi + 0.05) / (lo + 0.05)
  }
  return contrastWith(light) > contrastWith(dark) ? light : dark
}

/**
 * Per-node fill for a whole pruned tree: the branch's palette slot, stepped by
 * how deep the node sits inside that branch.
 *
 * `branchOf` maps a pruned index to the index of its own TOP-LEVEL ancestor,
 * and `branchDepth` to its depth below that ancestor — both computed by the
 * caller in one preorder pass, since the caller already has the tree and this
 * module deliberately knows nothing about tree shape.
 *
 * Slots are handed out in the order branches are first seen, so the leftmost
 * branch is always slot 1 and the palette's opening colours land on the
 * branches a viewer reads first. Past the last slot, branches share
 * `otherColour` rather than wrapping — see this module's docblock.
 */
export function computeNodeFills(
  count: number,
  branchOf: Int32Array,
  branchDepth: Int32Array,
  palette: readonly string[],
  otherColour: string,
  hubColour: string,
): string[] {
  const fills: string[] = Array.from({ length: count })
  const slotOfBranch = new Map<number, number>()
  // Memoised per (slot, depth) — a tree of any size only ever produces
  // `palette.length * (DEPTH_CAP + 1)` distinct colours, so the OKLab round
  // trip runs a few dozen times rather than once per node.
  const cache = new Map<number, string>()

  for (let i = 0; i < count; i++) {
    const branch = branchOf[i]!
    if (branch === -1) {
      // A root: the hub of a wheel, or the top of a file list. Neutral, not a
      // series colour — it is the thing the branches hang off, not one of them.
      fills[i] = hubColour
      continue
    }
    let slot = slotOfBranch.get(branch)
    if (slot === undefined) {
      slot = slotOfBranch.size
      slotOfBranch.set(branch, slot)
    }
    if (slot >= palette.length) {
      fills[i] = otherColour
      continue
    }
    const d = branchDepth[i]!
    const key = slot * (DEPTH_CAP + 1) + (d > DEPTH_CAP ? DEPTH_CAP : d)
    let colour = cache.get(key)
    if (colour === undefined) {
      colour = depthStep(palette[slot]!, d)
      cache.set(key, colour)
    }
    fills[i] = colour
  }
  return fills
}
