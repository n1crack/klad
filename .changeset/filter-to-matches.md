---
'@klad/engine': minor
'@klad/core': minor
---

`filter(query)` — reduce the chart to what matches.

```ts
const found = chart.api.filter('schema')   // the ids that matched
chart.api.filter(null)                     // back to the whole tree
```

A substring on the label, or your own predicate. What stays is the matches
plus the ancestors that lead to them, so the result is a tree rather than a
list and you can see where each hit lives. A match's own children are hidden
unless they match too: answering "where are the things I asked for" with their
subtrees attached puts back most of what was taken away.

It overrides collapse. A filter that found something and then left it hidden
behind a closed ancestor would be answering a different question than the one
that was asked. Expand state is untouched underneath and comes back when the
filter is cleared.

Like `isolate`, this prunes and lays out again rather than hiding nodes at draw
time — so the minimap, the screen-reader tree, drop resolution and the exports
all agree with what is drawn, without any of them learning about filtering.
Under a filter the keyboard's right arrow moves inward rather than expanding,
since the mask has already decided what is on screen.

The engine's half is `setFilter(keep)`, a source-indexed mask. Working out what
matches, and which ancestors lead to it, stays with the caller: matching is a
question about their data, which the engine addresses by index and cannot see.

Also corrected: `isolate`'s documentation claimed it constrained `search`. It
never has. `search` deliberately scans the whole tree — including branches that
are collapsed, isolated away or filtered out — because "is there a Rossi
anywhere in this company" is not a question about the current view, and a
search that could only find what was already on screen would be no use for
getting to what is not. That is now what the docs say, and `search`'s own
docblock says why.
