import { createApp } from 'vue'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { OrgChartApi, OrgChartInstance } from '@n1crack/orgchart'
import { EXAMPLES, minimapDefaultOn, minimapOptionFor, type Example } from './data.js'
import { mountVanilla } from './vanilla-demo.js'
import VueDemo from './VueDemo.vue'
import { ReactDemo, type ReactDemoHandle } from './ReactDemo.js'
import './style.css'

type Stack = 'vanilla' | 'vue' | 'react'

const root = document.querySelector<HTMLDivElement>('#app')
if (root === null) throw new Error('#app element not found')
root.innerHTML = ''

// --- toolbar: two independent dropdowns (stack, example) plus the shared
// zoom/pan/collapse controls, which stay wired to whichever chart is
// currently mounted. Switching either dropdown tears down and remounts. ---

const toolbar = document.createElement('div')
toolbar.className = 'toolbar'

function labeledSelect(
  labelText: string,
  id: string,
  options: { value: string; label: string }[],
): HTMLSelectElement {
  const label = document.createElement('label')
  label.textContent = labelText
  label.htmlFor = id
  const select = document.createElement('select')
  select.id = id
  for (const opt of options) {
    const optionEl = document.createElement('option')
    optionEl.value = opt.value
    optionEl.textContent = opt.label
    select.append(optionEl)
  }
  toolbar.append(label, select)
  return select
}

const stackSelect = labeledSelect('Stack:', 'stack-select', [
  { value: 'vanilla', label: 'vanilla' },
  { value: 'vue', label: 'vue' },
  { value: 'react', label: 'react' },
])

// Driven from the same registry every stack renders, so a new example is a
// one-line addition to data.ts rather than a page change.
const exampleSelect = labeledSelect(
  'Example:',
  'example-select',
  EXAMPLES.map((example) => ({ value: example.id, label: example.name })),
)

const controls = document.createElement('div')
controls.className = 'controls'
toolbar.append(controls)

let currentApi: OrgChartApi | null = null

function addButton(label: string, onClick: () => void): void {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  button.onclick = onClick
  controls.append(button)
}

addButton('Zoom In', () => currentApi?.zoomIn())
addButton('Zoom Out', () => currentApi?.zoomOut())
addButton('Fit', () => currentApi?.fit())
addButton('Expand All', () => currentApi?.expandAll())
addButton('Collapse All', () => currentApi?.collapseAll())

// --- minimap toggle ---
// `OrgChartApi` (the object every "currentApi?.xxx()" call above reaches
// for) has no minimap method at all — the only place `minimap` can be
// changed post-construction is `OrgChartInstance.update()`, which the
// vanilla layer's own test suite confirms is a supported way to flip it
// (packages/vanilla/src/minimap.browser.test.ts, "can be toggled on and off
// via update()"). So this button drives `update()` (vanilla directly; Vue
// and React indirectly, through their own `options`-prop watch/effect that
// already calls `chart.update()` internally) rather than remounting the
// chart — remounting would lose camera position too, on top of whatever
// `update()` already resets. Note that `update()` always resets open/closed
// state via `initOpen()`, as a side effect that has nothing to do with the
// minimap; there's no way to change ONLY the minimap without also paying
// that cost, since that would take a dedicated runtime method (something
// like `api.setMinimap(enabled)`) that the vanilla API doesn't have.
let currentSetMinimap: ((on: boolean) => void) | null = null
let minimapOn = false

const minimapButton = document.createElement('button')
minimapButton.type = 'button'
controls.append(minimapButton)

function updateMinimapButton(): void {
  minimapButton.textContent = `Minimap: ${minimapOn ? 'On' : 'Off'}`
  minimapButton.setAttribute('aria-pressed', String(minimapOn))
}

minimapButton.onclick = () => {
  minimapOn = !minimapOn
  currentSetMinimap?.(minimapOn)
  updateMinimapButton()
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

addButton('Export SVG', () => {
  const svg = currentApi?.toSVG()
  if (svg !== undefined) download(new Blob([svg], { type: 'image/svg+xml' }), 'org-chart.svg')
})
addButton('Export PNG', () => {
  void currentApi?.toBlob({ format: 'png', scale: 2 }).then((blob) => download(blob, 'org-chart.png'))
})

const description = document.createElement('div')
description.className = 'example-description'

const surface = document.createElement('div')
surface.className = 'surface'

root.append(toolbar, description, surface)

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
  surface.innerHTML = ''

  const example = findExample(exampleId)
  description.textContent = example.description

  // Reset the toggle to whatever this example itself declares before it
  // mounts, rather than carrying over the previous example/stack's on/off
  // state — the button's label must reflect what's ACTUALLY showing.
  minimapOn = minimapDefaultOn(example)
  updateMinimapButton()

  if (stack === 'vanilla') {
    const chart: OrgChartInstance = mountVanilla(surface, example)
    currentApi = chart.api
    currentSetMinimap = (on) => chart.update(example.data, { minimap: minimapOptionFor(example, on) })
    teardown = () => chart.destroy()
  } else if (stack === 'vue') {
    const app = createApp(VueDemo, {
      example,
      onReady: (api: OrgChartApi) => {
        currentApi = api
      },
    })
    // VueDemo exposes `setMinimap` via `defineExpose`; `app.mount()` returns
    // exactly that exposed public instance for the root component.
    const instance = app.mount(surface) as unknown as { setMinimap: (on: boolean) => void }
    currentSetMinimap = (on) => instance.setMinimap(on)
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
