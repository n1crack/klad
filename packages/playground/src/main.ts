import { createApp } from 'vue'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ChartView, EdgeStyle, KladApi, LayoutSettings, NodeData, Theme } from '@klad/core'
import {
  BLOCK_FILL_SEED,
  GRID_DOT_SEED,
  EDGE_RADIUS_MAX,
  EDGE_RADIUS_MIN,
  EDGE_WIDTH_MAX,
  EDGE_WIDTH_MIN,
  EDGE_WIDTH_STEP,
  effectiveTheme,
  EXAMPLES,
  departmentOf,
  rememberDepartment,
  highlightWidthFor,
  MINIMAP_POSITIONS,
  minimapDefaultOn,
  minimapDefaultPosition,
  centreControlFor,
  contentForLayout,
  defaultLayoutOf,
  LAYOUT_LABELS,
  LAYOUT_ORDER,
  LAYOUT_PRESETS,
  optionsForLayout,
  type Example,
  type LayoutName,
  type MinimapPosition,
  setWorkingSetHook,
} from './data.js'
import { closeOverflowPanel, openOverflowPanel } from './overflow-panel.js'
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

/**
 * `?embed=1` — the chart alone, no shell.
 *
 * For the documentation site's home page, which frames one example rather than
 * describing it. An iframe of the app that is already built and copied in
 * under the docs site, rather than a second copy of a showcase in the docs
 * theme: the example, its cards' CSS and its data have one implementation, and
 * whatever the playground grows the home page gets.
 *
 * Read here rather than beside the rest of the URL handling at the bottom,
 * because the shell reads it as it is being built.
 */
const EMBEDDED = new URLSearchParams(window.location.search).get('embed') === '1'
if (EMBEDDED) root.dataset.embed = ''

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
// Appended further down, next to the code toggle: on a narrow screen the two
// share a row of their own, and they have to be siblings in the right order
// for that.

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

/**
 * A picker built out of real radio inputs, laid out either as a row of
 * segments or as a list of rows.
 *
 * Radios rather than the `<select>` these used to be, and the reason is what
 * the control is FOR. A dropdown hides its options until asked and shows one
 * answer; these two are the first question the page asks, their options are
 * the point of the page, and the whole set is worth seeing at once — how many
 * examples there are IS information about this project. Real inputs rather
 * than styled buttons because a radio group already does everything expected
 * of it: arrow keys move within the group, the label is a click target, and
 * a screen reader announces "3 of 17".
 */
function radioPicker(
  name: string,
  layout: 'segmented' | 'list',
  options: { value: string; label: string }[],
  onChange: (value: string) => void,
): { element: HTMLDivElement; get value(): string; set value(next: string) } {
  const group = document.createElement('div')
  group.className = layout === 'segmented' ? 'segmented' : 'option-list'
  const inputs = new Map<string, HTMLInputElement>()

  for (const option of options) {
    const label = document.createElement('label')
    label.className = layout === 'segmented' ? 'segment' : 'option-row'
    const input = document.createElement('input')
    input.type = 'radio'
    input.name = name
    input.value = option.value
    input.className = 'visually-hidden'
    input.onchange = () => {
      if (input.checked) onChange(option.value)
    }
    const text = document.createElement('span')
    text.textContent = option.label
    label.append(input, text)
    group.append(label)
    inputs.set(option.value, input)
  }

  return {
    element: group,
    get value() {
      for (const [value, input] of inputs) if (input.checked) return value
      return options[0]?.value ?? ''
    },
    set value(next: string) {
      // Assigning `.checked` does NOT fire `change` — which is what makes this
      // usable as "reflect the state" rather than "act as if the user clicked".
      const input = inputs.get(next)
      if (input !== undefined) input.checked = true
    },
  }
}

function labelled(text: string, control: HTMLElement): HTMLDivElement {
  const field = document.createElement('div')
  field.className = 'field'
  const label = document.createElement('span')
  label.className = 'field-label'
  label.textContent = text
  field.append(label, control)
  return field
}

/**
 * Which adapter mounts the chart.
 *
 * Not on screen any more — the code drawer's tabs set it, since "show me
 * React" is one question and had grown two controls. Kept as a picker rather
 * than a bare variable because `refresh()` and the URL both read `.value`, and
 * because its radios are still what a keyboard reaches if it is ever put back.
 */
const stackSelect = radioPicker(
  'stack',
  'segmented',
  [
    { value: 'vanilla', label: 'Vanilla' },
    { value: 'vue', label: 'Vue' },
    { value: 'react', label: 'React' },
  ],
  () => {
    setControlsOpen(false)
    // The Code panel follows the mounted stack — you asked for React, you want
    // the React snippet — but it can still be pointed elsewhere from its own
    // tabs afterwards.
    codeStack = stackSelect.value as CodeStack
    refresh()
  },
)

// Driven from the same registry every stack renders, so a new example is a
// one-line addition to data.ts rather than a page change.
const exampleSelect = radioPicker(
  'example',
  'list',
  EXAMPLES.map((example) => ({ value: example.id, label: example.name })),
  (id) => {
    setControlsOpen(false)
    // Snap the layout back to the one this example is ABOUT. The picker stays
    // free afterwards — that is the point of it — but arriving at "Sunburst"
    // and being shown a tiered chart because the last example happened to be
    // tidy would be answering a question nobody asked.
    layoutSelect.value = defaultLayoutOf(findExample(id))
    refresh()
  },
)

/**
 * The shape the current example is drawn in.
 *
 * A picker rather than a per-example fixture because the library's actual
 * claim is that these are four views of the SAME tree, and a viewer can only
 * check that by switching one while the data stays put. What makes every
 * combination worth looking at is that the presentation a shape needs — node
 * size, content treatment, colour — travels with the LAYOUT rather than with
 * the example; see `LAYOUT_PRESETS` in data.ts.
 *
 * Changing it remounts the demo, which is why this is a plain picker and not
 * a live `setOptions` call: the content treatment changes with the shape, and
 * that is chosen at construction in all three adapters.
 */
const layoutSelect = radioPicker(
  'layout',
  'segmented',
  LAYOUT_ORDER.map((name) => ({ value: name, label: LAYOUT_LABELS[name] })),
  () => {
    setControlsOpen(false)
    refresh()
  },
)

const layoutBlurb = document.createElement('p')
layoutBlurb.className = 'field-note'

// --- the current layout's own knobs -----------------------------------------
//
// Every layout has a couple of numbers that decide how it reads, and they are
// different numbers per layout: a file list has an indent and a row gap, a
// wheel has a ring thickness and a ring count. So this is not one fixed set of
// sliders — it is whichever ones the CURRENT shape actually has, rebuilt when
// the shape changes.
//
// All of them go through `setLayoutOptions`, which relayouts without touching
// the tree's open state or the camera. Routing them through a remount (or
// through `update()`, which is what a caller reaches for by instinct) would
// collapse the branches the viewer had opened on every tick of a slider,
// which makes a slider useless as a way to find a value you like.

/** What the sidebar currently has each layout knob set to. Persisted across a
 * remount, so switching example or stack does not silently reset a value the
 * viewer chose — the same discipline `themeState` follows for the theme. */
const layoutState: LayoutSettings = {}

const layoutKnobFields = document.createElement('div')
layoutKnobFields.className = 'sidebar-subgroup-body'

function applyLayoutSettings(partial: LayoutSettings, fit = false): void {
  Object.assign(layoutState, partial)
  currentSetLayoutOptions?.(partial, fit)
  refreshCode()
}

/**
 * One slider bound to a layout option rather than a theme token. Its `write`
 * returns a patch so a knob can drive more than one key where that is what the
 * viewer means by one number.
 */
function layoutRange(
  labelText: string,
  id: string,
  bounds: { min: number; max: number; step: number },
  initial: number,
  write: (value: number) => LayoutSettings,
): HTMLElement {
  const input = document.createElement('input')
  input.type = 'range'
  input.id = id
  input.min = String(bounds.min)
  input.max = String(bounds.max)
  input.step = String(bounds.step)
  input.value = String(initial)
  const out = readout()
  out.setAttribute('for', id)
  out.textContent = String(initial)
  input.oninput = () => {
    out.textContent = input.value
    applyLayoutSettings(write(Number(input.value)))
  }
  // Refit when the drag ENDS, not on every tick.
  //
  // Every one of these knobs changes how big the drawing is — an indent widens
  // it, a ring thickness grows its radius — so a camera left where it was
  // eventually has the chart wandering off the edge of the viewport, which is
  // what a slider must not do. But `fit()` animates, so refitting per `input`
  // event means a 200ms camera tween restarting every few milliseconds for the
  // whole drag: the chart pulses and the value you are trying to judge is
  // never on screen still. Live geometry while dragging, one settle at the
  // end, is the pattern that lets a viewer actually see what they picked.
  input.onchange = () => applyLayoutSettings(write(Number(input.value)), true)
  const wrapper = field(labelText, input, out)
  wrapper.classList.add('field-range')
  return wrapper
}

function layoutToggle(
  labelText: string,
  initial: boolean,
  write: (on: boolean) => LayoutSettings,
): HTMLElement {
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.checked = initial
  input.onchange = () => applyLayoutSettings(write(input.checked))
  const label = document.createElement('label')
  label.className = 'field-check'
  const text = document.createElement('span')
  text.textContent = labelText
  label.append(input, text)
  return label
}

/**
 * Rebuilds the knob list for `layout`, seeded from what the chart is actually
 * showing: the layout's own preset, with anything the viewer has already
 * chosen over the top.
 */
function syncLayoutKnobs(example: Example, layout: LayoutName): void {
  layoutKnobFields.innerHTML = ''
  const preset = optionsForLayout(example, layout)
  const step = layoutState.layoutStep ?? preset.layoutStep
  const knobs: HTMLElement[] = []

  if (layout === 'file') {
    knobs.push(
      layoutRange('Indent', 'layout-indent', { min: 4, max: 48, step: 1 }, step ?? 18, (v) => ({
        layoutStep: v,
      })),
      layoutRange(
        'Row gap',
        'layout-rowgap',
        { min: 0, max: 24, step: 1 },
        layoutState.rowGap ?? preset.rowGap ?? 2,
        (v) => ({
          rowGap: v,
        }),
      ),
    )
  } else if (layout === 'radial' || layout === 'sunburst') {
    knobs.push(
      layoutRange(
        layout === 'radial' ? 'Ring spacing' : 'Ring thickness',
        'layout-ring',
        { min: 20, max: 300, step: 2 },
        step ?? 100,
        (v) => ({ layoutStep: v }),
      ),
    )
    if (layout === 'sunburst') {
      knobs.push(
        layoutRange(
          'Rings shown',
          'layout-rings',
          { min: 1, max: 8, step: 1 },
          layoutState.maxRings ?? preset.maxRings ?? 3,
          (v) => ({
            maxRings: v,
          }),
        ),
      )
    }
  } else {
    knobs.push(
      layoutRange(
        'Sibling gap',
        'layout-gapx',
        { min: 4, max: 80, step: 2 },
        layoutState.spacing?.x ?? 16,
        (v) => ({
          spacing: { ...layoutState.spacing, x: v },
        }),
      ),
      layoutRange(
        'Level gap',
        'layout-gapy',
        { min: 16, max: 200, step: 4 },
        layoutState.spacing?.y ?? 48,
        (v) => ({
          spacing: { ...layoutState.spacing, y: v },
        }),
      ),
    )
  }

  // The connector, on every layout, because `edgeStyle` is no longer part of
  // the layout — that is the whole point of it being an option. `Auto` is
  // absent from the picker's own values on purpose: it means "no override",
  // which is `undefined` rather than a style.
  //
  // `folder` is deliberately NOT offered. It is reachable by choosing the
  // file layout, and a guide line down a gutter that a tiered chart does not
  // have is the one combination the docs call a mistake rather than a taste.
  const styles = [
    { value: 'auto', label: 'Auto' },
    { value: 'tiered', label: 'Elbow' },
    { value: 'spoke', label: 'Straight' },
    { value: 'bezier', label: 'Curved' },
    { value: 'none', label: 'None' },
  ]
  const stylePicker = radioPicker(`edge-style-${layout}`, 'segmented', styles, (value) => {
    applyLayoutSettings({ edgeStyle: value === 'auto' ? undefined : (value as EdgeStyle) })
  })
  stylePicker.value = layoutState.edgeStyle ?? 'auto'
  knobs.push(labelled('Connector', stylePicker.element))

  // Branch colour is the one knob every layout has, because every tree has
  // branches. It defaults differently per layout (on for the sunburst, whose
  // segments have nothing else to carry structure), so the checkbox is seeded
  // from what the chart is actually doing rather than from a fixed `false`.
  knobs.push(
    layoutToggle(
      'Colour by branch',
      layoutState.colourBranches ?? preset.colourBranches ?? layout === 'sunburst',
      (on) => ({
        colourBranches: on,
      }),
    ),
  )

  layoutKnobFields.append(...knobs)
}

// Stack is NOT in here. It is a once-per-visit choice — which adapter you are
// reading — and it used to sit above a list of two dozen examples that people
// use constantly, pushing the thing they came for down the panel. Worse, it
// only existed inside this panel, so changing adapter from View or Appearance
// meant navigating back. It lives in the header now, where it is reachable
// from anywhere and out of the way of the list.
const demoGroup = sidebarGroup('Demo', labelled('Example', exampleSelect.element))

// --- "View" group: camera + tree-shape controls, shared by every mounted chart ---

let currentApi: KladApi | null = null

/**
 * The same commands the keyboard has, as buttons — and then the keys
 * themselves, listed.
 *
 * The list is here because the feature is invisible otherwise: the chart takes
 * focus and answers to arrows, but nothing on screen says so, and the first
 * person to try it in this playground reported the keys as broken rather than
 * as undiscovered. A control panel is the one place a reader is already
 * looking for "what can I do".
 */
function keyHint(keys: string, what: string): HTMLDivElement {
  const row = document.createElement('div')
  row.className = 'key-hint'
  const combo = document.createElement('span')
  combo.className = 'key-combo'
  for (const key of keys.split(' ')) {
    const kbd = document.createElement('kbd')
    kbd.textContent = key
    combo.append(kbd)
  }
  const label = document.createElement('span')
  label.className = 'key-what'
  label.textContent = what
  row.append(combo, label)
  return row
}

const viewGroup = sidebarGroup(
  'View',
  // The shape of the tree belongs here rather than under Demo. Demo is "which
  // example, in which framework" — a fixed pair of pickers. Layout is
  // something a viewer changes WHILE looking at a chart, alongside zoom and
  // expand/collapse, and its knobs are the same kind of control as the ones
  // below them.
  subGroup('Layout', layoutSelect.element, layoutBlurb, layoutKnobFields),
  sidebarButton('Zoom In', () => currentApi?.zoomIn()),
  sidebarButton('Zoom Out', () => currentApi?.zoomOut()),
  sidebarButton('Fit', () => currentApi?.fit()),
  sidebarButton('Expand All', () => currentApi?.expandAll()),
  sidebarButton('Collapse All', () => currentApi?.collapseAll()),
  subGroup(
    'Keys',
    keyHint('← ↑ → ↓', 'Pan — hold Shift to stride'),
    keyHint('+ −', 'Zoom'),
    keyHint('F', 'Fit'),
    keyHint('0', 'Opening view'),
    keyHint('Home', 'Centre the root'),
    keyHint('Esc', 'Clear the highlight'),
  ),
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
/** The mounted chart's live layout tuning — see `KladApi.setLayoutOptions`. */
let currentSetLayoutOptions: ((settings: LayoutSettings, fit: boolean) => void) | null = null
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

/** A checkbox for one of the theme's boolean tokens. */
function switchControl(
  labelText: string,
  id: string,
  read: (theme: Theme) => boolean,
  write: (on: boolean) => Partial<Theme>,
): ThemeControl {
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.id = id
  input.className = 'checkbox-input'
  input.onchange = () => {
    applyThemeTokens(write(input.checked))
  }
  const wrapper = document.createElement('div')
  wrapper.className = 'field'
  const label = document.createElement('label')
  label.textContent = labelText
  label.htmlFor = id
  const row = document.createElement('div')
  row.className = 'field-range-row'
  row.append(input)
  wrapper.append(label, row)
  return {
    element: wrapper,
    sync(theme) {
      input.checked = read(theme)
    },
  }
}

/**
 * A colour token whose "off" is the word `'transparent'` rather than a colour:
 * a checkbox for whether to paint at all, plus the swatch it gates. `<input
 * type="color">` cannot represent "none", and the two tokens shaped like this
 * — the block tier's fill and the grid — both default to off, so the control
 * has to be able to say so.
 *
 * The swatch stays live while unchecked, which pre-arms a colour for the
 * moment the box is ticked.
 */
function optionalColourControl(
  labelText: string,
  id: string,
  seed: string,
  offLabel: string,
  read: (theme: Theme) => string,
  write: (value: string) => Partial<Theme>,
): ThemeControl {
  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'
  checkbox.id = `${id}-checkbox`
  checkbox.className = 'checkbox-input'
  const input = document.createElement('input')
  input.type = 'color'
  input.id = id
  input.className = 'color-input'
  input.value = seed
  const out = readout()
  out.setAttribute('for', id)

  const apply = (): void => {
    const value = checkbox.checked ? input.value : 'transparent'
    out.textContent = checkbox.checked ? value.toUpperCase() : offLabel
    applyThemeTokens(write(value))
  }
  checkbox.onchange = apply
  input.oninput = apply

  const wrapper = document.createElement('div')
  wrapper.className = 'field'
  const label = document.createElement('label')
  label.textContent = labelText
  label.htmlFor = checkbox.id
  const row = document.createElement('div')
  row.className = 'field-range-row'
  row.append(checkbox, input, out)
  wrapper.append(label, row)

  return {
    element: wrapper,
    sync(theme) {
      const value = read(theme)
      // An example may set the token to something no swatch can show — a
      // translucent `rgba()` for the grid. The tick still reflects the truth;
      // only the swatch keeps its own last value.
      const on = value !== 'transparent'
      checkbox.checked = on
      if (/^#[0-9a-f]{6}$/i.test(value)) input.value = value
      out.textContent = on ? value.toUpperCase() : offLabel
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
  return optionalColourControl(
    'Shape fill',
    'block-fill-input',
    BLOCK_FILL_SEED,
    'Transparent',
    (theme) => theme.blockFill,
    (blockFill) => ({ blockFill }),
  )
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
      colourControl(
        'Fill',
        'node-fill-input',
        (theme) => theme.nodeFill,
        (nodeFill) => ({ nodeFill }),
      ),
      colourControl(
        'Border',
        'node-stroke-input',
        (theme) => theme.nodeStroke,
        (nodeStroke) => ({ nodeStroke }),
      ),
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
      // Inert unless the example colours its branches at all, like the flow
      // tokens below — and in the same way worth having beside the fill it
      // overrides rather than in a section of its own.
      switchControl(
        'Branch colours',
        'node-branch-colours',
        (theme) => theme.nodeBranchColours,
        (nodeBranchColours) => ({ nodeBranchColours }),
      ),
      switchControl(
        'More-inside mark',
        'hidden-mark',
        (theme) => theme.hiddenMark,
        (hiddenMark) => ({ hiddenMark }),
      ),
    ],
  },
  {
    caption: 'Connectors',
    controls: [
      colourControl(
        'Colour',
        'edge-stroke-input',
        (theme) => theme.edgeStroke,
        (edgeStroke) => ({ edgeStroke }),
      ),
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
      switchControl(
        'Branch colours',
        'edge-branch-colours',
        (theme) => theme.edgeBranchColours,
        (edgeBranchColours) => ({ edgeBranchColours }),
      ),
      // The flow tokens sit with the other connector tokens rather than in a
      // group of their own: they do nothing at all unless an example marks
      // some edges, and a section that is inert on every screen but one reads
      // as broken rather than as conditional.
      colourControl(
        'Flow colour',
        'edge-flow-colour',
        (theme) => theme.edgeFlowStroke,
        (edgeFlowStroke) => ({ edgeFlowStroke }),
      ),
      rangeControl(
        'Flow speed',
        'edge-flow-speed',
        { min: 0, max: 120, step: 4 },
        (theme) => theme.edgeFlowSpeed,
        // Zero is a legitimate setting and not a broken one: a dashed line
        // standing still is what a reduced-motion reader should get.
        (edgeFlowSpeed) => ({ edgeFlowSpeed }),
      ),
    ],
  },
  {
    caption: 'Labels',
    controls: [
      colourControl(
        'Colour',
        'label-colour-input',
        (theme) => theme.labelColour,
        (labelColour) => ({ labelColour }),
      ),
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
      colourControl(
        'Accent',
        'accent-input',
        (theme) => theme.ringStroke,
        (accent) => ({
          ringStroke: accent,
          edgeHighlightStroke: accent,
          highlightStroke: accent,
        }),
      ),
      colourControl(
        'Lit fill',
        'highlight-fill-input',
        (theme) => theme.highlightFill,
        (highlightFill) => ({
          highlightFill,
        }),
      ),
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
      rangeControl(
        'Route glow',
        'edge-glow-range',
        { min: 0, max: 16, step: 1 },
        (theme) => theme.edgeHighlightGlow,
        (edgeHighlightGlow) => ({ edgeHighlightGlow }),
      ),
      switchControl(
        'Recolour route',
        'edge-highlight-recolours',
        (theme) => theme.edgeHighlightRecolours,
        (edgeHighlightRecolours) => ({ edgeHighlightRecolours }),
      ),
    ],
  },
  {
    caption: 'Grid',
    controls: [
      optionalColourControl(
        'Dots',
        'grid-dot-input',
        GRID_DOT_SEED,
        'None',
        (theme) => theme.gridDot,
        (gridDot) => ({ gridDot }),
      ),
      rangeControl(
        'Spacing',
        'grid-spacing-range',
        { min: 8, max: 96, step: 2 },
        (theme) => theme.gridSpacing,
        (gridSpacing) => ({ gridSpacing }),
      ),
      rangeControl(
        'Dot size',
        'grid-dot-size-range',
        { min: 0.5, max: 4, step: 0.5 },
        (theme) => theme.gridDotSize,
        (gridDotSize) => ({ gridDotSize }),
      ),
    ],
  },
]

const ALL_THEME_CONTROLS = THEME_CONTROLS.flatMap((section) => section.controls)

/** Points every control at the theme the chart is actually showing. */
function syncThemeControls(example: Example): void {
  const theme = effectiveTheme(example, layoutSelect.value as LayoutName, mode, themeState)
  for (const control of ALL_THEME_CONTROLS) control.sync(theme)
}

/**
 * The "Ring" on/off is NOT a theme token (see `Options.ring`'s docblock in
 * packages/core/src/index.ts), so it goes through its own API method rather
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

// The canvas itself only ever `clearRect`s (see packages/engine/src/render/canvas2d.ts)
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

/**
 * "Grows" — the four directions, with the RTL switch beside them.
 *
 * Two controls rather than one eight-way picker, because the engine treats
 * them as independent axes and a viewer who cannot vary them separately
 * cannot discover that. `applyOrientation` turns the growth axis for
 * `orientation` and mirrors sibling order for `rtl`, and the two flips never
 * share an axis — so `lr + rtl` is NOT the arrangement `rl` gives you. The
 * two frozen examples this replaces (one at `lr`, one at `tb + rtl`) showed
 * two of the eight and said nothing at all about the rule joining them.
 *
 * Live rather than a remount: `setLayoutOptions` keeps every node's open
 * state and the camera, so turning the tree is turning the tree you were
 * reading, not being handed a fresh one. It asks for a fit, since all four
 * directions change which way the drawing is long.
 */
const orientationPicker = radioPicker(
  'orientation',
  'segmented',
  [
    { value: 'tb', label: 'Down' },
    { value: 'bt', label: 'Up' },
    { value: 'lr', label: 'Right' },
    { value: 'rl', label: 'Left' },
  ],
  (value) => {
    applyLayoutSettings({ orientation: value as NonNullable<LayoutSettings['orientation']> }, true)
  },
)

const rtlButton = document.createElement('button')
rtlButton.type = 'button'
rtlButton.className = 'btn btn-toggle'

let rtlOn = false

/**
 * Sets the RTL switch. `apply` is false when the panel is merely catching up
 * with an example that was just mounted — reflecting state must not look like
 * the viewer flipped it, or every example change would fire a relayout and a
 * fit for a value that did not change.
 */
function setRtl(next: boolean, apply: boolean): void {
  rtlOn = next
  rtlButton.textContent = `RTL: ${rtlOn ? 'On' : 'Off'}`
  rtlButton.setAttribute('aria-pressed', String(rtlOn))
  if (apply) applyLayoutSettings({ rtl: rtlOn }, true)
}

rtlButton.onclick = () => setRtl(!rtlOn, true)

const orientationNote = document.createElement('span')
orientationNote.className = 'panel-note'

// Retitled rather than fixed: with the directions gone the panel is no longer
// about which way the tree GROWS, and a caption left saying "Grows" over a
// lone RTL switch describes the one thing that switch does not do.
const orientationLabel = document.createElement('label')

const orientationField = document.createElement('div')
orientationField.className = 'surface-panel surface-panel-stacked'

// Same reason as every other panel that sits on the canvas: the surface claims
// pointer and wheel gestures for panning and zooming.
for (const type of ['pointerdown', 'wheel'] as const) {
  orientationField.addEventListener(type, (event) => event.stopPropagation())
}

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
/**
 * "Go to node", as a button that opens the searchable list rather than a
 * `<select>` with one option per node.
 *
 * The select was fine on the twenty-eight-node example it was written for and
 * hopeless past that: nine thousand `<option>` elements built on every mount,
 * and on a phone a native picker nobody can scroll to the end of. The panel
 * builds only the rows in view and can be searched, which is what you wanted
 * from it anyway.
 */
const gotoSelect = document.createElement('button')
gotoSelect.type = 'button'
gotoSelect.className = 'btn'
gotoSelect.textContent = 'Pick a node…'
const gotoLabel = document.createElement('label')
gotoLabel.textContent = 'Go to node'
const gotoField = document.createElement('div')
gotoField.className = 'surface-panel'
gotoField.append(gotoLabel, gotoSelect)

// The surface is the chart's own host: a pointer landing here would otherwise
// bubble into it and start a pan, and a wheel would zoom the chart while the
// menu is open. The select's own gestures stop at the panel.
for (const type of ['pointerdown', 'wheel'] as const) {
  gotoField.addEventListener(type, (event) => event.stopPropagation())
}

/** Every node of the current example — a list of `{ id, label }`, never DOM.
 * Built once per mount. */
let gotoItems: { id: string; label: string }[] = []

gotoSelect.onclick = () => {
  openOverflowPanel({
    anchor: gotoSelect,
    items: gotoItems,
    mode: 'pick',
    onPick: (id) => {
      // `pathTo` is the root-to-node chain, which is exactly what `highlight`
      // wants; an edge is painted when both its endpoints are lit, so this
      // lights the way and not merely its ends. `focus` opens every collapsed
      // ancestor before centring, so this works from the fully closed chart
      // the example starts as.
      currentApi?.highlight(currentApi.pathTo(id))
      currentApi?.focus(id, { ring: true })
    },
  })
}

/**
 * "Branch and view" — the panel for the example about `fitSubtree` and
 * `getView`/`setView`.
 *
 * On the canvas rather than in the sidebar for the same reason the go-to combo
 * box is: it belongs to ONE example, and a control that means nothing on the
 * other fifteen reads as broken. It also sits next to what it acts on.
 */
const branchSelect = document.createElement('select')
branchSelect.id = 'branch-select'
branchSelect.className = 'select'
const branchLabel = document.createElement('label')
branchLabel.textContent = 'Frame branch'
branchLabel.htmlFor = 'branch-select'

/**
 * The last saved view, and the only state this panel keeps. In a real app this
 * is the thing you would put in a URL — it is a plain object of ids and
 * numbers, which is the whole point of it (see `getView`).
 */
let savedView: ChartView | null = null

const saveViewButton = document.createElement('button')
saveViewButton.type = 'button'
saveViewButton.className = 'btn'
saveViewButton.textContent = 'Save view'

const restoreViewButton = document.createElement('button')
restoreViewButton.type = 'button'
restoreViewButton.className = 'btn'
restoreViewButton.textContent = 'Restore'

const viewNote = document.createElement('span')
viewNote.className = 'panel-note'

function updateViewButtons(): void {
  restoreViewButton.disabled = savedView === null
  viewNote.textContent =
    savedView === null
      ? 'Nothing saved yet'
      : `${savedView.open.length} open · zoom ${savedView.camera.k.toFixed(2)}`
}

branchSelect.onchange = () => {
  const id = branchSelect.value
  if (id === '') return
  // Frames the branch and lights it, so it is obvious WHICH branch was framed
  // once the camera stops — at a tight zoom the surrounding chart is off
  // screen and there is otherwise nothing to compare against.
  currentApi?.highlight(currentApi.pathTo(id))
  currentApi?.fitSubtree(id)
  updateTrail()
}

saveViewButton.onclick = () => {
  const view = currentApi?.getView()
  if (view === undefined) return
  // Round-tripped through JSON deliberately: this is what a URL or a database
  // column would do to it, and doing it here means the demo cannot
  // accidentally rely on anything that would not survive the trip.
  savedView = JSON.parse(JSON.stringify(view)) as ChartView
  updateViewButtons()
}

restoreViewButton.onclick = () => {
  if (savedView === null) return
  // Animated because this is a move WITHIN a session: the viewer remembers
  // where they were, and the flight is what tells them they went back rather
  // than that something jumped.
  currentApi?.setView(savedView, { animate: true })
  // A saved view carries the isolated branch with it (see `ChartView`), so
  // restoring one can isolate — or un-isolate — the chart just as the Isolate
  // button does. The trail is this panel's own state, drawn from
  // `getState().isolated`, and nothing recomputes it on its own: without this
  // a view saved while isolated came back with the branch isolated and no way
  // out of it drawn, which is precisely the "an isolated branch looks like a
  // small chart rather than part of a big one" this panel exists to answer.
  // `setView` applies the isolation synchronously, so the state is already
  // right by the time this reads it.
  branchSelect.value = ''
  updateTrail()
}

/**
 * Isolation, and the breadcrumb back out of it.
 *
 * The library deliberately does not draw a breadcrumb — `pathTo(id)` returns
 * the chain from the real root and where to put it is a host's question. This
 * is that answer, and it is also the demonstration: without a trail, an
 * isolated branch looks like a small chart rather than part of a big one.
 */
const isolateButton = document.createElement('button')
isolateButton.type = 'button'
isolateButton.className = 'btn'
isolateButton.textContent = 'Isolate'

const trail = document.createElement('div')
trail.className = 'panel-trail'

function updateTrail(): void {
  const isolated = currentApi?.getState().isolated ?? null
  trail.innerHTML = ''
  isolateButton.disabled = branchSelect.value === '' && isolated === null
  if (isolated === null) {
    trail.hidden = true
    return
  }
  trail.hidden = false
  const path = currentApi?.pathTo(isolated) ?? [isolated]
  path.forEach((id, i) => {
    if (i > 0) {
      const sep = document.createElement('span')
      sep.className = 'panel-trail-sep'
      sep.textContent = '/'
      trail.append(sep)
    }
    const crumb = document.createElement('button')
    crumb.type = 'button'
    crumb.className = 'panel-crumb'
    const item = example().data.find((node) => node.id === id)
    crumb.textContent = String(item?.name ?? id)
    // Every crumb is a place you can go: the last one is where you are, the
    // rest re-isolate higher up — which is what makes the trail a way out
    // rather than a label.
    crumb.onclick = () => {
      currentApi?.isolate(i === 0 ? null : id)
      branchSelect.value = ''
      updateTrail()
    }
    trail.append(crumb)
  })
}

isolateButton.onclick = () => {
  const id = branchSelect.value
  if (id === '') {
    currentApi?.isolate(null)
  } else {
    currentApi?.isolate(id)
    currentApi?.highlight(null)
  }
  updateTrail()
}

function example(): Example {
  return findExample(exampleSelect.value)
}

const viewButtons = document.createElement('div')
viewButtons.className = 'panel-row'
viewButtons.append(isolateButton, saveViewButton, restoreViewButton, viewNote)

const viewField = document.createElement('div')
viewField.className = 'surface-panel surface-panel-stacked'
viewField.append(branchLabel, branchSelect, viewButtons, trail)

for (const type of ['pointerdown', 'wheel'] as const) {
  viewField.addEventListener(type, (event) => event.stopPropagation())
}

/**
 * The selection panel: what is picked right now, and the two commands an app
 * would build on a selection.
 *
 * It exists because a selection you cannot see reported anywhere is just an
 * outline. The point of the API is that the page around the chart does
 * something with it — this panel is the smallest honest version of that.
 */
const selectionCount = document.createElement('span')
selectionCount.className = 'panel-note'

const selectionNames = document.createElement('div')
selectionNames.className = 'panel-names'

const selectAllButton = document.createElement('button')
selectAllButton.type = 'button'
selectAllButton.className = 'btn'
selectAllButton.textContent = 'Select all'

const clearSelectionButton = document.createElement('button')
clearSelectionButton.type = 'button'
clearSelectionButton.className = 'btn'
clearSelectionButton.textContent = 'Clear'

const selectionHint = document.createElement('div')
selectionHint.className = 'panel-hint'
selectionHint.textContent = 'Click · ⌘/Ctrl-click · Shift-drag box · Alt-drag lasso · Esc'

function syncSelectionPanel(): void {
  const ids = currentApi?.getSelection() ?? []
  clearSelectionButton.disabled = ids.length === 0
  selectionCount.textContent = ids.length === 0 ? 'Nothing selected' : `${ids.length} selected`
  const example = findExample(exampleSelect.value)
  // The first few names, then a count: a panel that grows with the selection
  // would push the chart off the screen exactly when the selection got
  // interesting.
  const named = ids.slice(0, 4).map((id) => String(example.data.find((item) => item.id === id)?.name ?? id))
  selectionNames.textContent =
    ids.length > 4 ? `${named.join(', ')} +${ids.length - 4} more` : named.join(', ')
}

selectAllButton.onclick = () => {
  // `search` with a predicate that takes everything is the API's own way of
  // asking for every node — there is no separate "give me all the ids".
  const all = currentApi?.search(() => true).map((result) => result.id) ?? []
  currentApi?.select(all)
  syncSelectionPanel()
}

clearSelectionButton.onclick = () => {
  currentApi?.select(null)
  syncSelectionPanel()
}

const selectionButtons = document.createElement('div')
selectionButtons.className = 'panel-row'
selectionButtons.append(selectAllButton, clearSelectionButton, selectionCount)

const selectionField = document.createElement('div')
selectionField.className = 'surface-panel surface-panel-stacked'
selectionField.append(selectionHint, selectionButtons, selectionNames)

for (const type of ['pointerdown', 'wheel'] as const) {
  selectionField.addEventListener(type, (event) => event.stopPropagation())
}

/**
 * Re-reads the selection after the gestures that can change it, over the next
 * few frames rather than once.
 *
 * A click does not select synchronously: the chart hit-tests the point first,
 * and that is a round trip to the worker. Reading on `pointerup` alone gets
 * the selection as it was BEFORE the click that just happened — which is
 * exactly what this panel did at first, reporting "nothing selected" while a
 * card sat outlined on screen.
 *
 * Three frames is not a guess about worker latency so much as a cheap way to
 * be right either way: the sync is a string compare and a `textContent`
 * write, and it stops as soon as the value settles.
 */
const syncSelectionSoon = (): void => {
  let frames = 3
  const step = (): void => {
    syncSelectionPanel()
    if (--frames > 0) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

/**
 * The sunburst's breadcrumb: the trail from the root to whatever is at the
 * centre of the wheel, each step clickable.
 *
 * A drill-down without one is a chart you can get lost in. The wheel shows the
 * three rings below wherever you are and nothing above it, so once you are two
 * levels in there is no on-screen evidence of what you drilled through — and
 * "click the middle to go up" only tells you how to take one step back, not
 * how far back there is to go. The trail is the missing half of the
 * navigation, and clicking a step jumps straight there with the same animation
 * a click on the wheel gives.
 */
const centreTrail = document.createElement('div')
centreTrail.className = 'centre-trail'

const centreField = document.createElement('div')
centreField.className = 'surface-panel surface-panel-trail'
centreField.append(centreTrail)

for (const type of ['pointerdown', 'wheel'] as const) {
  centreField.addEventListener(type, (event) => event.stopPropagation())
}

/** Renders the root-to-`centreId` trail. `null` means the root itself. */
function renderCentreTrail(example: Example, centreId: string | null): void {
  const byId = new Map(example.data.map((item) => [String(item.id), item]))
  const rootId = example.data[0] === undefined ? null : String(example.data[0].id)
  const path: string[] = []
  let cursor = centreId ?? rootId
  while (cursor !== null && byId.has(cursor)) {
    path.unshift(cursor)
    const parent = byId.get(cursor)!.parentId
    cursor = parent === undefined || parent === null ? null : String(parent)
  }

  centreTrail.innerHTML = ''
  path.forEach((id, index) => {
    if (index > 0) {
      const sep = document.createElement('span')
      sep.className = 'centre-sep'
      sep.textContent = '/'
      centreTrail.append(sep)
    }
    const step = document.createElement('button')
    step.type = 'button'
    step.className = 'centre-step'
    step.textContent = String(byId.get(id)!.name ?? id)
    // The last step IS the centre — a button that would navigate to where you
    // already are is a dead control, so it is marked as the current position
    // instead.
    const isCurrent = index === path.length - 1
    step.classList.toggle('is-current', isCurrent)
    step.disabled = isCurrent
    step.onclick = () => {
      currentApi?.setCentre(index === 0 ? null : id)
      renderCentreTrail(example, index === 0 ? null : id)
    }
    centreTrail.append(step)
  })
}

/** The example the breadcrumb is currently describing — it needs the data to
 * walk parent links, and only the example that owns the trail has it. */
let centreExample: Example | null = null

/** Called by whichever demo is mounted when a drill lands. */
function reportCentre(id: string | null): void {
  if (centreExample !== null) renderCentreTrail(centreExample, id)
}

/** Shows the breadcrumb when the current LAYOUT is one that has a centre. */
function syncCentreControl(example: Example, layout: LayoutName): void {
  centreField.remove()
  centreExample = null
  if (!centreControlFor(layout)) return
  centreExample = example
  surface.append(centreField)
  renderCentreTrail(example, example.options.centre ?? null)
}

/**
 * What the last drop actually moved. A drag whose result is only visible as
 * "the tree looks different now" is hard to check; an app would be sending
 * this to a server, so the demo shows exactly what it would send.
 */
const dropLog = document.createElement('div')
dropLog.className = 'panel-note'
dropLog.textContent = 'Drag a card onto another.'

const dropField = document.createElement('div')
dropField.className = 'surface-panel surface-panel-trail'
dropField.append(dropLog)

for (const type of ['pointerdown', 'wheel'] as const) {
  dropField.addEventListener(type, (event) => event.stopPropagation())
}

function syncDropControl(example: Example): void {
  dropField.remove()
  if (example.dropControl !== true) return
  dropLog.textContent = 'Drag a card onto another.'
  surface.append(dropField)
}

/** Called by the demo when a drop lands — see `playground:drop`. */
function reportDrop(detail: { ids: string[]; parentId: string | null; mode: string }): void {
  // A drag is an edit like any other, so the Edit panel's buttons have to
  // notice one even though nothing in that panel was clicked.
  if (editField.isConnected) syncEditState()
  if (!dropField.isConnected) return
  const what = detail.ids.length === 1 ? detail.ids[0]! : `${detail.ids.length} nodes`
  dropLog.textContent =
    detail.mode === 'into'
      ? `${what} → into ${detail.parentId ?? 'the root'}`
      : `${what} → ${detail.mode} a sibling, under ${detail.parentId ?? 'the root'}`
}

/**
 * The editing panel.
 *
 * Buttons rather than prose, because `move`/`add`/`remove` and `reconcile`
 * are all things you have to WATCH: the rule refusing under the pointer, and
 * a poll arriving without folding up what you had opened.
 */
const editLog = document.createElement('div')
editLog.className = 'panel-note'

/** Rows added by this panel, so "A poll arrives" can send them back and they
 * do not vanish the moment the server speaks. */
let editAdded: NodeData[] = []
let editRemoved = new Set<string>()
let editHires = 0

const editAdd = sidebarButton('Add a report', () => {
  const api = currentApi
  if (api === null) return
  // No quiet default. "Add a report" is a report to SOMEBODY, and picking the
  // root on their behalf makes the button do something they did not ask for
  // in the one case where it is least obvious what it did.
  const under = api.getState().selected[0]
  if (under === undefined) {
    editLog.textContent = 'Click somebody first — the new person reports to them.'
    return
  }
  const department = departmentOf(under)
  if (department === null) {
    editLog.textContent = `No department on ${under}, so the rule could not answer for a new report.`
    return
  }
  editHires++
  const row = {
    id: `hire-${editHires}`,
    parentId: under,
    name: `New Hire ${editHires}`,
    title: 'Associate',
    department,
  }
  // Filed under the same department as the person they report to, or the rule
  // above would refuse to let anyone move them anywhere.
  rememberDepartment(row.id, department)
  editAdded.push(row)
  editLog.textContent = api.add(row, under)
    ? `Added ${row.name} under ${under}.`
    : `Refused — ${under} already has a ${row.id}?`
  syncEditState()
})

const editRemove = sidebarButton('Remove', () => {
  const api = currentApi
  if (api === null) return
  const selected = api.getState().selected
  if (selected.length === 0) {
    editLog.textContent = 'Click somebody first.'
    return
  }
  const gone = api.remove(selected)
  if (gone) for (const id of selected) editRemoved.add(id)
  editLog.textContent = gone
    ? `Removed ${selected.length === 1 ? selected[0]! : `${selected.length} people`}, and everyone under them.`
    : 'Refused.'
  syncEditState()
})

/** Reflects what the chart says about its own history, so the buttons cannot
 * claim something the API would refuse. */
function syncEditState(): void {
  const api = currentApi
  if (api === null) return
  editUndo.disabled = !api.canUndo()
  editRedo.disabled = !api.canRedo()
  editSave.disabled = !api.isDirty()
  const pending = api.changes().length
  // What the button will DO, and how much of it — "Saved" read as a state and
  // left you wondering what the number beside it had meant.
  editSave.textContent = api.isDirty()
    ? `Send ${pending} change${pending === 1 ? '' : 's'}`
    : 'Nothing to send'
}

const editUndo = sidebarButton('Undo', () => {
  currentApi?.undo()
  syncEditState()
})

const editRedo = sidebarButton('Redo', () => {
  currentApi?.redo()
  syncEditState()
})

const editSave = sidebarButton('Nothing to send', () => {
  const api = currentApi
  if (api === null) return
  // What an app would PATCH. Shown rather than sent, since there is nothing
  // here to send it to — and what it would send is the interesting part.
  const changes = api.changes()
  editLog.textContent =
    changes.length === 0
      ? 'Nothing to send.'
      : `A real app would send this: ${changes.map((change) => `${change.op} ${'ids' in change ? change.ids.join(', ') : change.items.map((item) => String(item.id)).join(', ')}`).join(' · ')}`
  api.markSaved()
  syncEditState()
})

const editPoll = sidebarButton('New data from the server', () => {
  const api = currentApi
  if (api === null) return
  // What a server would send: the tree as IT sees it. Deliberately built from
  // the example's own array rather than from `getData()`, so it genuinely is
  // an outside statement — including one row this page never saw.
  const rows = (EXAMPLES.find((e) => e.id === 'editing')?.data ?? [])
    .filter((item) => !editRemoved.has(String(item.id)))
    .map((item) => ({ ...item }))
  const anchor = rows[3]
  if (anchor !== undefined) {
    const department = departmentOf(String(anchor.id))
    if (department !== null) {
      const id = 'from-the-server'
      rememberDepartment(id, department)
      if (!rows.some((item) => item.id === id)) {
        rows.push({ id, parentId: String(anchor.id), name: 'Arrived', title: 'Transfer', department })
      }
    }
  }
  api.reconcile([...rows, ...editAdded.filter((item) => !editRemoved.has(String(item.id)))])
  editLog.textContent = 'The tree changed. What you had open, and where you were looking, did not.'
  // Fresh data clears the history — see `reconcile`.
  syncEditState()
})

const editField = document.createElement('div')
editField.className = 'surface-panel'
editField.append(
  Object.assign(document.createElement('label'), { textContent: 'Edit' }),
  editAdd,
  editRemove,
  editUndo,
  editRedo,
  editSave,
  editPoll,
  editLog,
)

for (const type of ['pointerdown', 'wheel'] as const) {
  editField.addEventListener(type, (event) => event.stopPropagation())
}

function syncEditControl(example: Example): void {
  editField.remove()
  if (example.editControl !== true) return
  editAdded = []
  editRemoved = new Set()
  editHires = 0
  editLog.textContent = 'Drag between departments to see the rule refuse.'
  surface.append(editField)
  syncEditState()
}

/**
 * The filter box.
 *
 * A text input and a count, because that is the whole of the feature from the
 * outside: type, and the chart becomes the matches plus the ancestors that
 * lead to them. The count is what makes "nothing matched" different from
 * "something is broken".
 */
const filterInput = document.createElement('input')
filterInput.type = 'search'
filterInput.className = 'select'
filterInput.placeholder = 'Filter by name…'
filterInput.setAttribute('aria-label', 'Filter the chart')

const filterCount = document.createElement('span')
filterCount.className = 'panel-note'

/**
 * The find bar, beside the filter box on purpose.
 *
 * They are the two answers to "where is Rossi" and the difference between them
 * is easiest to see side by side: the filter REDUCES the chart to the matches
 * and the way to each, while find leaves every node where it is and walks you
 * to them one at a time. Reading that in prose is not the same as pressing
 * both.
 */
const findInput = document.createElement('input')
findInput.type = 'search'
findInput.className = 'select'
findInput.placeholder = 'Find by name…'
findInput.setAttribute('aria-label', 'Find nodes without changing the chart')

const findCount = document.createElement('span')
findCount.className = 'panel-note'

const findPrev = sidebarButton('‹ Prev', () => stepFind(-1))
const findNext = sidebarButton('Next ›', () => stepFind(1))

/** Which hit we are on, purely so the panel can say "3 of 12". */
let findAt = 0
let findTotal = 0

/**
 * Steps the cursor and reports where it is.
 *
 * Just "3 of 12", deliberately. It used to add "the chart still has every
 * node" — which is find's whole point, and a claim the FILTER box beside it
 * can make false the moment somebody types in both. A panel should not assert
 * something the panel next to it can falsify.
 */
function stepFind(delta: 1 | -1): void {
  const api = currentApi
  if (api === null || findTotal === 0) return
  const result = delta === 1 ? api.findNext() : api.findPrevious()
  if (result === null) {
    findCount.textContent = 'Gone — search again.'
    findTotal = 0
    return
  }
  findAt = ((findAt + delta - 1 + findTotal) % findTotal) + 1
  findCount.textContent = `${findAt} of ${findTotal}`
}

findInput.oninput = () => {
  const api = currentApi
  if (api === null) return
  const query = findInput.value.trim()
  if (query === '') {
    findTotal = 0
    api.highlight(null)
    findCount.textContent = 'Type a name — find changes nothing.'
    return
  }
  const all = api.search(query)
  findTotal = all.length
  findAt = 0
  // Every hit lit, and `findNext` takes the camera to them in turn.
  api.highlight(all.length === 0 ? null : all.map((result) => result.id))
  if (all.length === 0) {
    findCount.textContent = 'Nothing matched.'
    return
  }
  api.findNext(query)
  findAt = 1
  findCount.textContent = `1 of ${findTotal}`
}

const filterField = document.createElement('div')
filterField.className = 'surface-panel'
filterField.append(
  Object.assign(document.createElement('label'), { textContent: 'Filter' }),
  filterInput,
  filterCount,
  Object.assign(document.createElement('label'), { textContent: 'Find' }),
  findInput,
  findPrev,
  findNext,
  findCount,
)

// The panel sits over the canvas, which claims pointer and wheel gestures for
// panning and zooming — see input.ts. Without this, typing in the box is fine
// but scrolling over it moves the chart underneath.
for (const type of ['pointerdown', 'wheel'] as const) {
  filterField.addEventListener(type, (event) => event.stopPropagation())
}

filterInput.oninput = () => {
  const query = filterInput.value.trim()
  const matched = currentApi?.filter(query === '' ? null : query) ?? []
  // Light up the matches themselves. What a filter leaves on screen is the
  // matches PLUS the ancestors that lead to them, and from the outside those
  // look alike — so a chart of forty cards for four matches leaves you hunting
  // for the four. `filter` hands back exactly the ones that matched, which is
  // the difference `highlight` can then draw.
  currentApi?.highlight(matched.length === 0 ? null : matched)
  filterCount.textContent =
    query === ''
      ? 'The whole tree.'
      : matched.length === 0
        ? 'Nothing matched.'
        : `${matched.length} ${matched.length === 1 ? 'match' : 'matches'} lit, and the way to each.`
}

/** Shows the filter box for the example that asked for it. */
function syncFilterControl(example: Example): void {
  filterField.remove()
  if (example.filterControl !== true) return
  filterInput.value = ''
  filterCount.textContent = 'The whole tree.'
  findInput.value = ''
  findTotal = 0
  findAt = 0
  findCount.textContent = 'Type a name — find changes nothing.'
  surface.append(filterField)
}

let selectionListenersBound = false

/** Shows the selection panel for the example that asked for it. */
function syncSelectionControl(example: Example): void {
  selectionField.remove()
  if (example.selectionControl !== true) return
  surface.append(selectionField)
  if (!selectionListenersBound) {
    selectionListenersBound = true
    for (const type of ['pointerup', 'keyup'] as const) {
      surface.addEventListener(type, () => {
        if (selectionField.isConnected) syncSelectionSoon()
      })
    }
  }
  syncSelectionPanel()
}

/**
 * Fills the branch picker with the nodes that HAVE children — framing a leaf
 * is framing one card, which is a zoom rather than an answer — and hides the
 * panel for every example that did not ask for it.
 */
function syncViewControl(example: Example): void {
  viewField.remove()
  savedView = null
  updateViewButtons()
  if (example.viewControl !== true) return

  surface.append(viewField)
  const childCount = new Map<string, number>()
  for (const item of example.data) {
    const parentId = item.parentId
    if (parentId === undefined || parentId === null) continue
    const key = String(parentId)
    childCount.set(key, (childCount.get(key) ?? 0) + 1)
  }

  branchSelect.innerHTML = ''
  const placeholder = document.createElement('option')
  placeholder.value = ''
  placeholder.textContent = 'Pick a branch…'
  branchSelect.append(placeholder)
  for (const item of example.data) {
    const count = childCount.get(item.id) ?? 0
    if (count === 0) continue
    const option = document.createElement('option')
    option.value = item.id
    option.textContent = `${String(item.name ?? item.id)} — ${count} report${count === 1 ? '' : 's'}`
    branchSelect.append(option)
  }
  branchSelect.value = ''
  updateTrail()
}

/**
 * Shows the orientation panel for the example that asked for it, reset to
 * whatever that example's own options declare under the current layout.
 *
 * The four directions belong to `tidy` alone: every other rectangular layout
 * fixes its own growth axis, and the engine passes `'tb'` for them regardless
 * (see the `applyOrientation` call in engine.ts). They are dropped from the
 * panel there rather than shown inert — a dimmed row of tabs is still a row
 * of tabs, and the first thing anyone does with one is click it.
 *
 * RTL survives that cut, because it does NOT belong to tidy: every
 * rectangular layout mirrors its sibling order. A polar layout is where the
 * whole panel goes, having neither a growth axis to turn nor a sibling order
 * to mirror.
 */
function syncOrientationControl(example: Example, layout: LayoutName): void {
  orientationField.remove()
  if (example.orientationControl !== true) return
  if (layout === 'radial' || layout === 'sunburst') return
  const preset = optionsForLayout(example, layout)
  orientationPicker.value = preset.orientation ?? 'tb'
  setRtl(preset.rtl === true, false)
  const tidy = layout === 'tidy'
  orientationLabel.textContent = tidy ? 'Grows' : 'Reads'
  orientationNote.textContent = tidy
    ? 'Independent axes: RTL mirrors sibling order without turning the tree, so lr + RTL is not rl.'
    : `RTL mirrors sibling order. ${LAYOUT_LABELS[layout]} grows one way, so there is no direction to pick.`
  orientationField.replaceChildren(
    orientationLabel,
    ...(tidy ? [orientationPicker.element] : []),
    rtlButton,
    orientationNote,
  )
  surface.append(orientationField)
}

/**
 * Fills the combo box with `example`'s own nodes, indented by depth so the
 * list reads as the tree it navigates, and hides the whole field for examples
 * that did not ask for it.
 */
function syncGotoControl(example: Example): void {
  gotoField.remove()
  if (example.gotoControl === true) {
    // Appended after the chart has mounted — see the note at the end of
    // `show`. The panel is absolutely positioned with its own stacking order,
    // so DOM order relative to the canvas doesn't decide what is on top.
    surface.append(gotoField)
    const depthOf = new Map<string, number>()
    gotoItems = example.data.map((item) => {
      const parentId = item.parentId
      const depth = parentId === undefined || parentId === null ? 0 : (depthOf.get(String(parentId)) ?? 0) + 1
      depthOf.set(item.id, depth)
      // Non-breaking spaces: the list renders its label as text, and ordinary
      // leading whitespace would collapse to nothing.
      return { id: item.id, label: '  '.repeat(depth) + String(item.name ?? item.id) }
    })
  }
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
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n * scale)))
      .toString(16)
      .padStart(2, '0')
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

/**
 * Wrap long lines, or let them run off and scroll.
 *
 * Wrapping stays the default, which is what the block already did — in a
 * column this narrow a `renderNode` body would otherwise vanish off the right
 * edge. The toggle is for the other reading: code that rewraps is harder to
 * scan than code you scroll, and somebody comparing two lines wants them
 * whole. So the button turns wrapping OFF.
 */
const WRAP_KEY = '@klad/playground-wrap'
const codeWrap = document.createElement('button')
codeWrap.type = 'button'
codeWrap.className = 'code-wrap-toggle'

function setCodeWrap(on: boolean, remember = true): void {
  codeBlock.classList.toggle('is-nowrap', !on)
  codeWrap.textContent = on ? 'No wrap' : 'Wrap'
  codeWrap.setAttribute('aria-pressed', String(!on))
  if (remember) {
    try {
      localStorage.setItem(WRAP_KEY, on ? '1' : '0')
    } catch {
      // A browser refusing storage is not a reason to refuse the click.
    }
  }
}

codeWrap.onclick = () => setCodeWrap(codeBlock.classList.contains('is-nowrap'))

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

/**
 * A mark per adapter, inline so the playground stays one self-contained page —
 * it is served from the docs site with no asset pipeline of its own.
 *
 * `currentColor` throughout: these sit in a tab that changes colour when it is
 * selected, and a logo keeping its brand colour through that would be the only
 * thing on the row not reacting to being chosen.
 */
const STACK_MARK: Record<CodeStack, string> = {
  vanilla:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 8v6.2a1.8 1.8 0 0 1-3.2 1.1M13.6 15.4a3 3 0 0 0 4.6-.6c.6-1.2-.3-2.1-1.9-2.6-1.6-.5-2.4-1.3-1.9-2.5a2.9 2.9 0 0 1 4.3-.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  vue: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 4h4l6 10 6-10h4L12 21Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M7.5 4h3L12 6.6 13.5 4h3" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  react:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2" fill="currentColor"/><g fill="none" stroke="currentColor" stroke-width="1.6"><ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)"/></g></svg>',
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
  const mark = document.createElement('span')
  mark.className = 'code-stack-mark'
  mark.innerHTML = STACK_MARK[value]
  button.append(mark, document.createTextNode(label))
  button.setAttribute('role', 'tab')
  button.onclick = () => {
    if (codeStack === value) return
    codeStack = value
    // These tabs ARE the stack picker now. There used to be a second one in
    // the header choosing which adapter mounts, and two controls for what
    // reads as one question — "show me React" — is a control too many. So the
    // chart remounts with this adapter and the snippet follows it, which also
    // keeps the three adapters exercised rather than leaving the playground
    // permanently on vanilla.
    stackSelect.value = value
    setControlsOpen(false)
    refresh()
    syncCode()
  }
  codeStackButtons.set(value, button)
  codeStackRow.append(button)
}

/**
 * The code drawer: a column on the right rather than one more panel in the
 * rail.
 *
 * It was a panel, which made it a place you GO — and the snippet is not a
 * settings page, it is feedback. Every control that changes it lives in some
 * other panel, so watching a slider change the code meant moving the slider,
 * navigating to Code, reading, and navigating back. Under the chart it is
 * open beside whatever you are adjusting.
 */
const codeDrawer = document.createElement('div')
codeDrawer.className = 'code-drawer'
codeDrawer.hidden = true
// A row of its own under the tabs. On the tab row it read as a fourth thing
// to choose between, which it is not — the tabs pick WHAT the snippet is, and
// this only changes how it is laid out.
const codeOptionsRow = document.createElement('div')
codeOptionsRow.className = 'code-options'
codeOptionsRow.append(codeWrap)
codeDrawer.append(codeStackRow, codeOptionsRow, codeFrame)

const codeToggle = document.createElement('button')
codeToggle.type = 'button'
codeToggle.className = 'btn code-toggle'

let codeOpen = false
const CODE_KEY = '@klad/playground-code'

function setCodeOpen(open: boolean, remember = true): void {
  codeOpen = open
  codeDrawer.hidden = !open
  codeToggle.textContent = open ? 'Hide code' : 'Show code'
  codeToggle.setAttribute('aria-expanded', String(open))
  if (remember) {
    try {
      localStorage.setItem(CODE_KEY, open ? '1' : '0')
    } catch {
      // A browser refusing storage is not a reason to refuse the click.
    }
  }
  // Rendered only while it is open, and rendered NOW so it is never a frame
  // behind the control that was just moved.
  if (open) syncCode()
}

codeToggle.onclick = () => setCodeOpen(!codeOpen)

/**
 * The live values of every control that ends up in the emitted options —
 * read at the moment the code is rendered rather than tracked as they change,
 * so there is exactly one place that decides what "current" means.
 */
function snapshot(): ConfigSnapshot {
  const example = findExample(exampleSelect.value)
  return {
    example,
    layout: layoutSelect.value as LayoutName,
    mode,
    minimapOn,
    minimapPosition: minimapPositionSelect.value as MinimapPosition,
    minimapSilhouette: minimapSilhouetteOverridden ? minimapSilhouetteInput.value : null,
    // The tokens the sidebar has applied, not the whole resolved theme: a
    // snippet restating every default is a worse answer than a short one, and
    // the defaults are what the reader gets for free by omitting them.
    theme: { ...themeState },
    // What the VIEW panel's knobs have been set to, over what the example
    // declares. Without this the snippet is a description of the example
    // rather than of the chart in front of you: turn the connector to
    // Straight, drag the indent, tick Colour by branch, and the code said
    // nothing about any of it.
    layoutSettings: { ...layoutState },
    ringEnabled,
    hasNodeContent: contentForLayout(example, layoutSelect.value as LayoutName) !== 'none',
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

/**
 * The way out of an embed: the same example in the playground proper, with
 * every control the frame is hiding.
 *
 * `_blank` because the frame's parent is the documentation site — navigating
 * inside the iframe would leave a whole playground in a box, and navigating
 * the parent would take a reader off the page they were reading. Re-appended
 * by `show()`, like every other thing that floats over the chart: mounting an
 * example clears the surface.
 */
const embedLink = document.createElement('a')
embedLink.className = 'embed-link'
embedLink.target = '_blank'
embedLink.rel = 'noopener'
embedLink.textContent = 'Open in the playground ↗'

const content = document.createElement('main')
content.className = 'content'
content.append(description, surface)

// Appended here rather than with the rest of the header, because the toggle is
// declared further down with the drawer it opens.
//
// No stack picker beside it: the code drawer's own tabs do that job, and they
// do it for the chart as well as the snippet.
/**
 * The two buttons that change what you are LOOKING at, in a group of their
 * own.
 *
 * Separate from `.app-actions` — which keeps the theme toggle and the docs
 * link — because on a narrow screen this group drops to a row of its own,
 * Controls at the left and the code toggle at the right. The theme toggle
 * stays up top beside the title; sending it down with these put a third thing
 * on a row meant for two, and took it away from where it has always been.
 */
const headerToolbar = document.createElement('div')
headerToolbar.className = 'app-toolbar'
headerToolbar.append(controlsButton, codeToggle)
header.insertBefore(headerToolbar, headerActions)

const layout = document.createElement('div')
layout.className = 'layout'
// The drawer is a column beside the chart, not a strip under it: a snippet is
// tall and narrow — one line per option — so vertical space is what it wants
// and horizontal space is what the chart wants. Under the chart it took the
// bottom third to show ten lines with the rest of the width empty.
layout.append(sidebar, content, codeDrawer)

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

function show(stack: Stack, exampleId: string, layout: LayoutName): void {
  // Tear the previous demo down properly before mounting the next one: the
  // vanilla chart via chart.destroy(), the Vue one via app.unmount() —
  // otherwise listeners and canvases from the old demo leak.
  teardown?.()
  teardown = null
  currentApi = null
  // The picker belongs to the chart that is going away, and so does the hook
  // that lets a tick reach it.
  closeOverflowPanel()
  setWorkingSetHook(null)
  currentSetMinimap = null
  currentSetMinimapPosition = null
  currentSetMinimapSilhouette = null
  currentSetTheme = null
  currentSetRingEnabled = null
  currentSetLayoutOptions = null
  currentSetMode = null
  surface.innerHTML = ''

  // Each stack mounts into its OWN container, not into `surface` itself.
  //
  // Vue's `app.mount()` and React's `createRoot().render()` both take over the
  // element they are given and clear it — and React's render is asynchronous,
  // so there is no "append afterwards" that reliably survives it. Giving them
  // a child of their own means the floating panels are siblings of the chart
  // rather than things it is about to delete, which is also what they are:
  // chrome over the drawing, not part of it.
  const chartRoot = document.createElement('div')
  chartRoot.className = 'surface-chart'
  surface.append(chartRoot)

  if (EMBEDDED) {
    embedLink.href = `${window.location.pathname}?example=${encodeURIComponent(exampleId)}`
    surface.append(embedLink)
  }

  const example = findExample(exampleId)
  layoutBlurb.textContent = LAYOUT_PRESETS[layout]!.blurb
  syncLayoutKnobs(example, layout)
  // Per-layout CSS hooks. The overlay cards a layout expects are its own
  // business — a file row is not an org card — and scoping their styles to
  // these classes is what keeps each example's look from leaking into the
  // others.
  surface.classList.toggle('is-file', layout === 'file')
  surface.classList.toggle('is-wheel', layout === 'sunburst' || layout === 'radial')
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
  // A knob the viewer set stays set across a remount — but only the ones that
  // still mean something in the shape they are now looking at. Carrying a
  // file list's 18px indent into a sunburst would set its ring thickness from
  // a number chosen for something else entirely.
  for (const key of Object.keys(layoutState) as (keyof LayoutSettings)[]) {
    if (key !== 'colourBranches') delete layoutState[key]
  }

  /**
   * The dotted grid under the showcase example travels WITH the chart: the
   * camera writes its offset and its spacing onto the surface, so a pan moves
   * the paper and the diagram together.
   *
   * Left as a plain subscription rather than something the library owns: a
   * background is the page's business, and everything it needs is already on
   * the `viewportChange` event.
   */

  if (stack === 'vanilla') {
    const chart: VanillaDemoHandle = mountVanilla(
      chartRoot,
      example,
      layout,
      mode,
      (api) => {
        currentApi = api
        // A tick in the picker changes the working set; `refresh()` re-reads
        // `pinChildren`, which is what puts it on the chart.
        setWorkingSetHook((keep) => api.refresh(keep === undefined ? undefined : { keep }))
      },
      reportDrop,
      reportCentre,
      () => syncEditState(),
    )
    currentSetMinimap = (on) => chart.setMinimap(on)
    currentSetMinimapPosition = (position) => chart.setMinimapPosition(position)
    currentSetMinimapSilhouette = (colour) => chart.setMinimapSilhouette(colour)
    currentSetTheme = (partial) => chart.setTheme(partial)
    currentSetRingEnabled = (enabled) => chart.setRingEnabled(enabled)
    currentSetLayoutOptions = (settings, fit) => chart.setLayoutOptions(settings, fit)
    currentSetMode = (next) => chart.setMode(next)
    teardown = () => chart.destroy()
  } else if (stack === 'vue') {
    const app = createApp(VueDemo, {
      example,
      layout,
      mode,
      onDrop: reportDrop,
      onCentreChange: reportCentre,
      onReady: (api: KladApi) => {
        currentApi = api
        // A tick in the picker changes the working set; `refresh()` re-reads
        // `pinChildren`, which is what puts it on the chart.
        setWorkingSetHook((keep) => api.refresh(keep === undefined ? undefined : { keep }))
      },
    })
    // VueDemo exposes `setMinimap`/`setMinimapPosition`/`setEdgeRadius`/
    // `setNodeFill`/`setBlockFill`/`setRingStroke`/`setRingEnabled` via
    // `defineExpose`; `app.mount()` returns exactly that exposed public
    // instance for the root component.
    const instance = app.mount(chartRoot) as unknown as {
      setMinimap: (on: boolean) => void
      setMinimapPosition: (position: MinimapPosition) => void
      setMinimapSilhouette: (colour: string) => void
      setTheme: (partial: Partial<Theme>) => void
      setRingEnabled: (enabled: boolean) => void
      setLayoutOptions: (settings: LayoutSettings, fit: boolean) => void
      setMode: (mode: ThemeMode) => void
    }
    currentSetMinimap = (on) => instance.setMinimap(on)
    currentSetMinimapPosition = (position) => instance.setMinimapPosition(position)
    currentSetMinimapSilhouette = (colour) => instance.setMinimapSilhouette(colour)
    currentSetTheme = (partial) => instance.setTheme(partial)
    currentSetRingEnabled = (enabled) => instance.setRingEnabled(enabled)
    currentSetLayoutOptions = (settings, fit) => instance.setLayoutOptions(settings, fit)
    currentSetMode = (next) => instance.setMode(next)
    teardown = () => app.unmount()
  } else {
    const root: Root = createRoot(chartRoot)
    const reactHandle: { current: ReactDemoHandle | null } = { current: null }
    root.render(
      createElement(ReactDemo, {
        example,
        layout,
        mode,
        onDrop: reportDrop,
        onCentreChange: reportCentre,
        onReady: (api: KladApi) => {
          currentApi = api
          // A tick in the picker changes the working set; `refresh()` re-reads
          // `pinChildren`, which is what puts it on the chart.
          setWorkingSetHook((keep) => api.refresh(keep === undefined ? undefined : { keep }))
        },
        ref: reactHandle,
      }),
    )
    currentSetMinimap = (on) => reactHandle.current?.setMinimap(on)
    currentSetMinimapPosition = (position) => reactHandle.current?.setMinimapPosition(position)
    currentSetMinimapSilhouette = (colour) => reactHandle.current?.setMinimapSilhouette(colour)
    currentSetTheme = (partial) => reactHandle.current?.setTheme(partial)
    currentSetRingEnabled = (enabled) => reactHandle.current?.setRingEnabled(enabled)
    currentSetLayoutOptions = (settings, fit) => reactHandle.current?.setLayoutOptions(settings, fit)
    currentSetMode = (next) => reactHandle.current?.setMode(next)
    teardown = () => root.unmount()
  }

  // The floating panels, onto `surface` — beside `chartRoot`, never inside it.
  // See the note where `chartRoot` is created for why that separation exists
  // at all; before it, the selection, branch and breadcrumb panels appeared
  // only on the vanilla stack, because the other two deleted them on mount.
  syncGotoControl(example)
  syncOrientationControl(example, layout)
  syncViewControl(example)
  syncSelectionControl(example)
  syncCentreControl(example, layout)
  syncDropControl(example)
  syncFilterControl(example)
  syncEditControl(example)
}

/**
 * What the address bar says, so a reload lands where you were and a link says
 * what it shows.
 *
 * `replaceState` rather than `pushState`: switching example is browsing a
 * gallery, not navigating, and a Back button that walks you through every
 * demo you glanced at is a worse Back button. Only what a viewer chose goes
 * in — the layout only when it is not the example's own default, so the
 * common URL stays short.
 */
function syncUrl(): void {
  const example = exampleSelect.value
  const params = new URLSearchParams()
  params.set('example', example)
  // Kept, or a reload inside the iframe comes back as the whole playground in
  // a 420px box.
  if (EMBEDDED) params.set('embed', '1')
  if (stackSelect.value !== 'vanilla') params.set('stack', stackSelect.value)
  const layout = layoutSelect.value
  if (layout !== defaultLayoutOf(findExample(example))) params.set('layout', layout)
  history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`)
}

function refresh(): void {
  show(stackSelect.value as Stack, exampleSelect.value, layoutSelect.value as LayoutName)
  refreshCode()
  syncUrl()
}

// Both pickers close the drawer on the way through (see `radioPicker` above):
// on a phone the point of choosing a stack or an example is to LOOK at the
// result, which is behind the panel that was just used to choose it. A no-op
// at any width where the sidebar is not a drawer.

/**
 * Re-renders the snippet after anything that could change it. One delegated
 * listener rather than a call in every control's own handler: the sidebar's
 * controls all bubble here, and a handler that has to remember to tell a
 * second thing about itself is a handler that eventually forgets. A no-op
 * while the Code panel is closed, which is most of the time.
 */
function refreshCode(): void {
  if (codeOpen) syncCode()
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

/**
 * Where to start: whatever the URL says, falling back to the first example.
 *
 * An unknown id is ignored rather than treated as an error — a link to an
 * example that has since been renamed should still open the playground, not a
 * blank page with a complaint on it.
 */
const startParams = new URLSearchParams(window.location.search)
const startExample = findExample(startParams.get('example') ?? '')
const startStack = startParams.get('stack')
const startLayout = startParams.get('layout')

stackSelect.value =
  startStack === 'vue' || startStack === 'react' || startStack === 'vanilla' ? startStack : 'vanilla'
exampleSelect.value = startExample.id
layoutSelect.value =
  startLayout !== null && (LAYOUT_ORDER as readonly string[]).includes(startLayout)
    ? startLayout
    : defaultLayoutOf(startExample)
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

// Nothing is open in an embed: the panels are hidden there, and an open one
// would keep its minimap redrawing every frame behind a panel nobody can see.
openPanel(EMBEDDED ? null : initialPanel())

/**
 * The drawer starts closed for a first visit and remembers after that.
 *
 * Closed by default because the chart is the thing somebody came to see, and a
 * snippet taking the bottom third before they have touched anything is an
 * answer to a question they have not asked yet.
 */
setCodeWrap(
  (() => {
    try {
      // Absent means "never chosen", which is the wrapping default.
      return localStorage.getItem(WRAP_KEY) !== '0'
    } catch {
      return true
    }
  })(),
  false,
)

setCodeOpen(
  !EMBEDDED &&
    (() => {
      try {
        return localStorage.getItem(CODE_KEY) === '1'
      } catch {
        return false
      }
    })(),
  false,
)
