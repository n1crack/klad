import { defineConfig } from 'tsdown'

/**
 * A plain TypeScript package, which it did not used to be. `Klad` was a Single
 * File Component, so this config compiled it with `unplugin-vue` and routed
 * declaration emit through `vue-tsc` (`dts: { vue: true }`) — the only thing
 * that can type an SFC's public surface.
 *
 * Declaration emit is now on the same path every other package here uses, and
 * `tsconfig.build.json` is what makes that path correct: its `paths` point the
 * sibling packages at their BUILT declarations, so the emitted imports name
 * files a consumer will actually have. That file was malformed JSON for a
 * while and TypeScript read it anyway, minus the parts it could not parse —
 * which is how these declarations came to name `@vue/runtime-core`, a package
 * nothing here depends on. See `src/Klad.ts` for the whole account.
 */
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: 'esm',
  dts: { tsconfig: 'tsconfig.build.json' },
  clean: true,
  platform: 'neutral',
})
