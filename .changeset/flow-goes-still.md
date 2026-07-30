---
'@klad/core': patch
'@klad/engine': patch
---

Flowing edges stop animating when you zoom out past the point where a dash is
visible.

At the `block` tier a connector is a couple of pixels and a dash is smaller
than one, while dashed stroking costs the rasteriser real work per segment —
so on a large chart that was thousands of edges paying, sixty times a second,
for something nobody could see. They are drawn as ordinary lines there, and
the chart stops asking for frames at all.

The same rule the elbow radius already follows, for the same reason.

Measured on 20,000 nodes with every edge flowing, which is not a sensible
setting: 19 frames in 400ms close up, and 0 zoomed out.
