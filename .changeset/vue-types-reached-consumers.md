---
'@klad/vue': patch
---

Fix `@klad/vue`'s types arriving as `any`

The published declarations named `@vue/runtime-core` — a package private to
`vue`, which `@klad/vue` cannot depend on and only re-exports. Consumers whose
package manager does not flatten `node_modules` (pnpm, and increasingly the
default elsewhere) could not resolve it, and because `skipLibCheck` is on by
default the failure was silent rather than an error: the whole inferred chain
degraded to `any`. In practice `<Klad>`'s `options` prop, all eight of its
events, the `#node` slot payload and the exposed `api` were unchecked, with no
diagnostic to say so. Anyone who typed a template ref as
`InstanceType<typeof Klad>` got `any` back.

The component is now written as a render function rather than a Single File
Component, so its declarations come from the same emitter every other package
here uses instead of from `vue-tsc`; the remaining `@vue/runtime-core`
references, which come from type inference rather than from the SFC, are
rewritten to `vue`. The component's runtime behaviour, props, events, slot and
exposed `api` are unchanged — the point is that they are now typed.

`KladHandle` is exported for naming a template ref — the same name `@klad/react`
already uses for the same thing, and deliberately not `KladInstance`, which
`@klad/core` already exports to mean the chart itself. `InstanceType<typeof Klad>`
carries `api` now too.

Two things guard this going forward: a consumer fixture type-checked against
the built `.d.ts` rather than against source (the workspace resolves the
package to its own `src/`, so nothing here looked at what consumers receive),
and a packaging check that fails the build if any published declaration names
a module that is neither a declared dependency nor a peer.
