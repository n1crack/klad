import { createApp } from 'vue'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { OrgChartApi, OrgChartInstance } from '@n1crack/orgchart'
import { EXAMPLES, type Example } from './data.js'
import { mountVanilla } from './vanilla-demo.js'
import VueDemo from './VueDemo.vue'
import { ReactDemo } from './ReactDemo.js'
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
  surface.innerHTML = ''

  const example = findExample(exampleId)
  description.textContent = example.description

  if (stack === 'vanilla') {
    const chart: OrgChartInstance = mountVanilla(surface, example)
    currentApi = chart.api
    teardown = () => chart.destroy()
  } else if (stack === 'vue') {
    const app = createApp(VueDemo, {
      example,
      onReady: (api: OrgChartApi) => {
        currentApi = api
      },
    })
    app.mount(surface)
    teardown = () => app.unmount()
  } else {
    const root: Root = createRoot(surface)
    root.render(
      createElement(ReactDemo, {
        example,
        onReady: (api: OrgChartApi) => {
          currentApi = api
        },
      }),
    )
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
