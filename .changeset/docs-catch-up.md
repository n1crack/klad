---
'@klad/docs': patch
---

Docs catch-up for everything 1.4 and 1.5 added.

**The node context grew three things and the guide named none of them.**
`lft`/`rgt`, `loading`, and `overflow` are in the table now, where somebody
writing a card would look for them.

**Cards fade in and out, and nothing said so.** The chart writes `opacity`
straight onto your card's slot while a node arrives or leaves, and clears it
when nothing is animating. That is worth knowing before you set an opacity of
your own on the same element, or put a CSS transition on it — the value is
already being interpolated every frame against the curve the canvas underneath
is using, and a transition on top of that puts your card behind its own box.

**`refresh` does more than it said.** It re-reads `maxChildren` and
`pinChildren` as well as `nodeSize` and `label`, which is how a working set you
mutate reaches the chart, and it takes `{ keep: id }` to hold one node's screen
position across the relayout.

2.0's entry says what actually makes it a major version rather than gesturing
at a plugin API: a node reachable more than one way breaks "one parent", "no
cycles" and "a subtree is contiguous" all at once.
