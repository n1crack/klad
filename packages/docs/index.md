---
layout: home
# SEO <title> for the home page (the hero above is separate). `titleTemplate:
# false` keeps VitePress from appending "| Klad" on top of a title that already
# starts with the name.
title: Klad — Canvas org chart for very large trees
titleTemplate: false

hero:
  name: Klad
  text: Canvas Org Chart
  tagline: A fast, framework-agnostic org chart for very large trees
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
      link: https://github.com/n1crack/klad

features:
  - title: ⚡ Built for Large Trees
    details: Renders very large trees smoothly. Layout and drawing run on a canvas inside a Web Worker, so the main thread stays free. No DOM per node, ever.
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
