---
title: Tree view component for large hierarchies
description: 'A fast tree view for Vue 3, React and JavaScript: file-explorer rows with indent guides, expand and collapse, keyboard navigation, lazy-loaded children and drag and drop, for trees with tens of thousands of nodes.'
---

<script setup>
import { withBase } from 'vitepress'
</script>

# Tree view component for large hierarchies

A tree view is a list you can fold: one row per node, indented under its
parent, with branches you open and close. Klad's `file` layout draws one, like
a file explorer, an outline or a sidebar navigation. Most tree view components
create a DOM element for every row. Klad draws the rows and indent guides on a
canvas and creates real DOM only for the rows on screen, so a tree with tens of
thousands of nodes scrolls as smoothly as a short one.

<div class="demo-frame">
  <iframe :src="withBase('/playground/?example=file-tree&embed=1')" title="A tree as indented file-explorer rows" loading="lazy" />
</div>

## A tree view in a few lines

```ts
import { createKlad } from '@klad/core'

createKlad(document.getElementById('tree')!, {
  data: [
    { id: 'src', name: 'src' },
    { id: 'src/app.ts', parentId: 'src', name: 'app.ts' },
    { id: 'src/lib', parentId: 'src', name: 'lib' },
    { id: 'src/lib/util.ts', parentId: 'src/lib', name: 'util.ts' },
  ],
  layout: 'file',
  layoutStep: 18, // indent per level
  rowGap: 2,
  nodeSize: { w: 340, h: 30 },
  toggleOnNodeClick: true,
  label: (item) => String(item.name ?? ''),
})
```

The data is flat: each row has an `id` and its parent's `id`. Use `@klad/vue`
or `@klad/react` to render each row as your own component, with an icon, a
checkbox, a badge or a size column. See [Node content](/guide/node-content).

## Tree view features

- **Expand and collapse**, with any branches closed at the start
  (`collapsedByDefault`).
- **Lazy loading.** Mark nodes that may have children and fetch them the first
  time someone opens one. See [Children on demand](/guide/children-on-demand).
- **Drag and drop** to reorder rows or move them to a new parent, with drop
  before, after or into a node. See [Drag and drop](/guide/drag-and-drop).
- **Keyboard navigation** and an accessible tree for screen readers.
- **Search and filter** that keep the path to each match, so results stay a
  tree rather than a flat list. See [Filtering](/guide/filtering).
- **Selection**, single or multiple. See [Options](/api/options).
- **Huge folders.** A level with ten thousand children can be capped and
  paged. See [Very wide levels](/guide/wide-levels).

## The same tree, other shapes

The same data can also be drawn as an [org chart](/org-chart), a radial
dendrogram, or a sunburst that shows how much each branch holds. Change
`layout` and nothing else. See [Layouts](/guide/layouts). For product
categories, menus and taxonomies, see [Nested category tree](/category-tree).
