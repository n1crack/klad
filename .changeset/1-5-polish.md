---
'@klad/core': patch
---

Four gaps found reviewing 1.5, all of them the node a capped level invents
leaking somewhere it does not belong.

- **It could be dragged, and dropped into.** Both are now refused, from the
  pointer and from the keyboard. It stands for other nodes rather than being
  one, so moving it has no meaning — and `nodeDrop` must never report an id the
  host has never seen. That included the case where a box or lasso selection
  swept it up and a drag carried the whole selection.
- **`search` returned it.** Its `item` is a stub with nothing on it but an id,
  so a caller looping results to read a field would find nothing there.
- **`stats` counted it.** A card reading `directChildren` to say "20 reports"
  said 21. The counts now leave the invented nodes out; `lft`/`rgt`, being
  positions rather than counts, still include them, which leaves containment
  correct and scopes the `rgt - lft === 2 * descendants + 1` identity to a
  chart with nothing capped.
- **A view did not carry the caps or the filter.** `getView`/`setView` now
  round-trip `filter`, `uncapped` and `revealed` alongside `isolated` — a link
  that restored everything except what the viewer had filtered and opened up
  would come back a different chart. A filter set with a predicate is the one
  thing a view cannot carry, since a function does not go in a URL; that is
  stated rather than silently rounded to "no filter".
