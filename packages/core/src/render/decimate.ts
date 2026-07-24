import type { Camera } from '../viewport.js'

export interface DecimationViewport {
  width: number
  height: number
  dpr: number
}

/**
 * Computes the grid dimensions (cols and rows) for a given viewport and cell
 * device-pixel size. This is the single source of truth for grid dimensions,
 * ensuring consistent calculations across gridSizeFor and decimateByCell.
 */
function gridDims(
  viewport: DecimationViewport,
  cellDevicePx: number,
): { cols: number; rows: number } {
  const cols = Math.max(1, Math.ceil((viewport.width * viewport.dpr) / cellDevicePx))
  const rows = Math.max(1, Math.ceil((viewport.height * viewport.dpr) / cellDevicePx))
  return { cols, rows }
}

/**
 * How many occupancy cells `decimateByCell` needs for this viewport and cell
 * size: `cols * rows`, one byte each. A caller grows a reusable `Uint8Array` to
 * at least this length. `cols`/`rows` are in DEVICE pixels — `cellDevicePx` is a
 * device-pixel size, so a higher-dpr viewport gets a finer grid, matching what
 * is actually painted.
 */
export function gridSizeFor(viewport: DecimationViewport, cellDevicePx: number): number {
  const dims = gridDims(viewport, cellDevicePx)
  return dims.cols * dims.rows
}

/**
 * Keeps at most one entry per screen cell, compacting the survivors into the
 * front of `buffer` and returning the new count. `buffer` holds indices into
 * `boxes` (4 float64s per index: x, y, w, h, world space); each entry's cell is
 * decided by its box CENTRE mapped to screen through `camera`. `grid` is a
 * caller-owned scratch of at least `gridSizeFor(viewport, cellDevicePx)` bytes;
 * its used region is zeroed here, so the same grid is safe to reuse across
 * calls and frames. Survivor order is preserved (first entry to claim a cell
 * wins it).
 */
export function decimateByCell(
  boxes: Float64Array,
  buffer: Uint32Array,
  count: number,
  camera: Camera,
  viewport: DecimationViewport,
  cellDevicePx: number,
  grid: Uint8Array,
): number {
  const dims = gridDims(viewport, cellDevicePx)
  const { cols, rows } = dims
  const cellCss = cellDevicePx / viewport.dpr
  grid.fill(0, 0, cols * rows)
  let kept = 0
  for (let i = 0; i < count; i++) {
    const idx = buffer[i]!
    const o = idx * 4
    const cx = boxes[o]! + boxes[o + 2]! / 2
    const cy = boxes[o + 1]! + boxes[o + 3]! / 2
    // Inline of `worldToScreen` (screen = world*k + offset) to avoid allocating
    // a result object per entry: this runs over the whole culled set every
    // frame on the weak mobile engines this decimation exists for.
    const sx = cx * camera.k + camera.x
    const sy = cy * camera.k + camera.y
    let col = Math.floor(sx / cellCss)
    let row = Math.floor(sy / cellCss)
    if (col < 0) col = 0
    else if (col >= cols) col = cols - 1
    if (row < 0) row = 0
    else if (row >= rows) row = rows - 1
    const cell = row * cols + col
    if (grid[cell] === 0) {
      grid[cell] = 1
      buffer[kept++] = idx
    }
  }
  return kept
}
