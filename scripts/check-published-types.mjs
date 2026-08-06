/**
 * Installs each published package the way a stranger would and asks the one
 * question nothing else here asks: are its types actually there?
 *
 * `check-packages.mjs` catches a symptom — a published `.d.ts` naming a module
 * the consumer has no claim on. That is the shape the bug took in 1.9.0, where
 * `@klad/vue`'s declarations reached for `@vue/runtime-core` and, on a package
 * manager that does not flatten `node_modules`, could not find it. But the
 * DISEASE was not the module name. It was that TypeScript reported nothing:
 * `skipLibCheck` is on by default, a `.d.ts` that fails to resolve an import
 * degrades to `any` in silence, and the component's props, events, slot and
 * exposed `api` all became `any` without a single diagnostic. A broken
 * generic, a dropped export or a bundler regression would produce exactly the
 * same silence by a different route, and the module-name check would see none
 * of them.
 *
 * So this asks the question directly. For each package: pack it, install the
 * tarball into an empty project alongside its peers, and type-check a file
 * that asserts the package's main export is NOT `any` — with `skipLibCheck`
 * turned OFF, so an unresolvable import inside the shipped declarations is a
 * hard error rather than a shrug.
 *
 * `pnpm` is deliberate: its layout is the strict one. A dependency that
 * resolves only because npm hoisted it into a flat tree resolves here too, and
 * that is the difference between a package that works everywhere and one that
 * works until someone switches package managers.
 *
 * Slower than the rest of `check:packages`, because it is four real installs.
 * That is the price of asking about the artefact instead of about the source,
 * and the reason it is worth paying is that every other check in this
 * repository resolves these packages through their workspace `exports`, which
 * point at `src/`. Nothing else looks at what is published.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * pnpm as the running process was launched with, when there is one — a bare
 * `pnpm` may not be on PATH in a CI shell and is a `.cmd` shim on Windows.
 * `npm_execpath` is only set when this runs THROUGH a package script, though,
 * and running the file directly is the obvious thing to try when debugging it.
 * Falling back to the name rather than assuming the variable is what keeps
 * that from failing with `Cannot find module '.../pnpm'`, which says nothing
 * about what actually went wrong.
 */
const runPnpm = (args, options) => {
  const execpath = process.env.npm_execpath
  return execpath
    ? execFileSync('node', [execpath, ...args], options)
    : execFileSync('pnpm', args, { ...options, shell: process.platform === 'win32' })
}

/**
 * One export per package, chosen as the one a consumer reaches for first — if
 * this is `any`, everything behind it is too. The peers are what a consumer
 * would be told to install; without them the package's own declarations cannot
 * resolve and the check would fail for a reason that is not the package's
 * fault.
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
 * `0 extends 1 & T` is only true when `T` is `any` — the one way to ask
 * TypeScript whether it still knows anything about a type. Annotating the
 * constant `false` is what turns the answer into a compile error: if the
 * import degraded, `IsAny` is `true`, and `true` is not assignable to `false`.
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
    // The whole point. On — the default, and what hid this for a release —
    // an unresolvable import inside a dependency's `.d.ts` is silence.
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
     * `hoist=false` is the line that makes this check mean anything, and it was
     * missing on the first attempt — with pnpm's default `hoist-pattern=*`,
     * every transitive dependency is linked into `node_modules/.pnpm/node_modules`
     * where resolution walking up from the package finds it anyway. The check
     * passed with the bug deliberately reintroduced, which is worse than not
     * having written it.
     *
     * Off, a package can reach exactly what it declared and its peers, and
     * nothing else. That is the layout the 1.9.0 bug only appeared in.
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
     * `skipLibCheck: false` reads every `.d.ts` in the program, not only this
     * package's, so a problem inside somebody else's types lands here too —
     * `@vue/compiler-core` cannot resolve `@babel/types`, which is Vue's
     * business and not a reason to fail a release of this. Only two kinds of
     * error are ours: one in a file belonging to the package under test, and
     * one in the probe, which is the type assertion coming apart.
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
process.stdout.write('\nAll four packages keep their types on the way out.\n')
