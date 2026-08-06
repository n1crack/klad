/**
 * Packs each package, installs the tarball into an empty project next to its
 * peers, and type-checks a probe asserting the main export is not `any`.
 *
 * `check-packages.mjs` only inspects module names in the output, which misses
 * the failure this exists for: with `skipLibCheck` on, a `.d.ts` whose import
 * does not resolve degrades to `any` with no diagnostic. That is how 1.9.0
 * shipped `@klad/vue` as `any` on package managers that do not flatten
 * `node_modules`.
 *
 * Four real installs, so it is slow. Worth it because every other check here
 * resolves these packages through the workspace, which points at `src/`.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The pnpm this process was launched with: a bare `pnpm` may not be on PATH in
 * a CI shell, and is a `.cmd` shim on Windows. `npm_execpath` is unset when the
 * file is run directly, hence the fallback.
 */
const runPnpm = (args, options) => {
  const execpath = process.env.npm_execpath
  return execpath
    ? execFileSync('node', [execpath, ...args], options)
    : execFileSync('pnpm', args, { ...options, shell: process.platform === 'win32' })
}

/**
 * One export per package — the first thing a consumer reaches for; if that is
 * `any`, everything behind it is too. `peers` are what a consumer would be told
 * to install, without which the declarations cannot resolve anyway.
 */
const SUBJECTS = [
  { dir: 'packages/engine', name: '@klad/engine', symbol: 'VERSION', peers: [] },
  { dir: 'packages/core', name: '@klad/core', symbol: 'createKlad', peers: [] },
  { dir: 'packages/vue', name: '@klad/vue', symbol: 'Klad', peers: ['vue@^3.5.0'] },
  {
    dir: 'packages/react',
    name: '@klad/react',
    symbol: 'Klad',
    peers: ['react@^19.0.0', 'react-dom@^19.0.0', '@types/react@^19.0.0'],
  },
]

/**
 * `0 extends 1 & T` is only true when `T` is `any`. Annotating the constant
 * `false` turns that into a compile error when the import has degraded.
 */
const probe = (name, symbol) => `import { ${symbol} } from '${name}'

type IsAny<T> = 0 extends 1 & T ? true : false

export const stillTyped: IsAny<typeof ${symbol}> = false
`

const tsconfig = {
  compilerOptions: {
    target: 'ES2023',
    module: 'ESNext',
    moduleResolution: 'bundler',
    strict: true,
    noEmit: true,
    // The point of the check: on, which is the default, an unresolvable import
    // inside a dependency's `.d.ts` passes without a word.
    skipLibCheck: false,
    lib: ['ES2023', 'DOM'],
    jsx: 'react-jsx',
  },
  include: ['probe.ts'],
}

const tarballs = mkdtempSync(join(tmpdir(), 'klad-types-'))
let failed = false

for (const { dir, name, symbol, peers } of SUBJECTS) {
  process.stdout.write(`\n── ${name} · types as installed ──\n`)
  const consumer = mkdtempSync(join(tmpdir(), 'klad-consumer-'))
  try {
    const packed = runPnpm(['pack', '--pack-destination', tarballs], {
      cwd: join(repoRoot, dir),
      encoding: 'utf8',
    })
    const tarball = packed.trim().split('\n').at(-1).trim()

    mkdirSync(consumer, { recursive: true })
    writeFileSync(
      join(consumer, 'package.json'),
      JSON.stringify({ name: 'consumer', private: true, type: 'module' }),
    )
    writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2))
    writeFileSync(join(consumer, 'probe.ts'), probe(name, symbol))

    /**
     * Without `hoist=false` the check is worthless: pnpm's default links every
     * transitive dependency into `node_modules/.pnpm/node_modules`, where
     * resolution finds it anyway — with it on, the check passed against the
     * 1.9.0 bug reintroduced on purpose. Off, a package reaches what it
     * declared and its peers, and nothing else.
     */
    writeFileSync(join(consumer, '.npmrc'), 'hoist=false\nshamefully-hoist=false\n')

    // `--ignore-workspace` so this temp directory is not adopted into the
    // repository's workspace, which would resolve the package from source and
    // check the very thing this exists to avoid checking.
    runPnpm(['add', '--ignore-workspace', tarball, ...peers, 'typescript@5.9.3'], {
      cwd: consumer,
      stdio: 'pipe',
    })
    /**
     * `skipLibCheck: false` reads every `.d.ts` in the program, including other
     * people's — `@vue/compiler-core` cannot resolve `@babel/types`, which is
     * Vue's business. Only errors in the package under test or in the probe are
     * ours.
     */
    let diagnostics = ''
    try {
      execFileSync(
        'node',
        [join(consumer, 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', 'tsconfig.json'],
        { cwd: consumer, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      )
    } catch (error) {
      diagnostics = `${error.stdout ?? ''}${error.stderr ?? ''}`
    }

    const ours = diagnostics
      .split('\n')
      .filter((line) => line.includes('error TS'))
      .filter((line) => line.startsWith('probe.ts') || line.includes(`/${name}/`))

    if (ours.length === 0) {
      process.stdout.write(`${symbol} is still typed after a clean install\n`)
    } else {
      for (const line of ours) process.stdout.write(`${line}\n`)
      process.stdout.write(`\n${name}'s published types do not survive being installed\n`)
      failed = true
    }
  } catch (error) {
    process.stdout.write(`could not check ${name}: ${error.message}\n`)
    failed = true
  } finally {
    rmSync(consumer, { recursive: true, force: true })
  }
}

rmSync(tarballs, { recursive: true, force: true })

if (failed) {
  process.stdout.write('\nPublished types failed to survive installation — see above.\n')
  process.exit(1)
}
process.stdout.write('\nAll four packages keep their types through a clean install.\n')
