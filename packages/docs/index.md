---
layout: home

hero:
  name: OrgChart
  text: The whole org, at 60fps.
  tagline: Fifty thousand people on a canvas in a Web Worker — with your own Vue, React or plain-DOM cards mounted only where they are big enough to read.
  image:
    src: /hero.png
    alt: An org chart of six cards in perspective, floating above their connectors
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
  - title: 50,000 nodes, about 50 elements
    details: A node gets a DOM element once it is on screen and zoomed in far enough to read — never before. The rest is canvas, so the chart can be as big as the company is.
  - title: Bring your own card
    details: A Vue slot, a React render prop, or a plain function that gets an element. One DOM-free engine under all three, and a fourth binding is an afternoon's work.
  - title: Expand without losing your place
    details: Open a node and it holds its exact spot on screen, to the pixel, while the layout reflows around it. The camera keeps its zoom; the minimap keeps its frame.
---

## Draw one

::: tabs key:stack

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

Pan, zoom, click, keyboard navigation. `data` is flat — `{ id, parentId?, ...yours }` —
so the array from your API is usually already the right shape.

## The catch

`nodeSize` is declared, not measured. Layout runs in a Web Worker, where there
is no element to call `getBoundingClientRect()` on — that is what buys the
50,000. Your content fits the box you declare.

If your chart is a hundred nodes and every card is a different height decided
by its content, use a DOM-based chart instead. [Sizing](/guide/sizing) has the
whole trade.
