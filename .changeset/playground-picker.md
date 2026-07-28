---
'@klad/docs': patch
---

The playground's wide-levels example, rebuilt around picking.

The card said "click to show them all", which is the one thing a level of a
hundred should not offer. It now opens a small panel: a search box, a virtual
list of the hidden nodes with a checkbox each, and the checked ones sorted to
the top so a working set stays together as the search narrows. Ticking pins
that node onto the chart; nothing ever shows the whole level.

Plain DOM shared by all three framework demos — what it is is a list widget,
and three copies of a virtual list is three places for it to drift.

Two other things while there. The dataset fanned out to 57,000 nodes, which
made switching to the example crawl: a cap draws almost nothing either way, but
every pass that decides WHAT to draw is over the whole array. It is now about
8,000, which is the shape the example is about without the size it was not.
And the default is three per level rather than eight.

Children on demand also renders cards now instead of file rows when you switch
it to a tiered layout. It opens as a file list and the `file` preset still
forces rows there — but declaring rows on the example itself meant switching to
`tidy` drew file rows, indent lines and all, laid out as an org chart. Loading
children on demand is not a file-layout feature and should not look like one
the moment you leave it.
