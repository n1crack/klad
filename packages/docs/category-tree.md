---
title: Nested category tree for Vue, React and JavaScript
description: 'Render and edit nested categories, such as product categories, menus and taxonomies, straight from a parent_id table. Drag and drop to reorder, lazy-load subcategories, and filter, in Vue, React or plain JavaScript.'
---

<script setup>
import { withBase } from 'vitepress'
</script>

# Nested category tree

Product categories, a menu, a taxonomy, a chart of accounts: these are usually
stored as a table with a `parent_id` column, an _adjacency list_. Klad takes
those rows as they are and draws a category tree. People can browse it, search
it and reorganize it with drag and drop, and you do not need to build a
recursive component or a nested JSON structure.

<div class="demo-frame">
  <iframe :src="withBase('/playground/?example=drag-drop&embed=1')" title="A tree whose nodes can be dragged to a new parent" loading="lazy" />
</div>

## From a `parent_id` table

```sql
SELECT id, parent_id, name FROM categories;
```

```ts
import { createKlad } from '@klad/core'

const rows = await fetch('/api/categories').then((r) => r.json())

const chart = createKlad(document.getElementById('categories')!, {
  data: rows.map((row) => ({
    id: String(row.id),
    parentId: row.parent_id == null ? null : String(row.parent_id),
    name: row.name,
  })),
  layout: 'file', // an indented category list; 'tidy' for a top-down chart
  nodeSize: { w: 320, h: 30 },
  toggleOnNodeClick: true,
  dragAndDrop: true,
  label: (item) => String(item.name ?? ''),
})
```

Every category with no parent becomes a root, so a forest of top-level
categories works as it is. The order inside each parent is the order of the
rows.

## Moving a category

With `dragAndDrop: true`, dropping a category on another makes it a
subcategory. Dropping it before or after another moves it among its siblings.
The event fires **before** anything moves, so your server can still refuse:

```ts
chart.on('nodeDrop', async (event) => {
  event.preventDefault()
  const ok = await fetch('/api/categories/move', {
    method: 'POST',
    body: JSON.stringify({ ids: event.ids, parentId: event.parentId, index: event.index }),
  }).then((r) => r.ok)
  if (ok) chart.api.update(applyMove(rows, event)) // your own data update
})
```

A category can never be dropped into its own subcategories, so a move cannot
create a cycle. See [Drag and drop](/guide/drag-and-drop) for drop modes,
keyboard moves and multi-select.

## Large catalogues

- **Load subcategories on demand.** Send only the top level and fetch each
  branch when it is opened. See [Children on demand](/guide/children-on-demand).
- **Filter** to the matching categories and the parents above them.
  See [Filtering](/guide/filtering).
- **Cap categories with thousands of children.** See [Very wide levels](/guide/wide-levels).
- **Subtree queries.** `chart.api.stats(id)` returns nested-set `lft` and `rgt`
  bounds, so "is this category under that one" is a comparison rather than a
  walk up the tree. See the [Chart API](/api/chart).

## Your own row

Each category is your own Vue, React or DOM component, with a product count, a
visibility toggle, an edit button or whatever you need. See [Node content](/guide/node-content).
The same data also draws as a [tree view](/tree-view), an [org chart](/org-chart),
or a [sunburst](/guide/layouts#sunburst) that sizes each category by its number
of products.
