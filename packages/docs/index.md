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
// `withBase`, because these are raw `src` values and not VitePress links: the
// router prefixes `base` onto its own links, and nothing prefixes it onto
// these. The playground is a separate Vite app copied in under `public/`, not
// one of VitePress's own routes.
import { ref } from 'vue'
import { withBase } from 'vitepress'

// The claim this page used to make in prose — one library, several shapes —
// made instead by the thing itself. Each tab is a playground example in embed
// mode; switching one swaps the frame's `src`, and the app's bundle is already
// cached by then.
//
// Three, not every layout there is: radial fits its whole diagram to the
// frame, which at this height puts it below the zoom where its labels are
// drawn at all, and a tab that shows a skeleton argues against the page.
const demos = [
  { id: 'slots', label: 'Org chart', alt: 'An org chart of coloured cards you can pan, zoom and expand' },
  { id: 'file-tree', label: 'File tree', alt: 'A tree as indented file-explorer rows' },
  { id: 'sunburst', label: 'Sunburst', alt: 'A tree as a wheel of nested arc segments you can drill into' },
]
const current = ref(demos[0])
</script>

<div class="home-demo">
  <div class="home-demo-tabs" role="tablist" aria-label="Layout">
    <button
      v-for="demo in demos"
      :key="demo.id"
      role="tab"
      type="button"
      :class="{ 'is-active': demo.id === current.id }"
      :aria-selected="demo.id === current.id"
      @click="current = demo"
    >{{ demo.label }}</button>
  </div>
  <div class="home-demo-frame">
    <iframe
      :key="current.id"
      :src="withBase(`/playground/?example=${current.id}&embed=1`)"
      :title="current.alt"
      loading="lazy"
    />
  </div>
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
  border-radius: 14px;
  border: 1px solid var(--vp-c-divider);
  overflow: hidden;
  background: var(--vp-c-bg-soft);
}
.vp-doc .home-demo-frame {
  height: 460px;
}
.vp-doc .home-demo iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
}
@media (max-width: 640px) {
  .vp-doc .home-demo-frame {
    height: 340px;
  }
}

/* A strip of tabs, not a picker: four is few enough to show all of them, and
   the whole point is that the reader can see there are four. Scrollable rather
   than wrapped on a narrow screen, so the frame below never moves. */
.vp-doc .home-demo-tabs {
  display: flex;
  gap: 0.25rem;
  padding: 0.5rem 0.5rem 0;
  overflow-x: auto;
  scrollbar-width: none;
  border-bottom: 1px solid var(--vp-c-divider);
}
.vp-doc .home-demo-tabs::-webkit-scrollbar {
  display: none;
}
.vp-doc .home-demo-tabs button {
  flex: 0 0 auto;
  padding: 0.45rem 0.85rem;
  border: 0;
  border-radius: 8px 8px 0 0;
  background: transparent;
  color: var(--vp-c-text-2);
  font-size: 0.85rem;
  font-weight: 500;
  line-height: 1.4;
  cursor: pointer;
  transition:
    color 140ms ease,
    background 140ms ease;
}
.vp-doc .home-demo-tabs button:hover {
  color: var(--vp-c-text-1);
  background: var(--vp-c-default-soft);
}
/* The active tab is joined to the frame under it — the border it sits on is
   covered by its own background, so the strip reads as a folder tab and not as
   a button that happens to be darker. */
.vp-doc .home-demo-tabs button.is-active {
  color: var(--vp-c-brand-1);
  background: var(--vp-c-bg);
  box-shadow: 0 1px 0 0 var(--vp-c-bg);
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
