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

| | |
|---|---|
| `@klad/engine` (`packages/core`) | Layout, viewport maths, the quadtree, the renderer, the worker protocol. No DOM. |
| `@klad/core` (`packages/vanilla`) | The frameworkless chart. The reference every adapter is written against. |
| `@klad/vue`, `@klad/react` | Thin adapters over `@klad/core`. |

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
