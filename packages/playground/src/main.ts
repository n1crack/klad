import { createApp } from 'vue'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { OrgChartApi } from '@n1crack/orgchart'
import {
  BLOCK_FILL_SEED,
  EDGE_RADIUS_DEFAULT,
  EDGE_RADIUS_MAX,
  EDGE_RADIUS_MIN,
  EDGE_WIDTH_DEFAULT,
  EDGE_WIDTH_MAX,
  EDGE_WIDTH_MIN,
  EDGE_WIDTH_STEP,
  EXAMPLES,
  MINIMAP_POSITIONS,
  minimapDefaultOn,
  minimapDefaultPosition,
  NODE_FILL_DEFAULT,
  RING_STROKE_DEFAULT,
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

// --- "Appearance" group: theme-driven controls (edge radius, node fill) plus
// the canvas background — grouped together since all three change how the
// chart looks, not what it shows. Edge radius and node fill are both real
// `theme` tokens, applied live through `api.setTheme(...)` (no remount, no
// tree-state reset — see vanilla-demo.ts/VueDemo.vue/ReactDemo.tsx's own
// `setEdgeRadius`/`setNodeFill`). The canvas background isn't a theme token
// at all (see the comment above `applyCanvasBg` below) — it's chrome, a host
// CSS override — so it stays a separate mechanism even though it lives in
// the same sidebar group.
let currentSetEdgeRadius: ((radius: number) => void) | null = null
let currentSetNodeFill: ((nodeFill: string) => void) | null = null
let currentSetBlockFill: ((blockFill: string) => void) | null = null
let currentSetAccent: ((accent: string) => void) | null = null
let currentSetEdgeWidth: ((width: number) => void) | null = null
let currentSetRingEnabled: ((enabled: boolean) => void) | null = null

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

// "Line width" — `theme.edgeWidth`, the weight of every connector. It also
// drives `edgeHighlightWidth` through `highlightWidthFor`, so a highlighted
// route stays proportionally heavier than the lines around it at any setting;
// a route drawn at the same weight as everything else stops reading as a
// route at all.
const edgeWidthField = document.createElement('div')
edgeWidthField.className = 'field field-range'
const edgeWidthLabel = document.createElement('label')
edgeWidthLabel.textContent = 'Line width'
edgeWidthLabel.htmlFor = 'edge-width-range'
const edgeWidthRow = document.createElement('div')
edgeWidthRow.className = 'field-range-row'
const edgeWidthRange = document.createElement('input')
edgeWidthRange.type = 'range'
edgeWidthRange.id = 'edge-width-range'
edgeWidthRange.min = String(EDGE_WIDTH_MIN)
edgeWidthRange.max = String(EDGE_WIDTH_MAX)
edgeWidthRange.step = String(EDGE_WIDTH_STEP)
edgeWidthRange.value = String(EDGE_WIDTH_DEFAULT)
const edgeWidthValue = document.createElement('output')
edgeWidthValue.className = 'field-range-value'
edgeWidthValue.setAttribute('for', 'edge-width-range')
edgeWidthValue.textContent = String(EDGE_WIDTH_DEFAULT)
edgeWidthRow.append(edgeWidthRange, edgeWidthValue)
edgeWidthField.append(edgeWidthLabel, edgeWidthRow)

edgeWidthRange.oninput = () => {
  const width = Number(edgeWidthRange.value)
  edgeWidthValue.textContent = String(width)
  currentSetEdgeWidth?.(width)
}

// "Node fill" — the owner's ask: when the canvas is zoomed out small, nodes
// are drawn by the canvas itself as filled boxes using `theme.nodeFill` (see
// packages/core/src/render/canvas2d.ts), so this is the control that
// recolours them. Also affects the same boxes at any zoom (they're always
// canvas-drawn underneath), and any overlay card whose own CSS happens to
// read `theme.nodeFill` — the built-in demo cards in this playground don't
// (their background comes from `.card`'s own CSS, not the chart's theme), so
// dragging this only visibly recolours the canvas-drawn boxes here, most
// obviously once zoomed out past the overlay threshold.
const nodeFillInput = document.createElement('input')
nodeFillInput.type = 'color'
nodeFillInput.id = 'node-fill-input'
nodeFillInput.className = 'color-input'
nodeFillInput.value = NODE_FILL_DEFAULT
const nodeFillLabel = document.createElement('label')
nodeFillLabel.textContent = 'Node fill'
nodeFillLabel.htmlFor = 'node-fill-input'
const nodeFillValue = document.createElement('output')
nodeFillValue.className = 'field-range-value'
nodeFillValue.setAttribute('for', 'node-fill-input')
nodeFillValue.textContent = NODE_FILL_DEFAULT.toUpperCase()
const nodeFillRow = document.createElement('div')
nodeFillRow.className = 'field-range-row'
nodeFillRow.append(nodeFillInput, nodeFillValue)
const nodeFillField = document.createElement('div')
nodeFillField.className = 'field'
nodeFillField.append(nodeFillLabel, nodeFillRow)

nodeFillInput.oninput = () => {
  const hex = nodeFillInput.value
  nodeFillValue.textContent = hex.toUpperCase()
  currentSetNodeFill?.(hex)
}

// "Shape fill" — the `block` LOD tier's own fill (`theme.blockFill`, see
// packages/core/src/render/theme.ts), independent of "Node fill" above.
// Defaults to `'transparent'`: zoomed all the way out, past the text
// threshold, a chart shows only its connector lines, not solid boxes — the
// owner's ask. `<input type="color">` can't itself represent "no colour", so
// this is a checkbox ("enable a shape fill at all") plus the picker it
// gates: unchecked sends the literal string `'transparent'` through
// `api.setTheme({ blockFill })` (see canvas2d.ts, which treats that exact
// string as "skip the fill" rather than paint-with-an-invisible-colour);
// checked sends whatever the swatch holds. The picker itself stays enabled
// either way (dragging it while unchecked pre-arms a colour for the next
// time the checkbox is ticked, rather than being inert), and starts on
// `BLOCK_FILL_SEED`, a colour distinct from `NODE_FILL_DEFAULT` purely so the
// two swatches read as different controls at a glance.
const blockFillCheckbox = document.createElement('input')
blockFillCheckbox.type = 'checkbox'
blockFillCheckbox.id = 'block-fill-checkbox'
blockFillCheckbox.className = 'checkbox-input'
const blockFillInput = document.createElement('input')
blockFillInput.type = 'color'
blockFillInput.id = 'block-fill-input'
blockFillInput.className = 'color-input'
blockFillInput.value = BLOCK_FILL_SEED
const blockFillLabel = document.createElement('label')
blockFillLabel.textContent = 'Shape fill'
blockFillLabel.htmlFor = 'block-fill-checkbox'
const blockFillValue = document.createElement('output')
blockFillValue.className = 'field-range-value'
blockFillValue.setAttribute('for', 'block-fill-input')
blockFillValue.textContent = 'Transparent'
const blockFillRow = document.createElement('div')
blockFillRow.className = 'field-range-row'
blockFillRow.append(blockFillCheckbox, blockFillInput, blockFillValue)
const blockFillField = document.createElement('div')
blockFillField.className = 'field'
blockFillField.append(blockFillLabel, blockFillRow)

function applyBlockFill(): void {
  if (blockFillCheckbox.checked) {
    const hex = blockFillInput.value
    blockFillValue.textContent = hex.toUpperCase()
    currentSetBlockFill?.(hex)
  } else {
    blockFillValue.textContent = 'Transparent'
    currentSetBlockFill?.('transparent')
  }
}

blockFillCheckbox.onchange = applyBlockFill
blockFillInput.oninput = applyBlockFill

// "Accent" — one colour for everything that answers a question the viewer
// asked: the one-shot confirmation ring, a highlighted node's outline, and
// the connectors along a highlighted path. They are three separate theme
// tokens, since a consumer may want them apart, but a route drawn in one
// colour and confirmed in another reads as two unrelated events rather than
// one answer — so this control drives all three together (see each demo's
// `setAccent`). All three are real theme tokens, applied live through
// `api.setTheme(...)`, the same mechanism as "Node fill"/"Edge radius" above.
//
// The "Ring" on/off beside it is NOT a theme token (see `Options.ring`'s
// docblock in packages/vanilla/src/index.ts) so it goes through the dedicated
// `api.setRing(...)` method instead, mirroring the minimap on/off button's
// `btn-toggle` styling below.
const ringStrokeInput = document.createElement('input')
ringStrokeInput.type = 'color'
ringStrokeInput.id = 'ring-stroke-input'
ringStrokeInput.className = 'color-input'
ringStrokeInput.value = RING_STROKE_DEFAULT
const ringStrokeLabel = document.createElement('label')
ringStrokeLabel.textContent = 'Accent'
ringStrokeLabel.htmlFor = 'ring-stroke-input'
const ringStrokeValue = document.createElement('output')
ringStrokeValue.className = 'field-range-value'
ringStrokeValue.setAttribute('for', 'ring-stroke-input')
ringStrokeValue.textContent = RING_STROKE_DEFAULT.toUpperCase()
const ringStrokeRow = document.createElement('div')
ringStrokeRow.className = 'field-range-row'
ringStrokeRow.append(ringStrokeInput, ringStrokeValue)
const ringStrokeField = document.createElement('div')
ringStrokeField.className = 'field'
ringStrokeField.append(ringStrokeLabel, ringStrokeRow)

ringStrokeInput.oninput = () => {
  const hex = ringStrokeInput.value
  ringStrokeValue.textContent = hex.toUpperCase()
  currentSetAccent?.(hex)
}

let ringEnabled = true
const ringEnabledButton = document.createElement('button')
ringEnabledButton.type = 'button'
ringEnabledButton.className = 'btn btn-toggle'

function updateRingEnabledButton(): void {
  ringEnabledButton.textContent = `Ring: ${ringEnabled ? 'On' : 'Off'}`
  ringEnabledButton.setAttribute('aria-pressed', String(ringEnabled))
}

ringEnabledButton.onclick = () => {
  ringEnabled = !ringEnabled
  currentSetRingEnabled?.(ringEnabled)
  updateRingEnabledButton()
}
updateRingEnabledButton()

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

// "Go to node" — an EXTERNAL control, deliberately: the point of the example
// it belongs to is that navigating the chart does not have to start from the
// chart. Picking a name expands whatever is in the way, paints the route from
// the root, and flies there.
//
// It lives in the corner of the CANVAS rather than in the sidebar, because it
// belongs to one example rather than to the playground: the sidebar's controls
// all mean something on every example, and a field that is blank on all but
// one of them reads as broken. Sitting on the surface it is also next to the
// thing it drives, like the minimap in the opposite corner.
//
// Shown only for examples that ask for it (`Example.gotoControl`), and
// repopulated on every mount, since the list is the example's own data.
const gotoSelect = document.createElement('select')
gotoSelect.id = 'goto-select'
gotoSelect.className = 'select'
const gotoLabel = document.createElement('label')
gotoLabel.textContent = 'Go to node'
gotoLabel.htmlFor = 'goto-select'
const gotoField = document.createElement('div')
gotoField.className = 'goto-panel'
gotoField.append(gotoLabel, gotoSelect)

// The surface is the chart's own host: a pointer landing here would otherwise
// bubble into it and start a pan, and a wheel would zoom the chart while the
// menu is open. The select's own gestures stop at the panel.
for (const type of ['pointerdown', 'wheel'] as const) {
  gotoField.addEventListener(type, (event) => event.stopPropagation())
}

gotoSelect.onchange = () => {
  const id = gotoSelect.value
  if (id === '') return
  // `pathTo` is the root-to-node chain, which is exactly what `highlight`
  // wants; an edge is painted when both its endpoints are lit, so this lights
  // the way and not merely its ends. `focus` opens every collapsed ancestor
  // before centring, so this works from the fully closed chart the example
  // starts as.
  currentApi?.highlight(currentApi.pathTo(id))
  currentApi?.focus(id, { ring: true })
}

/**
 * Fills the combo box with `example`'s own nodes, indented by depth so the
 * list reads as the tree it navigates, and hides the whole field for examples
 * that did not ask for it.
 */
function syncGotoControl(example: Example): void {
  gotoField.remove()
  if (example.gotoControl === true) {
    // Appended after `surface.innerHTML = ''` has run and before the chart
    // mounts into it — the panel is absolutely positioned with its own
    // stacking order, so DOM order relative to the canvas doesn't decide what
    // is on top.
    surface.append(gotoField)
    const depthOf = new Map<string, number>()
    gotoSelect.innerHTML = ''
    const placeholder = document.createElement('option')
    placeholder.value = ''
    placeholder.textContent = 'Pick a node…'
    gotoSelect.append(placeholder)
    for (const item of example.data) {
      const parentId = item.parentId
      const depth =
        parentId === undefined || parentId === null ? 0 : (depthOf.get(String(parentId)) ?? 0) + 1
      depthOf.set(item.id, depth)
      const option = document.createElement('option')
      option.value = item.id
      // Non-breaking spaces: a native <option> collapses ordinary leading
      // whitespace, so plain spaces would indent nothing at all.
      option.textContent = '  '.repeat(depth) + String(item.name ?? item.id)
      gotoSelect.append(option)
    }
  }
  gotoSelect.value = ''
}

const appearanceGroup = sidebarGroup(
  'Appearance',
  edgeRadiusField,
  edgeWidthField,
  nodeFillField,
  blockFillField,
  ringStrokeField,
  ringEnabledButton,
  canvasBgField,
)

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
sidebarBody.append(demoGroup, viewGroup, minimapGroup, appearanceGroup, exportGroup)
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
  currentSetNodeFill = null
  currentSetBlockFill = null
  currentSetAccent = null
  currentSetEdgeWidth = null
  currentSetRingEnabled = null
  surface.innerHTML = ''

  const example = findExample(exampleId)
  syncGotoControl(example)
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
  // Same reset as edge radius: the swatch goes back to the library default
  // rather than whatever an example's OWN theme happens to declare (e.g.
  // Avatar/Monogram's transparent node box) — this control never applies
  // anything until a viewer actually drags it, so there's nothing to
  // reconcile the swatch against; see `NODE_FILL_DEFAULT`'s docblock.
  nodeFillInput.value = NODE_FILL_DEFAULT
  nodeFillValue.textContent = NODE_FILL_DEFAULT.toUpperCase()
  // Same reset pattern: back to "no shape fill" (the library default) rather
  // than carrying over the previous example/stack's state.
  blockFillCheckbox.checked = false
  blockFillInput.value = BLOCK_FILL_SEED
  blockFillValue.textContent = 'Transparent'
  ringStrokeInput.value = RING_STROKE_DEFAULT
  ringStrokeValue.textContent = RING_STROKE_DEFAULT.toUpperCase()
  edgeWidthRange.value = String(EDGE_WIDTH_DEFAULT)
  edgeWidthValue.textContent = String(EDGE_WIDTH_DEFAULT)
  ringEnabled = true
  updateRingEnabledButton()

  if (stack === 'vanilla') {
    const chart: VanillaDemoHandle = mountVanilla(surface, example, (api) => {
      currentApi = api
    })
    currentSetMinimap = (on) => chart.setMinimap(on)
    currentSetMinimapPosition = (position) => chart.setMinimapPosition(position)
    currentSetEdgeRadius = (radius) => chart.setEdgeRadius(radius)
    currentSetNodeFill = (nodeFill) => chart.setNodeFill(nodeFill)
    currentSetBlockFill = (blockFill) => chart.setBlockFill(blockFill)
    currentSetAccent = (accent) => chart.setAccent(accent)
    currentSetEdgeWidth = (width) => chart.setEdgeWidth(width)
    currentSetRingEnabled = (enabled) => chart.setRingEnabled(enabled)
    teardown = () => chart.destroy()
  } else if (stack === 'vue') {
    const app = createApp(VueDemo, {
      example,
      onReady: (api: OrgChartApi) => {
        currentApi = api
      },
    })
    // VueDemo exposes `setMinimap`/`setMinimapPosition`/`setEdgeRadius`/
    // `setNodeFill`/`setBlockFill`/`setRingStroke`/`setRingEnabled` via
    // `defineExpose`; `app.mount()` returns exactly that exposed public
    // instance for the root component.
    const instance = app.mount(surface) as unknown as {
      setMinimap: (on: boolean) => void
      setMinimapPosition: (position: MinimapPosition) => void
      setEdgeRadius: (radius: number) => void
      setNodeFill: (nodeFill: string) => void
      setBlockFill: (blockFill: string) => void
      setAccent: (accent: string) => void
      setEdgeWidth: (width: number) => void
      setRingEnabled: (enabled: boolean) => void
    }
    currentSetMinimap = (on) => instance.setMinimap(on)
    currentSetMinimapPosition = (position) => instance.setMinimapPosition(position)
    currentSetEdgeRadius = (radius) => instance.setEdgeRadius(radius)
    currentSetNodeFill = (nodeFill) => instance.setNodeFill(nodeFill)
    currentSetBlockFill = (blockFill) => instance.setBlockFill(blockFill)
    currentSetAccent = (accent) => instance.setAccent(accent)
    currentSetEdgeWidth = (width) => instance.setEdgeWidth(width)
    currentSetRingEnabled = (enabled) => instance.setRingEnabled(enabled)
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
    currentSetNodeFill = (nodeFill) => reactHandle.current?.setNodeFill(nodeFill)
    currentSetBlockFill = (blockFill) => reactHandle.current?.setBlockFill(blockFill)
    currentSetAccent = (accent) => reactHandle.current?.setAccent(accent)
    currentSetEdgeWidth = (width) => reactHandle.current?.setEdgeWidth(width)
    currentSetRingEnabled = (enabled) => reactHandle.current?.setRingEnabled(enabled)
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
