---
'@klados/core': minor
'klados': minor
'@klados/vue': minor
'@klados/react': minor
---

New `DARK_THEME` export — the same `Theme` shape as `DEFAULT_THEME`, with the
values a dark host needs. Exported from every package, so an adapter user never
has to add the vanilla package as a dependency to name it.

`nodeFill` and `cornerRadius` are the two tokens a dark theme cannot get wrong:
the canvas paints that box behind your overlay cards, so a card whose CSS
disagrees leaves the box showing around its edges. The theme documentation now
says so, with the one-value-drives-both recipe.
