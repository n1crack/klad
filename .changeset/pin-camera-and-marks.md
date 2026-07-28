---
'@klad/core': minor
---

`refresh({ keep })` — hold one node's screen position across the relayout.

Ticking somebody in a picker hung off an aggregate node swaps who is on that
level, and without a pin the level slid out from under the panel the viewer was
still reading. `keep` is the same pin a drop puts on its target. The aggregate
node is the right anchor here, unlike a `showMore`: the cap stays on, so the
node stays too.

`animateNextLayout` also takes the direction now — `opening`, defaulting to
`true`. The transition is two phases and which visual job each does flips with
it: arriving, room is made first and the new nodes settle into it; leaving,
they go first and the gap closes behind them. A move previously had no opinion
and inherited whatever the last expand or collapse left behind, so the same
action could animate one way after opening a branch and the other after closing
one. A cap change derives it from what actually happened to the tree.
