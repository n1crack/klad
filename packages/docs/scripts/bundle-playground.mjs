/**
 * Builds the playground for this site's base path and copies it into
 * `public/playground/`, from where VitePress serves it verbatim.
 *
 * Why build it here rather than reuse the playground's own `dist`: every asset
 * URL Vite emits is prefixed with `base`, and the base differs between the two
 * places this app is served — its own root when you run `pnpm dev`, and
 * `<docs base>/playground/` when it is embedded. One build cannot satisfy
 * both, so this one is made for the embedded case and kept out of git
 * (`.gitignore`) as build output.
 *
 * The result is one deploy and one origin: no second host, no cross-origin
 * anything, and a link back to the docs that is a plain relative path.
 */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { cp, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const docsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(docsDir, '..', '..')
const playgroundDir = join(repoRoot, 'packages', 'playground')

const docsBase = process.env.DOCS_BASE ?? '/'
const playgroundBase = `${docsBase.replace(/\/$/, '')}/playground/`

console.log(`building the playground for ${playgroundBase}`)

// Resolved from the PLAYGROUND's own dependencies. pnpm does not hoist, so
// there is no `vite` at the workspace root to reach for, and spawning `pnpm`
// itself would mean shelling out to a `.cmd` on Windows.
const requireFromPlayground = createRequire(join(playgroundDir, 'package.json'))
// Via `package.json` rather than the bin directly: `vite/bin/vite.js` is not
// in vite's `exports` map, so asking for it by path is refused.
const viteBin = join(dirname(requireFromPlayground.resolve('vite/package.json')), 'bin', 'vite.js')

execFileSync('node', [viteBin, 'build'], {
  cwd: playgroundDir,
  stdio: 'inherit',
  env: { ...process.env, PLAYGROUND_BASE: playgroundBase },
})

const destination = join(docsDir, 'public', 'playground')
await rm(destination, { recursive: true, force: true })
await cp(join(playgroundDir, 'dist'), destination, { recursive: true })

console.log('copied the playground into public/playground')
