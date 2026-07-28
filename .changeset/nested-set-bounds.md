---
'@klad/engine': minor
'@klad/core': minor
'@klad/vue': minor
'@klad/react': minor
---

`stats(id)` now carries nested-set bounds: `lft` and `rgt`.

A node's pair brackets every pair below it, which turns "is this node inside
that branch" from a walk up the parent chain of unbounded length into two
comparisons:

```ts
const branch = chart.api.stats('engineering')!
const node = chart.api.stats('lead-42')!
const inside = node.lft > branch.lft && node.rgt < branch.rgt
```

That is what makes filtering a large tree by branch cheap enough to do per
frame, which is what they are here for. Strict on both sides, so a node is not
inside itself, and `rgt - lft` is `2 * descendants + 1`, so the pair carries
the subtree size too.

The classic interleaved numbering rather than a half-open range, because it is
also what a database storing a hierarchy as nested sets uses — so these can go
straight back after a drag reorders anything. Numbered across the whole forest,
so two roots' ranges never overlap.

Free, in the sense that matters: computed by the same `computeSubtreeStats`
pass that already counts descendants, as a flat sweep over the existing
preorder rather than the enter/exit recursion the numbering is usually
described with. A 50,000-deep chain is a supported input and there is a test
that would blow the stack if this stopped being a sweep.

The six numbers are also on the context every card is rendered with, since
`NodeContext extends NodeStats`.
