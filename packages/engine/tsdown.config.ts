import { defineConfig } from 'tsdown'

/**
 * Three entries, named so the built layout mirrors the source one:
 * `publishConfig.exports` points at `dist/index.js` and `dist/worker/host.js`,
 * and the worker itself has to land beside `host.js` because that is where
 * `host.ts` looks for it — `new URL('./chart.worker.js', import.meta.url)`,
 * resolved relative to the module doing the asking.
 *
 * `chart.worker.ts` is not reachable from either public entry (nothing
 * imports it; it is fetched at runtime as a URL), so it has to be named here
 * or it would not be built at all.
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'worker/host': 'src/worker/host.ts',
    'worker/chart.worker': 'src/worker/chart.worker.ts',
  },
  format: 'esm',
  dts: true,
  clean: true,
  // Nothing to bundle in: this package has no runtime dependencies at all.
  platform: 'neutral',
})
