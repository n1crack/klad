import { afterEach } from 'vitest'

// The browser test file creates a fresh host <div> (and canvas) per test, but
// document.querySelector('canvas') is unscoped: without this, an earlier
// test's un-destroyed canvas — first in document order — shadows the canvas
// belonging to the test that is actually running. Wiping the body between
// tests keeps `document.querySelector` honest.
afterEach(() => {
  document.body.replaceChildren()
})
