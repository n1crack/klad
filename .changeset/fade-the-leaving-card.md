---
'@klad/engine': minor
'@klad/core': minor
---

Cards fade out when their node leaves, instead of vanishing.

The canvas has faded leaving nodes since 1.0 — a collapse's children shrink
back into their parent — but the host's DOM overlay never heard about them.
They are not in `visible` and never will be, so a chart with real cards on it
faded a box on the canvas while the card sitting on that box blinked out on the
first frame.

Nowhere was that worse than a capped level. Pinning somebody below the cap does
not widen the level, it takes the slot off whoever was last — so two cards
swapped in one place, one vanishing instantly and one fading in. What it read
as was the whole chart re-rendering, which is exactly how it was reported.

The engine now exposes `lastGhostSource`, `lastGhostBoxes` and
`lastGhostAlpha`: the nodes on their way out this frame, their interpolated
boxes and their alphas, three aligned arrays. `null` together on every frame
where nothing is leaving, and bounded by how many actually are — so the steady
state is untouched, the same way `lastDrawnBoxes` is. They cross the worker
boundary transferred rather than cloned, like their siblings.

The vanilla overlay folds them into the same box and alpha maps it already
keeps, so a leaving card animates exactly as an arriving one does. Every
collapse gets this too, not just a capped level.
