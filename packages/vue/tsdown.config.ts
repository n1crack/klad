import { defineConfig } from 'tsdown'

/**
 * A plain TypeScript package, which it did not used to be. `Klad` was a Single
 * File Component, so this config compiled it with `unplugin-vue` and routed
 * declaration emit through `vue-tsc` (`dts: { vue: true }`) — the only thing
 * that can type an SFC's public surface.
 *
 * Declaration emit is now on the same path every other package here uses.
 * That removed Volar's `__VLS_*` codegen from the output but NOT the
 * `@vue/runtime-core` references in it, which come from `defineComponent`'s
 * inferred return type and are corrected after the fact — see the `build`
 * script in this package's manifest and `scripts/normalize-dts.mjs`.
 */
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: 'esm',
  dts: { tsconfig: 'tsconfig.build.json' },
  clean: true,
  platform: 'neutral',
})
