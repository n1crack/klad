---
layout: home
# SEO <title> for the home page (the hero above is separate). `titleTemplate:
# false` keeps VitePress from appending "| Klad" on top of a title that already
# starts with the name.
title: Klad — Canvas tree engine for very large hierarchies
titleTemplate: false

hero:
  name: Klad
  text: Canvas Tree Engine
  tagline: One engine, four shapes — tiered, file, radial and sunburst — for trees of any size
  image:
    src: /hero.png
    alt: A tree of six cards in perspective, floating above their connectors
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Reference
      link: /api/options
    - theme: alt
      text: View on GitHub
      link: https://github.com/n1crack/klad

features:
  - title: ⚡ Built for Large Trees
    details: Renders very large trees smoothly. Layout and drawing run on a canvas inside a Web Worker, so the main thread stays free. No DOM per node, ever.
  - title: 🌳 Four Layouts, One Tree
    details: Tiered for an org chart, indented rows for a file explorer, concentric rings for something wide and shallow, or a sunburst you can drill into. Change the shape without changing the data.
  - title: 🧩 Your Components on Top
    details: A Vue slot, a React render prop, or plain DOM. Real components mount only for the nodes on screen and zoomed in far enough to read — about fifty at a time, pooled and reused.
  - title: 🛠️ Developer-Friendly
    details: TypeScript throughout, four orientations, RTL, minimap, SVG and PNG export, full keyboard navigation and a screen-reader tree. ESM only, with Vue 3 and React adapters.
---

## Quick Start

::: tabs key:stack

== Vanilla

```bash
npm install @klad/core
```

```ts
import { createKlad } from '@klad/core'

const chart = createKlad(document.getElementById('chart')!, {
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
npm install @klad/vue
```

```vue
<script setup lang="ts">
import { Klad, type Options } from '@klad/vue'

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
  <Klad :options="options" style="width: 100%; height: 100vh" />
</template>
```

== React

```bash
npm install @klad/react
```

```tsx
import { Klad, type Options } from '@klad/react'

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
  return <Klad options={options} style={{ width: '100%', height: '100vh' }} />
}
```

:::

Pan, zoom, click, keyboard navigation. `data` is flat — `{ id, parentId?, ...yours }` —
so the array from your API is usually already the right shape.

## Same Data, Four Shapes

An org chart is one thing a tree can look like. Add `layout` and the same array
draws as something else entirely — no second data structure, no second library.

```ts
createKlad(el, { data, layout: 'file' })      // indented rows, folder guide lines
createKlad(el, { data, layout: 'radial' })    // root at the centre, generations as rings
createKlad(el, { data, layout: 'sunburst' })  // nested arcs you can drill into
```

File explorers, ASTs, taxonomies, dependency trees, family trees, disk usage —
all the same shape of problem, and the reason this is a tree engine rather than
an org chart component. Try all four in the
[playground](/playground/).

## One Thing to Know

`nodeSize` is declared, not measured. Layout runs in a Web Worker, where there
is no element to call `getBoundingClientRect()` on — that is what buys the
scale. Your content fits the box you declare — more in [Sizing](/guide/sizing).

<p class="home-support">
  If you like this library, please consider giving it a
  <a href="https://github.com/n1crack/klad" target="_blank" rel="noopener">star on GitHub</a>
  or <a href="https://github.com/sponsors/n1crack" target="_blank" rel="noopener">sponsoring the project</a>.
</p>

<style>
/* Scoped under .vp-doc so it out-specifies VitePress's own `.vp-doc p` margin
   rule — otherwise `margin-left/right: 0` from that rule wins and the box sticks
   to the left instead of centring. */
.vp-doc .home-support {
  margin: 3.5rem auto 1rem;
  max-width: 560px;
  padding: 0.9rem 1.25rem;
  text-align: center;
  font-size: 0.9rem;
  line-height: 1.6;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
}
.vp-doc .home-support a {
  font-weight: 500;
  color: var(--vp-c-brand-1);
  text-decoration: none;
}
.vp-doc .home-support a:hover {
  text-decoration: underline;
}
</style>
