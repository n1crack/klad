/**
 * Copies the repository's licence file into the package that is being built.
 *
 * It cannot simply be listed in a package's `files` and left at the repo
 * root: npm packs only what is inside the package directory, and it skips a
 * listed path that does not exist there — silently. Without this step every
 * tarball would ship with no licence at all, which is the one file
 * a consumer most needs.
 *
 * Run from a package directory (each package's `build` script does), so the
 * destination is the current working directory and the source is two levels
 * up. The copies are build output, not source: `.gitignore` keeps them out of
 * the repository, and they are refreshed on every build so they can never
 * drift from the originals.
 */
import { copyFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const FILES = ['LICENSE']

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageDir = process.cwd()

await Promise.all(FILES.map((file) => copyFile(join(repoRoot, file), join(packageDir, file))))
