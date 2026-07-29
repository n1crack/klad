---
'@klad/core': minor
'@klad/react': minor
'@klad/vue': minor
---

Every per-node option now gets a second argument saying where the node sits.

`nodeSize`, `label`, `collapsedByDefault`, `mayHaveChildren` and `pinChildren`
were each handed the node's data and nothing else, so none of them could answer
a question about depth or about a node's place among its siblings. They now
receive a `NodePlace`:

```ts
createKlad(el, {
  data,
  collapsedByDefault: (item, at) => at.depth > 2,
})
```

`{ depth, index, siblings, parent }` — distance from a root, the slot among its
own siblings in data order, how many siblings there are counting itself, and
the parent's data.

A flat `{ id, parentId }` array does not say what depth anything is at, so the
alternative was walking parent links yourself, once per node per data change.
The playground had to do exactly that, and the workaround it needed is deleted
by this: a cached depth map keyed by the dataset, plus a per-example override
for the one example the map could not answer — the file explorer that fetches
its own rows, because a row `loadChildren` returned is in no array you hold.

Every field is about the node's place in the DATA, not on screen. Depth does
not change when a branch is collapsed or a filter hides its siblings, and the
export path reports a node's real sibling slot rather than its slot among
whatever survived pruning.

Additive — an option written against the old single-argument signature keeps
working unchanged.

Measured rather than assumed: a 20,000-node refresh with both `nodeSize` and
`label` as functions goes from 318.9ms to 328.6ms, so building forty thousand
of these costs about 3% of a relayout. The sibling index is swept once per tree
and cached against the tree object, not read off the CSR per node.
