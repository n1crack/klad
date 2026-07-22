import { afterEach } from 'vitest'

// Tells React this environment intends to wrap updates in `act(...)` (which
// the test file does around every render/state change), so React applies
// its synchronous, test-friendly effect-flushing behaviour instead of
// warning that updates may not be reflected in assertions.
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Mirrors packages/vue/src/test-setup.ts and packages/vanilla/src/test-setup.ts:
// each test mounts its own host <div> (and canvas), but document.querySelector
// is unscoped, so an earlier test's un-destroyed chart — first in document
// order — shadows the element belonging to the test that is actually running.
// Wiping the body between tests keeps that lookup honest.
afterEach(() => {
  document.body.replaceChildren()
})
