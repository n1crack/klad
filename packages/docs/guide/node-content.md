---
title: Node content
description: Put your own Vue, React or plain-DOM components on the nodes. Klad mounts them only where they are on screen and big enough to read.
---

# Node content

Out of the box a node is drawn by the canvas: a rounded box with a truncated
label. That is all a node ever gets when it is small on screen, and it is why
a very large chart is possible at all.

Zoom past the overlay threshold and the chart mounts your own content over the
canvas — but only for the nodes actually in the viewport, roughly fifty of
them, pooled and repositioned from frame to frame rather than created and
destroyed. Your card is a card; it is simply never asked to exist fifty
thousand times.

## Rendering a card

::: tabs key:stack

== Vanilla

```ts
createKlad(host, {
  ...options,
  renderNode(element, context) {
    // `element` is a pooled div, reused across frames and across NODES. Build
    // its children once and update their text afterwards; rebuilding the
    // subtree every frame is exactly the churn the pooling avoids.
    let card = element.firstElementChild as HTMLDivElement | null
    if (card === null) {
      card = document.createElement('div')
      card.className = 'card'
      card.append(document.createElement('strong'), document.createElement('small'))
      element.append(card)
    }
    card.querySelector('strong')!.textContent = String(context.item.name ?? '')
    card.querySelector('small')!.textContent = String(context.item.title ?? '')
  },
})
```

== Vue

```vue
<template>
  <Klad :options="options">
    <template #node="{ item, hasChildren, open, toggle }">
      <div class="card">
        <strong>{{ item.name }}</strong>
        <small>{{ item.title }}</small>
        <button v-if="hasChildren" type="button" @click="toggle">
          {{ open ? '−' : '+' }}
        </button>
      </div>
    </template>
  </Klad>
</template>
```

== React

```tsx
<Klad options={options}>
  {({ item, hasChildren, open, toggle }) => (
    <div className="card">
      <strong>{String(item.name)}</strong>
      <small>{String(item.title)}</small>
      {hasChildren && (
        <button type="button" onClick={toggle}>
          {open ? '−' : '+'}
        </button>
      )}
    </div>
  )}
</Klad>
```

:::

Omit the slot, the render prop or `renderNode` entirely and the chart never
creates overlay DOM at all — a frameworkless consumer pays nothing for a layer
they are not using.

## What a card is told

Every card receives the same context:

| Field            | Type             | What it is                                                                                                                                           |
| ---------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | `string`         | The node's own id, as it appeared in `data`.                                                                                                         |
| `item`           | `NodeData`       | The whole item from `data` — your fields included.                                                                                                   |
| `open`           | `boolean`        | Whether this node's children are currently shown.                                                                                                    |
| `hasChildren`    | `boolean`        | Whether there is anything to open.                                                                                                                   |
| `toggle`         | `() => void`     | Opens or closes this node.                                                                                                                           |
| `directChildren` | `number`         | How many children it has.                                                                                                                            |
| `descendants`    | `number`         | Everyone below it, at any depth.                                                                                                                     |
| `depth`          | `number`         | Distance from the root; a root is `0`.                                                                                                               |
| `height`         | `number`         | How far its own subtree runs below it; a leaf is `0`.                                                                                                |
| `lft` / `rgt`    | `number`         | [Nested-set bounds](/api/chart#is-this-node-inside-that-branch) — this node's pair brackets every pair below it.                                     |
| `loading`        | `boolean`        | A [`loadChildren`](/guide/children-on-demand) for this node is in flight. Always `false` without one.                                                |
| `overflow`       | object or `null` | Set only on the node a [capped level](/guide/wide-levels) rolled its remainder into — what it stands for, and the commands to bring some of it back. |

## Cards fade in and out

A node arriving — a branch you opened, a fetched child, somebody pinned onto a
level — grows into place over the transition rather than appearing. A node
leaving fades out where it was instead of vanishing between frames.

The chart does that by writing `opacity` straight onto your card's element
while it moves, and clearing it again once nothing is animating. Two things
follow:

- **Do not set `opacity` on `.klad-overlay-node` yourself**, or you will be
  fighting it. Style the element _inside_ the slot — the card you rendered —
  and leave the slot to the chart.
- **A CSS `transition` on opacity is not needed and will lag.** The value is
  already being interpolated every frame against the same curve the canvas
  underneath is using, and a transition on top of that puts your card behind
  the box it is sitting on.

A card that is fading out belongs to a node that has left the tree, so
`context.item` is the last data it had. It is on screen for a few hundred
milliseconds and then gone.

The four counts are computed once per tree, in a single pass, so reading them
while a card draws is an array lookup. Counting a subtree at draw time would
be O(subtree) per node per frame — the shape of work this library exists to
avoid.

They describe the **whole** tree, not the expanded part. Folding a branch up
does not change how many people are under it, and a card that said otherwise
would be lying about the org.

```ts
renderNode(element, context) {
  element.textContent = `${context.directChildren} direct · ${context.descendants} total`
}
```

## Interactive content

Cards are ordinary DOM in an ordinary stacking context, so buttons, inputs and
`<select>`s work normally. Two things are worth knowing:

- The chart treats genuinely interactive elements as theirs, not the canvas's,
  so a click on your button does not also toggle the node underneath it.
- A pointer press anywhere else on a card starts a pan, because that is what
  dragging a chart should do. If a control needs the press for itself — a
  `<select>` opening its menu — stop the event: `el.addEventListener(
'pointerdown', (e) => e.stopPropagation())`.

## Two kinds of open

A card can have its own disclosure state — a detail pane, an expanded row —
and it has nothing to do with the chart's expand/collapse of children. Keep it
on your own data rather than deriving it from `context.open`, or the two will
be confused for each other the first time a user opens one and the chart
closes the other.

If that disclosure changes how tall the card is, the layout has to be told;
see [Sizing](/guide/sizing).
