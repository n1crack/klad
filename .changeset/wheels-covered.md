---
'@klad/docs': patch
---

Covered the wheels, and corrected two things the guide implied but never said.

Every test for filtering and capping ran on a tiered or file layout. The polar
transition tweens four numbers per node rather than a box, and none of the
three new masks — filter, cap, unfetched — had been through it. Five tests now
put both wheels through all of them: a filter cuts a wheel down and comes back,
a cap takes a ring and `focus` still reaches what fell off it, and an unfetched
segment earns the inner-arc mark the wheels have had since 1.2. Nothing was
broken, which is worth knowing rather than assuming.

The two corrections: a wheel's bounds do not shrink when a filter removes
segments — the radius follows the ring count, not how many segments sit on each
ring — so the count is what says a filter worked there. And `reveal` SWAPS
rather than adds: the cap is a budget, so what you ask for takes a slot and
something else drops out. That is the same rule pins follow, and it is now
stated where somebody would look for it.
