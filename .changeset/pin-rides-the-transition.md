---
'@klad/core': patch
---

The camera pin now rides the transition instead of jumping ahead of it.

A pin holds one node's screen position across a relayout — the target of a
drop, the parent of a lifted cap, the node a lazy load hung off. It solved once
against where that node would END UP, on the first frame, while every node was
still drawn where it had been. So the whole chart jumped the full distance and
then drifted back into place, which reads as a snap and hides the animation
completely.

It is now re-solved every frame against the node's interpolated position, for
as long as the transition runs. The pinned node stays genuinely still and
everything reflows around it, which is what a pin was supposed to mean.

Visible on any pin where the node moves far. Lifting a cap on a level of twenty
moved the chart 532 pixels on frame one; drops mostly got away with it because
a drop target rarely moves much.

Also measured and written down: on a 20,000-node forest a full relayout is
328ms uncapped and 315ms with a cap and a pin predicate, and filtering the same
tree to 11,000 matches costs about what a plain `refresh()` does.
