---
'@klad/docs': patch
---

A guide and a playground example for filtering.

1.5 shipped `filter` with only an API-reference entry, and no example at all —
which for the one feature you drive by typing is the wrong way round.

The playground's **Filter** example is a search box over six hundred people:
type a name and the chart becomes the handful that match, with the chain to
each one intact. The count beside the box is what makes "nothing matched"
different from "something is broken".

The guide says what stays and what does not, why a match's own children go, how
this differs from `search` (a question, not a command), what it costs, and how
to filter by branch with the nested-set bounds instead of a predicate that
walks the tree.

The roadmap has 1.5 as released.
