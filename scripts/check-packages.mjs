/**
 * Verifies the four publishable packages as a CONSUMER will receive them,
 * which is the one thing neither the test suite nor the build can tell you.
 *
 * A green build only proves that `tsdown` wrote files. It says nothing about
 * whether the `exports` map points at those files, whether the `types`
 * condition sits before `import` (it must, or TypeScript resolves the JS and
 * reports no types at all), or whether the emitted `.d.ts` actually resolves
 * under a consumer's `moduleResolution`. Every one of those failures survives
 * a green CI and is discovered by the first person to install the package —
 * at which point the only fix is another version, since a publish cannot be
 * taken back.
 *
 * - `publint` reads each manifest against the built files.
 * - `attw` (are-the-types-wrong) resolves the tarball's types the way each
 *   module-resolution mode would. `--profile esm-only` because these packages
 *   are exactly that: no CJS entry is missing, it is absent on purpose, and
 *   without the profile every package "fails" for not having one.
 *
 * The tarball is built here with `pnpm pack` rather than left to attw's own
 * `--pack`, which shells out to `npm pack`. That distinction is the whole
 * reason this comment exists: `publishConfig.exports` — the field that swaps
 * these packages' entry points from `src/*.ts` (how the workspace resolves
 * them without a build) to `dist/*.js` (what a consumer gets) — is a pnpm
 * feature. npm ignores it, so an npm-packed tarball points at source files
 * that `files` does not ship, and attw reports every resolution as failing.
 * Checking the wrong artefact is worse than not checking: it fails loudly for
 * a reason that is not real, and the fix is to stop reading it.
 *
 * Run through the root `check:packages` script, which builds first.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const readManifest = (path) => JSON.parse(readFileSync(path, 'utf8'))

/** The publishable packages, in dependency order — the order a reader would check them in. */
const PACKAGES = ['packages/core', 'packages/vanilla', 'packages/vue', 'packages/react']

/**
 * Resolves a CLI's own entry and runs it with `node` directly, rather than
 * going through a `node_modules/.bin` shim (a shell script on POSIX, a `.cmd`
 * on Windows) or spawning `pnpm exec` (same problem, one process further out).
 *
 * The manifest is read off disk rather than `require`d: both of these CLIs
 * ship an `exports` map that does not include `./package.json`, so asking
 * Node to resolve it is refused outright. They are root devDependencies, so
 * pnpm links them into the root `node_modules` even though it does not hoist.
 */
function binOf(pkg, bin) {
  const dir = join(repoRoot, 'node_modules', pkg)
  const manifest = readManifest(join(dir, 'package.json'))
  const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin[bin]
  return join(dir, entry)
}

const publint = binOf('publint', 'publint')
const attw = binOf('@arethetypeswrong/cli', 'attw')

/**
 * pnpm's own entry, as the running process was launched with — rather than a
 * bare `pnpm`, which may not be on PATH in a CI shell and is a `.cmd` shim on
 * Windows.
 */
const pnpm = process.env.npm_execpath ?? 'pnpm'

const tarballs = mkdtempSync(join(tmpdir(), 'klad-pack-'))
let failed = false

for (const pkg of PACKAGES) {
  const cwd = join(repoRoot, pkg)
  const name = readManifest(join(cwd, 'package.json')).name

  process.stdout.write(`\n── ${name} · publint ──\n`)
  try {
    execFileSync('node', [publint, '--strict'], { cwd, stdio: 'inherit' })
  } catch {
    failed = true
  }

  process.stdout.write(`\n── ${name} · attw ──\n`)
  try {
    const packed = execFileSync('node', [pnpm, 'pack', '--pack-destination', tarballs], {
      cwd,
      encoding: 'utf8',
    })
    // `pnpm pack` prints a summary of what it packed and ends with the path;
    // the last non-empty line is that path.
    const tarball = packed.trim().split('\n').at(-1).trim()
    execFileSync('node', [attw, tarball, '--profile', 'esm-only'], { cwd, stdio: 'inherit' })
  } catch {
    failed = true
  }
}

rmSync(tarballs, { recursive: true, force: true })

if (failed) {
  process.stdout.write('\nPackaging checks failed — see above.\n')
  process.exit(1)
}
process.stdout.write('\nAll four packages check out.\n')
