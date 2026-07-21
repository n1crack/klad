import { afterEach } from 'vitest'

// Mirrors packages/vanilla/src/test-setup.ts: each test mounts its own host
// <div> and canvas, but document.querySelector('canvas') is unscoped, so an
// earlier test's un-destroyed chart — first in document order — shadows the
// element belonging to the test that is actually running. Wiping the body
// between tests keeps that lookup honest.
afterEach(() => {
  document.body.replaceChildren()
})
