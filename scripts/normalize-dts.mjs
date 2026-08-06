/**
 * Rewrites `@vue/runtime-core` to `vue` in a package's emitted declarations.
 *
 * Why this is needed at all: `defineComponent`'s return type is inferred, and
 * TypeScript names an inferred type's symbols by the file they are DECLARED
 * in. `DefineComponent`, `ExtractPropTypes`, `PublicProps` and the rest are
 * declared in `@vue/runtime-core`; `vue` only re-exports them (its own
 * `vue.d.mts` is a seven-line shim). So the emitted `.d.ts` names a package
 * this one does not depend on and never could — `vue` is a peer dependency,
 * and `@vue/runtime-core` is private to it.
 *
 * What that cost: a consumer whose package manager does not flatten
 * `node_modules` — pnpm, and increasingly the default elsewhere — cannot
 * resolve it. `skipLibCheck` (on by default, and set in this repo's base
 * config) turns that failure into silence rather than an error, the whole
 * inferred chain degrades to `any`, and `@klad/vue`'s props, all eight
 * events, the `#node` slot and the exposed `api` stop being typed at all.
 * Nobody sees a diagnostic. It shipped that way.
 *
 * Why rewriting rather than annotating the component by hand: `DefineComponent`
 * takes TWENTY type parameters. Writing them out to control the emit means
 * restating the public surface manually, which is exactly the thing most
 * likely to get it quietly wrong — and getting it wrong is the bug this
 * fixes. Keeping the inferred type and correcting the module it names is the
 * smaller claim. Every name involved is verified re-exported from `vue`, so
 * the rewrite is a rename, not a reinterpretation.
 *
 * The general protection is not here: `check-packages.mjs` fails the build if
 * any published declaration names a module that is not a declared dependency
 * or peer dependency, which catches this whole family rather than this one
 * member of it. This script exists to make that check pass honestly.
 *
 * Run from a package directory, after `tsdown`.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Private packages whose types are reachable only through their public face. */
const REWRITES = [['@vue/runtime-core', 'vue']]

const distDir = join(process.cwd(), 'dist')

let declarations
try {
  declarations = readdirSync(distDir, { recursive: true }).filter((name) => String(name).endsWith('.d.ts'))
} catch {
  // No dist: nothing was built, and the build step that follows will say so.
  process.exit(0)
}

for (const name of declarations) {
  const path = join(distDir, String(name))
  const before = readFileSync(path, 'utf8')
  let after = before
  for (const [from, to] of REWRITES) {
    // Only as a module specifier — in `import("x")`, `from "x"` or `from 'x'` —
    // so the same string inside a doc comment is left alone.
    after = after.replaceAll(`import("${from}")`, `import("${to}")`)
    after = after.replaceAll(`from "${from}"`, `from "${to}"`)
    after = after.replaceAll(`from '${from}'`, `from '${to}'`)
  }
  if (after !== before) {
    writeFileSync(path, after)
    console.log(`normalized module specifiers in dist/${name}`)
  }
}
