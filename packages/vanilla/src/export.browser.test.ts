import { describe, expect, it } from 'vitest'
import { createOrgChart } from './index.js'

/**
 * `toBlob` and `print` are hard to unit test meaningfully: `toBlob` produces
 * an opaque, browser-encoded image and `print` drives an actual OS print
 * dialog neither vitest nor Playwright can observe. What IS checkable, and
 * what these tests check:
 *  - `toSVG` returns a well-formed document containing the expected node count.
 *  - `toBlob` resolves to a `Blob` of the requested MIME type and a
 *    plausible (non-trivial, size-scaling) byte size — not that its pixels
 *    are correct, which nothing short of a human looking at it can confirm.
 *  - `print` creates a hidden iframe and removes it again once printing
 *    finishes (simulated here via a synthetic `afterprint` dispatch, since
 *    nothing in a headless run ever fires that event for real).
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
  return createOrgChart(host(), {
    data: DATA,
    nodeSize: { w: 120, h: 48 },
    label: (item) => String(item.name ?? ''),
    worker: false,
    ...overrides,
  })
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)))

describe('OrgChartApi.toSVG', () => {
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

describe('OrgChartApi.toBlob', () => {
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

describe('OrgChartApi.print', () => {
  it('DEBUG: plain iframe append works in this environment', () => {
    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    console.error('DEBUG plain iframe isConnected=', iframe.isConnected, document.body.contains(iframe))
    expect(iframe.isConnected).toBe(true)
    iframe.remove()
  })

  it('DEBUG: styled iframe with load listener, no srcdoc', () => {
    const iframe = document.createElement('iframe')
    iframe.setAttribute('aria-hidden', 'true')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    iframe.addEventListener('load', () => console.error('DEBUG load fired'), { once: true })
    document.body.appendChild(iframe)
    console.error('DEBUG styled iframe isConnected=', iframe.isConnected)
    iframe.remove()
  })

  it('DEBUG: with load handler calling win.focus()/win.print()', () => {
    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.width = '0'
    iframe.style.height = '0'
    const cleanup = (): void => {
      console.error('DEBUG cleanup called, removing iframe')
      iframe.remove()
    }
    iframe.addEventListener(
      'load',
      () => {
        console.error('DEBUG load handler start, isConnected=', iframe.isConnected)
        const win = iframe.contentWindow
        console.error('DEBUG win=', win)
        if (win === null) {
          cleanup()
          return
        }
        win.addEventListener('afterprint', cleanup, { once: true })
        win.focus()
        console.error('DEBUG after focus, isConnected=', iframe.isConnected)
        win.print()
        console.error('DEBUG after print, isConnected=', iframe.isConnected)
      },
      { once: true },
    )
    document.body.appendChild(iframe)
    console.error('DEBUG after appendChild, isConnected=', iframe.isConnected)
    iframe.srcdoc = '<html><body>hi</body></html>'
    console.error('DEBUG after srcdoc, isConnected=', iframe.isConnected)
  })

  it('DEBUG: with srcdoc assignment', () => {
    const iframe = document.createElement('iframe')
    iframe.setAttribute('aria-hidden', 'true')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    document.body.appendChild(iframe)
    console.error('DEBUG before srcdoc isConnected=', iframe.isConnected)
    iframe.srcdoc = '<html><body>hi</body></html>'
    console.error('DEBUG after srcdoc isConnected=', iframe.isConnected)
    iframe.remove()
  })

  it('creates a hidden iframe and removes it once printing is done', async () => {
    const chart = make()
    await nextFrame()

    expect(document.querySelectorAll('iframe').length).toBe(0)
    try {
      chart.api.print()
    } catch (err) {
      console.error('DEBUG print() threw', err)
      throw err
    }
    console.error('DEBUG body after print()', document.body.innerHTML)

    // `print()` appends the iframe synchronously, so it's already in the DOM
    // the instant this call returns — no need to poll for its appearance.
    const iframe = document.querySelector('iframe')
    expect(iframe).not.toBeNull()

    // Wait for the SAME 'load' event the implementation itself waits for.
    // Attached synchronously, right here, so there is no window in which the
    // real 'load' (queued as a task when `srcdoc` was assigned above, never
    // synchronous with it) could fire before this listener is registered —
    // by the time it does fire, the implementation's own handler (registered
    // first inside `print()`, so it runs first for the same event) has
    // already attached its 'afterprint' listener on `contentWindow`, below.
    await new Promise<void>((resolve) => {
      iframe!.addEventListener('load', () => resolve(), { once: true })
    })

    // Confirmed empirically (see this task's verification notes): headless
    // Chromium's `window.print()` returns immediately and fires neither
    // 'beforeprint' nor 'afterprint' — there is no dialog to drive to
    // completion. The completion signal is dispatched directly here instead;
    // this is exactly the event the implementation listens for to clean up.
    iframe!.contentWindow!.dispatchEvent(new Event('afterprint'))

    await new Promise<void>((resolve) => {
      const check = (): void => {
        if (document.querySelectorAll('iframe').length === 0) resolve()
        else requestAnimationFrame(check)
      }
      check()
    })
    expect(document.querySelectorAll('iframe').length).toBe(0)
    chart.destroy()
  })
})
