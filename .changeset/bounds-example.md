---
'@klad/docs': patch
---

A playground example for nested-set bounds.

`lft` sits against the card's left border and `rgt` against its right, which
turns the numbers into something you can read down a branch: a parent's pair
always encloses its children's, so the left numbers step inward and the right
ones step outward as you descend. That is the whole idea, and it is much
easier to see than to be told.

The subtitle carries the descendant count, because `rgt - lft` is
`2 * descendants + 1` — the pair holds the subtree's size as well as its
position, which is the part nobody expects.

All three framework demos, like every other example.
