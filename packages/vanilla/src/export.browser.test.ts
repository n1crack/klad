import { describe, expect, it } from 'vitest'
import { createKlados } from './index.js'

/**
 * `toBlob` and `print` are hard to unit test meaningfully: `toBlob` produces
 * an opaque, browser-encoded image and `print` drives an actual OS print
 * dialog neither vitest nor Playwright can observe. What IS checkable, and
 * what these tests check:
 *  - `toSVG` returns a well-formed document containing the expected node count.
 *  - `toBlob` resolves to a `Blob` of the requested MIME type and a
 *    plausible (non-trivial, size-scaling) byte size — not that its pixels
 *    are correct, which nothing short of a human looking at it can confirm.
 *  - `print` runs without throwing and would print a valid document. Its full
 *    iframe lifecycle is not asserted: in real Chromium the iframe's load fires
 *    synchronously during append and calls the frame window's print() before any
 *    stub can intercept, so the runner cannot observe it safely.
 */

const DATA = [
  { id: 'a', name: 'Root' },
  { id: 'b', parentId: 'a', name: 'Left' },
  { id: 'c', parentId: 'a', name: 'Right' },
  { id: 'd', parentId: 'b', name: 'Leaf' },
  { id: 'e', parentId: 'b', name: 'Leaf 2' },
]

function host(): HTMLElement {
  const el = document.createElement('div')
  el.style.width = '800px'
  el.style.height = '600px'
  document.body.appendChild(el)
  return el
}

function make(overrides: Record<string, unknown> = {}) {
  return createKlados(host(), {
    data: DATA,
    nodeSize: { w: 120, h: 48 },
    label: (item) => String(item.name ?? ''),
    worker: false,
    ...overrides,
  })
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)))

describe('KladosApi.toSVG', () => {
  it('returns a well-formed SVG document with one <rect> per visible node', async () => {
    const chart = make()
    await nextFrame()
    const svg = chart.api.toSVG()
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
    expect((svg.match(/<rect/g) ?? []).length).toBe(DATA.length)
    // Labels round-trip as real text, not lost/placeholder content.
    expect(svg).toContain('>Root<')
    expect(svg).toContain('>Leaf 2<')
    chart.destroy()
  })

  it('excludes collapsed branches from the node count', async () => {
    const chart = make()
    await nextFrame()
    chart.api.collapse('b')
    await nextFrame()
    const svg = chart.api.toSVG()
    // 'b' itself stays visible (collapsed, not hidden); its children 'd'/'e' do not.
    expect((svg.match(/<rect/g) ?? []).length).toBe(3)
    chart.destroy()
  })

  it('is a fresh snapshot, not a retained buffer, immediately after update()', async () => {
    const chart = make()
    await nextFrame()
    chart.update([{ id: 'x', name: 'Only' }], {})
    const svg = chart.api.toSVG()
    expect((svg.match(/<rect/g) ?? []).length).toBe(1)
    expect(svg).toContain('>Only<')
    chart.destroy()
  })

  it('honours a caller-supplied padding option', async () => {
    const chart = make()
    await nextFrame()
    const wide = chart.api.toSVG({ padding: 200 })
    const narrow = chart.api.toSVG({ padding: 0 })
    const widthOf = (svg: string): number => Number(/width="([\d.]+)"/.exec(svg)![1])
    expect(widthOf(wide)).toBeGreaterThan(widthOf(narrow))
    chart.destroy()
  })
})

describe('KladosApi.toBlob', () => {
  it('resolves to a PNG Blob with a plausible, non-trivial size', async () => {
    const chart = make()
    await nextFrame()
    const blob = await chart.api.toBlob({ format: 'png' })
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('image/png')
    // A tiny 5-node chart still has to encode a real raster image — a few
    // hundred bytes at minimum rules out an empty/blank-canvas encode.
    expect(blob.size).toBeGreaterThan(200)
    chart.destroy()
  })

  it('resolves to a JPEG Blob when format is jpeg', async () => {
    const chart = make()
    await nextFrame()
    const blob = await chart.api.toBlob({ format: 'jpeg' })
    expect(blob.type).toBe('image/jpeg')
    chart.destroy()
  })

  it('a larger scale produces a larger encoded image', async () => {
    const chart = make()
    await nextFrame()
    const small = await chart.api.toBlob({ format: 'png', scale: 1 })
    const large = await chart.api.toBlob({ format: 'png', scale: 4 })
    expect(large.size).toBeGreaterThan(small.size)
    chart.destroy()
  })
})

describe('KladosApi.print', () => {
  // The full lifecycle — append iframe, load, call the frame window's print(),
  // remove on afterprint — cannot be driven here: in real Chromium the iframe's
  // load fires synchronously during appendChild and calls the frame's real
  // print(), which opens the OS dialog and blocks the runner before any stub can
  // intercept it. So this asserts the half that is observable and ours: print()
  // runs without throwing and builds a valid SVG document from the current tree.
  // The iframe plumbing is straight-line DOM with no branching worth a flaky
  // test to cover.
  it('runs without throwing and would print a valid document', async () => {
    const chart = make()
    await nextFrame()

    expect(() => chart.api.print()).not.toThrow()

    // The same serializer print() feeds the iframe is separately verified by
    // the toSVG tests above; here we confirm the document it would print has the
    // expected shape.
    const svg = chart.api.toSVG()
    expect(svg).toContain('<svg')
    expect((svg.match(/<text/g) ?? []).length).toBe(DATA.length)

    // Remove any iframe print() managed to append, so it does not leak into the
    // next test's document.
    for (const frame of Array.from(document.querySelectorAll('iframe'))) frame.remove()
    chart.destroy()
  })
})
