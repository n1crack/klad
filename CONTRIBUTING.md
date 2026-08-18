# Contributing

A pnpm workspace. `pnpm install` at the root, then:

```bash
pnpm dev         # the playground
pnpm docs        # the documentation site
pnpm test        # every package, in a real Chromium
pnpm typecheck
pnpm lint
pnpm build
```

## Packages

|                                    |                                                                                  |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| `@klad/engine` (`packages/engine`) | Layout, viewport maths, the quadtree, the renderer, the worker protocol. No DOM. |
| `@klad/core` (`packages/core`)     | The frameworkless chart. The reference every adapter is written against.         |
| `@klad/vue`, `@klad/react`         | Thin adapters over `@klad/core`.                                                 |

Each depends on the layer beneath it. An adapter takes a **direct** dependency
on the layer it names types from — `@klad/vue` depends on `@klad/engine`, not
only on `@klad/core`, because its published `.d.ts` names types declared there
(`NodeData` and, through it, every event payload), and a strict `node_modules`
layout will not resolve a transitive dependency from a consumer's own tree.

`@klad/docs` lists the playground as a devDependency so turbo knows the edge:
the docs build rebuilds the playground for the site's base path, and without
that edge a playground-only change would serve a stale docs build from cache.

### Why `exports` points at source

Each publishable package's `exports` map points at `src/*.ts`, and its
`publishConfig.exports` points at `dist/*.js`. The first is what lets the
workspace resolve every package without a build step; the second is what npm
publishes. pnpm applies `publishConfig` on pack, so the built tarball ships the
`dist` paths while local development uses the source directly.

`@klad/engine` keeps `./host` as a separate subpath on purpose: `host.ts` is
the one DOM-bound module in that package, and holding it out of the main entry
is what lets the entry stay importable inside a Web Worker.

Packaging is verified before publish by `pnpm check:packages` (publint +
are-the-types-wrong), which runs in CI and again in the release workflow.

## TypeScript

The workspace is on TypeScript 7 — the native compiler — everywhere except
`@klad/playground`, which pins 5.9.3. The TS 7 npm package ships the Go binary
and drops the old JavaScript API: `typescript/lib/tsc` is not in its `exports`
map, and `vue-tsc` loads exactly that path. So one project keeps a 5.9 copy of
its own until Vue Language Tools moves, and pnpm keeps it from leaking into
the other six. The note in `packages/playground/package.json` says when to
delete it.

`@klad/engine` has a fourth tsconfig, `tsconfig.dts.json`, used by nothing but
the declaration emitter tsdown runs. The three narrow configs deliberately
exclude each other's files — each needs a `lib` the others must not have — but
the build has all three as entries, and TS 7 emits declarations by compiling a
tsconfig's program, so a file outside it yields no `.d.ts` at all.

`pnpm lint` runs oxlint with `--type-aware`, which needs a type checker and
gets one from `oxlint-tsgolint` (the same compiler, as a library). It is
slower than the syntax-only pass and worth it: on the run that turned it on it
found a worker test sorting `Uint32Array` indices with the default comparator,
so `[1, 10, 2]` compared equal to itself. `.oxlintrc.json` records the one rule
turned off and why.

## Releasing

Versioning and shipping are separate steps.

1. **While you work**, add a changeset for anything user-facing:

   ```bash
   pnpm changeset
   ```

2. **To release**, apply the pending changesets — this bumps the versions and
   writes the changelogs — then commit the result:

   ```bash
   pnpm version-packages
   git commit -am "chore: version packages"
   git push
   ```

3. **Publish** by creating a GitHub Release tagged `v<version>` (the `v` prefix
   is required):

   ```bash
   gh release create v1.2.0 --title v1.2.0 --notes "…"
   ```

Creating the Release is what ships: the workflow checks out the tag, verifies
it matches the packaged version, runs the full test and packaging suite, and
publishes over OIDC — no npm token, every tarball carrying a provenance
attestation. The four packages share one version, and the workflow **filename**
is part of npm's trusted-publisher configuration: renaming
`.github/workflows/release.yml` stops publishing until npm is told.
