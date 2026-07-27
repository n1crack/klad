---
'@klad/docs': patch
---

Rethought the roadmap from 1.4 onward.

Children on demand moves to 1.4 — 1.2's text promised it and the roadmap never
listed it, and it is the feature the rest depend on: a tree that exceeds memory
is the case the wide-level work and the graph work both assume. Very wide
levels and filtering to matches merge into one release, since both answer
"show me less of this". Custom edges merge into custom layouts, because which
connector a layout draws is part of that layout rather than a setting beside
it. Cross-links merge into 2.0, where the multi-parent routing they need lives.

Nested sets is dropped. `lft`/`rgt` is a storage encoding, not a way of looking
at a tree, and binary-tree presentation is a layout rather than a release.
