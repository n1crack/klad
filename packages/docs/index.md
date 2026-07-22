---
layout: home

hero:
  name: OrgChart
  text: 50,000 nodes at 60fps.
  tagline: A framework-agnostic org chart. The tree is laid out and drawn on a canvas inside a Web Worker; real components are mounted only for the handful of nodes actually on screen and zoomed in far enough to read.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: API
      link: /api/options
    - theme: alt
      text: GitHub
      link: https://github.com/n1crack/orgchart

features:
  - title: Built for trees that are actually large
    details: A DOM-per-node chart cannot reach 50,000 nodes — that is 50,000 component instances plus as many connector elements, and both memory and layout time run out long before. Nothing here creates DOM for a node unless that node is both visible and legible.
  - title: Your components, where they are readable
    details: Above a zoom threshold, real Vue or React components (or plain DOM) are mounted over the canvas for the ~50 nodes in the viewport, pooled and repositioned rather than recreated. Below it, the canvas draws the box itself and no DOM exists at all.
  - title: One engine, three bindings
    details: Layout, viewport maths, the spatial index and the renderer live in a DOM-free core. The frameworkless API is the reference implementation; the Vue and React adapters are thin bindings over it, and writing a fourth is a small job.
  - title: Interaction that holds still
    details: Expanding a node keeps it pinned exactly where it was on screen while the layout moves around it, to the pixel. Panning has kinetic momentum, the minimap keeps its frame across a toggle, and a full keyboard tree sits underneath for screen readers.
---

## Install and draw a chart

::: tabs

== Vanilla

```bash
npm install @n1crack/orgchart
```

```ts
import { createOrgChart } from '@n1crack/orgchart'

const chart = createOrgChart(document.getElementById('chart')!, {
  data: [
    { id: 'ceo', name: 'Jamie Fox', title: 'CEO' },
    { id: 'cto', parentId: 'ceo', name: 'Amy Chen', title: 'CTO' },
    { id: 'cfo', parentId: 'ceo', name: 'Priya Rao', title: 'CFO' },
  ],
  nodeSize: { w: 180, h: 64 },
  label: (item) => String(item.name ?? ''),
})

chart.on('nodeClick', ({ id }) => console.log('clicked', id))
```

== Vue

```bash
npm install @n1crack/orgchart-vue
```

```vue
<script setup lang="ts">
import { OrgChart, type Options } from '@n1crack/orgchart-vue'

const options: Options = {
  data: [
    { id: 'ceo', name: 'Jamie Fox', title: 'CEO' },
    { id: 'cto', parentId: 'ceo', name: 'Amy Chen', title: 'CTO' },
    { id: 'cfo', parentId: 'ceo', name: 'Priya Rao', title: 'CFO' },
  ],
  nodeSize: { w: 180, h: 64 },
  label: (item) => String(item.name ?? ''),
}
</script>

<template>
  <OrgChart :options="options" style="width: 100%; height: 100vh" />
</template>
```

== React

```bash
npm install @n1crack/orgchart-react
```

```tsx
import { OrgChart, type Options } from '@n1crack/orgchart-react'

const options: Options = {
  data: [
    { id: 'ceo', name: 'Jamie Fox', title: 'CEO' },
    { id: 'cto', parentId: 'ceo', name: 'Amy Chen', title: 'CTO' },
    { id: 'cfo', parentId: 'ceo', name: 'Priya Rao', title: 'CFO' },
  ],
  nodeSize: { w: 180, h: 64 },
  label: (item) => String(item.name ?? ''),
}

export function Chart() {
  return <OrgChart options={options} style={{ width: '100%', height: '100vh' }} />
}
```

:::

That is a working chart: pan, zoom, click, keyboard navigation, and a canvas
that stays at 60fps whether the array has three rows in it or fifty thousand.

`data` is flat. Every item is `{ id, parentId?, ...anything else you keep on
it }`; there is no nested-children shape, and an item whose `parentId` names
nothing becomes a root with a `warning` event rather than an exception.

## What it costs you

`nodeSize` is required, and declared rather than measured. Layout runs inside a
Web Worker, which has no DOM: it cannot mount your component, read its
`getBoundingClientRect()`, and only then decide where the box goes — there is
nothing to mount there. So you say how big a node is, either as one size or as
a function of the node's own data, and your content fits the box you declared.

That single constraint is what the 50,000-node number is bought with. If your
chart is a hundred nodes and every card is a different height decided by its
own content, a DOM-based chart will serve you better and there is no shame in
saying so.
