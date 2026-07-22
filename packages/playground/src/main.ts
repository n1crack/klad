import { createApp } from 'vue'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { OrgChartApi } from '@n1crack/orgchart'
import {
  EDGE_RADIUS_DEFAULT,
  EDGE_RADIUS_MAX,
  EDGE_RADIUS_MIN,
  EXAMPLES,
  MINIMAP_POSITIONS,
  minimapDefaultOn,
  minimapDefaultPosition,
  type Example,
  type MinimapPosition,
} from './data.js'
import { mountVanilla, type VanillaDemoHandle } from './vanilla-demo.js'
import VueDemo from './VueDemo.vue'
import { ReactDemo, type ReactDemoHandle } from './ReactDemo.js'
import './style.css'

type Stack = 'vanilla' | 'vue' | 'react'

const root = document.querySelector<HTMLDivElement>('#app')
if (root === null) throw new Error('#app element not found')
root.innerHTML = ''

// --- shell: a slim header bar above everything, then a sidebar + chart-area layout ---

const header = document.createElement('header')
header.className = 'app-header'
const appTitle = document.createElement('div')
appTitle.className = 'app-title'
const appName = document.createElement('span')
appName.className = 'app-name'
appName.textContent = 'OrgChart Playground'
const appTagline = document.createElement('span')
appTagline.className = 'app-tagline'
appTagline.textContent = 'One dataset, three framework adapters, one canvas underneath'
appTitle.append(appName, appTagline)
header.append(appTitle)

/** A labelled group of related controls — the sidebar's unit of visual hierarchy. */
function sidebarGroup(caption: string, ...children: HTMLElement[]): HTMLDivElement {
  const group = document.createElement('div')
  group.className = 'sidebar-group'
  const label = document.createElement('span')
  label.className = 'sidebar-group-caption'
  label.textContent = caption
  const body = document.createElement('div')
  body.className = 'sidebar-group-body'
  body.append(...children)
  group.append(label, body)
  return group
}

/** A `<label>` + `<select>` pair, e.g. for the stack/example choosers. */
function labeledSelect(
  labelText: string,
  id: string,
  options: { value: string; label: string }[],
): { field: HTMLDivElement; select: HTMLSelectElement } {
  const field = document.createElement('div')
  field.className = 'field'
  const label = document.createElement('label')
  label.textContent = labelText
  label.htmlFor = id
  const select = document.createElement('select')
  select.className = 'select'
  select.id = id
  for (const opt of options) {
    const optionEl = document.createElement('option')
    optionEl.value = opt.value
    optionEl.textContent = opt.label
    select.append(optionEl)
  }
  field.append(label, select)
  return { field, select }
}

/** A plain sidebar button. */
function sidebarButton(label: string, onClick: () => void, extraClass?: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = extraClass === undefined ? 'btn' : `btn ${extraClass}`
  button.textContent = label
  button.onclick = onClick
  return button
}

// --- "Demo" group: which stack, which example ---

const { field: stackField, select: stackSelect } = labeledSelect('Stack', 'stack-select', [
  { value: 'vanilla', label: 'Vanilla' },
  { value: 'vue', label: 'Vue' },
  { value: 'react', label: 'React' },
])

// Driven from the same registry every stack renders, so a new example is a
// one-line addition to data.ts rather than a page change.
const { field: exampleField, select: exampleSelect } = labeledSelect(
  'Example',
  'example-select',
  EXAMPLES.map((example) => ({ value: example.id, label: example.name })),
)

const demoGroup = sidebarGroup('Demo', stackField, exampleField)

// --- "View" group: camera + tree-shape controls, shared by every mounted chart ---

let currentApi: OrgChartApi | null = null

const viewGroup = sidebarGroup(
  'View',
  sidebarButton('Zoom In', () => currentApi?.zoomIn()),
  sidebarButton('Zoom Out', () => currentApi?.zoomOut()),
  sidebarButton('Fit', () => currentApi?.fit()),
  sidebarButton('Expand All', () => currentApi?.expandAll()),
  sidebarButton('Collapse All', () => currentApi?.collapseAll()),
)

// --- "Minimap" group: on/off toggle plus a corner picker ---
// Both are driven by `api.setMinimap(...)`, which flips/repositions the widget
// without the tree-state reset that routing it through `update()` would cause
// (`update()` calls `initOpen()` and would collapse everything back to the
// default). All three stacks call the same API underneath — see
// vanilla-demo.ts/VueDemo.vue/ReactDemo.tsx's own `setMinimap`/`setMinimapPosition`.
let currentSetMinimap: ((on: boolean) => void) | null = null
let currentSetMinimapPosition: ((position: MinimapPosition) => void) | null = null
let minimapOn = false

const minimapButton = document.createElement('button')
minimapButton.type = 'button'
minimapButton.className = 'btn btn-toggle'

function updateMinimapButton(): void {
  minimapButton.textContent = `Minimap: ${minimapOn ? 'On' : 'Off'}`
  minimapButton.setAttribute('aria-pressed', String(minimapOn))
}

minimapButton.onclick = () => {
  minimapOn = !minimapOn
  currentSetMinimap?.(minimapOn)
  updateMinimapButton()
}

const { field: minimapPositionField, select: minimapPositionSelect } = labeledSelect(
  'Corner',
  'minimap-position-select',
  MINIMAP_POSITIONS.map((position) => ({ value: position.value, label: position.label })),
)
minimapPositionSelect.onchange = () => {
  currentSetMinimapPosition?.(minimapPositionSelect.value as MinimapPosition)
}

const minimapGroup = sidebarGroup('Minimap', minimapButton, minimapPositionField)

// --- "Edge radius" group: rounds the connector elbows live via the chart's theme ---
// theme.edgeCornerRadius has no dedicated runtime setter on OrgChartApi (unlike
// setMinimap) — see the setEdgeRadius implementations in vanilla-demo.ts,
// VueDemo.vue and ReactDemo.tsx, and the playground polish report, for why
// this one goes through `update()`/a reactive options change instead, and
// what a `setTheme`-style method would save.
let currentSetEdgeRadius: ((radius: number) => void) | null = null

const edgeRadiusField = document.createElement('div')
edgeRadiusField.className = 'field field-range'
const edgeRadiusLabel = document.createElement('label')
edgeRadiusLabel.textContent = 'Edge radius'
edgeRadiusLabel.htmlFor = 'edge-radius-range'
const edgeRadiusRow = document.createElement('div')
edgeRadiusRow.className = 'field-range-row'
const edgeRadiusRange = document.createElement('input')
edgeRadiusRange.type = 'range'
edgeRadiusRange.id = 'edge-radius-range'
edgeRadiusRange.min = String(EDGE_RADIUS_MIN)
edgeRadiusRange.max = String(EDGE_RADIUS_MAX)
edgeRadiusRange.value = String(EDGE_RADIUS_DEFAULT)
const edgeRadiusValue = document.createElement('output')
edgeRadiusValue.className = 'field-range-value'
edgeRadiusValue.setAttribute('for', 'edge-radius-range')
edgeRadiusValue.textContent = String(EDGE_RADIUS_DEFAULT)
edgeRadiusRow.append(edgeRadiusRange, edgeRadiusValue)
edgeRadiusField.append(edgeRadiusLabel, edgeRadiusRow)

edgeRadiusRange.oninput = () => {
  const radius = Number(edgeRadiusRange.value)
  edgeRadiusValue.textContent = String(radius)
  currentSetEdgeRadius?.(radius)
}

const edgeRadiusGroup = sidebarGroup('Edge radius', edgeRadiusField)

// --- "Canvas" group: the colour behind the chart ---
// The canvas itself only ever `clearRect`s (see packages/core/src/render/canvas2d.ts)
// — it never paints a background of its own, so whatever colour shows behind the
// nodes and connectors is just the host element's CSS background showing through
// a transparent canvas. `surface` (below) is that host for the vanilla stack
// directly, and the common ancestor of the "chart-host" div OrgChart.vue/OrgChart.tsx
// create for Vue/React (neither of which sets an opaque background of its own) — so
// setting `surface.style.backgroundColor` recolours the area behind the nodes for
// all three stacks with no core/adapter change at all. There is no `theme.background`
// token today; if one is ever added, this control should switch to `setTheme`-style
// live updates instead of a host CSS override.
const canvasBgInput = document.createElement('input')
canvasBgInput.type = 'color'
canvasBgInput.id = 'canvas-bg-input'
canvasBgInput.className = 'color-input'
const canvasBgLabel = document.createElement('label')
canvasBgLabel.textContent = 'Background'
canvasBgLabel.htmlFor = 'canvas-bg-input'
const canvasBgValue = document.createElement('output')
canvasBgValue.className = 'field-range-value'
canvasBgValue.setAttribute('for', 'canvas-bg-input')
const canvasBgRow = document.createElement('div')
canvasBgRow.className = 'field-range-row'
canvasBgRow.append(canvasBgInput, canvasBgValue)
const canvasBgField = document.createElement('div')
canvasBgField.className = 'field'
canvasBgField.append(canvasBgLabel, canvasBgRow)

const canvasGroup = sidebarGroup('Canvas', canvasBgField)

function applyCanvasBg(hex: string): void {
  surface.style.backgroundColor = hex
  canvasBgValue.textContent = hex.toUpperCase()
}

canvasBgInput.oninput = () => applyCanvasBg(canvasBgInput.value)

/**
 * Approximates a computed colour string as a `#rrggbb` hex string —
 * `<input type="color">` only accepts that format, but `getComputedStyle`
 * resolves `.surface`'s `color-mix()` background down to whatever the
 * browser actually computed, which is what lets the picker default to
 * "whatever the chart already shows" (light or dark) instead of a hardcoded
 * guess.
 *
 * That computed value can come back in either of two shapes depending on the
 * browser: the legacy `rgb(r, g, b)` with 0-255 integer channels, or the
 * newer CSS Color 4 `color(srgb r g b)` function with 0-1 float channels —
 * Chromium resolves a `color-mix(in srgb, ...)` background to the latter.
 * Treating both the same (assuming 0-255) turns e.g. `0.94` into `1` instead
 * of `240`, producing a near-black hex (`#010101`) from what is actually a
 * light grey — that exact bug shipped briefly and was caught by hand: the
 * swatch showed near-black while the chart area was visibly light.
 */
function rgbToHex(colour: string): string {
  const channels = colour.match(/-?\d*\.?\d+/g)
  if (channels === null || channels.length < 3) return '#ffffff'
  const scale = colour.trim().startsWith('color(') ? 255 : 1
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n * scale))).toString(16).padStart(2, '0')
  return `#${toHex(Number(channels[0]))}${toHex(Number(channels[1]))}${toHex(Number(channels[2]))}`
}

// --- "Export" group ---

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

const exportGroup = sidebarGroup(
  'Export',
  sidebarButton(
    'SVG',
    () => {
      const svg = currentApi?.toSVG()
      if (svg !== undefined) download(new Blob([svg], { type: 'image/svg+xml' }), 'org-chart.svg')
    },
    'btn-export',
  ),
  sidebarButton(
    'PNG',
    () => {
      void currentApi?.toBlob({ format: 'png', scale: 2 }).then((blob) => download(blob, 'org-chart.png'))
    },
    'btn-export',
  ),
)

const sidebar = document.createElement('aside')
sidebar.className = 'sidebar'
const sidebarBody = document.createElement('div')
sidebarBody.className = 'sidebar-body'
sidebarBody.append(demoGroup, viewGroup, minimapGroup, edgeRadiusGroup, canvasGroup, exportGroup)
sidebar.append(sidebarBody)

const description = document.createElement('div')
description.className = 'example-description'
const descriptionEyebrow = document.createElement('span')
descriptionEyebrow.className = 'example-description-eyebrow'
descriptionEyebrow.textContent = 'Example'
const descriptionText = document.createElement('p')
description.append(descriptionEyebrow, descriptionText)

const surface = document.createElement('div')
surface.className = 'surface'

const content = document.createElement('main')
content.className = 'content'
content.append(description, surface)

const layout = document.createElement('div')
layout.className = 'layout'
layout.append(sidebar, content)

root.append(header, layout)

// Seed the background picker from whatever colour the surface actually
// resolves to right now (its CSS default, light or dark) — only once it's
// in the document, so `getComputedStyle` has an actual value to resolve
// `color-mix()` against. Deliberately does NOT call `applyCanvasBg`: that
// would freeze an inline override in immediately and stop the swatch from
// tracking the OS light/dark preference until the user actually touches it.
const initialCanvasBg = rgbToHex(getComputedStyle(surface).backgroundColor)
canvasBgInput.value = initialCanvasBg
canvasBgValue.textContent = initialCanvasBg.toUpperCase()

// --- mounting ---

let teardown: (() => void) | null = null

function findExample(id: string): Example {
  return EXAMPLES.find((example) => example.id === id) ?? EXAMPLES[0]!
}

function show(stack: Stack, exampleId: string): void {
  // Tear the previous demo down properly before mounting the next one: the
  // vanilla chart via chart.destroy(), the Vue one via app.unmount() —
  // otherwise listeners and canvases from the old demo leak.
  teardown?.()
  teardown = null
  currentApi = null
  currentSetMinimap = null
  currentSetMinimapPosition = null
  currentSetEdgeRadius = null
  surface.innerHTML = ''

  const example = findExample(exampleId)
  descriptionText.textContent = example.description

  // Reset every live control to whatever this example itself declares before
  // it mounts, rather than carrying over the previous example/stack's state —
  // the controls must reflect what's ACTUALLY showing. The canvas background
  // isn't part of any example's declared options (it's chrome, not data), so
  // it deliberately carries over across a stack/example switch instead.
  minimapOn = minimapDefaultOn(example)
  updateMinimapButton()
  minimapPositionSelect.value = minimapDefaultPosition(example)
  edgeRadiusRange.value = String(EDGE_RADIUS_DEFAULT)
  edgeRadiusValue.textContent = String(EDGE_RADIUS_DEFAULT)

  if (stack === 'vanilla') {
    const chart: VanillaDemoHandle = mountVanilla(surface, example, (api) => {
      currentApi = api
    })
    currentSetMinimap = (on) => chart.setMinimap(on)
    currentSetMinimapPosition = (position) => chart.setMinimapPosition(position)
    currentSetEdgeRadius = (radius) => chart.setEdgeRadius(radius)
    teardown = () => chart.destroy()
  } else if (stack === 'vue') {
    const app = createApp(VueDemo, {
      example,
      onReady: (api: OrgChartApi) => {
        currentApi = api
      },
    })
    // VueDemo exposes `setMinimap`/`setMinimapPosition`/`setEdgeRadius` via
    // `defineExpose`; `app.mount()` returns exactly that exposed public
    // instance for the root component.
    const instance = app.mount(surface) as unknown as {
      setMinimap: (on: boolean) => void
      setMinimapPosition: (position: MinimapPosition) => void
      setEdgeRadius: (radius: number) => void
    }
    currentSetMinimap = (on) => instance.setMinimap(on)
    currentSetMinimapPosition = (position) => instance.setMinimapPosition(position)
    currentSetEdgeRadius = (radius) => instance.setEdgeRadius(radius)
    teardown = () => app.unmount()
  } else {
    const root: Root = createRoot(surface)
    const reactHandle: { current: ReactDemoHandle | null } = { current: null }
    root.render(
      createElement(ReactDemo, {
        example,
        onReady: (api: OrgChartApi) => {
          currentApi = api
        },
        ref: reactHandle,
      }),
    )
    currentSetMinimap = (on) => reactHandle.current?.setMinimap(on)
    currentSetMinimapPosition = (position) => reactHandle.current?.setMinimapPosition(position)
    currentSetEdgeRadius = (radius) => reactHandle.current?.setEdgeRadius(radius)
    teardown = () => root.unmount()
  }
}

function refresh(): void {
  show(stackSelect.value as Stack, exampleSelect.value)
}

stackSelect.onchange = refresh
exampleSelect.onchange = refresh

stackSelect.value = 'vanilla'
exampleSelect.value = EXAMPLES[0]!.id
refresh()
