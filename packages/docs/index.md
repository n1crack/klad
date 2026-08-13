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
  tagline: Draw a tree the way it wants to be read — tiered, indented, radial or as a wheel
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
  - title: ⚡ Built for very large trees
    details: The tree is laid out and drawn on a canvas inside a Web Worker, so the main thread stays free. No DOM per node, ever — which is the one thing a chart made of elements cannot avoid.
  - title: 🌳 The shape is a setting
    details: An org chart, a file explorer, a radial dendrogram, a wheel you can drill into. Change one option; the data stays exactly as it was.
  - title: 🧩 Your components on top
    details: A Vue slot, a React render prop, or plain DOM. Real components mount only for the nodes on screen and zoomed in far enough to read, pooled and reused as you move.
---

<script setup>
// `withBase`, because this is a raw `src` and not a VitePress link: the router
// prefixes `base` onto its own links, and nothing prefixes it onto this. The
// playground is a separate Vite app copied in under `public/`, not one of
// VitePress's own routes.
import { withBase } from 'vitepress'
</script>

<div class="home-demo">
  <iframe
    :src="withBase('/playground/?example=slots&embed=1')"
    title="Klad — an org chart you can pan, zoom and expand"
    loading="lazy"
  />
</div>

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

<p class="home-support">
  If you like this library, please consider giving it a
  <a href="https://github.com/n1crack/klad" target="_blank" rel="noopener">star on GitHub</a>
  or <a href="https://github.com/sponsors/n1crack" target="_blank" rel="noopener">sponsoring the project</a>.
</p>

<style>
/*
 * The live demo. An iframe rather than a component built into this theme: the
 * playground is already a built app served from under this site, so framing it
 * means the example, its cards' CSS and its data have ONE implementation —
 * and a screenshot of a chart engine is the one thing that cannot show what it
 * does.
 *
 * A fixed height rather than an aspect ratio: what the frame is worth showing
 * is the top few levels at a readable zoom, and that is a number of pixels,
 * not a proportion of the width. `lazy` on the iframe — it is below the fold
 * on most screens, and it starts a Web Worker.
 */
.vp-doc .home-demo {
  margin: 2.5rem 0 3rem;
  height: 460px;
  border-radius: 14px;
  border: 1px solid var(--vp-c-divider);
  overflow: hidden;
  background: var(--vp-c-bg-soft);
}
.vp-doc .home-demo iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
}
@media (max-width: 640px) {
  .vp-doc .home-demo {
    height: 340px;
  }
}
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
