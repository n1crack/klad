---
title: Org chart library for Vue, React and JavaScript
description: 'An interactive org chart (organizational chart) component for Vue 3, React and plain JavaScript. Renders thousands of employees on a canvas, with your own cards, search, drag-and-drop reparenting and export.'
---

<script setup>
import { withBase } from 'vitepress'
</script>

# Org chart library for Vue, React and JavaScript

Klad draws an organizational chart from the flat list of people you already
have: every row has an `id` and the `id` of the person it reports to. It works
in Vue 3, in React and with no framework at all. The same chart holds up at a
team of twelve and at a company of twenty thousand.

<div class="demo-frame">
  <iframe :src="withBase('/playground/?example=slots&embed=1')" title="An org chart of coloured cards you can pan, zoom and expand" loading="lazy" />
</div>

## From an employee list to an org chart

```ts
import { createKlad } from '@klad/core'

createKlad(document.getElementById('chart')!, {
  data: [
    { id: 'ceo', name: 'Jamie Fox', title: 'CEO' },
    { id: 'cto', parentId: 'ceo', name: 'Amy Chen', title: 'CTO' },
    { id: 'cfo', parentId: 'ceo', name: 'Priya Rao', title: 'CFO' },
    { id: 'eng', parentId: 'cto', name: 'Lena Ortiz', title: 'Head of Engineering' },
  ],
  nodeSize: { w: 180, h: 64 },
  label: (item) => String(item.name ?? ''),
})
```

You do not need to build a nested JSON tree first. The `{ id, parentId }` rows
from your HR system, directory or database already have the right shape. For
Vue and React the options are the same, passed to a `<Klad>` component. See
[Getting started](/guide/getting-started).

## What an org chart needs

- **Your own employee cards.** A photo, name, title, team or status, built as a
  Vue slot, a React render prop or plain DOM. See [Node content](/guide/node-content).
- **Very large organizations.** The chart is laid out and drawn on a canvas in
  a Web Worker. Real DOM cards are created only for the people on screen, so a
  big company does not slow the page down.
- **Finding a person.** Search, `focus` the result, and highlight the
  reporting line from the CEO down to that person. See [Navigating](/guide/navigating).
- **Showing one department.** Filter to the matches and their managers, or
  isolate a single branch. See [Filtering](/guide/filtering).
- **Restructuring.** Turn on drag and drop to move a person or a whole team
  under a new manager, and save each move to your server.
  See [Drag and drop](/guide/drag-and-drop).
- **Managers with hundreds of reports.** Cap a wide level and keep it readable.
  See [Very wide levels](/guide/wide-levels).
- **Loading on demand.** Fetch a department the first time someone opens it.
  See [Children on demand](/guide/children-on-demand).
- **Any direction.** Top-down, bottom-up or left-to-right, and a
  [radial](/guide/layouts#radial) view of the whole company.
- **Export.** Save the chart, or one branch of it, as SVG or PNG.
  See [Export](/api/chart#export).

## Try it

The [playground](https://klad.ozdemir.be/playground/) has the org chart with several card styles
(avatars, photos, status badges, counts), plus drag and drop, filtering and a
20,000-node chart, with the Vue, React or plain-JavaScript code next to each.

Klad is also a [tree view](/tree-view) and a [nested category tree](/category-tree).
Both use the same data as the org chart.
