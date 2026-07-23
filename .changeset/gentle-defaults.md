---
'@klad/core': minor
'@klad/vue': minor
'@klad/react': minor
'@klad/engine': minor
---

`data` is now the only option without a default.

`nodeSize` defaults to `{ w: 180, h: 64 }` — a readable name-and-role card at
1:1, exported as `DEFAULT_NODE_SIZE` for anyone sizing their own cards around
it. `label` defaults to whichever of `name`, `label` or `title` a node
actually carries, falling back to its `id`.

```ts
createKlad(host, { data }) // a working chart
```

Both were required before, and neither had to be: the first was a number
almost every chart set to something similar, and the second was a one-line
accessor over a field the data was already using. Between them they made the
smallest possible chart three options long and made a missing label look like
a rendering fault rather than a setting. Explicit values behave exactly as
before — including `label: () => ''` for a node that should stay blank.
