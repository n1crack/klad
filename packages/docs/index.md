---
layout: home

hero:
  name: OrgChart
  text: 50,000 nodes. 60fps.
  tagline: Canvas in a worker. Your components only where they can be read.
  image:
    src: /logo-hero.svg
    alt: A parent node above three children, joined by elbow connectors
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
  - title: No DOM you can't see
    details: A node gets an element only when it is in the viewport and zoomed in far enough to read — about fifty at a time, pooled. Everything else is canvas.
  - title: Vue, React, or neither
    details: One DOM-free engine, three thin bindings. The frameworkless API is the reference; a fourth binding is a small job.
  - title: Nothing jumps
    details: Expand a node and it stays exactly where it was on screen, to the pixel, while the layout moves around it.
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
