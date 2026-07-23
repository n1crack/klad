---
'@klad/core': minor
---

Pointer and touch fixes.

- Only the primary button pans. A right-click used to drag the chart out from
  under the context menu it had just opened; a middle-click panned while the
  browser started its own auto-scroll. Both are now left alone, so a host's own
  `contextmenu` handler works over a chart that holds still.
- The host is given `touch-action: none` while a chart is mounted (restored on
  `destroy()`), so a one-finger drag pans the chart instead of scrolling the
  page and a pinch zooms the camera instead of the document.
- Text selection is suppressed on the host: a pan starting on an overlay card
  used to drag-select its label, and on touch pop the selection handles
  mid-drag. Buttons, links and form controls in a card are unaffected.
