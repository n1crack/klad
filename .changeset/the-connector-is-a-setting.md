---
'@klad/core': minor
'@klad/react': minor
'@klad/vue': minor
---

The line between a parent and a child is a setting now.

```ts
createKlad(el, { data, edgeStyle: 'spoke' })   // tidy, but straight lines
createKlad(el, { data, edgeStyle: 'none' })    // no connectors at all
```

`'tiered' | 'folder' | 'spoke' | 'none'`. Each layout still picks the one that
reads correctly on it and that stays the default, because a folder guide line
down a tiered chart is a mistake rather than a taste. This is for the chart
that wants a different answer anyway: a wide tidy tree that reads better with
straight lines, or one whose own cards already carry the structure and where
the lines are noise.

Changeable live through `setLayoutOptions`, and the SVG export follows it, so
an export of a chart drawn with straight lines does not come back with elbows.

**It does not cost you the "there is more inside" mark.** The short stub and
dot below a collapsed node used to disappear for `'spoke'` and `'none'`, which
was correct while those could only mean a wheel — a wheel draws its own arc or
halo instead. Chosen freely they can now land on a tiered chart, where the
branch still continues downward whether or not a line is drawn to it, and at
the zoom where the cards and their toggles are gone that mark is the only thing
saying so. It stays. `'folder'` still drops it on purpose: a file row has a
chevron beside its name and a stub underneath would say it twice.

Changing the style relayouts rather than repainting, because `'none'` skips
building the edge index and its whole quadtree — coming back from it has to
build one.

The playground's View panel has a **Connector** control on every layout.
