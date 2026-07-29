---
title: Filtering
description: 'Reduce a chart to what matters: filter to matches and their ancestors, how it differs from search, and how to filter by branch cheaply.'
---

# Filtering

A chart of six hundred people has the person you want in it somewhere. A
filter is how you get a chart of just them:

```ts
const found = chart.api.filter('rossi')   // the ids that matched
chart.api.filter(null)                    // back to the whole tree
```

A substring on the label, or your own predicate:

```ts
chart.api.filter((item) => item.status === 'open')
```

## What stays

The matches, and the ancestors that lead to them. So the result is a **tree**
rather than a list, and you can see where each hit lives — which is usually
half of what you wanted to know.

A match's own children are hidden unless they match too. Answering "where are
the things I asked for" with their subtrees attached puts back most of what was
taken away.

Nothing else about the chart changes. `filter` returns the ids that **matched**
— not everything left on screen, which also includes those ancestors and which
nobody asked about.

## It opens what it needs to

A filter that found something and then left it behind a collapsed branch would
be answering a different question than the one you asked. So it overrides
collapse for as long as it runs.

Your expand state is untouched underneath, and comes back exactly as it was
when you clear the filter.

## Filtering is not searching

| | |
| --- | --- |
| [`search(query)`](/api/chart#finding-and-marking) | A **question**. Scans the whole tree — including branches that are collapsed, isolated away or filtered out — and changes nothing. |
| `filter(query)` | A **command**. Changes what the chart is. |

That division is what makes `search` the thing the other commands are built
from: feed a result's id to `focus`, its whole set to `highlight`, or the same
predicate to `filter`. "Is there a Rossi anywhere in this company" is not a
question about the current view, and a search that could only find what was
already on screen would be no use for getting to what is not.

## What it costs

Like [`isolate`](/api/chart#camera), a filter prunes and lays the tree out
again rather than hiding things at draw time — so the minimap, the
screen-reader tree, drag-and-drop and the exports all agree with what is drawn,
without any of them knowing a filter exists. It is refitted afterwards for the
same reason it prunes: whatever the camera was framing has moved or gone.

Building the mask walks up from each match and stops at the first node already
marked, so every ancestor is climbed once. On a large tree the whole thing
costs about what a plain `refresh()` of the same tree does.

## Filtering by branch

If what you want is "everything under Engineering", the nested-set bounds on
[`stats(id)`](/api/chart#is-this-node-inside-that-branch) are cheaper than a
predicate that walks the tree:

```ts
const branch = chart.api.stats('engineering')!
chart.api.filter((item) => {
  const node = chart.api.stats(String(item.id))
  return node !== null && node.lft > branch.lft && node.rgt < branch.rgt
})
```

Two comparisons per node instead of an ancestor walk of unbounded length.

For "show me only this branch, as if it were the whole chart", you want
[`isolate`](/api/chart#camera) instead — it re-roots rather than filters.

## In a view

`getView()` carries the filter, so a filtered chart survives being put in a
URL. One limit, stated rather than rounded: a filter set with a **predicate**
cannot be serialised, so `getView` reports `filter: null` for one and a
restored view shows the whole tree.

## Try it

The [playground](https://klad.ozdemir.be/playground/)'s **Filter** example is a
search box over six hundred people — type a name and watch the chart become the
handful that match, with the chain to each one intact.
