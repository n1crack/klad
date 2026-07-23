---
layout: home

hero:
  name: Klados
  text: Canvas Org Chart
  tagline: κλάδος, “branch” — a fast, framework-agnostic org chart for very large trees
  image:
    src: /hero.png
    alt: An org chart of six cards in perspective, floating above their connectors
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Reference
      link: /api/options
    - theme: alt
      text: View on GitHub
      link: https://github.com/n1crack/klados

features:
  - title: ⚡ Built for Large Trees
    details: Renders 5,000–50,000 nodes at 60fps. Layout and drawing run on a canvas inside a Web Worker, so the main thread stays free. No DOM per node, ever.
  - title: 🧩 Your Components on Top
    details: A Vue slot, a React render prop, or plain DOM. Real components mount only for the nodes on screen and zoomed in far enough to read — about fifty at a time, pooled and reused.
  - title: 🛠️ Developer-Friendly
    details: TypeScript throughout, four orientations, RTL, minimap, SVG and PNG export, full keyboard navigation and a screen-reader tree. ESM only, with Vue 3 and React adapters.
---

## Quick Start

::: tabs key:stack

== Vanilla

```bash
npm install klados
```

```ts
import { createKlados } from 'klados'

const chart = createKlados(document.getElementById('chart')!, {
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
npm install @klados/vue
```

```vue
<script setup lang="ts">
import { Klados, type Options } from '@klados/vue'

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
  <Klados :options="options" style="width: 100%; height: 100vh" />
</template>
```

== React

```bash
npm install @klados/react
```

```tsx
import { Klados, type Options } from '@klados/react'

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
  return <Klados options={options} style={{ width: '100%', height: '100vh' }} />
}
```

:::

Pan, zoom, click, keyboard navigation. `data` is flat — `{ id, parentId?, ...yours }` —
so the array from your API is usually already the right shape.

## One Thing to Know

`nodeSize` is declared, not measured. Layout runs in a Web Worker, where there
is no element to call `getBoundingClientRect()` on — that is what buys the
50,000. Your content fits the box you declare.

If your chart is a hundred nodes and every card is a different height decided
by its content, use a DOM-based chart instead. [Sizing](/guide/sizing) has the
whole trade.
