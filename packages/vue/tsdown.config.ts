import { defineConfig } from 'tsdown'

/**
 * Plain TypeScript now that `Klad` is a render function rather than an SFC, so
 * declaration emit runs the same way as in every other package here.
 *
 * `tsconfig.build.json` matters: its `paths` point the sibling packages at
 * their built declarations, so the emitted imports name files a consumer
 * actually has. See `src/Klad.ts`.
 */
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: 'esm',
  dts: { tsconfig: 'tsconfig.build.json' },
  clean: true,
  platform: 'neutral',
})
