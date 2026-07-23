---
'@n1crack/orgchart': minor
---

New `minimap.silhouetteColour` option. The plate, border and viewport rectangle
are DOM and can always be restyled from a host stylesheet; the silhouette is
written straight into an `ImageData` buffer, so it was the one part of the
widget a dark theme could not reach.
