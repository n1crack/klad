import { createApp } from 'vue'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { KladApi, Theme } from '@klad/core'
import {
  BLOCK_FILL_SEED,
  EDGE_RADIUS_MAX,
  EDGE_RADIUS_MIN,
  EDGE_WIDTH_MAX,
  EDGE_WIDTH_MIN,
  EDGE_WIDTH_STEP,
  effectiveTheme,
  EXAMPLES,
  highlightWidthFor,
  MINIMAP_POSITIONS,
  minimapDefaultOn,
  minimapDefaultPosition,
  type Example,
  type MinimapPosition,
} from './data.js'
import {
  applyTheme,
  chartTokens,
  initialMode,
  rememberMode,
  silhouetteColour,
  watchStoredTheme,
  watchSystemTheme,
  type ThemeMode,
} from './theme.js'
import { startAnalytics } from './analytics.js'
import { generateCode, type ConfigSnapshot, type Stack as CodeStack } from './codegen.js'
import { highlight } from './highlight.js'
import { mountVanilla, type VanillaDemoHandle } from './vanilla-demo.js'
import VueDemo from './VueDemo.vue'
import { ReactDemo, type ReactDemoHandle } from './ReactDemo.js'
import './style.css'

type Stack = 'vanilla' | 'vue' | 'react'

/**
 * Light/dark, applied to `<html>` BEFORE the shell is built: every colour
 * below — the shell's own `canvas`/`canvastext`-derived tokens and the chart
 * theme the demos mount with alike — is read from the document, so a mode
 * settled after the first paint would show as a flash of the wrong one.
 */
let mode: ThemeMode = initialMode()
applyTheme(mode)

// A no-op in development — see analytics.ts.
startAnalytics()

const root = document.querySelector<HTMLDivElement>('#app')
if (root === null) throw new Error('#app element not found')
root.innerHTML = ''

// --- shell: a slim header bar above everything, then a sidebar + chart-area layout ---

/**
 * The mark, inline rather than as an `<img src>`: this app is served both on
 * its own and from under the documentation site's base path, and an inlined
 * SVG cannot get that path wrong.
 */
const MARK = `<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="pg-face" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="#3b82f6" /><stop offset="1" stop-color="#60a5fa" />
    </linearGradient>
    <linearGradient id="pg-leaf" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="#60a5fa" /><stop offset="1" stop-color="#93c5fd" />
    </linearGradient>
  </defs>
  <g fill="none" stroke="#94a3b8" stroke-width="3" stroke-linecap="round">
    <path d="M24 18v5" /><path d="M11 30v-7h26v7" />
  </g>
  <rect x="15" y="9" width="22" height="11" rx="3.5" fill="#1e40af" />
  <rect x="13" y="6" width="22" height="11" rx="3.5" fill="url(#pg-face)" />
  <rect x="6" y="32" width="15" height="10" rx="3" fill="#2563eb" />
  <rect x="4" y="30" width="15" height="10" rx="3" fill="url(#pg-leaf)" />
  <rect x="31" y="32" width="15" height="10" rx="3" fill="#2563eb" />
  <rect x="29" y="30" width="15" height="10" rx="3" fill="url(#pg-leaf)" />
</svg>`

const header = document.createElement('header')
header.className = 'app-header'

const brand = document.createElement('div')
brand.className = 'app-brand'
const markEl = document.createElement('span')
markEl.className = 'app-mark'
markEl.innerHTML = MARK
const appTitle = document.createElement('div')
appTitle.className = 'app-title'
const appName = document.createElement('span')
appName.className = 'app-name'
appName.textContent = 'Klad Playground'
const appTagline = document.createElement('span')
appTagline.className = 'app-tagline'
appTagline.textContent = 'One dataset, three framework adapters, one canvas underneath'
appTitle.append(appName, appTagline)
brand.append(markEl, appTitle)

/**
 * Back to the docs. Resolved one level up from wherever this app is served —
 * embedded at `<docs base>/playground/`, the parent IS the documentation
 * home — rather than hard-coded, so the link is right under the docs, under a
 * custom domain, and when the app is run on its own.
 */
const here = new URL('.', window.location.href).pathname
const parent = new URL('..', window.location.href).pathname

const headerActions = document.createElement('div')
headerActions.className = 'app-actions'

/**
 * Light/dark. One button rather than a three-way light/dark/system control:
 * the playground already STARTS on the OS preference and keeps following it
 * until this is clicked (see theme.ts), so the third state is the default
 * state and does not need a seat of its own.
 *
 * The icon shows what a click will GIVE you, not what you are in — the label
 * says the same thing, so the two never contradict each other.
 */
const SUN = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
  <circle cx="12" cy="12" r="4.2" />
  <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6" />
</svg>`
const MOON = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M20.5 14.2A8.6 8.6 0 0 1 9.8 3.5a8.6 8.6 0 1 0 10.7 10.7Z" />
</svg>`

/**
 * Opens the sidebar on a narrow screen, where it is a drawer over the chart
 * rather than a column beside it. Hidden by CSS at every width where the
 * sidebar is simply there (see the `max-width: 720px` block in style.css) —
 * a button that toggles something already permanently visible is noise.
 *
 * The drawer is the answer to the sidebar's own size on a phone: as a block
 * ABOVE the chart it took nearly half the screen, leaving the thing the page
 * exists to show as a strip at the bottom. Over the chart, it costs nothing
 * until it is asked for.
 */
const controlsButton = document.createElement('button')
controlsButton.type = 'button'
controlsButton.className = 'app-controls-toggle'
controlsButton.textContent = 'Controls'
controlsButton.setAttribute('aria-expanded', 'false')
controlsButton.onclick = () => setControlsOpen(!layout.classList.contains('is-controls-open'))
headerActions.append(controlsButton)

function setControlsOpen(open: boolean): void {
  layout.classList.toggle('is-controls-open', open)
  controlsButton.setAttribute('aria-expanded', String(open))
}

const themeButton = document.createElement('button')
themeButton.type = 'button'
themeButton.className = 'app-theme-toggle'
themeButton.onclick = () => {
  switchMode(mode === 'dark' ? 'light' : 'dark', true)
}
headerActions.append(themeButton)

/** Keeps the toggle's icon and its accessible label pointing at the mode a click would move TO. */
function updateThemeButton(): void {
  const next = mode === 'dark' ? 'light' : 'dark'
  themeButton.innerHTML = mode === 'dark' ? SUN : MOON
  themeButton.title = `Switch to ${next} theme`
  themeButton.setAttribute('aria-label', themeButton.title)
}
updateThemeButton()

// Only when there is somewhere to go back TO. Served on its own — `pnpm dev`,
// or deployed at a root — the parent is this same page, and an exit that
// reloads what you are already looking at is worse than no exit at all.
if (parent !== here) {
  const backLink = document.createElement('a')
  backLink.className = 'app-back'
  backLink.href = parent
  backLink.innerHTML = '<span aria-hidden="true">←</span> Docs'
  headerActions.append(backLink)
}

header.append(brand, headerActions)

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

let currentApi: KladApi | null = null

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

/**
 * The silhouette's colour — an OPTION rather than a theme token (see
 * `MinimapOptions.silhouetteColour`), because it is painted pixel by pixel
 * into the widget's own canvas and so is the one part of the minimap a host
 * stylesheet cannot reach. Left alone it follows light/dark on its own; once
 * touched, it is the viewer's.
 */
const minimapSilhouetteInput = document.createElement('input')
minimapSilhouetteInput.type = 'color'
minimapSilhouetteInput.id = 'minimap-silhouette-input'
minimapSilhouetteInput.className = 'color-input'
const minimapSilhouetteValue = readout()
minimapSilhouetteValue.setAttribute('for', minimapSilhouetteInput.id)
let minimapSilhouetteOverridden = false
minimapSilhouetteInput.oninput = () => {
  minimapSilhouetteOverridden = true
  minimapSilhouetteValue.textContent = minimapSilhouetteInput.value.toUpperCase()
  currentSetMinimapSilhouette?.(minimapSilhouetteInput.value)
}

/** Points the swatch at the mode's default while the viewer has not overridden it. */
function syncMinimapSilhouette(): void {
  if (minimapSilhouetteOverridden) return
  const colour = silhouetteColour(mode)
  minimapSilhouetteInput.value = colour
  minimapSilhouetteValue.textContent = colour.toUpperCase()
}

const minimapGroup = sidebarGroup(
  'Minimap',
  minimapButton,
  minimapPositionField,
  field('Silhouette', minimapSilhouetteInput, minimapSilhouetteValue),
)

// --- "Appearance": every theme token the sidebar owns ---
//
// One state object, one door. `themeState` is what the sidebar has applied on
// top of the example's own theme, and every control writes a partial into it
// through `applyThemeTokens`, which also pushes that partial into whichever
// stack is mounted (`api.setTheme` merges, paint-only — no remount, no
// tree-state reset). Two things fall out of that: adding a control is a line
// in a table rather than a setter in four files, and the Code panel can print
// exactly what the chart is showing by reading the same object.
//
// The canvas background is the one exception and stays separate: there is no
// `theme.background` token at all — the canvas only ever `clearRect`s, so the
// colour behind the nodes is the host element's own CSS (see `applyCanvasBg`).
let currentSetTheme: ((partial: Partial<Theme>) => void) | null = null
let currentSetRingEnabled: ((enabled: boolean) => void) | null = null
let currentSetMinimapSilhouette: ((colour: string) => void) | null = null
/**
 * Pushes a light/dark switch into whichever stack is mounted. Like every
 * other setter here it goes through `api.setTheme`, so flipping the theme
 * never resets camera, expand/collapse or highlight state.
 */
let currentSetMode: ((mode: ThemeMode) => void) | null = null

/** The tokens this sidebar has applied over the example's own theme. */
let themeState: Partial<Theme> = {}

function applyThemeTokens(partial: Partial<Theme>): void {
  Object.assign(themeState, partial)
  currentSetTheme?.(partial)
}

/** A labelled row holding one control and its readout — the sidebar's unit. */
function field(labelText: string, control: HTMLElement, readout?: HTMLElement): HTMLDivElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'field'
  const label = document.createElement('label')
  label.textContent = labelText
  if (control.id !== '') label.htmlFor = control.id
  const row = document.createElement('div')
  row.className = 'field-range-row'
  row.append(control)
  if (readout !== undefined) row.append(readout)
  wrapper.append(label, row)
  return wrapper
}

function readout(): HTMLOutputElement {
  const out = document.createElement('output')
  out.className = 'field-range-value'
  return out
}

/**
 * A control bound to one theme token: it knows how to read its own current
 * value out of a resolved theme (`read`) and how to turn its widget's value
 * back into a partial theme (`write`). That pairing is what makes a reset —
 * switching example, switching stack, flipping light/dark — a loop over the
 * controls rather than a list of assignments that has to be kept in step with
 * the list of controls.
 */
interface ThemeControl {
  element: HTMLElement
  /** Points the widget at what the chart is ACTUALLY showing right now. */
  sync(theme: Theme): void
}

function colourControl(
  labelText: string,
  id: string,
  read: (theme: Theme) => string,
  write: (hex: string) => Partial<Theme>,
): ThemeControl {
  const input = document.createElement('input')
  input.type = 'color'
  input.id = id
  input.className = 'color-input'
  const out = readout()
  out.setAttribute('for', id)
  input.oninput = () => {
    out.textContent = input.value.toUpperCase()
    applyThemeTokens(write(input.value))
  }
  return {
    element: field(labelText, input, out),
    sync(theme) {
      // A token an example deliberately set to `'transparent'` (the avatar
      // circle's node box) has no hex to show. The swatch keeps whatever it
      // had — it is a starting point for a viewer who wants to opt back IN to
      // a colour, and nothing is applied until they actually touch it.
      const value = read(theme)
      if (/^#[0-9a-f]{6}$/i.test(value)) input.value = value
      out.textContent = value.toUpperCase()
    },
  }
}

function rangeControl(
  labelText: string,
  id: string,
  bounds: { min: number; max: number; step: number },
  read: (theme: Theme) => number,
  write: (value: number) => Partial<Theme>,
): ThemeControl {
  const input = document.createElement('input')
  input.type = 'range'
  input.id = id
  input.min = String(bounds.min)
  input.max = String(bounds.max)
  input.step = String(bounds.step)
  const out = readout()
  out.setAttribute('for', id)
  input.oninput = () => {
    out.textContent = input.value
    applyThemeTokens(write(Number(input.value)))
  }
  const wrapper = field(labelText, input, out)
  wrapper.classList.add('field-range')
  return {
    element: wrapper,
    sync(theme) {
      const value = read(theme)
      input.value = String(value)
      out.textContent = String(value)
    },
  }
}

/**
 * "Shape fill" — the `block` LOD tier's own fill (`theme.blockFill`),
 * independent of the node fill above it. Defaults to `'transparent'`: zoomed
 * all the way out, past the text threshold, a chart shows only its connector
 * skeleton rather than a wall of solid boxes. `<input type="color">` cannot
 * itself represent "no colour", so this is a checkbox — "a shape fill at all"
 * — plus the swatch it gates. The swatch stays live either way, so dragging it
 * while unchecked pre-arms a colour for the moment the box is ticked.
 */
function blockFillControl(): ThemeControl {
  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'
  checkbox.id = 'block-fill-checkbox'
  checkbox.className = 'checkbox-input'
  const input = document.createElement('input')
  input.type = 'color'
  input.id = 'block-fill-input'
  input.className = 'color-input'
  input.value = BLOCK_FILL_SEED
  const out = readout()
  out.setAttribute('for', 'block-fill-input')

  const apply = (): void => {
    const value = checkbox.checked ? input.value : 'transparent'
    out.textContent = checkbox.checked ? value.toUpperCase() : 'Transparent'
    applyThemeTokens({ blockFill: value })
  }
  checkbox.onchange = apply
  input.oninput = apply

  const wrapper = document.createElement('div')
  wrapper.className = 'field'
  const label = document.createElement('label')
  label.textContent = 'Shape fill'
  label.htmlFor = checkbox.id
  const row = document.createElement('div')
  row.className = 'field-range-row'
  row.append(checkbox, input, out)
  wrapper.append(label, row)

  return {
    element: wrapper,
    sync(theme) {
      const value = theme.blockFill
      const on = value !== 'transparent'
      checkbox.checked = on
      if (/^#[0-9a-f]{6}$/i.test(value)) input.value = value
      out.textContent = on ? value.toUpperCase() : 'Transparent'
    },
  }
}

/**
 * The label font is a full CSS shorthand (`'14px system-ui, …'`), which is the
 * right shape for a token and the wrong shape for a slider. This drives the
 * size out of it and puts it back, leaving the family alone.
 */
const LABEL_FAMILY = 'system-ui, -apple-system, Segoe UI, sans-serif'

function labelSizeOf(font: string): number {
  const match = /(\d+(?:\.\d+)?)px/.exec(font)
  return match === null ? 14 : Number(match[1])
}

/**
 * "Accent" — one colour for everything that answers a question the viewer just
 * asked: the confirmation ring, a highlighted node's outline, and the
 * connectors along a highlighted path. Three tokens, because a consumer may
 * well want them apart, but a route drawn in one colour and confirmed in
 * another reads as two unrelated events rather than one answer.
 */
const THEME_CONTROLS: { caption: string; controls: ThemeControl[] }[] = [
  {
    caption: 'Nodes',
    controls: [
      colourControl('Fill', 'node-fill-input', (theme) => theme.nodeFill, (nodeFill) => ({ nodeFill })),
      colourControl('Border', 'node-stroke-input', (theme) => theme.nodeStroke, (nodeStroke) => ({ nodeStroke })),
      rangeControl(
        'Border width',
        'node-stroke-width-range',
        { min: 0, max: 4, step: 0.5 },
        (theme) => theme.nodeStrokeWidth,
        (nodeStrokeWidth) => ({ nodeStrokeWidth }),
      ),
      rangeControl(
        'Corner radius',
        'corner-radius-range',
        { min: 0, max: 24, step: 1 },
        (theme) => theme.cornerRadius,
        (cornerRadius) => ({ cornerRadius }),
      ),
      blockFillControl(),
    ],
  },
  {
    caption: 'Connectors',
    controls: [
      colourControl('Colour', 'edge-stroke-input', (theme) => theme.edgeStroke, (edgeStroke) => ({ edgeStroke })),
      rangeControl(
        'Width',
        'edge-width-range',
        { min: EDGE_WIDTH_MIN, max: EDGE_WIDTH_MAX, step: EDGE_WIDTH_STEP },
        (theme) => theme.edgeWidth,
        // The highlighted route rides along: drawn at the same weight as
        // everything else it stops reading as a route at all.
        (edgeWidth) => ({ edgeWidth, edgeHighlightWidth: highlightWidthFor(edgeWidth) }),
      ),
      rangeControl(
        'Elbow radius',
        'edge-radius-range',
        { min: EDGE_RADIUS_MIN, max: EDGE_RADIUS_MAX, step: 1 },
        (theme) => theme.edgeCornerRadius,
        (edgeCornerRadius) => ({ edgeCornerRadius }),
      ),
    ],
  },
  {
    caption: 'Labels',
    controls: [
      colourControl('Colour', 'label-colour-input', (theme) => theme.labelColour, (labelColour) => ({ labelColour })),
      rangeControl(
        'Size',
        'label-size-range',
        { min: 9, max: 28, step: 1 },
        (theme) => labelSizeOf(theme.labelFont),
        (size) => ({ labelFont: `${size}px ${LABEL_FAMILY}` }),
      ),
      rangeControl(
        'Padding',
        'label-padding-range',
        { min: 0, max: 32, step: 1 },
        (theme) => theme.labelPadding,
        (labelPadding) => ({ labelPadding }),
      ),
    ],
  },
  {
    caption: 'Highlight',
    controls: [
      colourControl('Accent', 'accent-input', (theme) => theme.ringStroke, (accent) => ({
        ringStroke: accent,
        edgeHighlightStroke: accent,
        highlightStroke: accent,
      })),
      colourControl('Lit fill', 'highlight-fill-input', (theme) => theme.highlightFill, (highlightFill) => ({
        highlightFill,
      })),
      rangeControl(
        'Ring width',
        'ring-width-range',
        { min: 0.5, max: 6, step: 0.5 },
        (theme) => theme.ringStrokeWidth,
        (ringStrokeWidth) => ({ ringStrokeWidth }),
      ),
      rangeControl(
        'Ring spread',
        'ring-offset-range',
        { min: 0, max: 16, step: 1 },
        (theme) => theme.ringMaxOffset,
        (ringMaxOffset) => ({ ringMaxOffset }),
      ),
    ],
  },
]

const ALL_THEME_CONTROLS = THEME_CONTROLS.flatMap((section) => section.controls)

/** Points every control at the theme the chart is actually showing. */
function syncThemeControls(example: Example): void {
  const theme = effectiveTheme(example, mode, themeState)
  for (const control of ALL_THEME_CONTROLS) control.sync(theme)
}

/**
 * The "Ring" on/off is NOT a theme token (see `Options.ring`'s docblock in
 * packages/vanilla/src/index.ts), so it goes through its own API method rather
 * than `setTheme` — same as the minimap toggle below it.
 */
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
// directly, and the common ancestor of the "chart-host" div Klad.vue/Klad.tsx
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

/**
 * A caption plus its own controls, INSIDE a panel. The rail already names the
 * panel; these name the handful of tokens within it, so "Colour" can be called
 * Colour under Connectors and Colour again under Labels without either being
 * ambiguous. Before this, Appearance was eleven differently-named sliders in
 * one flat column, and reading it meant reading all of it.
 */
function subGroup(caption: string, ...children: HTMLElement[]): HTMLDivElement {
  const section = document.createElement('div')
  section.className = 'sub-group'
  const label = document.createElement('span')
  label.className = 'sub-group-caption'
  label.textContent = caption
  const body = document.createElement('div')
  body.className = 'sub-group-body'
  body.append(...children)
  section.append(label, body)
  return section
}

const appearanceGroup = sidebarGroup(
  'Appearance',
  ...THEME_CONTROLS.map((section) =>
    subGroup(
      section.caption,
      ...section.controls.map((control) => control.element),
      // The ring's on/off is not a theme token, but it belongs beside the
      // colours that describe the ring rather than in a group of its own.
      ...(section.caption === 'Highlight' ? [ringEnabledButton] : []),
    ),
  ),
  subGroup('Canvas', canvasBgField),
)

/**
 * Whether the viewer has actually picked a background of their own. Until
 * they have, the surface keeps whatever its stylesheet resolves to, which is
 * what lets it follow a light/dark switch (and the OS preference) on its own;
 * an inline override frozen in at boot would pin the chart area to one mode's
 * colour forever after. Once they HAVE picked one, a mode switch leaves it
 * alone — it is now their choice, not a default.
 */
let canvasBgOverridden = false

function applyCanvasBg(hex: string): void {
  surface.style.backgroundColor = hex
  canvasBgValue.textContent = hex.toUpperCase()
}

canvasBgInput.oninput = () => {
  canvasBgOverridden = true
  applyCanvasBg(canvasBgInput.value)
}

/**
 * Points the background swatch at whatever the surface actually resolves to
 * right now, WITHOUT writing that value back as an inline override — see
 * `canvasBgOverridden`. Called once at boot and again after every mode switch
 * the viewer has not overridden.
 */
function seedCanvasBg(): void {
  surface.style.backgroundColor = ''
  const hex = rgbToHex(getComputedStyle(surface).backgroundColor)
  canvasBgInput.value = hex
  canvasBgValue.textContent = hex.toUpperCase()
}

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

// --- "Code" group: the chart you have dialled in, as code ---
//
// Every other panel changes what is on screen; this one reports it. The
// playground's whole premise is that you can find the options you want by
// dragging them, which is only half an answer if you then have to translate a
// sidebar back into an options object by hand.
//
// The stack shown here is INDEPENDENT of the mounted one: the options are the
// same object in all three, so seeing the React form while the Vue demo runs
// is a legitimate thing to want, and remounting a chart just to read its
// snippet would be absurd. It does follow the Demo panel's stack when that
// changes, since that is the more common intent.
let codeStack: CodeStack = 'vanilla'

const codeStackRow = document.createElement('div')
codeStackRow.className = 'code-stacks'
codeStackRow.setAttribute('role', 'tablist')

// The block and its Copy button share a wrapper so the button can sit IN the
// block's top-right corner rather than under it: a full-width button below a
// snippet reads as the panel's primary action, which it is not — the snippet
// is. This is the same place every code sample on the web puts it.
const codeFrame = document.createElement('div')
codeFrame.className = 'code-frame'
const codeBlock = document.createElement('pre')
codeBlock.className = 'code-block'
const codeText = document.createElement('code')
codeBlock.append(codeText)

const codeCopy = document.createElement('button')
codeCopy.type = 'button'
codeCopy.className = 'code-copy'
codeCopy.textContent = 'Copy'
codeCopy.title = 'Copy the snippet'
codeFrame.append(codeBlock, codeCopy)

let copyResetHandle: number | null = null
codeCopy.onclick = () => {
  // `textContent`, not `innerHTML`: the block holds highlighting markup now,
  // and what goes on the clipboard has to be the code, not the spans.
  void navigator.clipboard.writeText(codeText.textContent ?? '').then(
    () => flashCopy('Copied'),
    // A clipboard write can be refused outright (an insecure origin, a denied
    // permission). Saying so is better than a button that silently does
    // nothing — the text is selectable either way.
    () => flashCopy('Press ⌘C'),
  )
}

function flashCopy(message: string): void {
  codeCopy.textContent = message
  if (copyResetHandle !== null) clearTimeout(copyResetHandle)
  copyResetHandle = window.setTimeout(() => {
    codeCopy.textContent = 'Copy'
    copyResetHandle = null
  }, 1400)
}

const codeStackButtons = new Map<CodeStack, HTMLButtonElement>()
for (const [value, label] of [
  ['vanilla', 'Vanilla'],
  ['vue', 'Vue'],
  ['react', 'React'],
] as [CodeStack, string][]) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'code-stack'
  button.textContent = label
  button.setAttribute('role', 'tab')
  button.onclick = () => {
    codeStack = value
    syncCode()
  }
  codeStackButtons.set(value, button)
  codeStackRow.append(button)
}

const codeGroup = sidebarGroup('Code', codeStackRow, codeFrame)

/**
 * The live values of every control that ends up in the emitted options —
 * read at the moment the code is rendered rather than tracked as they change,
 * so there is exactly one place that decides what "current" means.
 */
function snapshot(): ConfigSnapshot {
  const example = findExample(exampleSelect.value)
  return {
    example,
    mode,
    minimapOn,
    minimapPosition: minimapPositionSelect.value as MinimapPosition,
    minimapSilhouette: minimapSilhouetteOverridden ? minimapSilhouetteInput.value : null,
    // The tokens the sidebar has applied, not the whole resolved theme: a
    // snippet restating every default is a worse answer than a short one, and
    // the defaults are what the reader gets for free by omitting them.
    theme: { ...themeState },
    ringEnabled,
    hasNodeContent: example.content !== 'none',
  }
}

/** Re-renders the snippet. Cheap enough to call from every control's handler. */
function syncCode(): void {
  for (const [value, button] of codeStackButtons) {
    const on = value === codeStack
    button.classList.toggle('is-on', on)
    button.setAttribute('aria-selected', String(on))
  }
  // `innerHTML` with markup this app generated and escaped itself — see
  // `highlight`, which HTML-escapes every token it emits.
  codeText.innerHTML = highlight(generateCode(codeStack, snapshot()))
}

const sidebar = document.createElement('aside')
sidebar.className = 'sidebar'

/**
 * The rail: one vertical tab per panel, down the sidebar's left edge, in the
 * shape an IDE uses for the same job. It buys two things at once — the group
 * captions stop competing with the controls for the panel's own width, and
 * only one group is open at a time, so the sidebar stops being a column you
 * scroll to find the slider you want. Clicking the open tab closes it
 * entirely, which is how you hand the whole width back to the chart.
 */
const PANELS: { id: string; label: string; body: HTMLElement }[] = [
  { id: 'demo', label: 'Demo', body: demoGroup },
  { id: 'view', label: 'View', body: viewGroup },
  { id: 'minimap', label: 'Minimap', body: minimapGroup },
  { id: 'appearance', label: 'Appearance', body: appearanceGroup },
  { id: 'export', label: 'Export', body: exportGroup },
  { id: 'code', label: 'Code', body: codeGroup },
]

const PANEL_KEY = '@klad/playground-panel'
const rail = document.createElement('div')
rail.className = 'rail'
rail.setAttribute('role', 'tablist')
rail.setAttribute('aria-orientation', 'vertical')
const sidebarBody = document.createElement('div')
sidebarBody.className = 'sidebar-body'

const railTabs = new Map<string, HTMLButtonElement>()
for (const panel of PANELS) {
  const tab = document.createElement('button')
  tab.type = 'button'
  tab.className = 'rail-tab'
  tab.setAttribute('role', 'tab')
  tab.id = `rail-tab-${panel.id}`
  // The label is turned on its side in CSS (`writing-mode`), not here: it is
  // ordinary text — selectable, searchable, readable by a screen reader —
  // that happens to be drawn rotated.
  const label = document.createElement('span')
  label.textContent = panel.label
  tab.append(label)
  tab.onclick = () => openPanel(activePanel === panel.id ? null : panel.id)
  railTabs.set(panel.id, tab)
  rail.append(tab)

  panel.body.id = `rail-panel-${panel.id}`
  panel.body.setAttribute('role', 'tabpanel')
  panel.body.setAttribute('aria-labelledby', tab.id)
  sidebarBody.append(panel.body)
}

/**
 * Arrow keys move along the rail, the way a tablist is expected to behave —
 * and the way it has to behave here, since the tabs are the only route to five
 * of the six panels. Home/End jump to the ends. Wraps, so holding one arrow
 * cycles rather than dead-ends.
 */
rail.addEventListener('keydown', (event) => {
  const order = PANELS.map((panel) => panel.id)
  const from = order.findIndex((id) => railTabs.get(id) === document.activeElement)
  if (from === -1) return
  const to =
    event.key === 'ArrowDown' || event.key === 'ArrowRight'
      ? (from + 1) % order.length
      : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
        ? (from - 1 + order.length) % order.length
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? order.length - 1
            : -1
  if (to === -1) return
  event.preventDefault()
  const tab = railTabs.get(order[to]!)!
  tab.focus()
  openPanel(order[to]!)
})

let activePanel: string | null = null

/** Opens `id`, or closes the sidebar's body entirely when `null`. */
function openPanel(id: string | null): void {
  activePanel = id
  for (const panel of PANELS) {
    const on = panel.id === id
    panel.body.hidden = !on
    const tab = railTabs.get(panel.id)!
    tab.classList.toggle('is-on', on)
    tab.setAttribute('aria-selected', String(on))
  }
  sidebar.classList.toggle('is-collapsed', id === null)
  // Code needs a wider panel than a column of sliders does: at the sidebar's
  // usual width these snippets wrap every second line, which is not something
  // anyone should have to read before pasting it.
  sidebar.classList.toggle('is-wide', id === 'code')
  try {
    localStorage.setItem(PANEL_KEY, id ?? '')
  } catch {
    // Same as the theme preference: a playground that cannot remember which
    // panel was open is fine, one that fails to start because of it is not.
  }
  // The chart's host just changed width. It has a ResizeObserver of its own,
  // so nothing needs telling — this comment exists so the next reader does not
  // go looking for the call that is missing.
  if (id === 'code') syncCode()
}

sidebar.append(rail, sidebarBody)

const description = document.createElement('div')
description.className = 'example-description'
const descriptionEyebrow = document.createElement('span')
descriptionEyebrow.className = 'example-description-eyebrow'
descriptionEyebrow.textContent = 'Example'
const descriptionText = document.createElement('p')
description.append(descriptionEyebrow, descriptionText)

// Clamped to two lines on a narrow screen and unclamped by a tap (see
// `.example-description` in style.css). The class is toggled at every width —
// it simply has nothing to do above the breakpoint, where the text is never
// clamped in the first place — and it is reset on every example change, since
// the next description is a new thing to read, not a continuation.
description.onclick = () => description.classList.toggle('is-expanded')

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
// `color-mix()` against.
seedCanvasBg()

/**
 * Switches light/dark: the document (which is what every shell colour and the
 * `<canvas>` host's own background are derived from), the mounted chart's own
 * theme (its node fill and stroke have to move WITH the cards' CSS, or the
 * canvas box shows around each card's edges — see theme.ts), and the two
 * controls whose value is a mode default rather than a viewer's choice.
 *
 * `remember` is false for a mode arriving from the OS and true for a click on
 * the toggle: only a deliberate choice pins the playground away from the
 * system preference (see theme.ts's `watchSystemTheme`).
 */
function switchMode(next: ThemeMode, remember: boolean): void {
  mode = next
  applyTheme(next)
  if (remember) rememberMode(next)
  updateThemeButton()
  currentSetMode?.(next)
  // A mode switch replaces the mode's own tokens underneath whatever the
  // sidebar applied (see `modeThemeFor`), so anything the viewer had set that
  // the mode also owns is gone — drop it from `themeState` too rather than
  // let the Code panel keep claiming a colour the chart no longer draws.
  for (const key of Object.keys(chartTokens(next)) as (keyof Theme)[]) {
    delete themeState[key]
  }
  syncThemeControls(findExample(exampleSelect.value))
  syncMinimapSilhouette()
  // The background swatch follows the mode too — unless the viewer has picked
  // one, in which case it is theirs and stays put.
  if (!canvasBgOverridden) seedCanvasBg()
  refreshCode()
}

watchSystemTheme((next) => switchMode(next, false))
// The documentation site writes the same preference key (see theme.ts), so a
// toggle over there while this page is open in another tab lands here too.
// `remember: false` — it is already stored, by whoever changed it.
watchStoredTheme((next) => {
  if (next !== mode) switchMode(next, false)
})

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
  currentSetMinimapSilhouette = null
  currentSetTheme = null
  currentSetRingEnabled = null
  currentSetMode = null
  surface.innerHTML = ''

  const example = findExample(exampleId)
  syncGotoControl(example)
  descriptionText.textContent = example.description
  description.classList.remove('is-expanded')

  // Reset every live control to whatever this example itself declares before
  // it mounts, rather than carrying over the previous example/stack's state —
  // the controls must reflect what's ACTUALLY showing. The canvas background
  // isn't part of any example's declared options (it's chrome, not data), so
  // it deliberately carries over across a stack/example switch instead.
  minimapOn = minimapDefaultOn(example)
  updateMinimapButton()
  minimapPositionSelect.value = minimapDefaultPosition(example)
  // Nothing the sidebar applied carries across a remount: the new chart is
  // mounted with the example's own theme, so `themeState` describes a chart
  // that no longer exists. Cleared first, then every control is pointed at
  // what the incoming example actually declares.
  themeState = {}
  syncThemeControls(example)
  syncMinimapSilhouette()
  ringEnabled = true
  updateRingEnabledButton()

  if (stack === 'vanilla') {
    const chart: VanillaDemoHandle = mountVanilla(surface, example, mode, (api) => {
      currentApi = api
    })
    currentSetMinimap = (on) => chart.setMinimap(on)
    currentSetMinimapPosition = (position) => chart.setMinimapPosition(position)
    currentSetMinimapSilhouette = (colour) => chart.setMinimapSilhouette(colour)
    currentSetTheme = (partial) => chart.setTheme(partial)
    currentSetRingEnabled = (enabled) => chart.setRingEnabled(enabled)
    currentSetMode = (next) => chart.setMode(next)
    teardown = () => chart.destroy()
  } else if (stack === 'vue') {
    const app = createApp(VueDemo, {
      example,
      mode,
      onReady: (api: KladApi) => {
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
      setMinimapSilhouette: (colour: string) => void
      setTheme: (partial: Partial<Theme>) => void
      setRingEnabled: (enabled: boolean) => void
      setMode: (mode: ThemeMode) => void
    }
    currentSetMinimap = (on) => instance.setMinimap(on)
    currentSetMinimapPosition = (position) => instance.setMinimapPosition(position)
    currentSetMinimapSilhouette = (colour) => instance.setMinimapSilhouette(colour)
    currentSetTheme = (partial) => instance.setTheme(partial)
    currentSetRingEnabled = (enabled) => instance.setRingEnabled(enabled)
    currentSetMode = (next) => instance.setMode(next)
    teardown = () => app.unmount()
  } else {
    const root: Root = createRoot(surface)
    const reactHandle: { current: ReactDemoHandle | null } = { current: null }
    root.render(
      createElement(ReactDemo, {
        example,
        mode,
        onReady: (api: KladApi) => {
          currentApi = api
        },
        ref: reactHandle,
      }),
    )
    currentSetMinimap = (on) => reactHandle.current?.setMinimap(on)
    currentSetMinimapPosition = (position) => reactHandle.current?.setMinimapPosition(position)
    currentSetMinimapSilhouette = (colour) => reactHandle.current?.setMinimapSilhouette(colour)
    currentSetTheme = (partial) => reactHandle.current?.setTheme(partial)
    currentSetRingEnabled = (enabled) => reactHandle.current?.setRingEnabled(enabled)
    currentSetMode = (next) => reactHandle.current?.setMode(next)
    teardown = () => root.unmount()
  }
}

function refresh(): void {
  show(stackSelect.value as Stack, exampleSelect.value)
  refreshCode()
}

// Both close the drawer on the way through: on a phone the point of picking a
// stack or an example is to LOOK at the result, which is behind the panel that
// was just used to pick it. (A no-op at any width where the sidebar is not a
// drawer — see `setControlsOpen`.)
stackSelect.onchange = () => {
  setControlsOpen(false)
  // The Code panel follows the mounted stack — you asked for React, you want
  // the React snippet — but it can still be pointed elsewhere from its own
  // tabs afterwards.
  codeStack = stackSelect.value as CodeStack
  refresh()
}
exampleSelect.onchange = () => {
  setControlsOpen(false)
  refresh()
}

/**
 * Re-renders the snippet after anything that could change it. One delegated
 * listener rather than a call in every control's own handler: the sidebar's
 * controls all bubble here, and a handler that has to remember to tell a
 * second thing about itself is a handler that eventually forgets. A no-op
 * while the Code panel is closed, which is most of the time.
 */
function refreshCode(): void {
  if (activePanel === 'code') syncCode()
}

for (const type of ['input', 'change', 'click'] as const) {
  sidebar.addEventListener(type, refreshCode)
}

// Anywhere outside the drawer dismisses it — the chart included, where the
// tap would otherwise land on a chart the drawer is covering. `pointerdown`
// rather than `click` so it closes on contact, before the gesture becomes a
// pan of the chart underneath.
content.addEventListener('pointerdown', () => setControlsOpen(false))
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setControlsOpen(false)
})

stackSelect.value = 'vanilla'
exampleSelect.value = EXAMPLES[0]!.id
refresh()

/**
 * The panel that was open last time, or Demo on a first visit — deliberately
 * not "closed", which would leave a first-time viewer looking at a rail of
 * unlabelled-looking tabs with nothing to say what they do. An empty stored
 * value means the viewer closed it on purpose, which IS restored.
 */
function initialPanel(): string | null {
  try {
    const stored = localStorage.getItem(PANEL_KEY)
    if (stored === null) return PANELS[0]!.id
    return stored === '' ? null : (PANELS.find((panel) => panel.id === stored)?.id ?? PANELS[0]!.id)
  } catch {
    return PANELS[0]!.id
  }
}

openPanel(initialPanel())
