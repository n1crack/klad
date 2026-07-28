---
'@klad/core': minor
---

Picking, not "show them all".

`NodeContext.overflow` now carries `items` alongside `ids` — the hidden nodes'
own data objects, in the same order — so a picker can show names without going
back to the host's array to look each one up.

And `refresh()` re-reads `maxChildren` and `pinChildren`. That is how a working
set reaches the chart: `pinChildren` closes over a set the host mutates, and
when that set changes neither the options object nor the data has, so there was
nothing for the chart to notice. Those are per-node answers from the host
exactly as `nodeSize` is, and re-reading those means re-reading these. With a
cap configured `refresh()` now takes the heavier path and animates, because a
cap is structure rather than a measurement.

Together these are what a big level actually needs. `showMore` is right for a
level of twelve with a cap of eight; it is wrong for a level of four hundred,
where unreadable is the problem the cap is solving and a button back to
unreadable is that problem with an invitation attached. The guide now says so
and shows the picker instead.
