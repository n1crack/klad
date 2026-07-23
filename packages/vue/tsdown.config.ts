import { defineConfig } from 'tsdown'
import Vue from 'unplugin-vue/rolldown'

/**
 * The one package with a Single File Component in it. `unplugin-vue` compiles
 * `Klad.vue` for the JS output; `dts: { vue: true }` routes declaration
 * generation through `vue-tsc`, which is the only thing that can type an SFC's
 * public surface (its props, emits and slots live in the template as much as
 * in the script).
 */
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: 'esm',
  dts: { vue: true, tsconfig: 'tsconfig.build.json' },
  clean: true,
  platform: 'neutral',
  plugins: [Vue({ isProduction: true })],
})
